import { randomBytes, randomUUID } from 'node:crypto';
import { withTransaction } from './db.mjs';
import { schemaName } from './migrate.mjs';
import { cookieToken,grantReference,grantFilters,grantMetadata } from '../auth.mjs';
import { tokenHash, normalizeEmail, credentialInput, passwordRecord, passwordMatches } from '../auth-crypto.mjs';
import {consumeAuthBudget} from './auth-budget.mjs';
import {requireTenantActive,lockOperationsGate} from './operations-gates.mjs';
import {requireWorkerSiteAccess} from './site-access.mjs';
import {revokeSessionPushSubscriptions} from './notification-events.mjs';

const invalidCredentials = () => new Error('Invalid credentials');
const validToken = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);

export function inSchema(pool, schema, fn) {
  schemaName(schema);
  return withTransaction(pool, async (client) => {
    await client.query(`SELECT set_config('search_path',quote_ident($1)||',pg_catalog',true),
      set_config('lock_timeout','5s',true),set_config('statement_timeout','10s',true)`,[schema]);
    return fn(client);
  });
}

export async function lockStaffAccount(client,staffId,active=true) {
  const reference=(await client.query('SELECT account_id FROM staff_account_memberships WHERE staff_id=$1',[staffId])).rows[0];
  if(!reference) return null;
  const row=(await client.query(`SELECT id AS account_id,credential_staff_id,active AS account_active,revision AS account_revision
    FROM staff_accounts WHERE id=$1 FOR UPDATE`,[reference.account_id])).rows[0];
  return row && (!active || row.account_active) ? row : null;
}

async function writableStaff(client, session) {
  if (session?.principal_type !== 'staff' || !['owner','supervisor'].includes(session.role)) throw new Error('Forbidden');
  await requireTenantActive(client,session.org_id);
  const row = (await client.query(`SELECT id FROM staff WHERE id=$1 AND org_id=$2 AND site_id=$3
    AND role=$4 AND active=true FOR SHARE`,[session.principal_id,session.org_id,session.site_id,session.role])).rows[0];
  if (!row) throw new Error('Forbidden');
}

async function audit(client, principal, action, objectId) {
  await client.query(`INSERT INTO audit(id,org_id,site_id,actor_type,actor_id,action,object_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7)`,[randomUUID(),principal.org_id,principal.site_id,principal.principal_type,principal.principal_id,action,objectId]);
}

export async function insertSession(client, principal, type, grantId = null, maxSeconds = 8*3600, credentialRevision = null) {
  await requireTenantActive(client,principal.org_id);
  if(type==='worker')await requireWorkerSiteAccess(client,principal.org_id,principal.site_id);
  if(credentialRevision!==null && (!Number.isSafeInteger(credentialRevision)||credentialRevision<1)) throw new Error('Invalid credential revision');
  const token = randomBytes(32).toString('base64url');
  const row = (await client.query(`INSERT INTO sessions(token_hash,org_id,site_id,principal_type,principal_id,expires_at,grant_id,access_mode,credential_revision)
    VALUES ($1,$2,$3,$4,$5,clock_timestamp()+$6*interval '1 second',$7,'credential',$8) RETURNING expires_at`,
  [tokenHash(token),principal.org_id,principal.site_id,type,principal.id,maxSeconds,grantId,credentialRevision])).rows[0];
  return { token,expiresAt:row.expires_at.toISOString(),maxSeconds };
}

// Maintenance-only bootstrap/rotation; this is intentionally not a public HTTP endpoint.
export async function provisionStaffCredential(pool, { staffId,orgId,siteId,email,password }, { schema='public' } = {}) {
  const normalized = credentialInput(email,password);
  const { salt,derived } = await passwordRecord(password);
  return inSchema(pool,schema,async (client) => {
    const identity=await lockStaffAccount(client,staffId,false);
    const staff = (await client.query(`SELECT id FROM staff WHERE id=$1 AND org_id=$2 AND site_id=$3 AND active=true FOR UPDATE`,
      [staffId,orgId,siteId])).rows[0];
    if (!staff) throw new Error('Staff member unavailable');
    await client.query(`INSERT INTO staff_credentials(staff_id,email,password_salt,password_hash,changed_at) VALUES ($1,$2,$3,$4,clock_timestamp())
      ON CONFLICT(staff_id) DO UPDATE SET email=excluded.email,password_salt=excluded.password_salt,password_hash=excluded.password_hash,changed_at=excluded.changed_at`,
    [identity?.credential_staff_id ?? staffId,normalized,salt,derived]);
    const account=await lockStaffAccount(client,staffId,false);
    await client.query(`UPDATE sessions SET revoked_at=clock_timestamp() WHERE principal_type='staff' AND revoked_at IS NULL
      AND principal_id IN (SELECT staff_id FROM staff_account_memberships WHERE account_id=$1)`,[account.account_id]);
    await audit(client,{ org_id:orgId,site_id:siteId,principal_type:'system',principal_id:'credential-maintenance' },'credential.rotated',staffId);
  });
}

