import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {openDatabase} from '../server/db.mjs';
import {seed} from '../server/seed.mjs';
import {submitAnswer} from '../server/domain.mjs';
import {requestWorkerDeletion} from '../server/deletions.mjs';
import {requestWorkerDeletion as pgRequest} from '../server/postgres/deletions.mjs';
import {ensureDeletionRedactionSchema,processOneDeletionRedaction} from '../server/deletion-redactions.mjs';
import {processOneDeletionRedaction as pgRedact} from '../server/postgres/deletion-redactions.mjs';
import {ensureRecordingSchema} from '../server/recordings.mjs';
import {ensureRetentionSchema} from '../server/retention.mjs';
import {requestExport,expireExports} from '../server/exports.mjs';
import {runMigrations} from '../server/postgres/migrate.mjs';

const owner={principal_type:'staff',principal_id:'maya',org_id:'cedar',site_id:'beirut',role:'owner'};
const worker={principal_type:'worker',principal_id:'worker-30',org_id:'cedar',site_id:'beirut'};
const request=()=>({requestId:randomUUID(),expectedCode:'Worker 030',reason:'worker_request',confirmed:true});

test('SQLite deletion removes legacy reactivation labels atomically without rewriting receipt metadata',()=>{
  const db=openDatabase(':memory:');seed(db);ensureDeletionRedactionSchema(db);
  try{
    const id=randomUUID(),now=new Date().toISOString();
    db.prepare('INSERT INTO directory_reactivations VALUES(?,?,?,?,?,?,?,?)').run(id,'cedar','beirut','worker-30',null,'Worker 030','maya',now);
    db.exec("INSERT INTO crews VALUES('crew-fixture','cedar','beirut','Synthetic crew',1)");
    db.prepare('INSERT INTO directory_reactivations VALUES(?,?,?,?,?,?,?,?)').run('crew-receipt','cedar','beirut',null,'crew-fixture','Synthetic crew','maya',now);
    db.prepare('INSERT INTO directory_reactivations VALUES(?,?,?,?,?,?,?,?)').run('other-receipt','cedar','beirut','worker-29',null,'Worker 029','maya',now);
    const before=db.prepare('SELECT * FROM directory_reactivations WHERE request_id=?').get(id);
    assert.throws(()=>db.prepare("UPDATE directory_reactivations SET expected_label='[Deleted]' WHERE request_id=?").run(id),/immutable/);
    requestWorkerDeletion(db,owner,'worker-30',request());
    assert.throws(()=>db.prepare('INSERT INTO directory_reactivations VALUES(?,?,?,?,?,?,?,?)')
      .run(randomUUID(),'cedar','beirut','worker-30',null,'Worker 030','maya',now),/pending/);
    db.exec("CREATE TRIGGER fail_label_audit BEFORE INSERT ON audit WHEN NEW.action='worker.reactivation_labels.redacted' BEGIN SELECT RAISE(ABORT,'Injected audit failure'); END;");
    assert.throws(()=>processOneDeletionRedaction(db),/Injected/);
    assert.deepEqual(db.prepare('SELECT * FROM directory_reactivations WHERE request_id=?').get(id),before);
    db.exec('DROP TRIGGER fail_label_audit');
    assert.equal(processOneDeletionRedaction(db),true);
    assert.deepEqual({...db.prepare('SELECT * FROM directory_reactivations WHERE request_id=?').get(id)},{...before,expected_label:'[Deleted]'});
    for(const other of ['crew-receipt','other-receipt'])assert.throws(()=>db.prepare("UPDATE directory_reactivations SET expected_label='[Deleted]' WHERE request_id=?").run(other),/immutable/);
    assert.throws(()=>db.prepare("UPDATE directory_reactivations SET expected_label='Worker 030' WHERE request_id=?").run(id),/immutable/);
    assert.throws(()=>db.prepare("UPDATE directory_reactivations SET occurred_at='changed' WHERE request_id=?").run(id),/immutable/);
    assert.throws(()=>db.prepare('DELETE FROM directory_reactivations WHERE request_id=?').run(id),/immutable/);
    processOneDeletionRedaction(db);assert.equal(processOneDeletionRedaction(db),false);
    assert.equal(db.prepare("SELECT count(*) AS count FROM audit WHERE action='worker.reactivation_labels.redacted'").get().count,1);
  }finally{db.close();}
});

