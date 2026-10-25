import { randomBytes, randomUUID } from 'node:crypto';
import { NOW, transaction } from './db.mjs';
import { tokenHash as hash, normalizeEmail, credentialInput, passwordRecordSync, passwordMatchesSync } from './auth-crypto.mjs';
import { requirePeopleStaff,inputKeys } from './people.mjs';
import {accountIdentity} from './account-schema.mjs';
import {consumeAuthBudget,recordAuthFailure} from './auth-budget.mjs';
import {requireWorkerSiteAccess} from './site-access.mjs';
import {revokePushForSession} from './notification-events.mjs';

const isLoopback = (address) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);
const invalidCredentials = () => new Error('Invalid credentials');

export function resolveAuthConfig(options = {}) {
  if (process.env.UNDERSTOOD_MODE) throw new Error('Legacy UNDERSTOOD_MODE is unsupported; configure tier, AI mode and access mode separately');
  const tier = options.tier ?? process.env.UNDERSTOOD_TIER;
  const aiMode = options.aiMode ?? process.env.UNDERSTOOD_AI_MODE;
  const accessMode = options.accessMode ?? process.env.UNDERSTOOD_ACCESS_MODE;
  if (tier === 'production') throw new Error('Production startup blocked: database/storage/live AI integration and release gates are incomplete');
  if (tier !== 'local' || aiMode !== 'synthetic' || !['demo', 'credential'].includes(accessMode)) {
    throw new Error('Set UNDERSTOOD_TIER=local, UNDERSTOOD_AI_MODE=synthetic and UNDERSTOOD_ACCESS_MODE=demo or credential');
  }
  const publicOrigin = options.publicOrigin ?? process.env.UNDERSTOOD_PUBLIC_ORIGIN ?? 'http://127.0.0.1:3020';
  let origin;
  try { origin = new URL(publicOrigin); } catch { throw new Error('Invalid local public origin'); }
  if (origin.origin !== publicOrigin || origin.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(origin.hostname)) {
    throw new Error('Local public origin must be an exact loopback HTTP origin');
  }
  return { tier, aiMode, accessMode, publicOrigin };
}

export function requireLocalRequest(req) {
  if (!isLoopback(req.socket.remoteAddress)) throw new Error('Forbidden');
}

