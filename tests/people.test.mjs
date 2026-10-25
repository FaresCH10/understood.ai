import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import { openDatabase } from '../server/db.mjs';
import { createSession, requireSession } from '../server/auth.mjs';
import {
  ensurePeopleSchema, listWorkers, createWorker, updateWorker, disableWorker,reenableWorker,
  listCrews, createCrew, moveWorkerToCrew, renameCrew, archiveCrew,restoreCrew,
} from '../server/people.mjs';

const maya = { principal_type: 'staff', principal_id: 'maya', org_id: 'cedar', site_id: 'beirut', role: 'owner' };
const harbor = { principal_type: 'staff', principal_id: 'harbor-owner', org_id: 'harbor', site_id: 'harbor-yard', role: 'owner' };
const auditor = { ...maya, role: 'auditor' };

function fixture() {
  const db = openDatabase(':memory:');
  db.prepare('INSERT INTO organizations VALUES (?,?)').run('cedar', 'Cedar Works');
  db.prepare('INSERT INTO organizations VALUES (?,?)').run('harbor', 'Harbor Tools');
  db.prepare('INSERT INTO sites VALUES (?,?,?,?)').run('beirut', 'cedar', 'Beirut site', 'Asia/Beirut');
  db.prepare('INSERT INTO sites VALUES (?,?,?,?)').run('harbor-yard', 'harbor', 'Harbor yard', 'UTC');
  db.prepare('INSERT INTO staff VALUES (?,?,?,?,?,?)').run('maya', 'cedar', 'beirut', 'Maya Haddad', 'owner', 1);
  db.prepare('INSERT INTO staff VALUES (?,?,?,?,?,?)').run('harbor-owner', 'harbor', 'harbor-yard', 'Harbor Owner', 'owner', 1);
  const insertWorker = db.prepare('INSERT INTO workers (id,org_id,site_id,code,language,active) VALUES (?,?,?,?,?,?)');
  for (let n = 1; n <= 30; n++) insertWorker.run(
    `worker-${n}`, 'cedar', 'beirut', `Worker ${String(n).padStart(3, '0')}`, n <= 12 ? 'en' : n <= 22 ? 'ar' : 'ur', 1,
  );
  insertWorker.run('harbor-worker', 'harbor', 'harbor-yard', 'Worker 014', 'en', 1);
  const now = new Date().toISOString();
  db.prepare('INSERT INTO briefings VALUES (?,?,?,?,?,?,?,?,?,?,?)').run('shelf', 'cedar', 'beirut', 'Shelf colour handover', 'Put items on shelves.', 1, 4, 'draft', null, now, now);
  db.prepare('INSERT INTO publications VALUES (?,?,?,?,?,?,?,?)').run('shelf-v3', 'cedar', 'beirut', 'shelf', 3, JSON.stringify({languages:{ar:{title:'Shelf colour handover',text:'ضع الأشياء على الرفوف.',question:'أين ستضع الأشياء؟'}}}), now, 'published');
  db.prepare('INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,due_at,created_at,language) VALUES (?,?,?,?,?,?,?,?)').run('assignment-14', 'cedar', 'beirut', 'shelf-v3', 'worker-14', null, now, 'ar');
  db.prepare('INSERT INTO attempts VALUES (?,?,?,?,?,?,?,?)').run('attempt-14', 'cedar', 'assignment-14', 'seed-14', 'Blue shelf.', 'clarification', '["missing_asked_fact"]', now);
  ensurePeopleSchema(db);
  return db;
}

test('SQLite directory rechecks actual active scoped staff authority for reads and mutations',() => {
  const db=fixture();
  try {
    for(const session of [{...maya,principal_id:'missing'},{...maya,role:'supervisor'},{...maya,site_id:'harbor-yard'},{...maya,org_id:'harbor'}]) {
      assert.throws(() => listWorkers(db,session),/Forbidden/);assert.throws(() => createCrew(db,session,{name:'Unauthorized crew'}),/Forbidden/);
    }
    db.prepare("UPDATE staff SET active=0 WHERE id='maya'").run();
    assert.throws(() => listWorkers(db,maya),/Forbidden/);assert.throws(() => createWorker(db,maya,{code:'Worker 099',language:'en'}),/Forbidden/);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM audit').get().n,0);
  } finally {db.close();}
});