export async function authenticateStaff(pool, email, password, remoteAddress='', { schema='public' } = {}) {
  const raw = normalizeEmail(email), normalized = raw.length<=254 ? raw : '<invalid>';
  if (typeof remoteAddress !== 'string' || remoteAddress.length>128) throw invalidCredentials();
  const emailKey = tokenHash(`email:${normalized}`), ipKey = tokenHash(`ip:${remoteAddress}`);
  if(!await inSchema(pool,schema,client=>consumeAuthBudget(client,[emailKey,ipKey],5,{increment:false}))) throw invalidCredentials();
  const result = await inSchema(pool,schema,async (client) => {
    await lockOperationsGate(client);
    // Serialize the shared email/IP counters; invalid attempts must commit before the generic error is raised.
    for (const key of [...new Set([emailKey,ipKey])].sort()) await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`understood:auth:${key}`]);
    const blocked = (await client.query(`SELECT 1 FROM auth_attempts WHERE key_hash IN ($1,$2)
      AND count>=5 AND window_started_at>clock_timestamp()-interval '15 minutes' LIMIT 1`,[emailKey,ipKey])).rows.length;
    if (blocked) return null;
    const reference=raw.length<=254 && typeof password==='string' && password.length<=256
      ? (await client.query(`SELECT a.credential_staff_id FROM staff_credentials c JOIN staff_accounts a ON a.credential_staff_id=c.staff_id WHERE c.email=$1`,[normalized])).rows[0] : null;
    const account=reference && await lockStaffAccount(client,reference.credential_staff_id);
    const row=account ? (await client.query(`SELECT s.id,s.org_id,s.site_id,s.name,s.role,s.active FROM staff_account_memberships m
      JOIN staff s ON s.id=m.staff_id WHERE m.account_id=$1 AND s.active=true
      AND NOT EXISTS(SELECT 1 FROM tenant_controls t WHERE t.org_id=s.org_id AND t.state='suspended')
      ORDER BY (s.id=$2) DESC,s.org_id,s.site_id,s.id LIMIT 1 FOR UPDATE OF s`,[account.account_id,account.credential_staff_id])).rows[0] : null;
    const credential=account ? (await client.query('SELECT password_salt,password_hash,email FROM staff_credentials WHERE staff_id=$1 FOR UPDATE',[account.credential_staff_id])).rows[0] : null;
    if(row && credential?.email===normalized) Object.assign(row,credential);
    else if(row) {row.active=false;}
    const matches = await passwordMatches(password,row);
    if (!row?.active || !matches) {
      for (const key of [emailKey,ipKey]) await client.query(`INSERT INTO auth_attempts(key_hash,count,window_started_at) VALUES ($1,1,clock_timestamp())
        ON CONFLICT(key_hash) DO UPDATE SET count=CASE WHEN auth_attempts.window_started_at<=clock_timestamp()-interval '15 minutes' THEN 1 ELSE auth_attempts.count+1 END,
        window_started_at=CASE WHEN auth_attempts.window_started_at<=clock_timestamp()-interval '15 minutes' THEN clock_timestamp() ELSE auth_attempts.window_started_at END`,[key]);
      return null;
    }
    await client.query('DELETE FROM auth_attempts WHERE key_hash=$1',[emailKey]);
    const principal = { id:row.id,org_id:row.org_id,site_id:row.site_id,name:row.name,role:row.role,principal_type:'staff',principal_id:row.id,account_id:account.account_id };
    const session = await insertSession(client,principal,'staff');
    await audit(client,principal,'staff.signed_in',row.id);
    return { principal,session };
  });
  if (!result) throw invalidCredentials();
  return result;
}