export function verifyMutationOrigin(req, config) {
  const origin = req.headers.origin;
  if (config.remoteDemo) {
    const host = req.headers.host, forwardedProto = req.headers['x-forwarded-proto'];
    const proto = config.localDemo ? (forwardedProto ?? 'http') : forwardedProto;
    if (!host || !/^[a-z0-9.-]+(?::\d{1,5})?$/.test(host) || !['http','https'].includes(proto)
      || (!config.localDemo && proto !== 'https') || !origin || origin !== `${proto}://${host}`)
      throw new Error('Forbidden origin');
    if (config.localDemo ? !/^(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/.test(host) : !config.demoHosts?.has(host))
      throw new Error('Forbidden origin');
    return;
  }
  if (config.accessMode === 'credential' && origin !== config.publicOrigin) throw new Error('Forbidden origin');
  if (origin && origin !== config.publicOrigin) throw new Error('Forbidden origin');
}

function validCookieName(name) {
  if (typeof name!=='string' || !/^(?:__Host-)?[a-z][a-z0-9_]{0,63}$/.test(name)) throw new Error('Invalid session cookie name');
  return name;
}

export function cookieToken(req,name='understood_session') {
  return req.headers.cookie?.match(new RegExp(`(?:^|;\\s*)${validCookieName(name)}=([^;]+)`))?.[1] || null;
}

export function sessionCookie(token, maxAge, { secure = false,name='understood_session' } = {}) {
  const checked=validCookieName(name);
  if(checked.startsWith('__Host-') && !secure)throw Error('Host-prefixed cookies require Secure');
  return `${checked}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

export function clearSessionCookie(options={}) {
  return sessionCookie('',0,options);
}

export function createSession(db, principal, principalType, accessMode, grantId = null, maxSeconds = 8 * 3600, credentialRevision = null) {
  if(principalType==='worker')requireWorkerSiteAccess(db,principal.org_id,principal.site_id);
  if(credentialRevision!==null && (!Number.isSafeInteger(credentialRevision) || credentialRevision<1)) throw new Error('Invalid credential revision');
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + maxSeconds * 1000).toISOString();
  db.prepare(`INSERT INTO sessions
    (token_hash,org_id,site_id,principal_type,principal_id,expires_at,revoked_at,grant_id,access_mode,credential_revision)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(hash(token), principal.org_id, principal.site_id, principalType, principal.id, expiresAt, null, grantId, accessMode, credentialRevision);
  return { token, expiresAt, maxSeconds };
}

export function workerCredentialSessionValid(db, session) {
  if (!session || session.principal_type !== 'worker' || session.access_mode !== 'credential') return true;
  if (session.grant_id) {
    return !!db.prepare(`SELECT 1 FROM worker_grants WHERE id=? AND worker_id=? AND org_id=? AND site_id=?
      AND redeemed_at IS NOT NULL AND revoked_at IS NULL AND expires_at>?`).get(session.grant_id, session.principal_id, session.org_id, session.site_id, NOW());
  }
  if (!Number.isSafeInteger(session.credential_revision) || session.credential_revision < 1) return false;
  return !!db.prepare(`SELECT 1 FROM worker_credentials c JOIN workers w ON w.id=c.worker_id
    AND w.org_id=c.org_id AND w.site_id=c.site_id
    WHERE c.worker_id=? AND c.org_id=? AND c.site_id=? AND c.state='active' AND c.credential_revision=? AND w.active=1`)
    .get(session.principal_id, session.org_id, session.site_id, session.credential_revision);
}

export function requireSession(db, req, config) {
  const token = cookieToken(req);
  if (!token) throw new Error('Sign in required');
  const session = db.prepare(`SELECT * FROM sessions WHERE token_hash=? AND access_mode=?
    AND revoked_at IS NULL AND expires_at>?`).get(hash(token), config.accessMode, NOW());
  if (!session) throw new Error('Sign in required');
  if(session.principal_type==='worker')requireWorkerSiteAccess(db,session.org_id,session.site_id);
  const table = session.principal_type === 'staff' ? 'staff' : 'workers';
  const principal = db.prepare(`SELECT * FROM ${table} WHERE id=? AND org_id=? AND site_id=? AND active=1`)
    .get(session.principal_id, session.org_id, session.site_id);
  if (!principal) throw new Error('Sign in required');
  const account=session.principal_type==='staff' && config.accessMode==='credential' ? accountIdentity(db,session.principal_id) : null;
  if (config.accessMode === 'credential' && session.principal_type === 'staff' &&
      (!account?.account_active || !db.prepare('SELECT 1 FROM staff_credentials WHERE staff_id=?').get(account.credential_staff_id))) throw new Error('Sign in required');
  if (config.accessMode === 'credential' && session.principal_type === 'worker' &&
      !workerCredentialSessionValid(db, session)) throw new Error('Sign in required');
  return { ...session, ...principal,...(account ? {account_id:account.account_id} : {}), principal_id: session.principal_id, principal_type: session.principal_type };
}

export function revokeSession(db, req) {
  const token = cookieToken(req);
  if (token) {
    const token_hash=hash(token);
    db.prepare('UPDATE sessions SET revoked_at=? WHERE token_hash=?').run(NOW(), token_hash);
    revokePushForSession(db,token_hash);
  }
}

export function provisionStaffCredential(db, staffId, email, password) {
  const normalized = credentialInput(email,password);
  const staff = db.prepare('SELECT id FROM staff WHERE id=? AND active=1').get(staffId);
  if (!staff) throw new Error('Staff member unavailable');
  const { salt, derived } = passwordRecordSync(password);
  transaction(db, () => {
    if(!db.prepare('SELECT id FROM staff WHERE id=? AND active=1').get(staffId)) throw new Error('Staff member unavailable');
    const identity=accountIdentity(db,staffId),credentialId=identity?.credential_staff_id ?? staffId;
    db.prepare(`INSERT INTO staff_credentials VALUES (?,?,?,?,?)
      ON CONFLICT(staff_id) DO UPDATE SET email=excluded.email,password_salt=excluded.password_salt,
      password_hash=excluded.password_hash,changed_at=excluded.changed_at`).run(credentialId, normalized, salt, derived, NOW());
    const account=accountIdentity(db,staffId);
    db.prepare(`UPDATE sessions SET revoked_at=? WHERE principal_type='staff' AND revoked_at IS NULL AND principal_id IN
      (SELECT staff_id FROM staff_account_memberships WHERE account_id=?)`).run(NOW(),account.account_id);
  });
}

function attemptKey(type, value) { return hash(`${type}:${value}`); }

export function authenticateStaff(db, email, password, remoteAddress = '') {
  const normalized = normalizeEmail(email);
  if(typeof remoteAddress!=='string' || remoteAddress.length>128) throw invalidCredentials();
  const emailKey = attemptKey('email', normalized);
  const ipKey = attemptKey('ip', remoteAddress);
  if (!transaction(db,()=>consumeAuthBudget(db,[emailKey,ipKey],5,{increment:false}))) throw invalidCredentials();
  const row = normalized.length <= 254 && typeof password === 'string' && password.length <= 256
    ? db.prepare(`SELECT c.*,s.id,s.org_id,s.site_id,s.name,s.role,s.active,a.id AS account_id FROM staff_credentials c
        JOIN staff_accounts a ON a.credential_staff_id=c.staff_id JOIN staff_account_memberships m ON m.account_id=a.id
        JOIN staff s ON s.id=m.staff_id WHERE c.email=? AND a.active=1 AND s.active=1
        ORDER BY (s.id=c.staff_id) DESC,s.org_id,s.site_id,s.id LIMIT 1`).get(normalized)
    : null;
  const matches = passwordMatchesSync(password,row);
  if (!row || !row.active || !matches) {
    recordAuthFailure(db, emailKey);
    recordAuthFailure(db, ipKey);
    throw invalidCredentials();
  }
  db.prepare('DELETE FROM auth_attempts WHERE key_hash=?').run(emailKey);
  return row;
}

export function issueWorkerGrant(db, session, workerId, expiresInMinutes = 240) {
  requirePeopleStaff(db,session);
  grantReference(workerId);
  if (!Number.isInteger(expiresInMinutes) || expiresInMinutes < 5 || expiresInMinutes > 1440) throw new Error('Invalid grant expiry');
  const id = randomUUID(), token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + expiresInMinutes * 60_000).toISOString();
  return transaction(db, () => {
    requirePeopleStaff(db,session);
    requireWorkerSiteAccess(db,session.org_id,session.site_id);
    const worker = db.prepare('SELECT id,org_id,site_id FROM workers WHERE id=? AND org_id=? AND site_id=? AND active=1')
      .get(workerId, session.org_id, session.site_id);
    if (!worker) throw new Error('Worker unavailable');
    const now = NOW();
    db.prepare('UPDATE worker_grants SET revoked_at=? WHERE worker_id=? AND org_id=? AND site_id=? AND revoked_at IS NULL')
      .run(now, worker.id,worker.org_id,worker.site_id);
    db.prepare(`UPDATE sessions SET revoked_at=? WHERE principal_type='worker' AND principal_id=? AND org_id=? AND site_id=? AND revoked_at IS NULL`)
      .run(now, worker.id,worker.org_id,worker.site_id);
    db.prepare('INSERT INTO worker_grants VALUES (?,?,?,?,?,?,?,?,?)')
      .run(id, worker.org_id, worker.site_id, worker.id, hash(token), expiresAt, null, null, now);
    db.prepare('INSERT INTO audit VALUES (?,?,?,?,?,?,?,?)')
      .run(randomUUID(), worker.org_id, worker.site_id, 'staff', session.principal_id, 'grant.issued', id, now);
    return { id, token, expiresAt, workerId: worker.id };
  });
}

