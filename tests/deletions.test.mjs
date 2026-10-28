import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {openDatabase} from '../server/db.mjs';
import {seed} from '../server/seed.mjs';
import {requestWorkerDeletion} from '../server/deletions.mjs';
import {applicationCleanupEvidence} from '../server/deletion-scope.mjs';
import {requestWorkerDeletion as pgRequest} from '../server/postgres/deletions.mjs';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {issueWorkerGrant,createSession} from '../server/auth.mjs';
import {reenableWorker,ensurePeopleSchema} from '../server/people.mjs';
import {reenableWorker as pgReenable} from '../server/postgres/people.mjs';
import {ensureRecordingSchema} from '../server/recordings.mjs';
import {processOneAudioPurge} from '../server/retention.mjs';
import {processOneAudioPurge as pgPurge} from '../server/postgres/retention.mjs';
import {processOneRecording} from '../server/recording-worker.mjs';
import {processOneAssessment} from '../server/postgres/assessment-worker.mjs';
import {submitAnswer as pgSubmit} from '../server/postgres/domain.mjs';
import {requestExport,processOneExport,downloadExport,expireExports} from '../server/exports.mjs';
import {requestExport as pgExport,processOneExport as pgProcessExport,downloadExport as pgDownload,expireExports as pgExpire} from '../server/postgres/exports.mjs';
import {previewWorkerImport,getWorkerImport,confirmWorkerImport,expireWorkerImports} from '../server/worker-import.mjs';
import {previewWorkerImport as pgPreview,getWorkerImport as pgImport,confirmWorkerImport as pgConfirm,expireWorkerImports as pgImportExpiry} from '../server/postgres/worker-import.mjs';
import {openPrincipalSession} from './helpers/sqlite-app.mjs';


const owner={principal_type:'staff',principal_id:'maya',org_id:'cedar',site_id:'beirut',role:'owner'};
const input=()=>({requestId:randomUUID(),expectedCode:'Worker 030',reason:'worker_request',confirmed:true});

test('SQLite deletion during transcription fences transcript persistence, assessment and retries',async()=>{
  const db=openDatabase(':memory:');seed(db);ensureRecordingSchema(db);
  try{
    const audioId=randomUUID(),now=new Date().toISOString();
    db.prepare(`INSERT INTO recordings(id,org_id,site_id,assignment_id,submission_id,sha256,duration_seconds,bytes,status,created_at,received_at)
      VALUES(?,'cedar','beirut','assignment-30',?,'synthetic',1,100,'received',?,?)`).run(audioId,randomUUID(),now,now);
    let assessments=0;
    await processOneRecording(db,{async transcribe(){requestWorkerDeletion(db,owner,'worker-30',input());return {text:'Private synthetic transcript'};},
      async assess(){assessments++;throw new Error('Must not assess');}},{async read(){return Buffer.from('synthetic');}});
    const row=db.prepare('SELECT * FROM recordings WHERE id=?').get(audioId);
    assert.equal(row.status,'failed');assert.equal(row.transcript,null);assert.equal(row.lease_token,null);
    assert.equal(assessments,0);
    assert.equal(await processOneRecording(db,{async transcribe(){throw new Error('Must not retry');}}),false);
    assert.equal(db.prepare("SELECT count(*) AS count FROM attempts WHERE assignment_id='assignment-30'").get().count,0);
  }finally{db.close();}
});