test('worker directory is paginated, filtered and scoped to the current site', () => {
  const db = fixture();
  try {
    const page = listWorkers(db, maya, { page: 2, pageSize: 5 });
    assert.equal(page.total, 30);
    assert.equal(page.items.length, 5);
    assert.equal(page.items[0].code, 'Worker 006');
    assert.deepEqual(listWorkers(db, maya, { search: 'Worker 014' }).items.map((w) => w.code), ['Worker 014']);
    assert.equal(listWorkers(db, maya, { language: 'ur' }).total, 8);
    assert.equal(listWorkers(db, harbor).total, 1);
    assert.throws(() => listWorkers(db, auditor), /Forbidden/);
    assert.throws(() => listWorkers(db, { ...maya, principal_type: 'worker' }), /Forbidden/);
    assert.throws(() => listWorkers(db, maya, { pageSize: 501 }), /Invalid/);
  } finally { db.close(); }
});

test('SQLite crews page beyond 500 with literal filters, complete counts and retained scoped membership',() => {
  const db=fixture();
  try {
    const insert=db.prepare('INSERT INTO crews VALUES (?,?,?,?,?)');
    for(let n=1;n<=602;n++) insert.run(`crew-${n}`,'cedar','beirut',`Crew ${String(n).padStart(3,'0')}`,n<=600 ? 1 : 0);
    insert.run('literal','cedar','beirut','Literal_under.score',1);
    insert.run('foreign','harbor','harbor-yard','Crew Foreign',1);
    moveWorkerToCrew(db,maya,'worker-14','crew-1');
    const created=createCrew(db,maya,{name:'Zulu New'});assert.equal(created.name,'Zulu New');assert.ok(created.id);
    const before=['assignments','attempts','audit','crew_memberships','crews'].map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all());
    const page=listCrews(db,maya,{page:7,pageSize:100});assert.equal(page.total,604);assert.equal(page.items.length,4);assert.equal(page.items[0].name,'Crew 601');
    assert.deepEqual(listCrews(db,maya,{search:'_',status:'active'}).items.map((row) => row.id),['literal']);
    assert.equal(listCrews(db,maya,{search:'%'}).total,0);
    assert.equal(listCrews(db,maya,{status:'active'}).total,602);assert.equal(listCrews(db,maya,{status:'inactive'}).total,2);
    assert.equal(listCrews(db,maya,{search:'Crew 001'}).items[0].member_count,1);
    assert.equal(listCrews(db,maya,{page:5000,pageSize:100}).total,604);assert.deepEqual(listCrews(db,maya,{page:5000}).items,[]);
    assert.equal(listCrews(db,harbor).total,1);assert.equal(listCrews(db,maya,{search:'Foreign'}).total,0);
    for(const filters of [{page:0},{page:5001},{page:null},{page:true},{pageSize:101},{pageSize:false},{search:null},{search:'x'.repeat(81)},{status:null},{status:'archived'},{org_id:'harbor'}]) assert.throws(() => listCrews(db,maya,filters),/Invalid/);
    for(const session of [auditor,{...maya,principal_type:'worker'},{...maya,principal_id:'missing'},{...maya,site_id:'harbor-yard'}]) assert.throws(() => listCrews(db,session),/Forbidden/);
    assert.deepEqual(['assignments','attempts','audit','crew_memberships','crews'].map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()),before);
    db.prepare("UPDATE staff SET active=0 WHERE id='maya'").run();assert.throws(() => listCrews(db,maya),/Forbidden/);
  } finally {db.close();}
});

