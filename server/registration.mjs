import {randomBytes,randomUUID} from 'node:crypto';
import {NOW,transaction} from './db.mjs';
import {tokenHash,passwordRecord} from './auth-crypto.mjs';
import {sealMail,openMail,sendAuthMail} from './auth-mail.mjs';
import {consumeAuthBudget} from './auth-budget.mjs';
import {authMailCapacity} from './auth-mail-budget.mjs';
import {ensureSettingsSchema} from './settings.mjs';
import {ensureEntitlementSchema} from './entitlement-schema.mjs';
import {registrationRequestInput,registrationResendInput,registrationVerifyInput,registrationEmailHash,
  REGISTRATION_TERMS_VERSION,REGISTRATION_PRIVACY_VERSION,REGISTRATION_TRIAL_HOURS,REGISTRATION_TRIAL_WORKER_LIMIT} from './registration-input.mjs';

const generic={accepted:true,delivery:'queued'};
const unavailable=()=>new Error('Registration verification unavailable');
const registrationLifetime=7*24*3600000,mailLifetime=24*3600000;
const date=milliseconds=>new Date(Date.now()+milliseconds).toISOString();

export function ensureRegistrationSchema(db) {
  ensureSettingsSchema(db);
  ensureEntitlementSchema(db);
  db.exec(`CREATE TABLE IF NOT EXISTS organization_registrations (
    id TEXT PRIMARY KEY,email_hash TEXT NOT NULL UNIQUE CHECK(length(email_hash)=64),
    payload TEXT CHECK(payload IS NULL OR length(payload)<=12000),
    state TEXT NOT NULL CHECK(state IN ('pending','verified','ignored','expired')),
    org_id TEXT REFERENCES organizations(id),site_id TEXT REFERENCES sites(id),owner_id TEXT REFERENCES staff(id),
    created_at TEXT NOT NULL,expires_at TEXT NOT NULL,verified_at TEXT,
    resend_count INTEGER NOT NULL DEFAULT 0 CHECK(resend_count BETWEEN 0 AND 5),
    country TEXT CHECK(country IS NULL OR length(country)=2),
    terms_version TEXT CHECK(terms_version IS NULL OR length(terms_version) BETWEEN 1 AND 40),
    privacy_version TEXT CHECK(privacy_version IS NULL OR length(privacy_version) BETWEEN 1 AND 40),
    acknowledged_at TEXT,
    CHECK((state='pending' AND payload IS NOT NULL AND verified_at IS NULL)
      OR (state='verified' AND payload IS NULL AND verified_at IS NOT NULL
        AND org_id IS NOT NULL AND site_id IS NOT NULL AND owner_id IS NOT NULL)
      OR (state IN ('ignored','expired') AND payload IS NULL AND verified_at IS NULL))
  ) STRICT;
  CREATE TABLE IF NOT EXISTS registration_mail (
    id TEXT PRIMARY KEY,registration_id TEXT NOT NULL REFERENCES organization_registrations(id),
    email_hash TEXT NOT NULL CHECK(length(email_hash)=64),payload TEXT,
    created_at TEXT NOT NULL,expires_at TEXT NOT NULL,next_at TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('queued','processing','sent','ignored','failed','expired')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
    lease_token TEXT,lease_until TEXT,provider_id TEXT,
    CHECK((state='processing')=(lease_token IS NOT NULL AND lease_until IS NOT NULL)),
    CHECK(state NOT IN ('sent','ignored','failed','expired') OR payload IS NULL)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS registration_mail_due ON registration_mail(state,next_at,lease_until);
  CREATE TABLE IF NOT EXISTS registration_tokens (
    token_hash TEXT PRIMARY KEY CHECK(length(token_hash)=64),
    registration_id TEXT NOT NULL REFERENCES organization_registrations(id),
    mail_id TEXT NOT NULL UNIQUE REFERENCES registration_mail(id),
    expires_at TEXT NOT NULL,used_at TEXT,revoked_at TEXT
  ) STRICT;
  CREATE TRIGGER IF NOT EXISTS organization_registration_identity BEFORE UPDATE ON organization_registrations
    WHEN NEW.id<>OLD.id OR NEW.email_hash<>OLD.email_hash
    BEGIN SELECT RAISE(ABORT,'Registration identity is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS organization_registration_verified_frozen BEFORE UPDATE ON organization_registrations
    WHEN OLD.state='verified' AND (NEW.state<>'verified' OR NEW.payload IS NOT NULL
      OR NEW.verified_at IS NOT OLD.verified_at OR NEW.org_id IS NOT OLD.org_id OR NEW.site_id IS NOT OLD.site_id
      OR NEW.owner_id IS NOT OLD.owner_id OR NEW.created_at<>OLD.created_at OR NEW.expires_at<>OLD.expires_at
      OR NEW.resend_count<>OLD.resend_count)
    BEGIN SELECT RAISE(ABORT,'Verified registration is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS organization_registration_payload BEFORE UPDATE OF payload ON organization_registrations
    WHEN OLD.payload IS NOT NULL AND NEW.payload IS NOT NULL AND NEW.payload<>OLD.payload
    BEGIN SELECT RAISE(ABORT,'Registration payload is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS organization_registration_verified_scope BEFORE UPDATE ON organization_registrations
    WHEN NEW.state='verified' AND NOT EXISTS(SELECT 1 FROM staff s JOIN sites t ON t.id=NEW.site_id AND t.org_id=NEW.org_id
      WHERE s.id=NEW.owner_id AND s.org_id=NEW.org_id AND s.site_id=NEW.site_id AND s.role='owner')
    BEGIN SELECT RAISE(ABORT,'Registration scope mismatch'); END;
  CREATE TRIGGER IF NOT EXISTS organization_registration_no_delete BEFORE DELETE ON organization_registrations
    BEGIN SELECT RAISE(ABORT,'Registration is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS registration_token_pending BEFORE INSERT ON registration_tokens
    WHEN NOT EXISTS(SELECT 1 FROM organization_registrations r WHERE r.id=NEW.registration_id AND r.state='pending')
    BEGIN SELECT RAISE(ABORT,'Registration token unavailable'); END;
  CREATE TRIGGER IF NOT EXISTS registration_token_identity BEFORE UPDATE ON registration_tokens
    WHEN NEW.token_hash<>OLD.token_hash OR NEW.registration_id<>OLD.registration_id OR NEW.mail_id<>OLD.mail_id
      OR NEW.expires_at<>OLD.expires_at
      OR (OLD.used_at IS NOT NULL AND NEW.used_at IS NOT OLD.used_at)
      OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NOT OLD.revoked_at)
    BEGIN SELECT RAISE(ABORT,'Registration token identity is immutable'); END;`);
}