export async function requireSession(pool, req, { schema='public',cookieName='understood_session' } = {}) {
  const token = cookieToken(req,cookieName);
  if (!validToken(token)) throw new Error('Sign in required');
  return inSchema(pool,schema,async (client) => {
    const row = (await client.query(`SELECT se.token_hash,se.org_id,se.site_id,se.principal_type,se.principal_id,se.expires_at,se.grant_id,se.access_mode,se.credential_revision,
      COALESCE(s.name,w.name,w.code) AS name,s.role,w.language,w.language_selection_required,w.language_selected_at,w.language_selected_by,a.id AS account_id,cred.email
      FROM sessions se
      LEFT JOIN staff s ON se.principal_type='staff' AND s.id=se.principal_id AND s.org_id=se.org_id AND s.site_id=se.site_id
      LEFT JOIN workers w ON se.principal_type='worker' AND w.id=se.principal_id AND w.org_id=se.org_id AND w.site_id=se.site_id
      LEFT JOIN staff_account_memberships m ON m.staff_id=s.id LEFT JOIN staff_accounts a ON a.id=m.account_id
      LEFT JOIN staff_credentials cred ON cred.staff_id=a.credential_staff_id
      WHERE se.token_hash=$1 AND se.access_mode='credential' AND se.revoked_at IS NULL AND se.expires_at>clock_timestamp()
      AND ((se.principal_type='staff' AND s.active=true AND a.active=true AND EXISTS (SELECT 1 FROM staff_credentials c WHERE c.staff_id=a.credential_staff_id))
        OR (se.principal_type='worker' AND w.active=true AND (
          (se.grant_id IS NOT NULL AND EXISTS (SELECT 1 FROM worker_grants g WHERE g.id=se.grant_id
            AND g.worker_id=w.id AND g.org_id=se.org_id AND g.site_id=se.site_id AND g.redeemed_at IS NOT NULL
            AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp()))
          OR (se.grant_id IS NULL AND se.credential_revision IS NOT NULL AND EXISTS (SELECT 1 FROM worker_credentials c
            WHERE c.worker_id=w.id AND c.org_id=se.org_id AND c.site_id=se.site_id AND c.state='active'
            AND c.credential_revision=se.credential_revision)))))`,[tokenHash(token)])).rows[0];
    if (!row) throw new Error('Sign in required');
    await requireTenantActive(client,row.org_id);
    if(row.principal_type==='worker')await requireWorkerSiteAccess(client,row.org_id,row.site_id);
    return { ...row,id:row.principal_id,expires_at:row.expires_at.toISOString() };
  });
}

export async function revokeSession(pool, req, { schema='public',cookieName='understood_session' } = {}) {
  const token = cookieToken(req,cookieName);
  if (!validToken(token)) return;
  return inSchema(pool,schema,async (client) => {
    const sessionHash=tokenHash(token);
    // Subscriptions must be revoked while their session is still live: the scope guard rejects updates afterwards.
    const rows = (await client.query(`SELECT org_id,site_id,principal_type,principal_id FROM sessions
      WHERE token_hash=$1 AND revoked_at IS NULL FOR UPDATE`,[sessionHash])).rows;
    await revokeSessionPushSubscriptions(client,sessionHash);
    await client.query('UPDATE sessions SET revoked_at=clock_timestamp() WHERE token_hash=$1 AND revoked_at IS NULL',[sessionHash]);
    if (rows[0]) await audit(client,rows[0],'session.revoked',rows[0].principal_id);
  });
}

export async function issueWorkerGrant(pool, session, workerId, expiresInMinutes=240, { schema='public' } = {}) {
  grantReference(workerId);
  if (!Number.isInteger(expiresInMinutes) || expiresInMinutes<5 || expiresInMinutes>1440) throw new Error('Invalid grant expiry');
  return inSchema(pool,schema,async (client) => {
    await writableStaff(client,session);
    await requireWorkerSiteAccess(client,session.org_id,session.site_id);
    const worker = (await client.query(`SELECT id,org_id,site_id FROM workers WHERE id=$1 AND org_id=$2 AND site_id=$3 AND active=true FOR UPDATE`,
      [workerId,session.org_id,session.site_id])).rows[0];
    if (!worker) throw new Error('Worker unavailable');
    await client.query(`UPDATE worker_grants SET revoked_at=clock_timestamp() WHERE worker_id=$1 AND org_id=$2 AND site_id=$3 AND revoked_at IS NULL`,[worker.id,worker.org_id,worker.site_id]);
    await client.query(`UPDATE sessions SET revoked_at=clock_timestamp() WHERE principal_type='worker' AND principal_id=$1
      AND org_id=$2 AND site_id=$3 AND revoked_at IS NULL`,[worker.id,worker.org_id,worker.site_id]);
    const id = randomUUID(), token = randomBytes(32).toString('base64url');
    const row = (await client.query(`INSERT INTO worker_grants(id,org_id,site_id,worker_id,token_hash,expires_at)
      VALUES ($1,$2,$3,$4,$5,clock_timestamp()+$6*interval '1 minute') RETURNING expires_at`,[id,worker.org_id,worker.site_id,worker.id,tokenHash(token),expiresInMinutes])).rows[0];
    await audit(client,session,'grant.issued',id);
    return { id,token,expiresAt:row.expires_at.toISOString(),workerId:worker.id };
  });
}

