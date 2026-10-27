import {randomBytes,randomUUID} from 'node:crypto';
import {consumeAuthBudget} from './auth-budget.mjs';
import {authMailCapacity} from './auth-mail-budget.mjs';
import {NOW,transaction} from './db.mjs';
import {ensureInvitationSchema} from './invitation-schema.mjs';
import {invitationReference,invitationIssueInput,invitationChangeInput,invitationFilters,invitationTokenInput,invitationAcceptInput,invitationRolePolicy,invitationEmailKey} from './invitation-input.mjs';
import {tokenHash,passwordRecord,passwordMatches} from './auth-crypto.mjs';
import {accountIdentity,linkAccountMembership} from './accounts.mjs';
import {sealMail,openMail,sendAuthMail} from './auth-mail.mjs';
export {ensureInvitationSchema} from './invitation-schema.mjs';
const later=milliseconds=>new Date(Date.now()+milliseconds).toISOString();
const invitationEmailHash=email=>tokenHash(invitationEmailKey(email));
const unavailable=()=>new Error('Invitation unavailable');
const issuerSql=`SELECT s.*,COALESCE(r.revision,1) AS access_revision FROM staff s LEFT JOIN staff_access_revisions r ON r.staff_id=s.id AND r.org_id=s.org_id AND r.site_id=s.site_id`;
function currentSession(db,session) {
  return !session.token_hash || !!db.prepare(`SELECT 1 FROM sessions WHERE token_hash=? AND principal_type='staff' AND access_mode='credential'
    AND principal_id=? AND org_id=? AND site_id=? AND revoked_at IS NULL AND expires_at>?`).get(session.token_hash,session.principal_id,session.org_id,session.site_id,NOW());
}
function authority(db,session,write=false,role='auditor') {
  if(session?.principal_type!=='staff' || session.access_mode!=='credential') throw new Error('Forbidden');
  const staff=db.prepare(issuerSql+' WHERE s.id=? AND s.org_id=? AND s.site_id=? AND s.active=1 AND s.role=?').get(session.principal_id,session.org_id,session.site_id,session.role);
  const account=accountIdentity(db,session.principal_id);
  if(!staff || !account?.account_active || !db.prepare('SELECT 1 FROM staff_credentials WHERE staff_id=?').get(account.credential_staff_id) || !currentSession(db,session)) throw new Error('Forbidden');
  if(write) invitationRolePolicy(staff,role);else if(!['owner','administrator','auditor'].includes(staff.role)) throw new Error('Forbidden');
  return {...staff,account_revision:account.account_revision};
}
function audit(db,scope,actor,action,id) {
  db.prepare('INSERT INTO audit VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),scope.org_id,scope.site_id,actor ? 'staff' : 'system',actor || 'staff-invitations',action,id,NOW());
}
function live(db,invitation) {
  if(!invitation || invitation.state!=='pending' || invitation.expires_at<=NOW()) return false;
  const issuer=db.prepare(issuerSql+' WHERE s.id=? AND s.org_id=? AND s.site_id=? AND s.active=1').get(invitation.issuer_id,invitation.org_id,invitation.site_id);
  const account=accountIdentity(db,invitation.issuer_id);
  if(!issuer || issuer.access_revision!==invitation.issuer_revision || !account?.account_active || account.account_revision!==invitation.issuer_account_revision || !db.prepare('SELECT 1 FROM staff_credentials WHERE staff_id=?').get(account.credential_staff_id)) return false;
  try {invitationRolePolicy(issuer,invitation.role);return true;}catch {return false;}
}
function revoke(db,id,now) {
  db.prepare('UPDATE staff_invitation_tokens SET revoked_at=? WHERE invitation_id=? AND revoked_at IS NULL AND used_at IS NULL').run(now,id);
  db.prepare("UPDATE staff_invitation_mail SET state='ignored',payload=NULL,lease_token=NULL,lease_until=NULL WHERE invitation_id=? AND state IN ('queued','processing')").run(id);
}
function expire(db,now) {
  db.prepare("UPDATE staff_invitations SET state='expired',email_payload=NULL WHERE state='pending' AND expires_at<=?").run(now);
  db.prepare('UPDATE staff_invitation_tokens SET revoked_at=? WHERE expires_at<=? AND revoked_at IS NULL AND used_at IS NULL').run(now,now);
  db.prepare("UPDATE staff_invitation_mail SET state='expired',payload=NULL,lease_token=NULL,lease_until=NULL WHERE state IN ('queued','processing') AND expires_at<=?").run(now);
  db.prepare("UPDATE staff_invitation_mail SET state='failed',payload=NULL,lease_token=NULL,lease_until=NULL WHERE state='processing' AND attempts>=3 AND lease_until<=?").run(now);
}
export function expireInvitations(db) {ensureInvitationSchema(db);return transaction(db,()=>expire(db,NOW()));}
function receipt(db,session,id,invitationId,action,value) {
  const old=db.prepare('SELECT * FROM staff_invitation_requests WHERE request_id=? AND org_id=? AND site_id=?').get(id,session.org_id,session.site_id);
  if(!old) return null;
  if(old.created_by!==session.principal_id || old.invitation_id!==invitationId || old.action!==action || old.request_json!==JSON.stringify(value)) throw new Error('Invitation request conflict');
  return {...JSON.parse(old.result_json),duplicate:true};
}
function saveReceipt(db,session,requestId,id,action,value,result) {
  db.prepare('INSERT INTO staff_invitation_requests VALUES(?,?,?,?,?,?,?,?,?)').run(requestId,session.org_id,session.site_id,id,action,JSON.stringify(value),JSON.stringify(result),session.principal_id,NOW());
  audit(db,session,session.principal_id,`staff.invitation_${action==='issue' ? 'issued' : action==='resend' ? 'reissued' : 'cancelled'}`,id);return result;
}
function queue(db,id,revision,expiresAt) {
  if(!authMailCapacity(db)) throw new Error('Email delivery unavailable');
  db.prepare('INSERT INTO staff_invitation_mail VALUES(?,?,?,NULL,?,?,?,?,0,NULL,NULL,NULL)').run(randomUUID(),id,revision,NOW(),expiresAt,NOW(),'queued');
}
export function issueInvitation(db,session,input,config) {
  const value=invitationIssueInput(input),emailHash=invitationEmailHash(value.email),request={name:value.name,role:value.role,emailHash};
  ensureInvitationSchema(db);
  return transaction(db,()=>{
    const actor=authority(db,session,true,value.role),old=receipt(db,session,input.requestId,input.requestId,'issue',request);if(old) return old;
    if(!config.available) throw new Error('Email delivery unavailable');
    expire(db,NOW());
    const existing=db.prepare(`SELECT c.email FROM staff s JOIN staff_account_memberships m ON m.staff_id=s.id
      JOIN staff_accounts a ON a.id=m.account_id JOIN staff_credentials c ON c.staff_id=a.credential_staff_id WHERE s.org_id=? AND s.site_id=?`).all(session.org_id,session.site_id).some(row=>invitationEmailHash(row.email)===emailHash);
    if(existing) throw new Error('Recipient already has a site membership');
    if(db.prepare("SELECT 1 FROM staff_invitations WHERE org_id=? AND site_id=? AND email_hash=? AND state='pending'").get(session.org_id,session.site_id,emailHash)) throw new Error('An invitation is already pending at this site');
    const expiresAt=later(48*3600000),id=input.requestId;
    db.prepare('INSERT INTO staff_invitations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)').run(id,session.org_id,session.site_id,value.name,value.role,emailHash,`${value.email[0]}***@${value.email.split('@')[1]}`,sealMail(config,id,{email:value.email}),actor.id,actor.access_revision,actor.account_revision,'pending',NOW(),expiresAt);
    queue(db,id,1,expiresAt);return saveReceipt(db,session,input.requestId,id,'issue',request,{id,revision:1,state:'pending',delivery:'queued',duplicate:false});
  });
}
export function changeInvitation(db,session,id,action,input,config) {
  invitationReference(id);const value=invitationChangeInput(input);if(!['resend','cancel'].includes(action)) throw new Error('Invalid invitation input');ensureInvitationSchema(db);
  return transaction(db,()=>{
    authority(db,session,true);const invitation=db.prepare('SELECT * FROM staff_invitations WHERE id=? AND org_id=? AND site_id=?').get(id,session.org_id,session.site_id);
    if(!invitation) throw unavailable();const actor=authority(db,session,true,invitation.role),old=receipt(db,session,input.requestId,id,action,value);if(old) return old;
    if(invitation.revision!==value.revision) throw new Error('Invitation revision changed');
    if(invitation.state!=='pending') throw new Error('Invitation is closed');
    if(action==='resend' && (invitation.expires_at<=NOW() || !config.available)) throw new Error(invitation.expires_at<=NOW() ? 'Invitation is closed' : 'Email delivery unavailable');
    const now=NOW();revoke(db,id,now);
    if(action==='cancel') db.prepare("UPDATE staff_invitations SET state='cancelled',email_payload=NULL WHERE id=?").run(id);
    else {
      if(!Number.isSafeInteger(invitation.revision+1)) throw new Error('Invitation revision changed');
      const recipient=openMail(config,id,invitation.email_payload);if(invitationEmailHash(recipient.email)!==invitation.email_hash) throw unavailable();
      const expiresAt=later(48*3600000);db.prepare('UPDATE staff_invitations SET revision=revision+1,issuer_id=?,issuer_revision=?,issuer_account_revision=?,expires_at=? WHERE id=?').run(actor.id,actor.access_revision,actor.account_revision,expiresAt,id);
      queue(db,id,invitation.revision+1,expiresAt);
    }
    return saveReceipt(db,session,input.requestId,id,action,value,{id,revision:invitation.revision+(action==='resend' ? 1 : 0),state:action==='cancel' ? 'cancelled' : 'pending',...(action==='resend' ? {delivery:'queued'} : {}),duplicate:false});
  });
}
export function listInvitations(db,session,input={}) {
  const {status,page,pageSize}=invitationFilters(input);ensureInvitationSchema(db);
  return transaction(db,()=>{
    authority(db,session);const now=NOW(),source="(SELECT *,CASE WHEN state='pending' AND expires_at<=? THEN 'expired' ELSE state END AS current_state FROM staff_invitations) i";
    const where=" WHERE i.org_id=? AND i.site_id=? AND (?='all' OR i.current_state=?)",params=[now,session.org_id,session.site_id,status,status];
    const total=db.prepare('SELECT COUNT(*) n FROM '+source+where).get(...params).n;
    const items=db.prepare(`SELECT i.id,i.name,i.role,i.email_hint AS emailHint,i.current_state AS state,i.revision,i.created_at AS createdAt,i.expires_at AS expiresAt,
      (SELECT CASE WHEN state IN ('queued','processing') AND expires_at<=i.expires_at AND i.current_state='expired' THEN 'expired' ELSE state END FROM staff_invitation_mail WHERE invitation_id=i.id AND generation=i.revision) AS delivery FROM ${source}${where} ORDER BY i.created_at DESC,i.id LIMIT ? OFFSET ?`).all(...params,pageSize,(page-1)*pageSize);
    return {items,total,page,pageSize,canWrite:['owner','administrator'].includes(session.role)};
  });
}
export function invitationReceipt(db,session,requestId) {
  invitationReference(requestId);ensureInvitationSchema(db);return transaction(db,()=>{
    authority(db,session);const old=db.prepare('SELECT invitation_id,action,request_json,result_json FROM staff_invitation_requests WHERE request_id=? AND org_id=? AND site_id=? AND created_by=?').get(requestId,session.org_id,session.site_id,session.principal_id);
    return old ? {accepted:true,id:old.invitation_id,action:old.action,request:JSON.parse(old.request_json),result:JSON.parse(old.result_json)} : {accepted:false};
  });
}
function throttle(db,token,ip) {
  return consumeAuthBudget(db,[tokenHash(`invite-token:${token}`),tokenHash(`invite-ip:${ip}`)],10);
}
function currentToken(db,hash) {
  const token=db.prepare('SELECT * FROM staff_invitation_tokens WHERE token_hash=? AND used_at IS NULL AND revoked_at IS NULL AND expires_at>?').get(hash,NOW());
  if(!token) throw unavailable();const invitation=db.prepare('SELECT * FROM staff_invitations WHERE id=?').get(token.invitation_id);
  if(!live(db,invitation) || token.generation!==invitation.revision) throw unavailable();return {token,invitation};
}
export function previewInvitation(db,input,remoteAddress) {
  const token=invitationTokenInput(input,remoteAddress);ensureInvitationSchema(db);
  const allowed=transaction(db,()=>throttle(db,token,remoteAddress));if(!allowed) throw unavailable();
  return transaction(db,()=>{
    const {invitation}=currentToken(db,tokenHash(token));const scope=db.prepare('SELECT o.name AS organization,s.name AS site FROM sites s JOIN organizations o ON o.id=s.org_id WHERE s.id=? AND s.org_id=?').get(invitation.site_id,invitation.org_id);
    return {...scope,name:invitation.name,role:invitation.role,emailHint:invitation.email_hint,expiresAt:invitation.expires_at};
  });
}
function acceptanceAccount(db,session,emailHash) {
  if(session?.principal_type!=='staff' || session.access_mode!=='credential') throw new Error('Sign in to accept this invitation');
  const account=accountIdentity(db,session.principal_id),staff=db.prepare('SELECT 1 FROM staff WHERE id=? AND org_id=? AND site_id=? AND active=1').get(session.principal_id,session.org_id,session.site_id);
  const credential=account && db.prepare('SELECT * FROM staff_credentials WHERE staff_id=?').get(account.credential_staff_id);
  if(!staff || !account.account_active || !credential || invitationEmailHash(credential.email)!==emailHash || !currentSession(db,session)) throw new Error('Sign in to accept this invitation');
  return account;
}
function acceptanceReplay(db,session,kind,input,hash) {
  const old=db.prepare('SELECT * FROM staff_invitation_acceptances WHERE token_hash=?').get(hash);
  if(old) return (async()=>{
    if(old.request_id!==input.requestId || old.kind!==kind) throw unavailable();
    if(kind==='existing') {if(acceptanceAccount(db,session,db.prepare('SELECT i.email_hash FROM staff_invitation_tokens t JOIN staff_invitations i ON i.id=t.invitation_id WHERE t.token_hash=?').get(hash).email_hash).account_id!==old.account_id) throw unavailable();}
    else {
      const credential=db.prepare('SELECT c.*,a.active FROM staff_accounts a JOIN staff_credentials c ON c.staff_id=a.credential_staff_id JOIN staff s ON s.id=? WHERE a.id=? AND s.active=1').get(old.staff_id,old.account_id);
      if(!credential?.active || !await passwordMatches(input.password,credential)) throw unavailable();
      const fresh=db.prepare('SELECT a.active,s.active AS staff_active FROM staff_accounts a JOIN staff s ON s.id=? JOIN staff_credentials c ON c.staff_id=a.credential_staff_id WHERE a.id=? AND c.password_hash=?').get(old.staff_id,old.account_id,credential.password_hash);
      if(!fresh?.active || !fresh.staff_active) throw unavailable();
    }
    return {completed:true,staffId:old.staff_id,signInRequired:kind==='signup',duplicate:true};
  })();
  return null;
}
export async function acceptInvitation(db,session,kind,input,remoteAddress,config) {
  invitationAcceptInput(input,kind,remoteAddress);ensureInvitationSchema(db);
  if(kind==='signup' && session) throw new Error('Sign out before creating an account');
  const allowed=transaction(db,()=>throttle(db,input.token,remoteAddress));if(!allowed) throw unavailable();
  const hash=tokenHash(input.token),replay=acceptanceReplay(db,session,kind,input,hash);if(replay) return await replay;
  const record=kind==='signup' ? await passwordRecord(input.password) : null;
  // Password derivation yields; a competing acceptance may have committed meanwhile.
  const raced=acceptanceReplay(db,session,kind,input,hash);if(raced) return await raced;
  return transaction(db,()=>{
    const {invitation}=currentToken(db,hash),now=NOW();let account;
    if(kind==='existing') account=acceptanceAccount(db,session,invitation.email_hash);
    else {
      if(!config.available) throw new Error('Email delivery unavailable');
      const recipient=openMail(config,invitation.id,invitation.email_payload);
      if(typeof recipient.email!=='string' || invitationEmailHash(recipient.email)!==invitation.email_hash) throw unavailable();
      if(db.prepare('SELECT 1 FROM staff_credentials WHERE email=?').get(recipient.email)) throw new Error('Sign in to accept this invitation');
      account={email:recipient.email};
    }
    if(account.account_id && db.prepare('SELECT 1 FROM staff_account_memberships WHERE account_id=? AND org_id=? AND site_id=?').get(account.account_id,invitation.org_id,invitation.site_id)) throw new Error('Recipient already has a site membership');
    const staffId=randomUUID();db.prepare('INSERT INTO staff VALUES(?,?,?,?,?,1)').run(staffId,invitation.org_id,invitation.site_id,invitation.name,invitation.role);
    if(kind==='signup') {
      db.prepare('INSERT INTO staff_credentials VALUES(?,?,?,?,?)').run(staffId,account.email,record.salt,record.derived,now);account=accountIdentity(db,staffId);
    }else linkAccountMembership(db,account.account_id,staffId);
    db.prepare('INSERT INTO staff_invitation_acceptances VALUES(?,?,?,?,?,?,?,?)').run(hash,input.requestId,account.account_id,staffId,invitation.org_id,invitation.site_id,kind,now);
    db.prepare('UPDATE staff_invitation_tokens SET used_at=?,revoked_at=? WHERE token_hash=?').run(now,now,hash);
    revoke(db,invitation.id,now);db.prepare("UPDATE staff_invitations SET state='accepted',email_payload=NULL WHERE id=?").run(invitation.id);
    audit(db,invitation,staffId,'staff.invitation_accepted',invitation.id);
    return {completed:true,staffId,signInRequired:kind==='signup',duplicate:false};
  });
}
export async function processOneInvitation(db,config,{send=sendAuthMail}={}) {
  if(!config.available) return false;ensureInvitationSchema(db);expireInvitations(db);
  const job=transaction(db,()=>{
    const now=NOW(),row=db.prepare(`SELECT * FROM staff_invitation_mail WHERE expires_at>? AND attempts<3
      AND ((state='queued' AND next_at<=?) OR (state='processing' AND lease_until<=?)) ORDER BY created_at,id LIMIT 1`).get(now,now,now);if(!row) return null;
    const invitation=db.prepare('SELECT * FROM staff_invitations WHERE id=?').get(row.invitation_id),lease=randomUUID();
    const finish=state=>{db.prepare('UPDATE staff_invitation_mail SET state=?,payload=NULL,lease_token=NULL,lease_until=NULL WHERE id=?').run(state,row.id);return {ignored:true};};
    if(!live(db,invitation) || invitation.revision!==row.generation) return finish('ignored');
    db.prepare("UPDATE staff_invitation_mail SET state='processing',attempts=attempts+1,lease_token=?,lease_until=? WHERE id=?").run(lease,later(30000),row.id);
    let message;const token=db.prepare('SELECT * FROM staff_invitation_tokens WHERE invitation_id=? AND generation=?').get(invitation.id,row.generation);
    if(token) {try {currentToken(db,token.token_hash);message=openMail(config,row.id,row.payload);}catch {return finish('failed');}}
    else {
      let recipient;try {recipient=openMail(config,invitation.id,invitation.email_payload);}catch {return finish('failed');}
      if(typeof recipient.email!=='string' || invitationEmailHash(recipient.email)!==invitation.email_hash) return finish('failed');
      const scope=db.prepare('SELECT o.name AS organization,s.name AS site FROM sites s JOIN organizations o ON o.id=s.org_id WHERE s.id=? AND s.org_id=?').get(invitation.site_id,invitation.org_id);
      const secret=randomBytes(32).toString('base64url');
      message={email:recipient.email,subject:'Your Understood invitation',text:`You are invited to ${scope.organization} - ${scope.site} as ${invitation.role}.\nAccept this one-use invitation before ${invitation.expires_at}:\n${config.publicOrigin}/#accept-invitation/${secret}\n\nAn existing account must sign in with this email. Ignore this message if it was not expected.`};
      db.prepare('INSERT INTO staff_invitation_tokens VALUES(?,?,?,?,NULL,NULL)').run(tokenHash(secret),invitation.id,row.generation,invitation.expires_at);
      db.prepare('UPDATE staff_invitation_mail SET payload=? WHERE id=?').run(sealMail(config,row.id,message),row.id);
      audit(db,invitation,null,'staff.invitation_prepared',row.id);
    }
    if(message.subject!=='Your Understood invitation' || typeof message.email!=='string' || invitationEmailHash(message.email)!==invitation.email_hash || typeof message.text!=='string' || message.text.length<1 || message.text.length>10000) return finish('failed');
    return {...row,lease,message};
  });
  if(!job) return false;if(job.ignored) return true;
  let providerId,mailCode='send_failed';
  try {const result=await send(config,job.id,job.message);if(typeof result?.providerId==='string' && /^[a-zA-Z0-9_-]{1,100}$/.test(result.providerId)) providerId=result.providerId;}
  catch(error){const status=Number(error?.status);mailCode=Number.isInteger(status)&&status>=400&&status<600?`http_${status}`:'send_failed';}
  transaction(db,()=>{
    const now=NOW(),row=db.prepare("SELECT 1 FROM staff_invitation_mail WHERE id=? AND state='processing' AND lease_token=? AND lease_until>? AND expires_at>?").get(job.id,job.lease,now,now);if(!row) return;
    const invitation=db.prepare('SELECT * FROM staff_invitations WHERE id=?').get(job.invitation_id);
    if(!live(db,invitation) || invitation.revision!==job.generation) db.prepare("UPDATE staff_invitation_mail SET state='ignored',payload=NULL,lease_token=NULL,lease_until=NULL WHERE id=?").run(job.id);
    else if(providerId) db.prepare("UPDATE staff_invitation_mail SET state='sent',payload=NULL,provider_id=?,lease_token=NULL,lease_until=NULL WHERE id=?").run(providerId,job.id);
    else {
      if(job.attempts+1>=3) console.error(`invitation mail failed state=failed code=${mailCode}`);
      db.prepare("UPDATE staff_invitation_mail SET state=CASE WHEN attempts>=3 THEN 'failed' ELSE 'queued' END,payload=CASE WHEN attempts>=3 THEN NULL ELSE payload END,next_at=?,lease_token=NULL,lease_until=NULL WHERE id=?").run(later(30000*(job.attempts+1)),job.id);
    }
  });return true;
}