export function redeemWorkerGrant(db, token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw invalidCredentials();
  return transaction(db, () => {
    const grant = db.prepare(`SELECT g.*,w.active FROM worker_grants g JOIN workers w ON w.id=g.worker_id
      WHERE g.token_hash=?`).get(hash(token));
    if (!grant || !grant.active || grant.revoked_at || grant.redeemed_at || grant.expires_at <= NOW()) throw invalidCredentials();
    try{requireWorkerSiteAccess(db,grant.org_id,grant.site_id);}catch{throw invalidCredentials();}
    const changed = db.prepare('UPDATE worker_grants SET redeemed_at=? WHERE id=? AND redeemed_at IS NULL AND revoked_at IS NULL')
      .run(NOW(), grant.id);
    if (changed.changes !== 1) throw invalidCredentials();
    const maxSeconds = Math.min(2 * 3600, Math.max(1, Math.floor((Date.parse(grant.expires_at) - Date.now()) / 1000)));
    const session = createSession(db, { id: grant.worker_id, org_id: grant.org_id, site_id: grant.site_id }, 'worker', 'credential', grant.id, maxSeconds);
    db.prepare('INSERT INTO audit VALUES (?,?,?,?,?,?,?,?)')
      .run(randomUUID(), grant.org_id, grant.site_id, 'worker', grant.worker_id, 'grant.redeemed', grant.id, NOW());
    return { ...session, workerId: grant.worker_id };
  });
}

