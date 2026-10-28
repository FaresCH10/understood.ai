import { seed } from '../../server/seed.mjs';
import { createAppServer } from '../../server/index.mjs';
import { createSession, provisionStaffCredential } from '../../server/auth.mjs';
import { assignWorkerPassword } from '../../server/worker-credentials.mjs';

export const TEST_PASSWORD = 'Synthetic-test-password-123';

export function principalLoginBody(principal) {
  if (principal === 'maya') return { email: 'maya@example.test', password: TEST_PASSWORD };
  if (principal === 'harbor-owner') return { email: 'harbor@example.test', password: TEST_PASSWORD };
  const company = principal === 'harbor-worker' ? 'harbor' : 'cedar';
  const n = principal === 'harbor-worker' ? 14 : Number(String(principal).replace('worker-', ''));
  return { company, workerId: `Worker ${String(n).padStart(3, '0')}`, password: TEST_PASSWORD };
}

export function loginRoute(principal) {
  return principalLoginBody(principal).email ? '/auth/staff/login' : '/auth/worker/login';
}

export function seedCredentials(db) {
  seed(db);
  if (db.prepare("SELECT id FROM staff WHERE id='maya' AND active=1").get()) {
    provisionStaffCredential(db, 'maya', 'maya@example.test', TEST_PASSWORD);
  }
  if (db.prepare("SELECT id FROM staff WHERE id='harbor-owner' AND active=1").get()) {
    provisionStaffCredential(db, 'harbor-owner', 'harbor@example.test', TEST_PASSWORD);
  }
  const workers = db.prepare('SELECT id,code,org_id,site_id FROM workers WHERE active=1').all();
  for (const worker of workers) {
    const owner = db.prepare("SELECT id,org_id,site_id,role FROM staff WHERE org_id=? AND site_id=? AND role='owner' AND active=1").get(worker.org_id, worker.site_id);
    if (!owner) continue;
    assignWorkerPassword(db, { principal_type: 'staff', principal_id: owner.id, org_id: owner.org_id, site_id: owner.site_id, role: 'owner' }, worker.id, {
      expectedCode: worker.code, workerId: worker.code, password: TEST_PASSWORD, confirmed: true,
    });
  }
}

export function sqliteApp(db, extra = {}) {
  seedCredentials(db);
  return createAppServer(db, { tier: 'local', aiMode: 'synthetic', accessMode: 'credential', publicOrigin: 'http://127.0.0.1:3020', ...extra });
}

export function openPrincipalSession(db, row) {
  if (row.role) {
    if (!db.prepare('SELECT 1 FROM staff_credentials WHERE staff_id=?').get(row.id)) {
      provisionStaffCredential(db, row.id, `${row.id}@example.test`, TEST_PASSWORD);
    }
    return createSession(db, row, 'staff', 'credential');
  }
  let cred = db.prepare("SELECT credential_revision FROM worker_credentials WHERE worker_id=? AND state='active'").get(row.id);
  if (!cred) {
    const owner = db.prepare("SELECT id,org_id,site_id,role FROM staff WHERE org_id=? AND site_id=? AND role='owner' AND active=1").get(row.org_id, row.site_id);
    assignWorkerPassword(db, { principal_type: 'staff', principal_id: owner.id, org_id: owner.org_id, site_id: owner.site_id, role: 'owner' }, row.id, {
      expectedCode: row.code, workerId: row.code, password: TEST_PASSWORD, confirmed: true,
    });
    cred = db.prepare('SELECT credential_revision FROM worker_credentials WHERE worker_id=?').get(row.id);
  }
  return createSession(db, row, 'worker', 'credential', null, 8 * 3600, cred.credential_revision);
}

export async function loginPrincipal(url, principal, origin = 'http://127.0.0.1:3020') {
  const root = String(url).replace(/\/api\/?$/, '');
  const body = principalLoginBody(principal);
  const path = body.email ? '/api/auth/staff/login' : '/api/auth/worker/login';
  return fetch(`${root}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body) });
}
