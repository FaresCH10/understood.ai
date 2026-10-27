import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {PGlite} from '@electric-sql/pglite';
import {openDatabase} from '../server/db.mjs';
import {ensurePeopleSchema,validateWorkerInput} from '../server/people.mjs';
import {runMigrations,verifyMigrations} from '../server/postgres/migrate.mjs';
import {
  WORKER_LOCALES,WORKER_LANGUAGE_CODES,RTL_LANGUAGE_CODES,isWorkerLanguage,languageDirection,
  LANGUAGE_CAPABILITIES,UI_LANGUAGE_CODES,CONTENT_LANGUAGE_CODES,SPEECH_LANGUAGE_CODES,
} from '../server/languages.mjs';
import {generationLanguages} from '../server/settings-input.mjs';

const expected=['en','ar','hi','ur','bn','ml','ta','te','ne','fil','si','ru','pa-Guru','pa-Arab','id'];

test('worker locale registry covers fourteen languages with explicit Punjabi scripts and honest capabilities',()=>{
  assert.deepEqual(WORKER_LANGUAGE_CODES,expected);
  assert.equal(new Set(WORKER_LOCALES.map(locale=>locale.base)).size,14);
  assert.equal(WORKER_LOCALES.find(locale=>locale.code==='pa-Guru').direction,'ltr');
  assert.equal(WORKER_LOCALES.find(locale=>locale.code==='pa-Arab').direction,'rtl');
  assert.deepEqual(RTL_LANGUAGE_CODES,['ar','ur','pa-Arab']);
  assert.equal(isWorkerLanguage('pa'),false);
  assert.equal(isWorkerLanguage('pa-Arab'),true);
  assert.equal(languageDirection('hi'),'ltr');
  assert.equal(WORKER_LOCALES.every(locale=>locale.name.trim() && locale.englishName.trim()),true);
  assert.deepEqual(UI_LANGUAGE_CODES,expected);
  assert.deepEqual(CONTENT_LANGUAGE_CODES,['en','ar','ur']);
  assert.deepEqual(SPEECH_LANGUAGE_CODES,['en','ar']);
  assert.equal(LANGUAGE_CAPABILITIES.ur.speech,false);
  assert.equal(LANGUAGE_CAPABILITIES.hi.ui,true);
  assert.equal(LANGUAGE_CAPABILITIES.hi.translation,false);
  assert.deepEqual(generationLanguages(['en','ar','ur']),['en','ar','ur']);
  assert.deepEqual(generationLanguages(['en','hi']),['en','hi']);
  assert.throws(()=>generationLanguages(['en','pa']),/Invalid generation languages/);
  for(const code of WORKER_LANGUAGE_CODES)assert.deepEqual(validateWorkerInput({code:`Worker ${code}`,language:code}),{code:`Worker ${code}`,language:code});
  assert.throws(()=>validateWorkerInput({code:'Worker',language:'pa'}),/Invalid language/);
});

