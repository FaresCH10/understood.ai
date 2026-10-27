import {randomBytes,randomUUID} from 'node:crypto';
import {consumeAuthBudget} from './auth-budget.mjs';
import {authMailCapacity} from './auth-mail-budget.mjs';
import {inSchema} from './auth.mjs';
import {linkAccountMembership} from './accounts.mjs';
import {invitationReference,invitationIssueInput,invitationChangeInput,invitationFilters,invitationTokenInput,invitationAcceptInput,invitationRolePolicy,invitationEmailKey} from '../invitation-input.mjs';
import {tokenHash,passwordRecord,passwordMatches} from '../auth-crypto.mjs';
import {sealMail,openMail,sendAuthMail} from '../auth-mail.mjs';
import {requireTenantActive,dispatchAllowed,dispatchPredicate} from './operations-gates.mjs';
const unavailable=()=>new Error('Invitation unavailable');
const invitationEmailHash=email=>tokenHash(invitationEmailKey(email));
const issuerSql=`SELECT s.*,COALESCE(r.revision,1) AS access_revision,a.id AS account_id,a.active AS account_active,
  a.revision AS account_revision,a.credential_staff_id,c.email,c.password_salt,c.password_hash FROM staff s
  LEFT JOIN staff_access_revisions r ON r.staff_id=s.id LEFT JOIN staff_account_memberships m ON m.staff_id=s.id
  LEFT JOIN staff_accounts a ON a.id=m.account_id LEFT JOIN staff_credentials c ON c.staff_id=a.credential_staff_id`;