test('PostgreSQL deletion during assessment cancels the lease without manufacturing a completed result',async()=>{
  const db=new PGlite(),client={async query(sql,values){return values?.length?db.query(sql,values):(await db.exec(sql)).at(-1)||{rows:[]};},release(){}};
  const pool={async connect(){return client;}};
  try{
    await runMigrations(pool);
    await db.exec(`INSERT INTO organizations VALUES('cedar','Synthetic');INSERT INTO sites VALUES('beirut','cedar','Synthetic','UTC');
      INSERT INTO staff(id,org_id,site_id,name,role) VALUES('maya','cedar','beirut','Synthetic','owner');
      INSERT INTO workers(id,org_id,site_id,code,language) VALUES('worker-30','cedar','beirut','Worker 030','en');
      INSERT INTO briefings(id,org_id,site_id,title,source,state) VALUES('briefing','cedar','beirut','Synthetic','Synthetic','ready');
      INSERT INTO publications(id,org_id,site_id,briefing_id,version,snapshot_json,state)
      VALUES('pub','cedar','beirut','briefing',1,'{"question":"Where?","rubric":{"askedFacts":["finished -> blue shelf"]}}','published');
      INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,language) VALUES('assignment','cedar','beirut','pub','worker-30','en');`);
    await pgSubmit(pool,{principal_type:'worker',principal_id:'worker-30',org_id:'cedar',site_id:'beirut'},'assignment',randomUUID(),'finished on blue');
    await processOneAssessment(pool,{async assess(){await pgRequest(pool,owner,'worker-30',input());
      return {outcome:'matched',reasons:['Synthetic'],evidence:[{factIndex:0,quote:'finished on blue'}]};}});
    const job=(await db.query('SELECT * FROM assessment_jobs')).rows[0],attempt=(await db.query('SELECT * FROM attempts')).rows[0];
    assert.equal(job.status,'blocked');assert.equal(job.lease_token,null);assert.equal(job.error,'Worker deletion pending');
    assert.equal(attempt.assessment_status,'pending');assert.equal(attempt.outcome,null);
    assert.equal(await processOneAssessment(pool,{async assess(){throw new Error('Must not retry');}}),false);
  }finally{await db.close();}
});