test('SQLite worker crew filters combine scope, archived membership, status, search and language without changing evidence',() => {
  const db=fixture();
  try {
    const crew=createCrew(db,maya,{name:'Retained crew'}),foreign=createCrew(db,harbor,{name:'Foreign crew'});
    moveWorkerToCrew(db,maya,'worker-14',crew.id);moveWorkerToCrew(db,maya,'worker-15',crew.id);
    disableWorker(db,maya,'worker-15');archiveCrew(db,maya,crew.id,{expectedName:crew.name,confirmed:true});
    const before=['assignments','attempts','audit','crew_memberships','workers','crews'].map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all());
    assert.equal(listWorkers(db,maya,{crewId:crew.id}).total,1);
    assert.equal(listWorkers(db,maya,{crewId:crew.id,status:'all',page:2,pageSize:1}).items[0].id,'worker-15');
    assert.equal(listWorkers(db,maya,{crewId:crew.id,status:'inactive'}).total,1);
    assert.equal(listWorkers(db,maya,{crewId:crew.id,language:'ur'}).total,0);
    assert.equal(listWorkers(db,maya,{crewId:crew.id,language:'ar',search:'014'}).total,1);
    assert.equal(listWorkers(db,maya,{crewId:'none'}).total,28);
    assert.equal(listWorkers(db,maya,{crewId:'all',status:'all'}).total,30);
    for(const id of [foreign.id,'missing']) assert.throws(() => listWorkers(db,maya,{crewId:id}),/Crew unavailable/);
    for(const id of ['',null,true,{},'x'.repeat(101)]) assert.throws(() => listWorkers(db,maya,{crewId:id}),/Invalid crew/);
    assert.deepEqual(['assignments','attempts','audit','crew_memberships','workers','crews'].map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()),before);
  } finally {db.close();}
});

test('worker creation and editing validate input and deny cross-tenant and cross-site writes', () => {
  const db = fixture();
  try {
    assert.throws(() => createWorker(db, maya, { code: 'Worker 031', language: 'en', org_id: 'harbor' }), /Invalid/);
    assert.throws(() => createWorker(db, maya, { code: 'Worker 031', language: 'xx' }), /Invalid/);
    assert.throws(() => createWorker(db, auditor, { code: 'Worker 031', language: 'en' }), /Forbidden/);
    const worker = createWorker(db, maya, { code: 'Worker 031', language: 'ur' });
    assert.equal(worker.org_id, 'cedar');
    assert.equal(worker.site_id, 'beirut');
    assert.equal(worker.language, 'ur');
    assert.throws(() => createWorker(db, maya, { code: 'Worker 031', language: 'ur' }), /Worker ID already in use/);
    assert.throws(() => updateWorker(db, harbor, worker.id, { language: 'ar' }), /Worker unavailable/);
    assert.throws(() => updateWorker(db, maya, worker.id, { site_id: 'harbor-yard' }), /Invalid/);
    db.prepare('INSERT INTO sites VALUES (?,?,?,?)').run('tripoli', 'cedar', 'Tripoli', 'Asia/Beirut');
    assert.throws(() => updateWorker(db,{...maya,site_id:'tripoli'},worker.id,{language:'ar'}),/Forbidden/);
    db.prepare('INSERT INTO staff VALUES (?,?,?,?,?,?)').run('tripoli-owner','cedar','tripoli','Tripoli Owner','owner',1);
    const tripoli = { ...maya, principal_id:'tripoli-owner',site_id: 'tripoli' };
    assert.throws(() => updateWorker(db, tripoli, worker.id, { language: 'ar' }), /Worker unavailable/);
    assert.equal(updateWorker(db, maya, worker.id, { language: 'ar' }).language, 'ar');
  } finally { db.close(); }
});