export function revokeWorkerGrant(db, session, grantId) {
  grantReference(grantId);
  transaction(db, () => {
    requirePeopleStaff(db,session);
    const grant = db.prepare('SELECT id FROM worker_grants WHERE id=? AND org_id=? AND site_id=?').get(grantId, session.org_id, session.site_id);
    if (!grant) throw new Error('Grant unavailable');
    const now = NOW();
    const changed=db.prepare('UPDATE worker_grants SET revoked_at=? WHERE id=? AND revoked_at IS NULL').run(now, grantId).changes;
    db.prepare('UPDATE sessions SET revoked_at=? WHERE grant_id=? AND revoked_at IS NULL').run(now, grantId);
    if(changed) db.prepare('INSERT INTO audit VALUES (?,?,?,?,?,?,?,?)')
      .run(randomUUID(), session.org_id, session.site_id, 'staff', session.principal_id, 'grant.revoked', grantId, now);
  });
}

export function grantReference(id) {
  if(typeof id!=='string' || !id || id.length>100) throw new Error('Invalid grant reference');
}

export function grantIssueInput(input) {
  inputKeys(input,['workerId','expiresInMinutes']);grantReference(input.workerId);
  const minutes=input.expiresInMinutes===undefined ? 240 : input.expiresInMinutes;
  if(!Number.isInteger(minutes) || minutes<5 || minutes>1440) throw new Error('Invalid grant expiry');
  return {workerId:input.workerId,expiresInMinutes:minutes};
}

export function grantFilters(id,input={}) {
  grantReference(id);inputKeys(input,['page','pageSize']);
  const page=input.page===undefined ? 1 : Number(input.page),pageSize=input.pageSize===undefined ? 5 : Number(input.pageSize);
  if(!Number.isInteger(page) || page<1 || page>5000 || !Number.isInteger(pageSize) || pageSize<1 || pageSize>50) throw new Error('Invalid page');
  return {page,pageSize};
}

export function grantMetadata(row,asOf) {
  const date=(value) => value===null ? null : new Date(value).toISOString();
  return {id:row.id,workerId:row.worker_id,createdAt:date(row.created_at),expiresAt:date(row.expires_at),
    redeemedAt:date(row.redeemed_at),revokedAt:date(row.revoked_at),
    status:row.revoked_at ? 'revoked' : Date.parse(row.expires_at)<=Date.parse(asOf) ? 'expired' : row.redeemed_at ? 'redeemed' : 'available'};
}

export function listWorkerGrants(db,session,workerId,input={}) {
  const {page,pageSize}=grantFilters(workerId,input);
  return transaction(db,() => {
    requirePeopleStaff(db,session);
    const worker=db.prepare('SELECT active FROM workers WHERE id=? AND org_id=? AND site_id=?').get(workerId,session.org_id,session.site_id);
    if(!worker) throw new Error('Worker unavailable');
    const asOf=NOW(),scope=[workerId,session.org_id,session.site_id];
    const total=db.prepare('SELECT COUNT(*) n FROM worker_grants WHERE worker_id=? AND org_id=? AND site_id=?').get(...scope).n;
    const items=db.prepare(`SELECT id,worker_id,created_at,expires_at,redeemed_at,revoked_at FROM worker_grants
      WHERE worker_id=? AND org_id=? AND site_id=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`).all(...scope,pageSize,(page-1)*pageSize);
    return {items:items.map((row) => grantMetadata(row,asOf)),total,page,pageSize,asOf,workerActive:!!worker.active};
  });
}