test('SQLite deletion acceptance is scoped, confirmed, audit-atomic, revokes access and cannot be reenabled',async()=>{
  const db=openDatabase(':memory:');seed(db);ensurePeopleSchema(db);
  try{
    ensureRecordingSchema(db);
    const audioId=randomUUID(),now=new Date().toISOString();
    db.prepare(`INSERT INTO recordings(id,org_id,site_id,assignment_id,submission_id,sha256,duration_seconds,bytes,status,created_at,received_at)
      VALUES(?,'cedar','beirut','assignment-30',?,'synthetic',1,100,'received',?,?)`).run(audioId,randomUUID(),now,now);
    issueWorkerGrant(db,owner,'worker-30');
    openPrincipalSession(db,db.prepare("SELECT * FROM workers WHERE id='worker-30'").get());
    const change=input();
    const oldReactivation={requestId:randomUUID(),expectedCode:'Worker 030',confirmed:true};
    reenableWorker(db,owner,'worker-30',oldReactivation);
    const importPreview=previewWorkerImport(db,owner,{requestId:randomUUID(),filename:'synthetic.csv',bytes:Buffer.from('worker_id,language\nWorker 030,en\n')});
    const unrelatedPreview=previewWorkerImport(db,owner,{requestId:randomUUID(),filename:'unrelated.csv',bytes:Buffer.from('worker_id,language\nNew Synthetic,en\n')});
    const foreignOwner={...owner,principal_id:'harbor-owner',org_id:'harbor',site_id:'harbor-yard'};
    const foreignPreview=previewWorkerImport(db,foreignOwner,{requestId:randomUUID(),filename:'foreign.csv',bytes:Buffer.from('worker_id,language\nWorker 030,en\n')});
    db.prepare('INSERT INTO sites VALUES(?,?,?,?)').run('other-site','cedar','Synthetic','UTC');
    db.prepare('INSERT INTO staff VALUES(?,?,?,?,?,?)').run('other-owner','cedar','other-site','Synthetic','owner',1);
    const otherOwner={...owner,principal_id:'other-owner',site_id:'other-site'};
    const otherPreview=previewWorkerImport(db,otherOwner,{requestId:randomUUID(),filename:'other.csv',bytes:Buffer.from('worker_id,language\nWorker 030,en\n')});
    const exported=requestExport(db,owner,{requestId:randomUUID(),publicationId:'shelf-v3'});
    processOneExport(db);
    assert.match(downloadExport(db,owner,exported.id).csv,/Worker 030/);
    assert.throws(()=>requestWorkerDeletion(db,owner,'worker-30',{...change,confirmed:false}),/Invalid/);
    assert.throws(()=>requestWorkerDeletion(db,{...owner,site_id:'foreign'},'worker-30',change),/Forbidden/);
    assert.throws(()=>requestWorkerDeletion(db,{...owner,token_hash:'revoked-or-forged'},'worker-30',change),/Sign in required/);
    assert.throws(()=>requestWorkerDeletion(db,owner,'worker-30',{...change,expectedCode:'Changed'}),/code changed/);
    db.exec("CREATE TRIGGER fail_deletion_audit BEFORE INSERT ON audit WHEN NEW.action='worker.deletion.requested' BEGIN SELECT RAISE(ABORT,'Injected audit failure'); END;");
    assert.throws(()=>requestWorkerDeletion(db,owner,'worker-30',change),/Injected/);
    assert.equal(db.prepare("SELECT active FROM workers WHERE id='worker-30'").get().active,1);
    assert.equal(db.prepare('SELECT count(*) AS count FROM worker_deletion_requests').get().count,0);
    db.exec('DROP TRIGGER fail_deletion_audit');
    assert.deepEqual(requestWorkerDeletion(db,owner,'worker-30',change),{id:change.requestId,status:'queued',duplicate:false,cleanupEvidence:applicationCleanupEvidence()});
    assert.equal(requestWorkerDeletion(db,owner,'worker-30',change).duplicate,true);
    assert.throws(()=>requestWorkerDeletion(db,owner,'worker-30',{...change,reason:'customer_policy'}),/conflict/);
    assert.throws(()=>requestWorkerDeletion(db,owner,'worker-30',input()),/pending/);
    assert.equal(db.prepare('SELECT count(*) AS count FROM worker_grants WHERE revoked_at IS NULL').get().count,0);
    assert.equal(db.prepare("SELECT count(*) AS count FROM sessions WHERE principal_type='worker' AND revoked_at IS NULL").get().count,0);
    assert.throws(()=>reenableWorker(db,owner,'worker-30',{requestId:randomUUID(),expectedCode:'Worker 030',confirmed:true}),/pending/);
    assert.throws(()=>reenableWorker(db,owner,'worker-30',oldReactivation),/pending/);
    assert.throws(()=>db.exec('DELETE FROM worker_deletion_requests'),/immutable/);
    assert.equal(db.prepare("SELECT count(*) AS count FROM audit WHERE action='worker.deletion.requested'").get().count,1);
    assert.throws(()=>downloadExport(db,owner,exported.id),/expired/);
    const expired=db.prepare('SELECT * FROM report_exports WHERE id=?').get(exported.id);
    assert.equal(expired.status,'expired');assert.equal(expired.snapshot_json,null);assert.equal(expired.csv,null);assert.equal(expired.checksum,null);
    assert.equal(expireExports(db),0);
    assert.equal(db.prepare("SELECT count(*) AS count FROM audit WHERE action='export.deletion_purged'").get().count,1);
    assert.equal(getWorkerImport(db,owner,importPreview.id).status,'expired');
    const importRow=db.prepare('SELECT * FROM worker_imports WHERE id=?').get(importPreview.id);
    assert.equal(importRow.rows_json,null);assert.equal(importRow.errors_json,null);
    assert.throws(()=>confirmWorkerImport(db,owner,importPreview.id),/expired/);
    assert.equal(getWorkerImport(db,owner,unrelatedPreview.id).status,'validated');
    assert.equal(getWorkerImport(db,foreignOwner,foreignPreview.id).status,'validated');
    assert.equal(getWorkerImport(db,otherOwner,otherPreview.id).status,'expired');
    assert.equal(expireWorkerImports(db),0);
    assert.equal(db.prepare("SELECT count(*) AS count FROM audit WHERE action='workers.import_deletion_purged'").get().count,2);
    let removed;
    assert.equal(await processOneAudioPurge(db,{async remove(row){removed=row.id;},async exists(){return false;}}),true);
    assert.equal(removed,audioId);
    assert.equal(db.prepare('SELECT status FROM recording_purges WHERE recording_id=?').get(audioId).status,'complete');
    assert.equal(db.prepare('SELECT error FROM recordings WHERE id=?').get(audioId).error,'Worker deletion pending');
  }finally{db.close();}
});