test('crews are site scoped and moving a worker preserves historical assignments', () => {
  const db = fixture();
  try {
    const morning = createCrew(db, maya, { name: 'Beirut Morning' });
    const evening = createCrew(db, maya, { name: 'Beirut Evening' });
    db.prepare('INSERT INTO sites VALUES (?,?,?,?)').run('tripoli', 'cedar', 'Tripoli', 'Asia/Beirut');
    db.prepare('INSERT INTO staff VALUES (?,?,?,?,?,?)').run('tripoli-owner','cedar','tripoli','Tripoli Owner','owner',1);
    const tripoliCrew = createCrew(db, { ...maya, principal_id:'tripoli-owner',site_id: 'tripoli' }, { name: 'Tripoli Morning' });
    assert.throws(() => createCrew(db, maya, { name: 'Beirut Morning' }), /UNIQUE constraint/);
    assert.throws(() => moveWorkerToCrew(db, harbor, 'worker-14', morning.id), /Worker unavailable/);
    assert.throws(() => moveWorkerToCrew(db, maya, 'worker-14', tripoliCrew.id), /Crew unavailable/);
    assert.throws(() => db.prepare('INSERT INTO crew_memberships VALUES (?,?,?,?,?)').run('worker-15', 'cedar', 'beirut', tripoliCrew.id, new Date().toISOString()), /Scope mismatch/);
    assert.throws(() => moveWorkerToCrew(db, maya, 'worker-14', 'missing'), /Crew unavailable/);
    assert.equal(moveWorkerToCrew(db, maya, 'worker-14', morning.id).crew_id, morning.id);
    assert.equal(moveWorkerToCrew(db, maya, 'worker-14', evening.id).crew_id, evening.id);
    assert.equal(listCrews(db, maya).items.find((c) => c.id === evening.id).member_count, 1);
    assert.equal(listCrews(db, harbor).total, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM assignments WHERE worker_id=?').get('worker-14').n, 1);
    assert.equal(moveWorkerToCrew(db, maya, 'worker-14', null).crew_id, null);
  } finally { db.close(); }
});

test('disabling a worker preserves history and revokes grants and sessions atomically', () => {
  const db = fixture();
  try {
    const worker = db.prepare('SELECT * FROM workers WHERE id=?').get('worker-14');
    const session = createSession(db, worker, 'worker', 'demo');
    db.prepare('INSERT INTO worker_grants VALUES (?,?,?,?,?,?,?,?,?)').run(
      'grant-14', 'cedar', 'beirut', worker.id, 'tokenhash', '2099-01-01T00:00:00.000Z', null, null, new Date().toISOString(),
    );
    assert.throws(() => disableWorker(db, harbor, worker.id), /Worker unavailable/);
    assert.throws(() => disableWorker(db, auditor, worker.id), /Forbidden/);
    const result = disableWorker(db, maya, worker.id);
    assert.equal(result.active, false);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM attempts WHERE assignment_id=?').get('assignment-14').n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM assignments WHERE worker_id=?').get(worker.id).n, 1);
    assert.ok(db.prepare('SELECT revoked_at FROM worker_grants WHERE id=?').get('grant-14').revoked_at);
    assert.ok(db.prepare('SELECT revoked_at FROM sessions WHERE principal_id=?').get(worker.id).revoked_at);
    assert.throws(() => requireSession(db, { headers: { cookie: `understood_session=${session.token}` } }, { accessMode: 'demo' }), /Sign in required/);
    assert.equal(listWorkers(db, maya, { status: 'inactive' }).total, 1);
  } finally { db.close(); }
});

