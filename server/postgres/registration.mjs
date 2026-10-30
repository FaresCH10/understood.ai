import {registrationAcceptance,sendRegistrationVerification,checkRegistrationCode} from '../registration-verification.mjs';
import {randomBytes,randomUUID} from 'node:crypto';
import {inSchema} from './auth.mjs';
import {tokenHash,passwordRecord} from '../auth-crypto.mjs';
import {sealMail,openMail,sendAuthMail} from '../auth-mail.mjs';
import {consumeAuthBudget} from './auth-budget.mjs';
import {authMailCapacity} from './auth-mail-budget.mjs';
import {registrationRequestInput,registrationResendInput,registrationVerifyInput,registrationCodeInput,registrationEmailHash,
  REGISTRATION_TERMS_VERSION,REGISTRATION_PRIVACY_VERSION,REGISTRATION_TRIAL_HOURS,REGISTRATION_TRIAL_WORKER_LIMIT} from '../registration-input.mjs';


const unavailable=()=>new Error('Registration verification unavailable');

async function revokeTokens(client,registrationId,now,keep=null) {
  await client.query(`UPDATE registration_tokens SET revoked_at=$1 WHERE registration_id=$2 AND used_at IS NULL AND revoked_at IS NULL
    AND ($3::text IS NULL OR token_hash<>$3)`,[now,registrationId,keep]);
}
async function ignoreMail(client,registrationId) {
  await client.query(`UPDATE registration_mail SET state='ignored',payload=NULL,lease_token=NULL,lease_until=NULL
    WHERE registration_id=$1 AND state IN ('queued','processing')`,[registrationId]);
  await client.query('UPDATE registration_mail SET payload=NULL WHERE registration_id=$1 AND payload IS NOT NULL',[registrationId]);
}
async function expire(client) {
  await client.query(`UPDATE organization_registrations SET state='expired',payload=NULL
    WHERE state='pending' AND expires_at<=clock_timestamp()`);
  await client.query(`UPDATE registration_tokens SET revoked_at=clock_timestamp()
    WHERE used_at IS NULL AND revoked_at IS NULL AND (expires_at<=clock_timestamp()
      OR registration_id IN (SELECT id FROM organization_registrations WHERE state<>'pending'))`);
  await client.query(`UPDATE registration_mail SET state='expired',payload=NULL,lease_token=NULL,lease_until=NULL
    WHERE state IN ('queued','processing') AND expires_at<=clock_timestamp()`);
  await client.query(`UPDATE registration_mail SET state='ignored',payload=NULL,lease_token=NULL,lease_until=NULL
    WHERE state IN ('queued','processing') AND registration_id IN
    (SELECT id FROM organization_registrations WHERE state<>'pending')`);
  await client.query(`UPDATE registration_mail SET state='failed',payload=NULL,lease_token=NULL,lease_until=NULL
    WHERE state='processing' AND attempts>=3 AND lease_until<=clock_timestamp()`);
  await client.query(`UPDATE registration_mail SET payload=NULL
    WHERE state IN ('sent','ignored','failed','expired') AND payload IS NOT NULL`);
}
export function expireRegistrations(pool,{schema='public'}={}) {
  return inSchema(pool,schema,expire);
}
async function queueMail(client,config,registrationId,email,registrationExpiresAt,now) {
  if(!await authMailCapacity(client)) throw new Error('Email delivery unavailable');
  const id=randomUUID();
  await client.query(`INSERT INTO registration_mail(id,registration_id,email_hash,payload,created_at,expires_at,next_at,state)
    VALUES($1,$2,$3,$4,$5,LEAST($6::timestamptz,$5::timestamptz+interval '24 hours'),$5,'queued')`,
  [id,registrationId,tokenHash(registrationEmailHash(email)),sealMail(config,id,{email}),now,registrationExpiresAt]);
  return id;
}
export async function requestRegistration(pool,input,remoteAddress,config,{schema='public'}={}) {
  const value=registrationRequestInput(input,remoteAddress),generic=registrationAcceptance(config);
  if(!config.available) throw new Error('Email delivery unavailable');
  const record=await passwordRecord(value.password);
  return inSchema(pool,schema,async client=>{
    if(!await consumeAuthBudget(client,[tokenHash(`registration-email:${value.email}`),tokenHash(`registration-ip:${remoteAddress}`)],5)) return generic;
    await expire(client);
    const emailHash=tokenHash(registrationEmailHash(value.email));
    if((await client.query('SELECT 1 FROM staff_credentials WHERE email=$1',[value.email])).rows[0]) return generic;
    const existing=(await client.query('SELECT * FROM organization_registrations WHERE email_hash=$1 FOR UPDATE',[emailHash])).rows[0];
    if(existing && (existing.state==='verified' || existing.state==='pending'))
      return config.provider==='neon' && existing.state==='pending' && existing.id!==value.requestId?{...generic,requestId:existing.id}:generic;
    if(!existing && (await client.query('SELECT 1 FROM organization_registrations WHERE id=$1',[value.requestId])).rows[0]) return generic;
    const now=(await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
    const id=existing?.id ?? value.requestId;
    const envelope=sealMail(config,id,{email:value.email,ownerName:value.ownerName,companyName:value.companyName,country:value.country,
      phone:value.phone,passwordSalt:record.salt,passwordHash:record.derived,termsVersion:REGISTRATION_TERMS_VERSION,
      privacyVersion:REGISTRATION_PRIVACY_VERSION,acknowledgedAt:now.toISOString()});
    let expiresAt;
    if(existing) {
      const updated=await client.query(`UPDATE organization_registrations SET state='pending',payload=$1,created_at=$2,
        expires_at=$2::timestamptz+interval '7 days',verified_at=NULL,org_id=NULL,site_id=NULL,owner_id=NULL,resend_count=0,
        country=$3,terms_version=$4,privacy_version=$5,acknowledged_at=$2
        WHERE id=$6 AND state IN ('expired','ignored') RETURNING expires_at`,
      [envelope,now,value.country,REGISTRATION_TERMS_VERSION,REGISTRATION_PRIVACY_VERSION,id]);
      expiresAt=updated.rows[0]?.expires_at;
      if(!expiresAt) return generic;
      await ignoreMail(client,id);
    } else {
      const inserted=await client.query(`INSERT INTO organization_registrations(id,email_hash,payload,state,created_at,expires_at,
        resend_count,country,terms_version,privacy_version,acknowledged_at)
        VALUES($1,$2,$3,'pending',$4,$4::timestamptz+interval '7 days',0,$5,$6,$7,$4) RETURNING expires_at`,
      [id,emailHash,envelope,now,value.country,REGISTRATION_TERMS_VERSION,REGISTRATION_PRIVACY_VERSION]);
      expiresAt=inserted.rows[0].expires_at;
    }
    await queueMail(client,config,id,value.email,expiresAt,now);
    return config.provider==='neon' && id!==value.requestId?{...generic,requestId:id}:generic;
  });
}
export function resendRegistration(pool,input,remoteAddress,config,{schema='public'}={}) {
  const value=registrationResendInput(input,remoteAddress),generic=registrationAcceptance(config);
  if(!config.available) throw new Error('Email delivery unavailable');
  return inSchema(pool,schema,async client=>{
    if(!await consumeAuthBudget(client,[tokenHash(`registration-resend-email:${value.email}`),
      tokenHash(`registration-resend-ip:${remoteAddress}`)],5)) return generic;
    await expire(client);
    const registration=(await client.query(`SELECT * FROM organization_registrations WHERE id=$1 AND email_hash=$2
      AND state='pending' AND expires_at>clock_timestamp() AND resend_count<5 FOR UPDATE`,
    [value.requestId,tokenHash(registrationEmailHash(value.email))])).rows[0];
    if(!registration) return generic;
    const now=(await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
    await revokeTokens(client,registration.id,now);await ignoreMail(client,registration.id);
    const recipient=openMail(config,registration.id,registration.payload);
    await queueMail(client,config,registration.id,recipient.email,registration.expires_at,now);
    await client.query('UPDATE organization_registrations SET resend_count=resend_count+1 WHERE id=$1',[registration.id]);
    return generic;
  });
}
async function abandon(client,id,now) {
  await client.query("UPDATE organization_registrations SET state='ignored',payload=NULL WHERE id=$1 AND state='pending'",[id]);
  await revokeTokens(client,id,now);await ignoreMail(client,id);
}
function registrationScope(registration,message) {
  if(!message || typeof message.email!=='string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(message.email)
    || tokenHash(registrationEmailHash(message.email))!==registration.email_hash) throw unavailable();
  if(typeof message.ownerName!=='string' || message.ownerName.length<2 || message.ownerName.length>100
    || typeof message.companyName!=='string' || message.companyName.length<2 || message.companyName.length>120
    || typeof message.passwordSalt!=='string' || !/^[0-9a-f]{32}$/.test(message.passwordSalt ?? '')
    || typeof message.passwordHash!=='string' || !/^[0-9a-f]{128}$/.test(message.passwordHash ?? '')) throw unavailable();
  return message;
}
async function verified(client,registration,now) {
  const id=randomUUID(),orgId=randomUUID(),siteId=randomUUID();
  const endsAt=new Date(now.getTime()+REGISTRATION_TRIAL_HOURS*3600000);
  await client.query('INSERT INTO organizations(id,name) VALUES($1,$2)',[orgId,registration.companyName]);
  await client.query('INSERT INTO sites(id,org_id,name,timezone) VALUES($1,$2,$3,$4)',[siteId,orgId,registration.companyName,'UTC']);
  await client.query("INSERT INTO staff(id,org_id,site_id,name,role) VALUES($1,$2,$3,$4,'owner')",[id,orgId,siteId,registration.ownerName]);
  await client.query('INSERT INTO organization_settings(org_id,revision,support_email) VALUES($1,0,$2)',[orgId,registration.email]);
  await client.query(`INSERT INTO site_settings(site_id,org_id,revision,generation_languages_json,primary_contact_id)
    VALUES($1,$2,0,'["en","ar","ur"]'::jsonb,$3)`,[siteId,orgId,id]);
  await client.query('INSERT INTO staff_credentials(staff_id,email,password_salt,password_hash,changed_at) VALUES($1,$2,$3,$4,$5)',
    [id,registration.email,registration.passwordSalt,registration.passwordHash,now]);
  const terms=`${registration.termsVersion ?? REGISTRATION_TERMS_VERSION};${registration.privacyVersion ?? REGISTRATION_PRIVACY_VERSION}`;
  await client.query(`INSERT INTO organization_entitlements(org_id,state,started_at,ends_at,worker_limit,plan,terms_reference,
    revision,updated_by,updated_at) VALUES($1,'trial',$2,$3,$4,'trial',$5,1,'registration',$2)`,
  [orgId,now,endsAt,REGISTRATION_TRIAL_WORKER_LIMIT,terms]);
  await client.query(`INSERT INTO organization_entitlement_transitions(org_id,revision,state,started_at,ends_at,worker_limit,plan,
    terms_reference,reason,actor_type,actor_id,request_id,created_at)
    VALUES($1,1,'trial',$2,$3,$4,'trial',$5,'Verified owner registration','registration',$6,$6,$2)`,
  [orgId,now,endsAt,REGISTRATION_TRIAL_WORKER_LIMIT,terms,registration.id]);
  await client.query(`INSERT INTO audit(id,org_id,site_id,actor_type,actor_id,action,object_id)
    VALUES($1,$2,$3,'system','registration','organization.registered',$4)`,[randomUUID(),orgId,siteId,registration.id]);
  return {orgId,siteId,ownerId:id,endsAt};
}
export async function verifyRegistration(pool,input,remoteAddress,config,{schema='public'}={}) {
  const value=registrationVerifyInput(input);
  if(typeof remoteAddress!=='string' || remoteAddress.length>128) throw unavailable();
  const hash=tokenHash(value.token);
  const allowed=await inSchema(pool,schema,async client=>consumeAuthBudget(client,
    [tokenHash(`registration-token:${value.token}`),tokenHash(`registration-verify-ip:${remoteAddress}`)],10));
  if(!allowed) throw unavailable();
  return inSchema(pool,schema,async client=>{
    await expire(client);
    const now=(await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
    const token=(await client.query('SELECT * FROM registration_tokens WHERE token_hash=$1 FOR UPDATE',[hash])).rows[0];
    if(!token) throw unavailable();
    const registration=(await client.query('SELECT * FROM organization_registrations WHERE id=$1 FOR UPDATE',[token.registration_id])).rows[0];
    if(token.used_at) {
      if(registration?.state==='verified') return {completed:true,signInRequired:true,duplicate:true};
      throw unavailable();
    }
    if(token.revoked_at || token.expires_at<=now || !registration || registration.state!=='pending'
      || registration.expires_at<=now || !registration.payload) throw unavailable();
    let message;try {message=openMail(config,registration.id,registration.payload);}catch {throw unavailable();}
    registrationScope(registration,message);
    if((await client.query('SELECT 1 FROM staff_credentials WHERE email=$1',[message.email])).rows[0]) {
      await abandon(client,registration.id,now);throw unavailable();
    }
    const result=await verified(client,{...registration,...message},now);
    const updated=await client.query(`UPDATE organization_registrations SET state='verified',org_id=$1,site_id=$2,owner_id=$3,
      verified_at=$4,payload=NULL WHERE id=$5 AND state='pending'`,[result.orgId,result.siteId,result.ownerId,now,registration.id]);
    if(updated.rowCount!==1) throw unavailable();
    await client.query('UPDATE registration_tokens SET used_at=$1 WHERE token_hash=$2 AND used_at IS NULL',[now,hash]);
    await revokeTokens(client,registration.id,now,hash);
    await ignoreMail(client,registration.id);
    return {completed:true,signInRequired:true,duplicate:false};
  });
}
export async function verifyRegistrationCode(pool,input,remoteAddress,config,{schema='public',checkCode=checkRegistrationCode}={}){
  const value=registrationCodeInput(input,remoteAddress);
  if(config.provider!=='neon'||!config.available)throw unavailable();
  if(!await inSchema(pool,schema,client=>consumeAuthBudget(client,[tokenHash(`registration-code:${value.requestId}`),tokenHash(`registration-code-ip:${remoteAddress}`)],10)))throw unavailable();
  const snapshot=await inSchema(pool,schema,async client=>{
    await expire(client);
    const now=(await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
    const row=(await client.query('SELECT * FROM organization_registrations WHERE id=$1 AND email_hash=$2',[value.requestId,tokenHash(registrationEmailHash(value.email))])).rows[0];
    if(row?.state==='verified')return {duplicate:true};
    if(!row||row.state!=='pending'||row.expires_at<=now||!row.payload)throw unavailable();
    registrationScope(row,openMail(config,row.id,row.payload));return {payload:row.payload};
  });
  if(snapshot.duplicate)return {completed:true,signInRequired:true,duplicate:true};
  if(await checkCode(config,value.email,value.code)!==true)throw unavailable();
  return inSchema(pool,schema,async client=>{
    await expire(client);
    const now=(await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
    const row=(await client.query('SELECT * FROM organization_registrations WHERE id=$1 AND email_hash=$2 FOR UPDATE',[value.requestId,tokenHash(registrationEmailHash(value.email))])).rows[0];
    if(row?.state==='verified')return {completed:true,signInRequired:true,duplicate:true};
    if(!row||row.state!=='pending'||row.expires_at<=now||row.payload!==snapshot.payload)throw unavailable();
    const message=registrationScope(row,openMail(config,row.id,row.payload));
    if((await client.query('SELECT 1 FROM staff_credentials WHERE email=$1',[message.email])).rows[0])throw unavailable();
    const result=await verified(client,{...row,...message},now);
    const changed=await client.query("UPDATE organization_registrations SET state='verified',org_id=$1,site_id=$2,owner_id=$3,verified_at=$4,payload=NULL WHERE id=$5 AND state='pending'",[result.orgId,result.siteId,result.ownerId,now,row.id]);
    if(changed.rowCount!==1)throw unavailable();
    await revokeTokens(client,row.id,now);await ignoreMail(client,row.id);
    return {completed:true,signInRequired:true,duplicate:false};
  });
}
export async function processOneRegistration(pool,config,{schema='public',send=sendRegistrationVerification,registrationId=null,throwOnFailure=false}={}) {
  if(!config.available) return false;
  await expireRegistrations(pool,{schema});
  const job=await inSchema(pool,schema,async client=>{
    const row=(await client.query(`SELECT m.*,r.email_hash AS registration_email_hash,r.expires_at AS registration_expires_at
      FROM registration_mail m JOIN organization_registrations r ON r.id=m.registration_id
      WHERE m.expires_at>clock_timestamp() AND m.attempts<3 AND r.state='pending' AND r.expires_at>clock_timestamp()
        AND ($1::text IS NULL OR r.id=$1) AND r.payload IS NOT NULL AND ((m.state='queued' AND m.next_at<=clock_timestamp())
          OR (m.state='processing' AND m.lease_until<=clock_timestamp()))
      ORDER BY m.created_at,m.id LIMIT 1 FOR UPDATE OF m SKIP LOCKED`,[registrationId])).rows[0];
    if(!row) return null;
    const now=(await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
    const lease=randomUUID();
    await client.query(`UPDATE registration_mail SET state='processing',attempts=attempts+1,lease_token=$1,
      lease_until=clock_timestamp()+interval '30 seconds' WHERE id=$2`,[lease,row.id]);
    const terminal=async state=>{
      await client.query('UPDATE registration_mail SET state=$1,payload=NULL,lease_token=NULL,lease_until=NULL WHERE id=$2',[state,row.id]);
      return {ignored:true};
    };
    let message;try {message=openMail(config,row.id,row.payload);}catch {return terminal('failed');}
    if(!message || typeof message.email!=='string' || tokenHash(registrationEmailHash(message.email))!==row.email_hash) {
      await client.query("UPDATE organization_registrations SET state='ignored',payload=NULL WHERE id=$1 AND state='pending'",[row.registration_id]);
      await revokeTokens(client,row.registration_id,now);
      return terminal('ignored');
    }
    if((await client.query('SELECT 1 FROM staff_credentials WHERE email=$1',[message.email])).rows[0]) {
      await client.query("UPDATE organization_registrations SET state='ignored',payload=NULL WHERE id=$1 AND state='pending'",[row.registration_id]);
      await revokeTokens(client,row.registration_id,now);
      await ignoreMail(client,row.registration_id);
      return terminal('ignored');
    }
    let token=(await client.query('SELECT * FROM registration_tokens WHERE mail_id=$1',[row.id])).rows[0];
    if(config.provider==='neon')message={email:message.email,subject:'Verify your Understood account',text:''};
    else if(!token) {
      const secret=randomBytes(32).toString('base64url');
      token={token_hash:tokenHash(secret)};
      await client.query('INSERT INTO registration_tokens(token_hash,registration_id,mail_id,expires_at) VALUES($1,$2,$3,$4)',
        [token.token_hash,row.registration_id,row.id,row.expires_at]);
      const text=`Verify your Understood account by opening this one-use link within 24 hours:\n${config.publicOrigin}/#verify-registration/${secret}\n\nConfirming your email starts a 14-day trial for up to 25 workers. No card is required and nothing renews automatically. If you did not create this account, ignore this email.`;
      message={email:message.email,subject:'Verify your Understood account',text};
      await client.query('UPDATE registration_mail SET payload=$1 WHERE id=$2',[sealMail(config,row.id,message),row.id]);
    }
    return {...row,lease,message};
  });
  if(!job) return false;if(job.ignored) return true;
  try {
    const result=await send(config,job.id,job.message);
    if(typeof result?.providerId!=='string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(result.providerId)) throw new Error('Unverified delivery');
    await inSchema(pool,schema,client=>client.query(`UPDATE registration_mail SET state='sent',payload=NULL,provider_id=$1,
      lease_token=NULL,lease_until=NULL WHERE id=$2 AND state='processing' AND lease_token=$3 AND lease_until>clock_timestamp()`,
    [result.providerId,job.id,job.lease]));
  }catch {
    await inSchema(pool,schema,client=>client.query(`UPDATE registration_mail SET state=CASE WHEN attempts>=3 THEN 'failed' ELSE 'queued' END,
      next_at=clock_timestamp()+$1*interval '1 second',payload=CASE WHEN attempts>=3 THEN NULL ELSE payload END,
      lease_token=NULL,lease_until=NULL WHERE id=$2 AND state='processing' AND lease_token=$3 AND lease_until>clock_timestamp()`,
    [30*(job.attempts+1),job.id,job.lease]));
    if(throwOnFailure)throw Error('Email delivery unavailable');
  }
  return true;
}