test('PostgreSQL deletion while an export renders purges its snapshot and fences late CSV completion',async()=>{
  const db=new PGlite(),client={async query(sql,values){return values?.length?db.query(sql,values):(await db.exec(sql)).at(-1)||{rows:[]};},release(){}};
  const pool={async connect(){return client;}};
  try{
    await runMigrations(pool);
    await db.exec(`INSERT INTO organizations VALUES('cedar','Synthetic');INSERT INTO sites VALUES('beirut','cedar','Synthetic','UTC');
      INSERT INTO staff(id,org_id,site_id,name,role) VALUES('maya','cedar','beirut','Synthetic','owner');
      INSERT INTO workers(id,org_id,site_id,code,language) VALUES('worker-30','cedar','beirut','Worker 030','en');
      INSERT INTO briefings(id,org_id,site_id,title,source,state) VALUES('briefing','cedar','beirut','Synthetic','Synthetic','ready');
      INSERT INTO publications(id,org_id,site_id,briefing_id,version,snapshot_json,state) VALUES('pub','cedar','beirut','briefing',1,'{}','published');
      INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,language) VALUES('assignment','cedar','beirut','pub','worker-30','en');`);
    const exported=await pgExport(pool,owner,{requestId:randomUUID(),publicationId:'pub'});
    await db.exec(`INSERT INTO publications(id,org_id,site_id,briefing_id,version,snapshot_json,state)
      VALUES('unrelated','cedar','beirut','briefing',2,'{}','published');`);
    const unaffected=await pgExport(pool,owner,{requestId:randomUUID(),publicationId:'unrelated'});
    await pgProcessExport(pool,{async render(){await pgRequest(pool,owner,'worker-30',input());return 'Old private synthetic CSV';}});
    const row=(await db.query('SELECT * FROM report_exports WHERE id=$1',[exported.id])).rows[0];
    assert.equal(row.status,'expired');assert.equal(row.snapshot_json,null);assert.equal(row.csv,null);assert.equal(row.lease_token,null);
    await assert.rejects(pgDownload(pool,owner,exported.id),/expired/);
    assert.equal(await pgProcessExport(pool),true);
    assert.equal(typeof (await pgDownload(pool,owner,unaffected.id)).csv,'string');
    assert.equal(await pgExpire(pool),0);
    assert.equal((await db.query("SELECT count(*)::int AS count FROM audit WHERE action='export.deletion_purged'")).rows[0].count,1);
  }finally{await db.close();}
});