test('SQLite reactivation is scoped, confirmed, audit-atomic and durably replayed without restoring old worker access',() => {
  const db=fixture();
  try {
    const crew=createCrew(db,maya,{name:'Retained crew'});moveWorkerToCrew(db,maya,'worker-14',crew.id);
    const worker=db.prepare("SELECT * FROM workers WHERE id='worker-14'").get();
    const session=createSession(db,worker,'worker','demo');
    db.prepare('INSERT INTO worker_grants VALUES(?,?,?,?,?,?,?,?,?)').run('old-grant','cedar','beirut',worker.id,'old-hash','2099-01-01T00:00:00.000Z',null,null,new Date().toISOString());
    disableWorker(db,maya,worker.id);archiveCrew(db,maya,crew.id,{expectedName:crew.name,confirmed:true});
    const tables=['publications','assignments','attempts','crew_memberships','sessions','worker_grants'];
    const evidence=() => tables.map((table) => JSON.stringify(db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()));
    const before=evidence(),restore={requestId:randomUUID(),expectedName:crew.name,confirmed:true},enable={requestId:randomUUID(),expectedCode:worker.code,confirmed:true};
    for(const bad of [{...restore,confirmed:false},{...restore,confirmed:'true'},{...restore,requestId:'bad'},{...restore,expectedName:null},{...restore,site_id:'harbor-yard'}]) assert.throws(() => restoreCrew(db,maya,crew.id,bad),/Invalid/);
    for(const bad of [{...enable,confirmed:false},{...enable,requestId:null},{...enable,expectedCode:null},{...enable,active:true}]) assert.throws(() => reenableWorker(db,maya,worker.id,bad),/Invalid/);
    assert.throws(() => restoreCrew(db,harbor,crew.id,restore),/unavailable/);
    assert.throws(() => reenableWorker(db,harbor,worker.id,enable),/unavailable/);
    for(const badSession of [auditor,{...maya,principal_id:'missing'},{...maya,principal_type:'worker'},{...maya,role:'supervisor'}]) {
      assert.throws(() => restoreCrew(db,badSession,crew.id,restore),/Forbidden/);
      assert.throws(() => reenableWorker(db,badSession,worker.id,enable),/Forbidden/);
    }
    assert.throws(() => restoreCrew(db,maya,crew.id,{...restore,expectedName:'Old name'}),/name changed/);
    assert.throws(() => reenableWorker(db,maya,worker.id,{...enable,expectedCode:'Old code'}),/code changed/);
    db.exec("CREATE TRIGGER react_audit_failure BEFORE INSERT ON audit WHEN NEW.action IN ('worker.reenabled','crew.restored') BEGIN SELECT RAISE(ABORT,'Injected failure'); END;");
    assert.throws(() => restoreCrew(db,maya,crew.id,restore),/Injected/);
    assert.throws(() => reenableWorker(db,maya,worker.id,enable),/Injected/);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM directory_reactivations').get().n,0);
    assert.equal(listCrews(db,maya,{status:'inactive'}).total,1);assert.equal(listWorkers(db,maya,{status:'inactive'}).total,1);
    db.exec('DROP TRIGGER react_audit_failure');
    db.exec("CREATE TRIGGER react_receipt_failure BEFORE INSERT ON directory_reactivations BEGIN SELECT RAISE(ABORT,'Injected receipt failure'); END;");
    assert.throws(() => restoreCrew(db,maya,crew.id,restore),/Injected/);assert.throws(() => reenableWorker(db,maya,worker.id,enable),/Injected/);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit WHERE action IN ('crew.restored','worker.reenabled')").get().n,0);
    db.exec('DROP TRIGGER react_receipt_failure');
    assert.equal(restoreCrew(db,maya,crew.id,restore).active,true);
    assert.equal(reenableWorker(db,maya,worker.id,enable).active,true);
    assert.equal(restoreCrew(db,maya,crew.id,restore).duplicate,true);assert.equal(reenableWorker(db,maya,worker.id,enable).duplicate,true);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit WHERE action IN ('crew.restored','worker.reenabled')").get().n,2);
    assert.deepEqual(evidence(),before);
    assert.throws(() => requireSession(db,{headers:{cookie:`understood_session=${session.token}`}},{accessMode:'demo'}),/Sign in required/);
    assert.throws(() => restoreCrew(db,maya,crew.id,{...restore,expectedName:'Other name'}),/request conflict/);
    assert.throws(() => reenableWorker(db,maya,worker.id,{...enable,requestId:restore.requestId}),/request conflict/);
    assert.throws(() => db.exec("UPDATE directory_reactivations SET expected_label='Other'"),/immutable/);
    assert.throws(() => db.exec('DELETE FROM directory_reactivations'),/immutable/);
    disableWorker(db,maya,worker.id);archiveCrew(db,maya,crew.id,{expectedName:crew.name,confirmed:true});
    assert.equal(reenableWorker(db,maya,worker.id,enable).active,false);assert.equal(restoreCrew(db,maya,crew.id,restore).active,false);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit WHERE action IN ('crew.restored','worker.reenabled')").get().n,2);
    db.prepare("UPDATE staff SET active=0 WHERE id='maya'").run();
    assert.throws(() => restoreCrew(db,maya,crew.id,restore),/Forbidden/);assert.throws(() => reenableWorker(db,maya,worker.id,enable),/Forbidden/);
  } finally {db.close();}
});

