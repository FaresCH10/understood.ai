import { openDatabase } from './db.mjs';
import { tokenHash } from './auth-crypto.mjs';
import { createAppHandler } from './index.mjs';

const PRINCIPALS = ['maya', 'worker-14', 'worker-29', 'worker-30', 'harbor-owner', 'harbor-worker'];
const DEMO_SESSION_SECONDS = 7 * 24 * 3600;
const demoToken = principal => `demo.${principal}.synthetic`;
const demoHosts = () => new Set(['VERCEL_URL', 'VERCEL_BRANCH_URL', 'VERCEL_PROJECT_PRODUCTION_URL']
  .map(key => process.env[key]).filter(Boolean)
  .concat((process.env.UNDERSTOOD_DEMO_HOSTS ?? '').split(',').map(host => host.trim()).filter(Boolean)));

// A Vercel deployment uses credential sign-in. Set UNDERSTOOD_ACCESS_MODE=demo to keep the profile picker.
// ponytail: this database is memory inside one function instance. Saved accounts need the hosted PostgreSQL runtime.
export function vercelAccessMode(env = process.env, explicit) {
  if (explicit === 'demo' || explicit === 'credential') return explicit;
  if (env.UNDERSTOOD_ACCESS_MODE === 'demo' || env.UNDERSTOOD_ACCESS_MODE === 'credential') return env.UNDERSTOOD_ACCESS_MODE;
  return env.VERCEL === '1' ? 'credential' : 'demo';
}

export function createVercelDemoHandler({ localDemo = process.env.VERCEL !== '1', audioRoot = '/tmp/understood-private-audio', accessMode } = {}) {
  const mode = vercelAccessMode(process.env, accessMode);
  const db = openDatabase(':memory:');
  const hosts = demoHosts();
  const config = Object.freeze({
    tier: 'local',
    aiMode: 'synthetic',
    accessMode: mode,
    publicOrigin: localDemo ? 'http://localhost' : `https://${[...hosts][0] ?? 'invalid.local'}`,
    remoteDemo: true,
    localDemo,
    demoHosts: hosts,
    ...(mode === 'demo' ? { demoSessionToken: demoToken } : {}),
    cookieOptions: { name: 'understood_session', secure: !localDemo },
  });
  const handler = createAppHandler(db, { config, audioRoot, mail: { available: false } });
  if (mode !== 'demo') return { handler, db, config, sessionSeconds: DEMO_SESSION_SECONDS };
  const expiresAt = new Date(Date.now() + DEMO_SESSION_SECONDS * 1000).toISOString();
  const insert = db.prepare(`INSERT INTO sessions(token_hash,org_id,site_id,principal_type,principal_id,expires_at,revoked_at,grant_id,access_mode)
    VALUES(?,?,?,?,?,?,NULL,NULL,'demo')
    ON CONFLICT(token_hash) DO UPDATE SET expires_at=excluded.expires_at,revoked_at=NULL`);
  for (const principal of PRINCIPALS) {
    const row = db.prepare('SELECT id,org_id,site_id FROM staff WHERE id=?').get(principal)
      ?? db.prepare('SELECT id,org_id,site_id FROM workers WHERE id=?').get(principal);
    if (!row) throw new Error('Synthetic demo profile unavailable');
    const type = principal.startsWith('worker') || principal === 'harbor-worker' ? 'worker' : 'staff';
    insert.run(tokenHash(demoToken(principal)), row.org_id, row.site_id, type, row.id, expiresAt);
  }
  return { handler, db, config, sessionSeconds: DEMO_SESSION_SECONDS };
}