test('PostgreSQL deletion acceptance preserves immutable minimal receipts and prevents reactivation',async()=>{
  const db=new PGlite();
  const client={async query(sql,values){return values?.length?db.query(sql,values):(await db.exec(sql)).at(-1)||{rows:[]};},release(){}};
  const pool={async connect(){return client;}};
  try{
    await runMigrations(pool);
    await db.exec(`INSERT INTO organizations VALUES('cedar','Synthetic');INSERT INTO sites VALUES('beirut','cedar','Synthetic','UTC');
      INSERT INTO staff(id,org_id,site_id,name,role) VALUES('maya','cedar','beirut','Synthetic','owner');
      INSERT INTO workers(id,org_id,site_id,code,language) VALUES('worker-30','cedar','beirut','Worker 030','en');`);
    const change=input();
    const oldReactivation={requestId:randomUUID(),expectedCode:'Worker 030',confirmed:true};
    await pgReenable(pool,owner,'worker-30',oldReactivation);
    const staged=await pgPreview(pool,owner,{requestId:randomUUID(),filename:'synthetic.csv',bytes:Buffer.from('worker_id,language\nWorker 030,en\n')});
    const unrelated=await pgPreview(pool,owner,{requestId:randomUUID(),filename:'unrelated.csv',bytes:Buffer.from('worker_id,language\nNew Synthetic,en\n')});
    await db.exec(`INSERT INTO organizations VALUES('harbor','Synthetic');INSERT INTO sites VALUES('harbor-yard','harbor','Synthetic','UTC');
      INSERT INTO sites VALUES('other-site','cedar','Synthetic','UTC');
      INSERT INTO staff(id,org_id,site_id,name,role) VALUES('harbor-owner','harbor','harbor-yard','Synthetic','owner'),('other-owner','cedar','other-site','Synthetic','owner');`);
    const foreignOwner={...owner,principal_id:'harbor-owner',org_id:'harbor',site_id:'harbor-yard'},otherOwner={...owner,principal_id:'other-owner',site_id:'other-site'};
    const foreign=await pgPreview(pool,foreignOwner,{requestId:randomUUID(),filename:'foreign.csv',bytes:Buffer.from('worker_id,language\nWorker 030,en\n')});
    const other=await pgPreview(pool,otherOwner,{requestId:randomUUID(),filename:'other.csv',bytes:Buffer.from('worker_id,language\nWorker 030,en\n')});
    await assert.rejects(pgRequest(pool,{...owner,role:'supervisor'},'worker-30',change),/Forbidden/);
    await assert.rejects(pgRequest(pool,owner,'worker-30',{...change,confirmed:false}),/Invalid/);
    assert.equal((await pgRequest(pool,owner,'worker-30',change)).status,'queued');
    assert.equal((await pgRequest(pool,owner,'worker-30',change)).duplicate,true);
    await assert.rejects(pgRequest(pool,owner,'worker-30',{...change,reason:'customer_policy'}),/conflict/);
    await assert.rejects(pgRequest(pool,owner,'worker-30',input()),/pending/);
    await assert.rejects(db.exec("UPDATE workers SET active=true WHERE id='worker-30'"),/pending/);
    await assert.rejects(pgReenable(pool,owner,'worker-30',oldReactivation),/pending/);
    await assert.rejects(db.exec('DELETE FROM worker_deletion_requests'),/immutable/);
    const receipt=(await db.query('SELECT * FROM worker_deletion_requests')).rows[0];
    assert.equal(receipt.fingerprint.length,64);assert.equal('expected_code' in receipt,false);
    assert.equal((await db.query("SELECT count(*)::int AS count FROM audit WHERE action='worker.deletion.requested'")).rows[0].count,1);
    assert.equal((await pgImport(pool,owner,staged.id)).status,'expired');
    const stagedRow=(await db.query('SELECT * FROM worker_imports WHERE id=$1',[staged.id])).rows[0];
    assert.equal(stagedRow.rows_json,null);assert.equal(stagedRow.errors_json,null);
    await assert.rejects(pgConfirm(pool,owner,staged.id),/expired/);
    assert.equal((await pgImport(pool,owner,unrelated.id)).status,'validated');
    assert.equal((await pgImport(pool,foreignOwner,foreign.id)).status,'validated');
    assert.equal((await pgImport(pool,otherOwner,other.id)).status,'expired');
    assert.equal(await pgImportExpiry(pool),0);
    assert.equal((await db.query("SELECT count(*)::int AS count FROM audit WHERE action='workers.import_deletion_purged'")).rows[0].count,2);
    await db.exec(`INSERT INTO briefings(id,org_id,site_id,title,source,state) VALUES('briefing','cedar','beirut','Synthetic','Synthetic','ready');
      INSERT INTO publications(id,org_id,site_id,briefing_id,version,snapshot_json,state) VALUES('pub','cedar','beirut','briefing',1,'{}','published');
      INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,language) VALUES('assignment','cedar','beirut','pub','worker-30','en');`);
    const audioId=randomUUID();
    await db.query(`INSERT INTO recordings(id,org_id,site_id,assignment_id,submission_id,sha256,duration_seconds,bytes,status,received_at)
      VALUES($1,'cedar','beirut','assignment',$2,$3,1,100,'received',clock_timestamp())`,[audioId,randomUUID(),'a'.repeat(64)]);
    let removed;
    assert.equal(await pgPurge(pool,{async remove(row){removed=row.id;},async exists(){return false;}}),true);
    assert.equal(removed,audioId);
    assert.equal((await db.query('SELECT status FROM recording_purges WHERE recording_id=$1',[audioId])).rows[0].status,'complete');
  }finally{await db.close();}
});