function revokeTokens(db,registrationId,now,keep=null) {
  db.prepare(`UPDATE registration_tokens SET revoked_at=? WHERE registration_id=? AND used_at IS NULL AND revoked_at IS NULL
    AND (? IS NULL OR token_hash<>?)`).run(now,registrationId,keep,keep);
}
function ignoreMail(db,registrationId,now) {
  db.prepare(`UPDATE registration_mail SET state='ignored',payload=NULL,lease_token=NULL,lease_until=NULL
    WHERE registration_id=? AND state IN ('queued','processing')`).run(registrationId);
  db.prepare("UPDATE registration_mail SET payload=NULL WHERE registration_id=? AND payload IS NOT NULL").run(registrationId);
}
function expire(db,now) {
  db.prepare("UPDATE organization_registrations SET state='expired',payload=NULL WHERE state='pending' AND expires_at<=?").run(now);
  db.prepare(`UPDATE registration_tokens SET revoked_at=? WHERE used_at IS NULL AND revoked_at IS NULL
    AND (expires_at<=? OR registration_id IN (SELECT id FROM organization_registrations WHERE state<>'pending'))`).run(now,now);
  db.prepare(`UPDATE registration_mail SET state='expired',payload=NULL,lease_token=NULL,lease_until=NULL
    WHERE state IN ('queued','processing') AND expires_at<=?`).run(now);
  db.prepare(`UPDATE registration_mail SET state='ignored',payload=NULL,lease_token=NULL,lease_until=NULL
    WHERE state IN ('queued','processing') AND registration_id IN
    (SELECT id FROM organization_registrations WHERE state<>'pending')`).run();
  db.prepare(`UPDATE registration_mail SET state='failed',payload=NULL,lease_token=NULL,lease_until=NULL
    WHERE state='processing' AND attempts>=3 AND lease_until<=?`).run(now);
  db.prepare("UPDATE registration_mail SET payload=NULL WHERE state IN ('sent','ignored','failed','expired') AND payload IS NOT NULL").run();
}
export function expireRegistrations(db) {
  ensureRegistrationSchema(db);
  return transaction(db,()=>expire(db,NOW()));
}
function queueMail(db,config,registrationId,email,registrationExpiresAt,now) {
  if(!authMailCapacity(db)) throw new Error('Email delivery unavailable');
  const id=randomUUID(),expiresAt=new Date(Math.min(Date.parse(registrationExpiresAt),Date.parse(now)+mailLifetime)).toISOString();
  db.prepare(`INSERT INTO registration_mail(id,registration_id,email_hash,payload,created_at,expires_at,next_at,state)
    VALUES(?,?,?,?,?,?,?,'queued')`).run(id,registrationId,tokenHash(registrationEmailHash(email)),
    sealMail(config,id,{email}),now,expiresAt,now);
  return id;
}
export async function requestRegistration(db,input,remoteAddress,config) {
  const value=registrationRequestInput(input,remoteAddress);
  if(!config.available) throw new Error('Email delivery unavailable');
  ensureRegistrationSchema(db);
  const record=await passwordRecord(value.password);
  return transaction(db,()=>{
    const now=NOW();
    if(!consumeAuthBudget(db,[tokenHash(`registration-email:${value.email}`),tokenHash(`registration-ip:${remoteAddress}`)],5,{now})) return generic;
    expire(db,now);
    const emailHash=tokenHash(registrationEmailHash(value.email));
    if(db.prepare('SELECT 1 FROM staff_credentials WHERE lower(email)=?').get(value.email)) return generic;
    const existing=db.prepare('SELECT * FROM organization_registrations WHERE email_hash=?').get(emailHash);
    if(existing && (existing.state==='verified' || existing.state==='pending')) return generic;
    if(!existing && db.prepare('SELECT 1 FROM organization_registrations WHERE id=?').get(value.requestId)) return generic;
    const id=existing?.id ?? value.requestId,expiresAt=date(registrationLifetime);
    const envelope=sealMail(config,id,{email:value.email,ownerName:value.ownerName,companyName:value.companyName,country:value.country,
      phone:value.phone,passwordSalt:record.salt,passwordHash:record.derived,termsVersion:REGISTRATION_TERMS_VERSION,
      privacyVersion:REGISTRATION_PRIVACY_VERSION,acknowledgedAt:now});
    if(existing) {
      db.prepare(`UPDATE organization_registrations SET state='pending',payload=?,created_at=?,expires_at=?,verified_at=NULL,
        org_id=NULL,site_id=NULL,owner_id=NULL,resend_count=0,country=?,terms_version=?,privacy_version=?,acknowledged_at=?
        WHERE id=? AND state IN ('expired','ignored')`).run(envelope,now,expiresAt,value.country,REGISTRATION_TERMS_VERSION,
        REGISTRATION_PRIVACY_VERSION,now,id);
      ignoreMail(db,id,now);
    } else {
      db.prepare(`INSERT INTO organization_registrations(id,email_hash,payload,state,created_at,expires_at,resend_count,
        country,terms_version,privacy_version,acknowledged_at) VALUES(?,?,?,'pending',?,?,0,?,?,?,?)`)
        .run(id,emailHash,envelope,now,expiresAt,value.country,REGISTRATION_TERMS_VERSION,REGISTRATION_PRIVACY_VERSION,now);
    }
    queueMail(db,config,id,value.email,expiresAt,now);
    return generic;
  });
}
export function resendRegistration(db,input,remoteAddress,config) {
  const value=registrationResendInput(input,remoteAddress);
  if(!config.available) throw new Error('Email delivery unavailable');
  ensureRegistrationSchema(db);
  return transaction(db,()=>{
    const now=NOW();
    if(!consumeAuthBudget(db,[tokenHash(`registration-resend-email:${value.email}`),
      tokenHash(`registration-resend-ip:${remoteAddress}`)],5,{now})) return generic;
    expire(db,now);
    const registration=db.prepare('SELECT * FROM organization_registrations WHERE id=? AND email_hash=?')
      .get(value.requestId,tokenHash(registrationEmailHash(value.email)));
    if(!registration || registration.state!=='pending' || registration.expires_at<=now || registration.resend_count>=5) return generic;
    revokeTokens(db,registration.id,now);ignoreMail(db,registration.id,now);
    const recipient=openMail(config,registration.id,registration.payload);
    queueMail(db,config,registration.id,recipient.email,registration.expires_at,now);
    db.prepare('UPDATE organization_registrations SET resend_count=resend_count+1 WHERE id=?').run(registration.id);
    return generic;
  });
}
function abandon(db,id,now) {
  db.prepare("UPDATE organization_registrations SET state='ignored',payload=NULL WHERE id=? AND state='pending'").run(id);
  revokeTokens(db,id,now);ignoreMail(db,id,now);
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
function verified(db,registration,now) {
  const id=randomUUID(),orgId=randomUUID(),siteId=randomUUID();
  const endsAt=new Date(Date.parse(now)+REGISTRATION_TRIAL_HOURS*3600000).toISOString();
  db.prepare('INSERT INTO organizations(id,name) VALUES(?,?)').run(orgId,registration.companyName);
  db.prepare('INSERT INTO sites(id,org_id,name,timezone) VALUES(?,?,?,?)').run(siteId,orgId,registration.companyName,'UTC');
  db.prepare("INSERT INTO staff(id,org_id,site_id,name,role) VALUES(?,?,?,?,'owner')").run(id,orgId,siteId,registration.ownerName);
  db.prepare('INSERT INTO organization_settings(org_id,revision,support_email) VALUES(?,0,?)').run(orgId,registration.email);
  db.prepare(`INSERT INTO site_settings(site_id,org_id,revision,generation_languages_json,primary_contact_id)
    VALUES(?,?,0,'["en","ar","ur"]',?)`).run(siteId,orgId,id);
  db.prepare('INSERT INTO staff_credentials(staff_id,email,password_salt,password_hash,changed_at) VALUES(?,?,?,?,?)')
    .run(id,registration.email,registration.passwordSalt,registration.passwordHash,now);
  const terms=`${registration.termsVersion ?? REGISTRATION_TERMS_VERSION};${registration.privacyVersion ?? REGISTRATION_PRIVACY_VERSION}`;
  db.prepare(`INSERT INTO organization_entitlements(org_id,state,started_at,ends_at,worker_limit,plan,terms_reference,
    revision,updated_by,updated_at) VALUES(?,'trial',?,?,?,'trial',?,1,'registration',?)`)
    .run(orgId,now,endsAt,REGISTRATION_TRIAL_WORKER_LIMIT,terms,now);
  db.prepare(`INSERT INTO organization_entitlement_transitions(org_id,revision,state,started_at,ends_at,worker_limit,plan,
    terms_reference,reason,actor_type,actor_id,request_id,created_at)
    VALUES(?,1,'trial',?,?,?,'trial',?,'Verified owner registration','registration',?,?,?)`)
    .run(orgId,now,endsAt,REGISTRATION_TRIAL_WORKER_LIMIT,terms,registration.id,registration.id,now);
  db.prepare(`INSERT INTO audit VALUES(?,?,?,?,?,?,?,?)`).run(randomUUID(),orgId,siteId,'system','registration',
    'organization.registered',registration.id,now);
  return {orgId,siteId,ownerId:id,endsAt};
}
export function verifyRegistration(db,input,remoteAddress,config) {
  const value=registrationVerifyInput(input);
  if(typeof remoteAddress!=='string' || remoteAddress.length>128) throw unavailable();
  ensureRegistrationSchema(db);
  const allowed=transaction(db,()=>consumeAuthBudget(db,[tokenHash(`registration-token:${value.token}`),
    tokenHash(`registration-verify-ip:${remoteAddress}`)],10,{now:NOW()}));
  if(!allowed) throw unavailable();
  const hash=tokenHash(value.token);
  return transaction(db,()=>{
    const now=NOW();expire(db,now);
    const token=db.prepare('SELECT * FROM registration_tokens WHERE token_hash=?').get(hash);
    if(!token) throw unavailable();
    const registration=db.prepare('SELECT * FROM organization_registrations WHERE id=?').get(token.registration_id);
    if(token.used_at) {
      if(registration?.state==='verified') return {completed:true,signInRequired:true,duplicate:true};
      throw unavailable();
    }
    if(token.revoked_at || token.expires_at<=now || !registration || registration.state!=='pending'
      || registration.expires_at<=now || !registration.payload) throw unavailable();
    let message;try {message=openMail(config,registration.id,registration.payload);}catch {throw unavailable();}
    registrationScope(registration,message);
    if(db.prepare('SELECT 1 FROM staff_credentials WHERE lower(email)=?').get(message.email)) {
      abandon(db,registration.id,now);throw unavailable();
    }
    const result=verified(db,{...registration,...message},now);
    const updated=db.prepare(`UPDATE organization_registrations SET state='verified',org_id=?,site_id=?,owner_id=?,verified_at=?,
      payload=NULL WHERE id=? AND state='pending'`).run(result.orgId,result.siteId,result.ownerId,now,registration.id);
    if(updated.changes!==1) throw unavailable();
    db.prepare('UPDATE registration_tokens SET used_at=? WHERE token_hash=? AND used_at IS NULL').run(now,hash);
    revokeTokens(db,registration.id,now,hash);
    ignoreMail(db,registration.id,now);
    return {completed:true,signInRequired:true,duplicate:false};
  });
}
export async function processOneRegistration(db,config,{send=sendAuthMail}={}) {
  if(!config.available) return false;
  ensureRegistrationSchema(db);expireRegistrations(db);
  const job=transaction(db,()=>{
    const now=NOW(),row=db.prepare(`SELECT m.*,r.email_hash AS registration_email_hash,r.expires_at AS registration_expires_at
      FROM registration_mail m JOIN organization_registrations r ON r.id=m.registration_id
      WHERE m.expires_at>? AND m.attempts<3 AND r.state='pending' AND r.expires_at>? AND r.payload IS NOT NULL
        AND ((m.state='queued' AND m.next_at<=?) OR (m.state='processing' AND m.lease_until<=?))
      ORDER BY m.created_at,m.id LIMIT 1`).get(now,now,now,now);
    if(!row) return null;
    const lease=randomUUID();
    db.prepare("UPDATE registration_mail SET state='processing',attempts=attempts+1,lease_token=?,lease_until=? WHERE id=?")
      .run(lease,date(30000),row.id);
    const terminal=state=>{
      db.prepare('UPDATE registration_mail SET state=?,payload=NULL,lease_token=NULL,lease_until=NULL WHERE id=?').run(state,row.id);
      return {ignored:true};
    };
    let message;try {message=openMail(config,row.id,row.payload);}catch {return terminal('failed');}
    if(!message || typeof message.email!=='string' || tokenHash(registrationEmailHash(message.email))!==row.email_hash) {
      db.prepare("UPDATE organization_registrations SET state='ignored',payload=NULL WHERE id=? AND state='pending'").run(row.registration_id);
      revokeTokens(db,row.registration_id,now);
      return terminal('ignored');
    }
    if(db.prepare('SELECT 1 FROM staff_credentials WHERE lower(email)=?').get(message.email)) {
      db.prepare("UPDATE organization_registrations SET state='ignored',payload=NULL WHERE id=? AND state='pending'").run(row.registration_id);
      revokeTokens(db,row.registration_id,now);ignoreMail(db,row.registration_id,now);
      return terminal('ignored');
    }
    let token=db.prepare('SELECT * FROM registration_tokens WHERE mail_id=?').get(row.id);
    if(!token) {
      const secret=randomBytes(32).toString('base64url');
      token={token_hash:tokenHash(secret)};
      db.prepare('INSERT INTO registration_tokens(token_hash,registration_id,mail_id,expires_at) VALUES(?,?,?,?)')
        .run(token.token_hash,row.registration_id,row.id,row.expires_at);
      const text=`Verify your Understood account by opening this one-use link within 24 hours:\n${config.publicOrigin}/#verify-registration/${secret}\n\nConfirming your email starts a 14-day trial for up to 25 workers. No card is required and nothing renews automatically. If you did not create this account, ignore this email.`;
      message={email:message.email,subject:'Verify your Understood account',text};
      db.prepare('UPDATE registration_mail SET payload=? WHERE id=?').run(sealMail(config,row.id,message),row.id);
    }
    return {...row,lease,message};
  });
  if(!job) return false;if(job.ignored) return true;
  try {
    const result=await send(config,job.id,job.message);
    if(typeof result?.providerId!=='string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(result.providerId)) throw new Error('Unverified delivery');
    db.prepare(`UPDATE registration_mail SET state='sent',payload=NULL,provider_id=?,lease_token=NULL,lease_until=NULL
      WHERE id=? AND state='processing' AND lease_token=? AND lease_until>?`).run(result.providerId,job.id,job.lease,NOW());
  }catch {
    db.prepare(`UPDATE registration_mail SET state=CASE WHEN attempts>=3 THEN 'failed' ELSE 'queued' END,next_at=?,
      payload=CASE WHEN attempts>=3 THEN NULL ELSE payload END,lease_token=NULL,lease_until=NULL
      WHERE id=? AND state='processing' AND lease_token=? AND lease_until>?`)
      .run(date(30000*(job.attempts+1)),job.id,job.lease,NOW());
  }
  return true;
}
