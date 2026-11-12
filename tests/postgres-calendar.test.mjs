import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { runMigrations } from '../server/postgres/migrate.mjs';
import { listCalendar } from '../server/postgres/calendar.mjs';
import { timeZoneCivilDate } from '../server/calendar.mjs';

const schema = 'understood_test_calendar';
const owner = { principal_type: 'staff', principal_id: 'owner', org_id: 'a', site_id: 'a', role: 'owner' };

function embeddedPool(db) {
  const client = {
    async query(sql, values) {
      if (values?.length) return db.query(sql, values);
      const results = await db.exec(sql);
      return results.at(-1) ?? { rows: [] };
    },
    release() {},
  };
  return { async connect() { return client; } };
}

async function fixture() {
  const db = new PGlite();
  const pool = embeddedPool(db);
  await db.exec(`CREATE SCHEMA ${schema}; SET search_path TO ${schema},pg_catalog`);
  await runMigrations(pool, { schema });
  await db.query("INSERT INTO organizations(id,name) VALUES ('a','A'),('b','B')");
  await db.query("INSERT INTO sites(id,org_id,name,timezone) VALUES ('a','a','A','Asia/Beirut'),('b','b','B','UTC')");
  await db.query(`INSERT INTO staff(id,org_id,site_id,name,role) VALUES
    ('owner','a','a','Owner','owner'),('supervisor','a','a','Supervisor','supervisor'),
    ('auditor','a','a','Auditor','auditor'),('admin','a','a','Admin','administrator'),('other','b','b','Other','owner')`);
  await db.query("INSERT INTO workers(id,org_id,site_id,code,language) VALUES ('w1','a','a','001','en'),('w2','a','a','002','ur'),('w3','a','a','003','ar')");
  await db.query("INSERT INTO briefings(id,org_id,site_id,title,source,state) VALUES ('brief','a','a','Shelf handover','Source','ready')");
  await db.query(`INSERT INTO publications(id,org_id,site_id,briefing_id,version,snapshot_json,state,published_at)
    VALUES ('pub','a','a','brief',1,'{"title":"Shelf handover"}','published','2026-10-02T05:15:00.000Z')`);
  await db.query(`INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,language)
    VALUES ('a1','a','a','pub','w1','en'),('a2','a','a','pub','w2','ur'),('a3','a','a','pub','w3','ar')`);
  await db.query(`INSERT INTO submission_receipts(org_id,assignment_id,submission_id,kind,received_at)
    VALUES ('a','a1','s1','typed','2026-10-02T06:10:00.000Z')`);
  await db.query(`INSERT INTO attempts(id,org_id,site_id,assignment_id,submission_id,answer_text,outcome,reasons_json,received_at)
    VALUES ('t1','a','a','a1','s1','Finished blue','matched','["asked_facts_present"]','2026-10-02T06:10:00.000Z')`);
  await db.query(`INSERT INTO clarifications(id,org_id,site_id,assignment_id,reason,status,created_at)
    VALUES ('c1','a','a','a2','uncertain_placement','open','2026-10-03T07:00:00.000Z')`);
  await db.query(`INSERT INTO acknowledgments(request_id,org_id,site_id,assignment_id,worker_id,received_at)
    VALUES ('ak1','a','a','a1','w1','2026-10-04T08:00:00.000Z'),('ak2','a','a','a3','w3','2026-10-04T09:00:00.000Z')`);
  await db.query(`INSERT INTO assignment_completions(assignment_id,org_id,site_id,worker_id,completed_at)
    VALUES ('a1','a','a','w1','2026-10-05T09:00:00.000Z')`);
  return { db, pool };
}