test('SQLite upgrades old worker language checks without losing identity, requests, triggers or foreign keys',async()=>{
  const root=mkdtempSync(join(tmpdir(),'understood-language-upgrade-')),path=join(root,'understood.sqlite');
  try {
    const old=new DatabaseSync(path);
    old.exec(`PRAGMA foreign_keys=ON;
      CREATE TABLE organizations(id TEXT PRIMARY KEY,name TEXT NOT NULL) STRICT;
      CREATE TABLE sites(id TEXT PRIMARY KEY,org_id TEXT NOT NULL REFERENCES organizations(id),name TEXT NOT NULL,timezone TEXT NOT NULL) STRICT;
      CREATE TABLE staff(id TEXT PRIMARY KEY,org_id TEXT NOT NULL REFERENCES organizations(id),site_id TEXT NOT NULL REFERENCES sites(id),name TEXT NOT NULL,role TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1) STRICT;
      CREATE TABLE publications(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,site_id TEXT NOT NULL,briefing_id TEXT NOT NULL,version INTEGER NOT NULL,snapshot_json TEXT NOT NULL,published_at TEXT NOT NULL,state TEXT NOT NULL) STRICT;
      CREATE TABLE workers(id TEXT PRIMARY KEY,org_id TEXT NOT NULL REFERENCES organizations(id),site_id TEXT NOT NULL REFERENCES sites(id),
        code TEXT NOT NULL,language TEXT NOT NULL CHECK(language IN ('en','ar','ur')),active INTEGER NOT NULL DEFAULT 1,name TEXT,
        language_selection_required INTEGER NOT NULL DEFAULT 0 CHECK(language_selection_required IN (0,1)),
        language_selected_at TEXT,language_selected_by TEXT CHECK(language_selected_by IN ('worker','staff','migration')),
        language_selection_request_id TEXT,UNIQUE(org_id,code)) STRICT;
      CREATE TABLE assignments(id TEXT PRIMARY KEY,org_id TEXT NOT NULL REFERENCES organizations(id),site_id TEXT NOT NULL REFERENCES sites(id),
        publication_id TEXT NOT NULL REFERENCES publications(id),worker_id TEXT NOT NULL REFERENCES workers(id),due_at TEXT,created_at TEXT NOT NULL,
        language TEXT NOT NULL DEFAULT 'en' CHECK(language IN ('en','ar','ur')),UNIQUE(publication_id,worker_id)) STRICT;
      CREATE TABLE worker_language_requests(id TEXT PRIMARY KEY,org_id TEXT NOT NULL REFERENCES organizations(id),
        site_id TEXT NOT NULL REFERENCES sites(id),worker_id TEXT NOT NULL REFERENCES workers(id),
        current_language TEXT NOT NULL CHECK(current_language IN ('en','ar','ur')),
        requested_language TEXT NOT NULL CHECK(requested_language IN ('en','ar','ur')),
        reason TEXT NOT NULL DEFAULT '' CHECK(length(reason)<=500),
        state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approved','rejected')),
        requested_at TEXT NOT NULL,decided_at TEXT,decided_by TEXT REFERENCES staff(id),
        decision_note TEXT CHECK(decision_note IS NULL OR length(decision_note)<=500),
        CHECK(requested_language<>current_language),
        CHECK((state='pending' AND decided_at IS NULL AND decided_by IS NULL AND decision_note IS NULL)
          OR (state<>'pending' AND decided_at IS NOT NULL AND decided_by IS NOT NULL))) STRICT;
      INSERT INTO organizations VALUES('org','Organization');
      INSERT INTO sites VALUES('site','org','Site','UTC');
      INSERT INTO workers VALUES('worker','org','site','Worker 001','ar',1,'Rana',1,NULL,NULL,NULL);
      INSERT INTO worker_language_requests VALUES('request','org','site','worker','ar','ur','','pending','2026-10-23T00:00:00.000Z',NULL,NULL,NULL);`);
    old.close();
    const db=openDatabase(path);
    try {
      assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM workers').get().n,1);
      assert.equal(db.prepare("SELECT name FROM workers WHERE id='worker'").get().name,'Rana');
      assert.equal(db.prepare("SELECT requested_language FROM worker_language_requests WHERE id='request'").get().requested_language,'ur');
      for(const name of ['workers','assignments']){
        assert.match(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(name).sql,/pa-Arab/,name);
      }
      assert.doesNotMatch(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='worker_language_requests'").get().sql,/pa-Arab/);
      ensurePeopleSchema(db);
      assert.match(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='worker_language_requests'").get().sql,/pa-Arab/);
      for(const trigger of ['worker_language_selection_receipt_frozen','worker_language_selection_reopen_frozen','worker_language_request_immutable','assignment_language_frozen']){
        assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name=?").get(trigger),trigger);
      }
      assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_assignments_worker'").get());
      db.prepare("INSERT INTO workers(id,org_id,site_id,code,language) VALUES('new','org','site','Worker 002','pa-Arab')").run();
      db.prepare("INSERT INTO worker_language_requests VALUES('request-2','org','site','new','pa-Arab','pa-Guru','','pending','2026-10-23T00:00:01.000Z',NULL,NULL,NULL)").run();
      assert.throws(()=>db.prepare("INSERT INTO workers(id,org_id,site_id,code,language) VALUES('bad','org','site','Worker 003','pa')").run(),/CHECK/);
      assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
    } finally {db.close();}
    const reopened=openDatabase(path);
    try {
      assert.equal(reopened.prepare('SELECT COUNT(*) n FROM workers').get().n,2);
      assert.equal(reopened.prepare("SELECT language FROM workers WHERE id='new'").get().language,'pa-Arab');
      assert.equal(reopened.prepare('PRAGMA foreign_key_check').all().length,0);
    } finally {reopened.close();}
  } finally {rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

test('SQLite adds missing identity columns before rebuilding a legacy worker table',()=>{
  const root=mkdtempSync(join(tmpdir(),'understood-language-legacy-')),path=join(root,'understood.sqlite');
  try {
    const old=new DatabaseSync(path);
    old.exec(`PRAGMA foreign_keys=ON;
      CREATE TABLE organizations(id TEXT PRIMARY KEY,name TEXT NOT NULL) STRICT;
      CREATE TABLE sites(id TEXT PRIMARY KEY,org_id TEXT NOT NULL REFERENCES organizations(id),name TEXT NOT NULL,timezone TEXT NOT NULL) STRICT;
      CREATE TABLE publications(id TEXT PRIMARY KEY,org_id TEXT NOT NULL REFERENCES organizations(id),site_id TEXT NOT NULL REFERENCES sites(id),
        briefing_id TEXT NOT NULL,snapshot_json TEXT NOT NULL,published_at TEXT NOT NULL,state TEXT NOT NULL) STRICT;
      CREATE TABLE workers(id TEXT PRIMARY KEY,org_id TEXT NOT NULL REFERENCES organizations(id),site_id TEXT NOT NULL REFERENCES sites(id),
        code TEXT NOT NULL,language TEXT NOT NULL CHECK(language IN ('en','ar','ur')),active INTEGER NOT NULL DEFAULT 1,UNIQUE(org_id,code)) STRICT;
      CREATE TABLE assignments(id TEXT PRIMARY KEY,org_id TEXT NOT NULL REFERENCES organizations(id),site_id TEXT NOT NULL REFERENCES sites(id),
        publication_id TEXT NOT NULL REFERENCES publications(id),worker_id TEXT NOT NULL REFERENCES workers(id),due_at TEXT,created_at TEXT NOT NULL,
        UNIQUE(publication_id,worker_id)) STRICT;
      INSERT INTO organizations VALUES('org','Organization');
      INSERT INTO sites VALUES('site','org','Site','UTC');
      INSERT INTO publications VALUES('publication','org','site','briefing','{"languages":{"en":{"title":"Title","text":"Body"}}}','2026-10-23T00:00:00.000Z','published');
      INSERT INTO workers VALUES('worker','org','site','Worker 001','ar',1);
      INSERT INTO assignments VALUES('assignment','org','site','publication','worker',NULL,'2026-10-23T00:00:00.000Z');`);
    old.close();
    const db=openDatabase(path);
    try {
      for(const column of ['name','language_selection_required','language_selected_at','language_selected_by','language_selection_request_id']){
        assert.ok(db.prepare('PRAGMA table_info(workers)').all().some(row=>row.name===column),column);
      }
      assert.equal(db.prepare("SELECT language FROM workers WHERE id='worker'").get().language,'ar');
      assert.equal(db.prepare("SELECT name FROM workers WHERE id='worker'").get().name,null);
      assert.equal(db.prepare("SELECT language FROM assignments WHERE id='assignment'").get().language,'en');
      assert.match(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='workers'").get().sql,/pa-Arab/);
      assert.match(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='assignments'").get().sql,/pa-Arab/);
      db.prepare("INSERT INTO workers(id,org_id,site_id,code,language) VALUES('new','org','site','Worker 002','pa-Guru')").run();
      assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
    } finally {db.close();}
  } finally {rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

test('PostgreSQL stores every worker locale and rejects the ambiguous bare Punjabi tag',async()=>{
  const schema='understood_test_language_registry',db=new PGlite();
  const client={async query(sql,values){return values?.length?db.query(sql,values):(await db.exec(sql)).at(-1)||{rows:[]};},release(){}};
  const pool={async connect(){return client;}};
  try {
    await db.exec(`CREATE SCHEMA ${schema};SET search_path TO ${schema},pg_catalog`);
    await runMigrations(pool,{schema});
    assert.deepEqual(await verifyMigrations(pool,{schema}),{schema,migrations:113});
    await db.query("INSERT INTO organizations(id,name) VALUES('org','Organization')");
    await db.query("INSERT INTO sites(id,org_id,name,timezone) VALUES('site','org','Site','UTC')");
    for(const [index,code] of WORKER_LANGUAGE_CODES.entries()){
      await db.query('INSERT INTO workers(id,org_id,site_id,code,language) VALUES($1,$2,$3,$4,$5)',[`w${index}`,'org','site',`Worker ${index}`,code]);
    }
    await db.query("INSERT INTO worker_language_requests(id,org_id,site_id,worker_id,current_language,requested_language,requested_at) VALUES('r1','org','site','w0','en','pa-Guru',clock_timestamp())");
    await db.query("INSERT INTO worker_language_requests(id,org_id,site_id,worker_id,current_language,requested_language,requested_at) VALUES('r2','org','site','w1','ar','pa-Arab',clock_timestamp())");
    await assert.rejects(db.query("INSERT INTO workers(id,org_id,site_id,code,language) VALUES('bad','org','site','Bad','pa')"),/check/i);
    assert.deepEqual((await db.query('SELECT language FROM workers')).rows.map(row=>row.language).sort(),[...expected].sort());
  } finally {await db.close();}
});