export async function redeemWorkerGrant(pool, token, { schema='public' } = {}) {
  if (!validToken(token)) throw invalidCredentials();
  return inSchema(pool,schema,async (client) => {
    const reference = (await client.query('SELECT worker_id,org_id,site_id FROM worker_grants WHERE token_hash=$1',[tokenHash(token)])).rows[0];
    if (!reference) throw invalidCredentials();
    await requireTenantActive(client,reference.org_id);
    try{await requireWorkerSiteAccess(client,reference.org_id,reference.site_id);}catch(error){if(['Worker access paused','Site archived'].includes(error.message))throw invalidCredentials();throw error;}
    // All issue/redeem/revoke paths lock the worker before touching its grants.
    const worker = (await client.query(`SELECT id,org_id,site_id FROM workers WHERE id=$1 AND org_id=$2 AND site_id=$3 AND active=true FOR UPDATE`,
      [reference.worker_id,reference.org_id,reference.site_id])).rows[0];
    if (!worker) throw invalidCredentials();
    const grant = (await client.query(`SELECT id,floor(EXTRACT(EPOCH FROM expires_at-clock_timestamp()))::int AS seconds
      FROM worker_grants WHERE token_hash=$1 AND worker_id=$2 AND org_id=$3 AND site_id=$4 AND redeemed_at IS NULL
      AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR UPDATE`,[tokenHash(token),worker.id,worker.org_id,worker.site_id])).rows[0];
    if (!grant || grant.seconds<1) throw invalidCredentials();
    await client.query('UPDATE worker_grants SET redeemed_at=clock_timestamp() WHERE id=$1',[grant.id]);
    const session = await insertSession(client,worker,'worker',grant.id,Math.min(2*3600,grant.seconds));
    await audit(client,{ ...worker,principal_type:'worker',principal_id:worker.id },'grant.redeemed',grant.id);
    return { ...session,workerId:worker.id };
  });
}

export async function revokeWorkerGrant(pool, session, grantId, { schema='public' } = {}) {
  grantReference(grantId);
  return inSchema(pool,schema,async (client) => {
    await writableStaff(client,session);
    const reference = (await client.query('SELECT worker_id FROM worker_grants WHERE id=$1 AND org_id=$2 AND site_id=$3',[grantId,session.org_id,session.site_id])).rows[0];
    if (!reference) throw new Error('Grant unavailable');
    await client.query('SELECT id FROM workers WHERE id=$1 AND org_id=$2 AND site_id=$3 FOR UPDATE',[reference.worker_id,session.org_id,session.site_id]);
    const changed = (await client.query(`UPDATE worker_grants SET revoked_at=clock_timestamp()
      WHERE id=$1 AND org_id=$2 AND site_id=$3 AND revoked_at IS NULL RETURNING id`,[grantId,session.org_id,session.site_id])).rows.length;
    await client.query(`UPDATE sessions SET revoked_at=clock_timestamp() WHERE grant_id=$1 AND org_id=$2 AND site_id=$3 AND revoked_at IS NULL`,[grantId,session.org_id,session.site_id]);
    if (changed) await audit(client,session,'grant.revoked',grantId);
  });
}

export async function listWorkerGrants(pool,session,workerId,input={}, {schema='public'}={}) {
  const {page,pageSize}=grantFilters(workerId,input);
  return inSchema(pool,schema,async (client) => {
    await writableStaff(client,session);
    // Worker state, count and page are read from the same statement snapshot.
    const result=(await client.query(`WITH scoped AS (SELECT id,active FROM workers WHERE id=$1 AND org_id=$2 AND site_id=$3),
      grants AS (SELECT g.id,g.worker_id,g.created_at,g.expires_at,g.redeemed_at,g.revoked_at FROM worker_grants g
        JOIN scoped w ON w.id=g.worker_id WHERE g.org_id=$2 AND g.site_id=$3)
      SELECT w.active AS worker_active,clock_timestamp() AS as_of,(SELECT COUNT(*)::int FROM grants) AS total,
        (SELECT COALESCE(jsonb_agg(result ORDER BY result.created_at DESC,result.id DESC),'[]') FROM
          (SELECT * FROM grants ORDER BY created_at DESC,id DESC LIMIT $4 OFFSET $5) result) AS items FROM scoped w`,
    [workerId,session.org_id,session.site_id,pageSize,(page-1)*pageSize])).rows[0];
    if(!result) throw new Error('Worker unavailable');
    const asOf=result.as_of.toISOString();
    return {items:result.items.map((row) => grantMetadata(row,asOf)),total:result.total,page,pageSize,asOf,workerActive:result.worker_active};
  });
}