test('postgres calendar returns site-scoped instructions and activity', async () => {
  const { db, pool } = await fixture();
  try {
    const payload = await listCalendar(pool, owner, { month: '2026-10' }, { schema });
    assert.deepEqual(Object.keys(payload), ['month', 'timezone', 'today', 'asOf', 'instructions', 'events']);
    assert.equal(payload.month, '2026-10');
    assert.equal(payload.timezone, 'Asia/Beirut');
    assert.equal(payload.today, timeZoneCivilDate(new Date(), 'Asia/Beirut'));
    assert.equal(payload.instructions.length, 1);
    const [publication] = payload.instructions;
    assert.equal(publication.kind, 'publication');
    assert.equal(publication.briefingId, 'brief');
    assert.equal(publication.title, 'Shelf handover');
    assert.equal(publication.date, '2026-10-02');
    assert.equal(publication.metrics.assigned, 3);
    assert.equal(publication.metrics.responses, 2);
    assert.equal(publication.metrics.matches, 1);
    assert.equal(publication.metrics.acknowledged, 1);
    assert.equal(publication.metrics.clarifications, 0);
    assert.equal(publication.metrics.pending, 1);
    assert.equal(publication.metrics.completion, 67);
    assert.equal(publication.openClarifications, 1);
    assert.deepEqual(payload.events.map((event) => event.kind).sort(), ['acknowledgment', 'acknowledgment', 'clarification', 'completion', 'response']);
    assert.ok(payload.events.every((event) => event.briefingId === 'brief' && event.date.startsWith('2026-10-')));
    assert.equal(payload.events.find((event) => event.kind === 'clarification').reason, 'uncertain_placement');
  } finally {
    await db.close();
  }
});

test('postgres calendar enforces staff role, tenant, site and input boundaries', async () => {
  const { db, pool } = await fixture();
  try {
    for (const role of ['supervisor', 'auditor'])
      assert.equal((await listCalendar(pool, { ...owner, principal_id: role, role }, { month: '2026-10' }, { schema })).instructions.length, 1);
    for (const session of [
      { ...owner, role: 'administrator' },
      { ...owner, principal_type: 'worker' },
      { ...owner, principal_id: 'other' },
      { ...owner, site_id: 'b' },
      { ...owner, principal_id: 'missing' },
    ]) await assert.rejects(listCalendar(pool, session, { month: '2026-10' }, { schema }), /Forbidden/);
    const otherTenant = await listCalendar(pool, { ...owner, org_id: 'b', site_id: 'b', principal_id: 'other' }, { month: '2026-10' }, { schema });
    assert.equal(otherTenant.instructions.length, 0);
    assert.equal(otherTenant.events.length, 0);
    for (const input of [null, [], { month: '2026-13' }, { month: '2026-10', page: '2' }])
      await assert.rejects(listCalendar(pool, owner, input, { schema }), /Invalid calendar/);
    assert.equal((await listCalendar(pool, owner, { month: '2026-09' }, { schema })).instructions.length, 0);
  } finally {
    await db.close();
  }
});

test('postgres calendar includes queued schedules on their publish date', async () => {
  const { db, pool } = await fixture();
  try {
    await db.query(`INSERT INTO publication_schedules(id,org_id,site_id,briefing_id,request_json,snapshot_hash,recipients_json,requested_by,authority_json,publish_at,created_at,state)
      VALUES ('schedule','a','a','brief','{"nextVersion":5,"workerIds":["w1","w2"]}',$1,'["w1","w2"]','owner','{}','2026-11-04T07:00:00.000Z','2026-10-30T12:00:00.000Z','queued')`, ['a'.repeat(64)]);
    const november = await listCalendar(pool, owner, { month: '2026-11' }, { schema });
    assert.equal(november.instructions.length, 1);
    assert.equal(november.instructions[0].id, 'schedule:schedule');
    assert.equal(november.instructions[0].kind, 'scheduled');
    assert.equal(november.instructions[0].date, '2026-11-04');
    assert.equal(november.instructions[0].version, 5);
    assert.equal(november.instructions[0].audience, 2);
    assert.equal(november.events.length, 0);
    assert.equal((await listCalendar(pool, owner, { month: '2026-10' }, { schema })).instructions.length, 1);
  } finally {
    await db.close();
  }
});