async function identity(client,id) {return (await client.query(issuerSql+' WHERE s.id=$1',[id])).rows[0];}
async function currentSession(client,session) {
  return !session.token_hash || !!(await client.query(`SELECT 1 FROM sessions WHERE token_hash=$1 AND principal_type='staff' AND access_mode='credential'
    AND principal_id=$2 AND org_id=$3 AND site_id=$4 AND revoked_at IS NULL AND expires_at>clock_timestamp()`,[session.token_hash,session.principal_id,session.org_id,session.site_id])).rows[0];
}
async function authority(client,session,write=false,role='auditor') {
  if(session?.principal_type!=='staff' || session.access_mode!=='credential') throw new Error('Forbidden');
  await requireTenantActive(client,session.org_id);
  const row=await identity(client,session.principal_id);
  if(!row?.active || !row.account_active || !row.email || row.org_id!==session.org_id || row.site_id!==session.site_id || row.role!==session.role || !await currentSession(client,session)) throw new Error('Forbidden');
  if(write) invitationRolePolicy(row,role);else if(!['owner','administrator','auditor'].includes(row.role)) throw new Error('Forbidden');return row;
}
// Ordered accounts precede site access, sorted staff, invitation, token and mail locks.
async function lockParticipants(client,ids,scope,{completion=false}={}) {
  if(!completion)await requireTenantActive(client,scope.org_id);
  const unique=[...new Set(ids)].sort();
  await client.query(`SELECT a.id FROM staff_accounts a WHERE a.id IN(SELECT account_id FROM staff_account_memberships WHERE staff_id=ANY($1::text[]))
    ORDER BY a.id FOR UPDATE`,[unique]);
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`staff-access:${scope.org_id}:${scope.site_id}`]);
  await client.query('SELECT id FROM staff WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE',[unique]);
}
async function live(client,invitation) {
  if(!invitation || invitation.state!=='pending' || !invitation.unexpired) return false;
  const issuer=await identity(client,invitation.issuer_id);
  if(!issuer?.active || !issuer.account_active || !issuer.email || issuer.access_revision!==invitation.issuer_revision || issuer.account_revision!==invitation.issuer_account_revision) return false;
  try {invitationRolePolicy(issuer,invitation.role);return true;}catch {return false;}
}
async function invitationRow(client,id,lock=false) {return (await client.query(`SELECT *,expires_at>clock_timestamp() AS unexpired FROM staff_invitations WHERE id=$1${lock ? ' FOR UPDATE' : ''}`,[id])).rows[0];}
async function audit(client,scope,actor,action,id) {
  await client.query(`INSERT INTO audit(id,org_id,site_id,actor_type,actor_id,action,object_id) VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [randomUUID(),scope.org_id,scope.site_id,actor ? 'staff' : 'system',actor || 'staff-invitations',action,id]);
}
async function revoke(client,id) {
  await client.query('UPDATE staff_invitation_tokens SET revoked_at=clock_timestamp() WHERE invitation_id=$1 AND revoked_at IS NULL AND used_at IS NULL',[id]);
  await client.query("UPDATE staff_invitation_mail SET state='ignored',payload=NULL,lease_token=NULL,lease_until=NULL WHERE invitation_id=$1 AND state IN ('queued','processing')",[id]);
}
async function expire(client) {
  await client.query("UPDATE staff_invitations SET state='expired',email_payload=NULL WHERE state='pending' AND expires_at<=clock_timestamp()");
  await client.query('UPDATE staff_invitation_tokens SET revoked_at=clock_timestamp() WHERE expires_at<=clock_timestamp() AND revoked_at IS NULL AND used_at IS NULL');
  await client.query("UPDATE staff_invitation_mail SET state='expired',payload=NULL,lease_token=NULL,lease_until=NULL WHERE state IN ('queued','processing') AND expires_at<=clock_timestamp()");
  await client.query("UPDATE staff_invitation_mail SET state='failed',payload=NULL,lease_token=NULL,lease_until=NULL WHERE state='processing' AND attempts>=3 AND lease_until<=clock_timestamp()");
}
export function expireInvitations(pool,{schema='public'}={}) {return inSchema(pool,schema,expire);}
async function receipt(client,session,requestId,id,action,value) {
  const old=(await client.query('SELECT *,request_json=$4::jsonb AS matches FROM staff_invitation_requests WHERE request_id=$1 AND org_id=$2 AND site_id=$3',
    [requestId,session.org_id,session.site_id,JSON.stringify(value)])).rows[0];
  if(!old) return null;
  if(old.created_by!==session.principal_id || old.invitation_id!==id || old.action!==action || !old.matches) throw new Error('Invitation request conflict');
  return {...old.result_json,duplicate:true};
}
async function saveReceipt(client,session,requestId,id,action,value,result) {
  await client.query(`INSERT INTO staff_invitation_requests(request_id,org_id,site_id,invitation_id,action,request_json,result_json,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[requestId,session.org_id,session.site_id,id,action,JSON.stringify(value),JSON.stringify(result),session.principal_id]);
  await audit(client,session,session.principal_id,`staff.invitation_${action==='issue' ? 'issued' : action==='resend' ? 'reissued' : 'cancelled'}`,id);return result;
}
async function queue(client,id,revision,expiresAt) {
  if(!await authMailCapacity(client)) throw new Error('Email delivery unavailable');
  await client.query("INSERT INTO staff_invitation_mail(id,invitation_id,generation,expires_at,state) VALUES($1,$2,$3,$4,'queued')",[randomUUID(),id,revision,expiresAt]);
}
export async function issueInvitation(pool,session,input,config,{schema='public'}={}) {
  const value=invitationIssueInput(input),emailHash=invitationEmailHash(value.email),request={name:value.name,role:value.role,emailHash};
  if(session?.principal_type!=='staff' || session.access_mode!=='credential') throw new Error('Forbidden');
  return inSchema(pool,schema,async client=>{
    await lockParticipants(client,[session.principal_id],session);const actor=await authority(client,session,true,value.role);
    const old=await receipt(client,session,input.requestId,input.requestId,'issue',request);if(old) return old;
    if(!config.available) throw new Error('Email delivery unavailable');
    await client.query("UPDATE staff_invitations SET state='expired',email_payload=NULL WHERE org_id=$1 AND site_id=$2 AND state='pending' AND expires_at<=clock_timestamp()",[session.org_id,session.site_id]);
    const existing=(await client.query(`SELECT c.email FROM staff s JOIN staff_account_memberships m ON m.staff_id=s.id
      JOIN staff_accounts a ON a.id=m.account_id JOIN staff_credentials c ON c.staff_id=a.credential_staff_id WHERE s.org_id=$1 AND s.site_id=$2`,[session.org_id,session.site_id])).rows;
    if(existing.some(row=>invitationEmailHash(row.email)===emailHash)) throw new Error('Recipient already has a site membership');
    if((await client.query("SELECT 1 FROM staff_invitations WHERE org_id=$1 AND site_id=$2 AND email_hash=$3 AND state='pending'",[session.org_id,session.site_id,emailHash])).rows[0]) throw new Error('An invitation is already pending at this site');
    const id=input.requestId,row=(await client.query(`INSERT INTO staff_invitations(id,org_id,site_id,name,role,email_hash,email_hint,email_payload,issuer_id,issuer_revision,issuer_account_revision,state,revision,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending',1,clock_timestamp()+interval '48 hours') RETURNING expires_at`,
      [id,session.org_id,session.site_id,value.name,value.role,emailHash,`${value.email[0]}***@${value.email.split('@')[1]}`,sealMail(config,id,{email:value.email}),actor.id,actor.access_revision,actor.account_revision])).rows[0];
    await queue(client,id,1,row.expires_at);return saveReceipt(client,session,id,id,'issue',request,{id,revision:1,state:'pending',delivery:'queued',duplicate:false});
  });
}
export async function changeInvitation(pool,session,id,action,input,config,{schema='public'}={}) {
  invitationReference(id);const value=invitationChangeInput(input);if(!['resend','cancel'].includes(action)) throw new Error('Invalid invitation input');
  if(session?.principal_type!=='staff' || session.access_mode!=='credential') throw new Error('Forbidden');
  return inSchema(pool,schema,async client=>{
    await lockParticipants(client,[session.principal_id],session);await authority(client,session,true);
    const invitation=await invitationRow(client,id,true);if(!invitation || invitation.org_id!==session.org_id || invitation.site_id!==session.site_id) throw unavailable();
    const actor=await authority(client,session,true,invitation.role),old=await receipt(client,session,input.requestId,id,action,value);if(old) return old;
    if(invitation.revision!==value.revision) throw new Error('Invitation revision changed');if(invitation.state!=='pending') throw new Error('Invitation is closed');
    if(action==='resend' && (!invitation.unexpired || !config.available)) throw new Error(!invitation.unexpired ? 'Invitation is closed' : 'Email delivery unavailable');
    await revoke(client,id);
    if(action==='cancel') await client.query("UPDATE staff_invitations SET state='cancelled',email_payload=NULL WHERE id=$1",[id]);
    else {
      const recipient=openMail(config,id,invitation.email_payload);if(invitationEmailHash(recipient.email)!==invitation.email_hash) throw unavailable();
      const row=(await client.query(`UPDATE staff_invitations SET revision=revision+1,issuer_id=$1,issuer_revision=$2,issuer_account_revision=$3,expires_at=clock_timestamp()+interval '48 hours' WHERE id=$4 RETURNING expires_at`,
        [actor.id,actor.access_revision,actor.account_revision,id])).rows[0];await queue(client,id,invitation.revision+1,row.expires_at);
    }
    return saveReceipt(client,session,input.requestId,id,action,value,{id,revision:invitation.revision+(action==='resend' ? 1 : 0),state:action==='cancel' ? 'cancelled' : 'pending',...(action==='resend' ? {delivery:'queued'} : {}),duplicate:false});
  });
}
export async function listInvitations(pool,session,input={}, {schema='public'}={}) {
  const {status,page,pageSize}=invitationFilters(input);
  return inSchema(pool,schema,async client=>{
    await authority(client,session);
    const source=`(SELECT *,CASE WHEN state='pending' AND expires_at<=clock_timestamp() THEN 'expired' ELSE state END AS current_state FROM staff_invitations) i`;
    const where=" WHERE i.org_id=$1 AND i.site_id=$2 AND ($3='all' OR i.current_state=$3)",params=[session.org_id,session.site_id,status];
    const total=(await client.query('SELECT COUNT(*)::int n FROM '+source+where,params)).rows[0].n;
    const items=(await client.query(`SELECT i.id,i.name,i.role,i.email_hint AS "emailHint",i.current_state AS state,i.revision,i.created_at AS "createdAt",i.expires_at AS "expiresAt",
      (SELECT CASE WHEN state IN ('queued','processing') AND i.current_state='expired' THEN 'expired' ELSE state END FROM staff_invitation_mail WHERE invitation_id=i.id AND generation=i.revision) AS delivery
      FROM ${source}${where} ORDER BY i.created_at DESC,i.id LIMIT $4 OFFSET $5`,[...params,pageSize,(page-1)*pageSize])).rows;
    return {items,total,page,pageSize,canWrite:['owner','administrator'].includes(session.role)};
  });
}
export async function invitationReceipt(pool,session,requestId,{schema='public'}={}) {
  invitationReference(requestId);return inSchema(pool,schema,async client=>{
    await authority(client,session);const old=(await client.query('SELECT invitation_id,action,request_json,result_json FROM staff_invitation_requests WHERE request_id=$1 AND org_id=$2 AND site_id=$3 AND created_by=$4',[requestId,session.org_id,session.site_id,session.principal_id])).rows[0];
    return old ? {accepted:true,id:old.invitation_id,action:old.action,request:old.request_json,result:old.result_json} : {accepted:false};
  });
}
async function throttle(client,token,ip) {
  return consumeAuthBudget(client,[tokenHash(`invite-token:${token}`),tokenHash(`invite-ip:${ip}`)],10);
}
async function tokenReference(client,hash) {return (await client.query('SELECT i.* FROM staff_invitation_tokens t JOIN staff_invitations i ON i.id=t.invitation_id WHERE t.token_hash=$1',[hash])).rows[0];}
async function currentToken(client,hash,invitation) {
  const token=(await client.query('SELECT * FROM staff_invitation_tokens WHERE token_hash=$1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR UPDATE',[hash])).rows[0];
  if(!token || !await live(client,invitation) || token.invitation_id!==invitation.id || token.generation!==invitation.revision) throw unavailable();return token;
}
export async function previewInvitation(pool,input,remoteAddress,{schema='public'}={}) {
  const token=invitationTokenInput(input,remoteAddress),hash=tokenHash(token);
  if(!await inSchema(pool,schema,client=>throttle(client,token,remoteAddress))) throw unavailable();
  return inSchema(pool,schema,async client=>{
    const ref=await tokenReference(client,hash);if(!ref) throw unavailable();await lockParticipants(client,[ref.issuer_id],ref);
    const invitation=await invitationRow(client,ref.id,true);if(invitation?.issuer_id!==ref.issuer_id) throw unavailable();await currentToken(client,hash,invitation);
    const scope=(await client.query('SELECT o.name AS organization,s.name AS site FROM sites s JOIN organizations o ON o.id=s.org_id WHERE s.id=$1 AND s.org_id=$2',[invitation.site_id,invitation.org_id])).rows[0];
    return {...scope,name:invitation.name,role:invitation.role,emailHint:invitation.email_hint,expiresAt:invitation.expires_at};
  });
}
async function acceptanceAccount(client,session,emailHash) {
  if(session?.principal_type!=='staff' || session.access_mode!=='credential') throw new Error('Sign in to accept this invitation');
  const row=await identity(client,session.principal_id);
  if(!row?.active || !row.account_active || !row.email || row.org_id!==session.org_id || row.site_id!==session.site_id || invitationEmailHash(row.email)!==emailHash || !await currentSession(client,session)) throw new Error('Sign in to accept this invitation');return row;
}
export async function acceptInvitation(pool,session,kind,input,remoteAddress,config,{schema='public'}={}) {
  invitationAcceptInput(input,kind,remoteAddress);if(kind==='signup' && session) throw new Error('Sign out before creating an account');
  if(!await inSchema(pool,schema,client=>throttle(client,input.token,remoteAddress))) throw unavailable();
  const hash=tokenHash(input.token),record=kind==='signup' ? await passwordRecord(input.password) : null;
  const perform=()=>inSchema(pool,schema,async client=>{
    const ref=await tokenReference(client,hash);if(!ref) throw unavailable();
    const oldRef=(await client.query('SELECT staff_id FROM staff_invitation_acceptances WHERE token_hash=$1',[hash])).rows[0];
    await lockParticipants(client,[ref.issuer_id,...(session ? [session.principal_id] : []),...(oldRef ? [oldRef.staff_id] : [])],ref);
    const invitation=await invitationRow(client,ref.id,true);if(invitation?.issuer_id!==ref.issuer_id) throw unavailable();
    const old=(await client.query('SELECT * FROM staff_invitation_acceptances WHERE token_hash=$1',[hash])).rows[0];
    if(old) {
      if(old.request_id!==input.requestId || old.kind!==kind) throw unavailable();
      if(kind==='signup' && !oldRef) return {retryReplay:true};
      if(kind==='existing') {if((await acceptanceAccount(client,session,invitation.email_hash)).account_id!==old.account_id) throw unavailable();}
      else {
        const recipient=await identity(client,old.staff_id);
        if(!recipient?.active || !recipient.account_active || !await passwordMatches(input.password,recipient)) throw unavailable();
      }
      return {completed:true,staffId:old.staff_id,signInRequired:kind==='signup',duplicate:true};
    }
    await currentToken(client,hash,invitation);let account;
    if(kind==='existing') account=await acceptanceAccount(client,session,invitation.email_hash);
    else {
      if(!config.available) throw new Error('Email delivery unavailable');
      const recipient=openMail(config,invitation.id,invitation.email_payload);
      if(typeof recipient.email!=='string' || invitationEmailHash(recipient.email)!==invitation.email_hash) throw unavailable();
      if((await client.query('SELECT 1 FROM staff_credentials WHERE email=$1',[recipient.email])).rows[0]) throw new Error('Sign in to accept this invitation');account={email:recipient.email};
    }
    if(account.account_id && (await client.query('SELECT 1 FROM staff_account_memberships WHERE account_id=$1 AND org_id=$2 AND site_id=$3',[account.account_id,invitation.org_id,invitation.site_id])).rows[0]) throw new Error('Recipient already has a site membership');
    const staffId=randomUUID();await client.query('INSERT INTO staff(id,org_id,site_id,name,role) VALUES($1,$2,$3,$4,$5)',[staffId,invitation.org_id,invitation.site_id,invitation.name,invitation.role]);
    if(kind==='signup') {
      await client.query('INSERT INTO staff_credentials(staff_id,email,password_salt,password_hash) VALUES($1,$2,$3,$4)',[staffId,account.email,record.salt,record.derived]);account=await identity(client,staffId);
    }else await linkAccountMembership(client,account.account_id,staffId);
    await client.query('INSERT INTO staff_invitation_acceptances(token_hash,request_id,account_id,staff_id,org_id,site_id,kind) VALUES($1,$2,$3,$4,$5,$6,$7)',[hash,input.requestId,account.account_id,staffId,invitation.org_id,invitation.site_id,kind]);
    await client.query('UPDATE staff_invitation_tokens SET used_at=clock_timestamp(),revoked_at=clock_timestamp() WHERE token_hash=$1',[hash]);
    await revoke(client,invitation.id);await client.query("UPDATE staff_invitations SET state='accepted',email_payload=NULL WHERE id=$1",[invitation.id]);
    await audit(client,invitation,staffId,'staff.invitation_accepted',invitation.id);return {completed:true,staffId,signInRequired:kind==='signup',duplicate:false};
  });
  const result=await perform();return result.retryReplay ? perform() : result;
}
export async function processOneInvitation(pool,config,{schema='public',send=sendAuthMail}={}) {
  if(!config.available) return false;await expireInvitations(pool,{schema});
  const job=await inSchema(pool,schema,async client=>{
    const reference=(await client.query(`SELECT i.* FROM staff_invitation_mail m JOIN staff_invitations i ON i.id=m.invitation_id WHERE m.expires_at>clock_timestamp() AND m.attempts<3
      AND ((m.state='queued' AND m.next_at<=clock_timestamp()) OR (m.state='processing' AND m.lease_until<=clock_timestamp()))
      AND ${dispatchPredicate('i')} ORDER BY m.created_at,m.id LIMIT 1`)).rows[0];
    if(!reference || !await dispatchAllowed(client,reference.org_id)) return null;await lockParticipants(client,[reference.issuer_id],reference);
    const invitation=await invitationRow(client,reference.id,true),row=(await client.query(`SELECT * FROM staff_invitation_mail WHERE invitation_id=$1 AND expires_at>clock_timestamp() AND attempts<3
      AND ((state='queued' AND next_at<=clock_timestamp()) OR (state='processing' AND lease_until<=clock_timestamp())) ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`,[reference.id])).rows[0];
    if(!row || invitation?.issuer_id!==reference.issuer_id) return null;
    const finish=async state=>{await client.query('UPDATE staff_invitation_mail SET state=$1,payload=NULL,lease_token=NULL,lease_until=NULL WHERE id=$2',[state,row.id]);return {ignored:true};};
    if(!await live(client,invitation) || invitation.revision!==row.generation) return finish('ignored');
    const lease=randomUUID();await client.query("UPDATE staff_invitation_mail SET state='processing',attempts=attempts+1,lease_token=$1,lease_until=clock_timestamp()+interval '30 seconds' WHERE id=$2",[lease,row.id]);
    let message;const token=(await client.query('SELECT token_hash FROM staff_invitation_tokens WHERE invitation_id=$1 AND generation=$2',[invitation.id,row.generation])).rows[0];
    if(token) {try {await currentToken(client,token.token_hash,invitation);message=openMail(config,row.id,row.payload);}catch {return finish('failed');}}
    else {
      let recipient;try {recipient=openMail(config,invitation.id,invitation.email_payload);}catch {return finish('failed');}
      if(typeof recipient.email!=='string' || invitationEmailHash(recipient.email)!==invitation.email_hash) return finish('failed');
      const scope=(await client.query('SELECT o.name AS organization,s.name AS site FROM sites s JOIN organizations o ON o.id=s.org_id WHERE s.id=$1 AND s.org_id=$2',[invitation.site_id,invitation.org_id])).rows[0];
      const secret=randomBytes(32).toString('base64url');
      message={email:recipient.email,subject:'Your Understood invitation',text:`You are invited to ${scope.organization} - ${scope.site} as ${invitation.role}.\nAccept this one-use invitation before ${invitation.expires_at.toISOString()}:\n${config.publicOrigin}/#accept-invitation/${secret}\n\nAn existing account must sign in with this email. Ignore this message if it was not expected.`};
      await client.query('INSERT INTO staff_invitation_tokens(token_hash,invitation_id,generation,expires_at) VALUES($1,$2,$3,$4)',[tokenHash(secret),invitation.id,row.generation,invitation.expires_at]);
      await client.query('UPDATE staff_invitation_mail SET payload=$1 WHERE id=$2',[sealMail(config,row.id,message),row.id]);await audit(client,invitation,null,'staff.invitation_prepared',row.id);
    }
    if(message.subject!=='Your Understood invitation' || typeof message.email!=='string' || invitationEmailHash(message.email)!==invitation.email_hash || typeof message.text!=='string' || message.text.length<1 || message.text.length>10000) return finish('failed');
    return {...row,lease,message};
  });
  if(!job) return false;if(job.ignored) return true;
  let providerId,mailCode='send_failed';
  try {const result=await send(config,job.id,job.message);if(typeof result?.providerId==='string' && /^[a-zA-Z0-9_-]{1,100}$/.test(result.providerId)) providerId=result.providerId;}
  catch(error){const status=Number(error?.status);mailCode=Number.isInteger(status)&&status>=400&&status<600?`http_${status}`:'send_failed';}
  await inSchema(pool,schema,async client=>{
    const ref=await invitationRow(client,job.invitation_id);if(!ref) return;
    // Journal an already-dispatched mail result even if access was paused meanwhile.
    await lockParticipants(client,[ref.issuer_id],ref,{completion:true});const invitation=await invitationRow(client,ref.id,true);if(invitation?.issuer_id!==ref.issuer_id) return;
    const row=(await client.query("SELECT 1 FROM staff_invitation_mail WHERE id=$1 AND state='processing' AND lease_token=$2 AND lease_until>clock_timestamp() AND expires_at>clock_timestamp() FOR UPDATE",[job.id,job.lease])).rows[0];if(!row) return;
    if(!await live(client,invitation) || invitation.revision!==job.generation) await client.query("UPDATE staff_invitation_mail SET state='ignored',payload=NULL,lease_token=NULL,lease_until=NULL WHERE id=$1",[job.id]);
    else if(providerId) await client.query("UPDATE staff_invitation_mail SET state='sent',payload=NULL,provider_id=$1,lease_token=NULL,lease_until=NULL WHERE id=$2",[providerId,job.id]);
    else {
      if(job.attempts+1>=3) console.error(`invitation mail failed state=failed code=${mailCode}`);
      await client.query(`UPDATE staff_invitation_mail SET state=CASE WHEN attempts>=3 THEN 'failed' ELSE 'queued' END,payload=CASE WHEN attempts>=3 THEN NULL ELSE payload END,
      next_at=clock_timestamp()+$1*interval '1 second',lease_token=NULL,lease_until=NULL WHERE id=$2`,[30*(job.attempts+1),job.id]);
    }
  });return true;
}