test('SQLite redaction waits for snapshots, rolls back on audit failure and preserves immutable receipt metadata',()=>{
  const db=openDatabase(':memory:');seed(db);ensureDeletionRedactionSchema(db);
  try{
    submitAnswer(db,worker,'assignment-30',randomUUID(),'Finished on blue; unfinished on yellow.');
    const before=db.prepare("SELECT * FROM attempts WHERE assignment_id='assignment-30'").get();
    const caseId=randomUUID(),now=new Date().toISOString();
    db.prepare(`INSERT INTO instruction_sends(request_id,org_id,site_id,briefing_id,publication_request_id,audience_json,
      response_mode,delivery_mode,state,publication_id,audience_count,delivered,undelivered,undelivered_json,error,request_json,
      requested_by,created_at,updated_at) VALUES('send-30','cedar','beirut','shelf','send-publication',
      '{"type":"all","workers":[{"id":"worker-30","language":"ur"}]}','question','text','published','shelf-v3',1,1,0,'[]',NULL,
      '{"title":"Private send title","source":"Private send source","responseMode":"question","deliveryMode":"text"}','maya',?,?)`).run(now,now);
    db.prepare(`INSERT INTO instruction_deliveries(request_id,org_id,site_id,worker_id,language,state,reason,attempts,
      assignment_id,content_json,content_hash,updated_at) VALUES('send-30','cedar','beirut','worker-30','ur','available',NULL,0,
      'assignment-30','{"title":"Private late title","text":"Private late text"}',?,?)`).run('f'.repeat(64),now);
    db.prepare('INSERT INTO clarifications VALUES(?,?,?,?,?,?,?,?,?)').run(caseId,'cedar','assignment-30',null,'Private reason',null,'resolved','Private supervisor note',now);
    db.prepare('INSERT INTO help_requests VALUES(?,?,?,?,?,?)').run(caseId,'cedar','beirut','assignment-30','Private original help',now);
    assert.throws(()=>db.prepare("UPDATE help_requests SET text='[Deleted]' WHERE case_id=?").run(caseId),/immutable/);
    ensureRecordingSchema(db);ensureRetentionSchema(db);
    const artifact=db.prepare(`INSERT INTO presentation_artifacts(id,org_id,site_id,worker_id,assignment_id,publication_id,
      publication_version,source_kind,source_id,original_language,target_language,source_hash,status,title,text,question,provider,live,created_at,updated_at,ready_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    artifact.run('artifact-ready','cedar','beirut','worker-30','assignment-30','shelf-v3',3,'instruction','','ur','en','b'.repeat(64),
      'ready','Private translated title','Private translated text','Private translated question','synthetic-test',0,now,now,now);
    artifact.run('artifact-pending','cedar','beirut','worker-30','assignment-30','shelf-v3',3,'instruction','','ur','ar','c'.repeat(64),
      'pending',null,null,null,null,null,now,now,null);
    db.prepare('INSERT INTO answer_presentation_bindings VALUES(?,?,?,?,?,?,?,?)').run(before.id,'cedar','beirut','assignment-30',
      'artifact-ready','en','Private translated question',now);
    db.prepare(`INSERT INTO recordings(id,org_id,site_id,assignment_id,submission_id,sha256,duration_seconds,bytes,status,transcript,error,created_at,received_at,presentation_id,presentation_language,presented_question)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('recording-provenance','cedar','beirut','assignment-30','audio-submission',
      'd'.repeat(64),1,100,'received',null,null,now,now,'artifact-ready','en','Private translated question');
    db.prepare(`INSERT INTO recordings(id,org_id,site_id,assignment_id,submission_id,sha256,duration_seconds,bytes,status,created_at,received_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run('recording-null','cedar','beirut','assignment-30','audio-null','e'.repeat(64),1,100,'received',now,now);
    const purge=db.prepare('INSERT INTO recording_purges(recording_id,org_id,site_id,status,created_at,completed_at) VALUES(?,?,?,?,?,?)');
    purge.run('recording-provenance','cedar','beirut','complete',now,now);
    purge.run('recording-null','cedar','beirut','complete',now,now);
    assert.throws(()=>db.prepare("UPDATE recordings SET presented_question='Injected' WHERE id='recording-null'").run(),/immutable/);
    assert.throws(()=>db.prepare("UPDATE recordings SET presentation_id='artifact-ready',presentation_language='en' WHERE id='recording-null'").run(),/immutable/);
    requestExport(db,owner,{requestId:randomUUID(),publicationId:'shelf-v3'});
    requestWorkerDeletion(db,owner,'worker-30',request());
    assert.equal(processOneDeletionRedaction(db),false);
    expireExports(db);
    db.exec("CREATE TRIGGER fail_redaction_audit BEFORE INSERT ON audit WHEN NEW.action='worker.content.redacted' BEGIN SELECT RAISE(ABORT,'Injected audit failure'); END;");
    assert.throws(()=>processOneDeletionRedaction(db),/Injected/);
    assert.deepEqual(db.prepare('SELECT * FROM attempts WHERE id=?').get(before.id),before);
    assert.equal(db.prepare('SELECT count(*) AS count FROM worker_deletion_redactions').get().count,0);
    db.exec('DROP TRIGGER fail_redaction_audit');
    assert.equal(processOneDeletionRedaction(db),true);
    const after=db.prepare('SELECT * FROM attempts WHERE id=?').get(before.id);
    assert.equal(after.answer_text,'[Deleted]');assert.deepEqual(JSON.parse(after.reasons_json),{reasons:[],evidence:[]});
    for(const key of ['id','org_id','assignment_id','submission_id','received_at','outcome'])assert.equal(after[key],before[key]);
    const help=db.prepare('SELECT * FROM help_requests WHERE case_id=?').get(caseId),clarification=db.prepare('SELECT * FROM clarifications WHERE id=?').get(caseId);
    assert.equal(help.text,'[Deleted]');assert.equal(help.created_at,now);
    assert.equal(clarification.reason,'[Deleted]');assert.equal(clarification.notes,'');assert.equal(clarification.status,'resolved');
    assert.deepEqual({...db.prepare("SELECT status,title,text,question,provider,source_hash FROM presentation_artifacts WHERE id='artifact-ready'").get()},
      {status:'ready',title:'[Deleted]',text:'[Deleted]',question:'[Deleted]',provider:'synthetic-test',source_hash:'b'.repeat(64)});
    const pendingArtifact=db.prepare("SELECT status,title,text,question,provider,error_code FROM presentation_artifacts WHERE id='artifact-pending'").get();
    assert.deepEqual({...pendingArtifact},{status:'failed',title:null,text:null,question:null,provider:null,error_code:'Worker deletion pending'});
    assert.equal(db.prepare('SELECT presented_question FROM answer_presentation_bindings WHERE attempt_id=?').get(before.id).presented_question,'[Deleted]');
    const instructionDelivery=db.prepare("SELECT state,content_json,content_hash,assignment_id FROM instruction_deliveries WHERE request_id='send-30'").get();
    assert.equal(instructionDelivery.state,'available');assert.equal(instructionDelivery.content_hash,'f'.repeat(64));
    assert.equal(instructionDelivery.assignment_id,'assignment-30');assert.deepEqual(JSON.parse(instructionDelivery.content_json),{title:'[Deleted]',text:'[Deleted]'});
    assert.throws(()=>db.prepare("UPDATE instruction_deliveries SET content_json='{\"title\":\"Private restored\",\"text\":\"Private restored\"}'").run(),/immutable/);
    assert.throws(()=>db.prepare('UPDATE instruction_deliveries SET content_json=NULL').run(),/immutable/);
    assert.deepEqual({...db.prepare("SELECT presented_question,sha256 FROM recordings WHERE id='recording-provenance'").get()},
      {presented_question:'[Deleted]',sha256:'d'.repeat(64)});
    assert.throws(()=>db.prepare("UPDATE attempts SET answer_text='Restored private text' WHERE id=?").run(before.id),/immutable/);
    assert.throws(()=>db.prepare("UPDATE help_requests SET text='Restored private text' WHERE case_id=?").run(caseId),/immutable/);
    assert.throws(()=>db.prepare("UPDATE clarifications SET notes='Restored private note' WHERE id=?").run(caseId),/immutable/);
    assert.throws(()=>db.prepare("UPDATE presentation_artifacts SET text='Restored' WHERE id='artifact-ready'").run(),/immutable/);
    assert.throws(()=>db.prepare("UPDATE answer_presentation_bindings SET presented_question='Restored' WHERE attempt_id=?").run(before.id),/immutable/);
    assert.throws(()=>db.prepare("UPDATE recordings SET presented_question='Restored' WHERE id='recording-provenance'").run(),/immutable/);
    assert.throws(()=>db.exec('DELETE FROM worker_deletion_redactions'),/immutable/);
    assert.equal(processOneDeletionRedaction(db),false);
    assert.equal(db.prepare("SELECT count(*) AS count FROM audit WHERE action='worker.content.redacted'").get().count,1);
  }finally{db.close();}
});

test('PostgreSQL redaction permits only scoped content removal and cannot revise historical outcomes',async()=>{
  const db=new PGlite(),client={async query(sql,values){return values?.length?db.query(sql,values):(await db.exec(sql)).at(-1)||{rows:[]};},release(){}};
  const pool={async connect(){return client;}};
  try{
    await runMigrations(pool);
    await db.exec(`INSERT INTO organizations VALUES('cedar','Synthetic');INSERT INTO sites VALUES('beirut','cedar','Synthetic','UTC');
      INSERT INTO staff(id,org_id,site_id,name,role) VALUES('maya','cedar','beirut','Synthetic','owner');
      INSERT INTO workers(id,org_id,site_id,code,language) VALUES('worker-30','cedar','beirut','Worker 030','en');
      INSERT INTO briefings(id,org_id,site_id,title,source,state) VALUES('briefing','cedar','beirut','Synthetic','Synthetic','ready');
      INSERT INTO publications(id,org_id,site_id,briefing_id,version,snapshot_json,state) VALUES('pub','cedar','beirut','briefing',1,'{}','published');
      INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,language) VALUES('assignment','cedar','beirut','pub','worker-30','en');
      INSERT INTO instruction_sends(request_id,org_id,site_id,briefing_id,publication_request_id,audience_json,
        response_mode,delivery_mode,state,publication_id,audience_count,delivered,undelivered,undelivered_json,request_json,
        requested_by,created_at,updated_at) VALUES('send-30','cedar','beirut','briefing','send-publication',
        '{"type":"all","workers":[{"id":"worker-30","language":"en"}]}','question','text','published','pub',1,1,0,'[]',
        '{"title":"Private send title","source":"Private send source","responseMode":"question","deliveryMode":"text"}',
        'maya',clock_timestamp(),clock_timestamp());
      INSERT INTO instruction_deliveries(request_id,org_id,site_id,worker_id,language,state,reason,attempts,
        assignment_id,content_json,content_hash,updated_at) VALUES('send-30','cedar','beirut','worker-30','en','available',NULL,0,
        'assignment','{"title":"Private late title","text":"Private late text"}','${'f'.repeat(64)}',clock_timestamp());
      INSERT INTO attempts(id,org_id,site_id,assignment_id,submission_id,answer_text,outcome,reasons_json,evidence_json)
        VALUES('attempt','cedar','beirut','assignment','submission','Private answer','matched','["Private reason"]','[{"quote":"Private answer"}]');
      INSERT INTO clarifications(id,org_id,site_id,assignment_id,attempt_id,reason,status,notes)
        VALUES('case','cedar','beirut','assignment','attempt','Private reason','resolved','Private supervisor note');
      INSERT INTO help_requests(case_id,org_id,site_id,assignment_id,text) VALUES('case','cedar','beirut','assignment','Private original help');
      INSERT INTO presentation_artifacts(id,org_id,site_id,worker_id,assignment_id,publication_id,publication_version,
        source_kind,source_id,original_language,target_language,source_hash,status,title,text,question,provider,live,created_at,updated_at,ready_at)
      VALUES('instruction-ready','cedar','beirut','worker-30','assignment','pub',1,'instruction','','en','ar','${'b'.repeat(64)}','ready',
          'Private translated title','Private translated text','Private translated question','synthetic-test',false,clock_timestamp(),clock_timestamp(),clock_timestamp()),
        ('instruction-pending','cedar','beirut','worker-30','assignment','pub',1,'instruction','','en','ur','${'c'.repeat(64)}','pending',
          NULL,NULL,NULL,NULL,NULL,clock_timestamp(),clock_timestamp(),NULL);
      INSERT INTO answer_presentation_bindings(attempt_id,org_id,site_id,assignment_id,presentation_id,presentation_language,presented_question,created_at)
        VALUES('attempt','cedar','beirut','assignment','instruction-ready','ar','Private translated question',clock_timestamp());
      INSERT INTO recordings(id,org_id,site_id,assignment_id,submission_id,sha256,duration_seconds,bytes,status,created_at,received_at,
        presentation_id,presentation_language,presented_question)
        VALUES('recording-provenance','cedar','beirut','assignment','audio-submission','${'d'.repeat(64)}',1,100,'received',
          clock_timestamp(),clock_timestamp(),'instruction-ready','ar','Private translated question');
      INSERT INTO recordings(id,org_id,site_id,assignment_id,submission_id,sha256,duration_seconds,bytes,status,created_at,received_at)
        VALUES('recording-null','cedar','beirut','assignment','audio-null','${'e'.repeat(64)}',1,100,'received',clock_timestamp(),clock_timestamp());
      INSERT INTO recording_purges(recording_id,org_id,site_id,status,created_at,completed_at)
        VALUES('recording-provenance','cedar','beirut','complete',clock_timestamp(),clock_timestamp()),
          ('recording-null','cedar','beirut','complete',clock_timestamp(),clock_timestamp());`);
    const before=(await db.query("SELECT * FROM attempts WHERE id='attempt'")).rows[0];
    await assert.rejects(db.exec("UPDATE recordings SET presented_question='Injected' WHERE id='recording-null'"),/immutable/);
    await assert.rejects(db.exec("UPDATE recordings SET presentation_id='instruction-ready',presentation_language='ar' WHERE id='recording-null'"),/immutable/);
    await assert.rejects(db.exec("UPDATE attempts SET answer_text='[Deleted]',reasons_json='[]',evidence_json='[]' WHERE id='attempt'"),/immutable/);
    await pgRequest(pool,owner,'worker-30',request());
    await assert.rejects(db.exec(`INSERT INTO directory_reactivations(request_id,org_id,site_id,worker_id,expected_label,requested_by)
      VALUES('resurrected','cedar','beirut','worker-30','Worker 030','maya')`),/pending/);
    await db.exec(`CREATE FUNCTION fail_redaction_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action='worker.content.redacted' THEN RAISE EXCEPTION 'Injected audit failure'; END IF;RETURN NEW;END;$$;
      CREATE TRIGGER fail_redaction_audit BEFORE INSERT ON audit FOR EACH ROW EXECUTE FUNCTION fail_redaction_audit();`);
    await assert.rejects(pgRedact(pool),/Injected/);
    assert.deepEqual((await db.query("SELECT * FROM attempts WHERE id='attempt'")).rows[0],before);
    await db.exec('DROP TRIGGER fail_redaction_audit ON audit');
    assert.equal(await pgRedact(pool),true);
    const after=(await db.query("SELECT * FROM attempts WHERE id='attempt'")).rows[0];
    assert.equal(after.answer_text,'[Deleted]');assert.deepEqual(after.reasons_json,[]);assert.deepEqual(after.evidence_json,[]);
    for(const key of ['id','org_id','site_id','assignment_id','submission_id','outcome','assessment_status'])assert.equal(after[key],before[key]);
    assert.equal(after.received_at.getTime(),before.received_at.getTime());
    assert.equal((await db.query("SELECT text FROM help_requests WHERE case_id='case'")).rows[0].text,'[Deleted]');
    const c=(await db.query("SELECT * FROM clarifications WHERE id='case'")).rows[0];assert.equal(c.reason,'[Deleted]');assert.equal(c.notes,'');assert.equal(c.status,'resolved');
    const readyArtifact=(await db.query("SELECT status,title,text,question,provider,source_hash FROM presentation_artifacts WHERE id='instruction-ready'")).rows[0];
    assert.deepEqual(readyArtifact,{status:'ready',title:'[Deleted]',text:'[Deleted]',question:'[Deleted]',provider:'synthetic-test',source_hash:'b'.repeat(64)});
    const pendingArtifact=(await db.query("SELECT status,title,text,question,provider,error_code FROM presentation_artifacts WHERE id='instruction-pending'")).rows[0];
    assert.deepEqual(pendingArtifact,{status:'failed',title:null,text:null,question:null,provider:null,error_code:'Worker deletion pending'});
    assert.equal((await db.query("SELECT presented_question FROM answer_presentation_bindings WHERE attempt_id='attempt'")).rows[0].presented_question,'[Deleted]');
    const instructionDelivery=(await db.query("SELECT state,content_json,content_hash,assignment_id FROM instruction_deliveries WHERE request_id='send-30'")).rows[0];
    assert.deepEqual(instructionDelivery,{state:'available',content_json:{title:'[Deleted]',text:'[Deleted]'},content_hash:'f'.repeat(64),assignment_id:'assignment'});
    await assert.rejects(db.exec("UPDATE instruction_deliveries SET content_json='{\"title\":\"Private restored\",\"text\":\"Private restored\"}'"),/immutable/);
    await assert.rejects(db.exec('UPDATE instruction_deliveries SET content_json=NULL'),/immutable/);
    assert.deepEqual((await db.query("SELECT presented_question,sha256 FROM recordings WHERE id='recording-provenance'")).rows[0],
      {presented_question:'[Deleted]',sha256:'d'.repeat(64)});
    await assert.rejects(db.exec("UPDATE presentation_artifacts SET text='Private restored text' WHERE id='instruction-ready'"),/immutable/);
    await assert.rejects(db.exec("UPDATE answer_presentation_bindings SET presented_question='Private restored question' WHERE attempt_id='attempt'"),/immutable/);
    await assert.rejects(db.exec("UPDATE recordings SET presented_question='Private restored question' WHERE id='recording-provenance'"),/immutable/);
    await assert.rejects(db.exec("UPDATE attempts SET outcome='clarification' WHERE id='attempt'"),/immutable/);
    await assert.rejects(db.exec("UPDATE attempts SET answer_text='Private restored text' WHERE id='attempt'"),/immutable/);
    await assert.rejects(db.exec("UPDATE help_requests SET text='Private restored text' WHERE case_id='case'"),/immutable/);
    await assert.rejects(db.exec("UPDATE clarifications SET notes='Private restored note' WHERE id='case'"),/immutable/);
    await assert.rejects(db.exec('DELETE FROM worker_deletion_redactions'),/immutable/);
    assert.equal(await pgRedact(pool),false);
  }finally{await db.close();}
});

test('PostgreSQL deletion sanitizes reactivation labels with atomic audit and immutable identity',async()=>{
  const db=new PGlite(),client={async query(sql,values){return values?.length?db.query(sql,values):(await db.exec(sql)).at(-1)||{rows:[]};},release(){}};
  const pool={async connect(){return client;}};
  try{
    await runMigrations(pool);
    await db.exec(`INSERT INTO organizations VALUES('cedar','Synthetic');INSERT INTO sites VALUES('beirut','cedar','Synthetic','UTC');
      INSERT INTO staff(id,org_id,site_id,name,role) VALUES('maya','cedar','beirut','Synthetic','owner');
      INSERT INTO workers(id,org_id,site_id,code,language) VALUES('worker-30','cedar','beirut','Worker 030','en');
      INSERT INTO directory_reactivations(request_id,org_id,site_id,worker_id,expected_label,requested_by)
        VALUES('legacy','cedar','beirut','worker-30','Worker 030','maya');`);
    const before=(await db.query("SELECT * FROM directory_reactivations WHERE request_id='legacy'")).rows[0];
    await assert.rejects(db.exec("UPDATE directory_reactivations SET expected_label='[Deleted]'"),/immutable/);
    await pgRequest(pool,owner,'worker-30',request());
    await db.exec(`CREATE FUNCTION fail_label_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action='worker.reactivation_labels.redacted' THEN RAISE EXCEPTION 'Injected audit failure'; END IF;RETURN NEW;END;$$;
      CREATE TRIGGER fail_label_audit BEFORE INSERT ON audit FOR EACH ROW EXECUTE FUNCTION fail_label_audit();`);
    await assert.rejects(pgRedact(pool),/Injected/);
    assert.deepEqual((await db.query("SELECT * FROM directory_reactivations WHERE request_id='legacy'")).rows[0],before);
    await db.exec('DROP TRIGGER fail_label_audit ON audit');
    assert.equal(await pgRedact(pool),true);
    assert.deepEqual((await db.query("SELECT * FROM directory_reactivations WHERE request_id='legacy'")).rows[0],{...before,expected_label:'[Deleted]'});
    await assert.rejects(db.exec("UPDATE directory_reactivations SET expected_label='Worker 030'"),/immutable/);
    await assert.rejects(db.exec("UPDATE directory_reactivations SET requested_by='someone'"),/immutable/);
    await assert.rejects(db.exec('DELETE FROM directory_reactivations'),/immutable/);
    await pgRedact(pool);assert.equal(await pgRedact(pool),false);
    assert.equal((await db.query("SELECT count(*)::int AS count FROM audit WHERE action='worker.reactivation_labels.redacted'")).rows[0].count,1);
  }finally{await db.close();}
});