test('SQLite crew rename and confirmed archive preserve evidence, access and membership with replay and rollback', () => {
  const db=fixture();
  try {
    const crew=createCrew(db,maya,{name:'Morning 014'}),other=createCrew(db,maya,{name:'Evening'});
    moveWorkerToCrew(db,maya,'worker-14',crew.id);
    const worker=db.prepare("SELECT * FROM workers WHERE id='worker-14'").get();
    const session=createSession(db,worker,'worker','demo');
    const preserved=() => ['workers','crew_memberships','assignments','attempts','sessions','worker_grants','publications']
      .map((table) => JSON.stringify(db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()));
    const before=preserved(),rename={name:'فريق الصباح 014',expectedName:crew.name};
    assert.throws(() => renameCrew(db,harbor,crew.id,rename),/unavailable/);
    assert.throws(() => renameCrew(db,auditor,crew.id,rename),/Forbidden/);
    assert.throws(() => archiveCrew(db,{...maya,principal_id:'missing'},crew.id,{expectedName:crew.name,confirmed:true}),/Forbidden/);
    for(const input of [{...rename,site_id:'harbor-yard'},{...rename,name:null},{...rename,expectedName:null}]) assert.throws(() => renameCrew(db,maya,crew.id,input),/Invalid/);
    assert.throws(() => renameCrew(db,maya,'x'.repeat(101),rename),/Invalid/);
    assert.throws(() => renameCrew(db,maya,crew.id,{...rename,expectedName:'Old name'}),/name changed/);
    assert.throws(() => renameCrew(db,maya,crew.id,{...rename,name:other.name}),/UNIQUE/);
    db.exec("CREATE TRIGGER crew_audit_failure BEFORE INSERT ON audit WHEN NEW.action IN ('crew.renamed','crew.archived') BEGIN SELECT RAISE(ABORT,'Injected failure'); END;");
    assert.throws(() => renameCrew(db,maya,crew.id,rename),/Injected/);
    assert.equal(listCrews(db,maya).items.find((row) => row.id===crew.id).name,crew.name);
    db.exec('DROP TRIGGER crew_audit_failure');
    assert.equal(renameCrew(db,maya,crew.id,rename).name,rename.name);
    assert.equal(renameCrew(db,maya,crew.id,rename).member_count,1);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit WHERE action='crew.renamed'").get().n,1);
    assert.equal(listWorkers(db,maya,{search:worker.code}).items[0].crew_name,rename.name);
    const archive={expectedName:rename.name,confirmed:true};
    for(const input of [{expectedName:rename.name},{...archive,confirmed:false},{...archive,confirmed:'true'},{...archive,name:rename.name}]) assert.throws(() => archiveCrew(db,maya,crew.id,input),/Invalid/);
    assert.throws(() => archiveCrew(db,maya,crew.id,{...archive,expectedName:crew.name}),/name changed/);
    db.exec("CREATE TRIGGER crew_audit_failure BEFORE INSERT ON audit WHEN NEW.action='crew.archived' BEGIN SELECT RAISE(ABORT,'Injected failure'); END;");
    assert.throws(() => archiveCrew(db,maya,crew.id,archive),/Injected/);
    assert.equal(listCrews(db,maya).items.find((row) => row.id===crew.id).active,true);
    db.exec('DROP TRIGGER crew_audit_failure');
    assert.equal(archiveCrew(db,maya,crew.id,archive).active,false);
    assert.equal(archiveCrew(db,maya,crew.id,archive).member_count,1);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit WHERE action='crew.archived'").get().n,1);
    assert.throws(() => renameCrew(db,maya,crew.id,{name:'New name',expectedName:rename.name}),/archived/);
    assert.throws(() => moveWorkerToCrew(db,maya,'worker-15',crew.id),/unavailable/);
    assert.deepEqual(preserved(),before);
    assert.equal(requireSession(db,{headers:{cookie:`understood_session=${session.token}`}},{accessMode:'demo'}).principal_id,worker.id);
    assert.equal(moveWorkerToCrew(db,maya,worker.id,other.id).crew_id,other.id);
  } finally {db.close();}
});
