import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {textRetentionInput} from '../server/text-retention-input.mjs';
import {getTextRetention,saveTextRetention,textRetentionReceipt,processOneTextPurge} from '../server/postgres/text-retention.mjs';
import {processOneAssessment} from '../server/postgres/assessment-worker.mjs';
import {processOneRecording} from '../server/postgres/recording-worker.mjs';
import {requestExport} from '../server/postgres/exports.mjs';

const owner={principal_type:'staff',principal_id:'owner',org_id:'test',site_id:'site',role:'owner'};
async function fixture() {
  const db=new PGlite(),options={schema:'understood_test_text_retention'};
  const pool={async connect(){return {query:async(sql,args)=>args?.length?db.query(sql,args):(await db.exec(sql)).at(-1)??{rows:[]},release(){}};}};
  await db.exec(`CREATE SCHEMA ${options.schema};SET search_path TO ${options.schema},pg_catalog`);await runMigrations(pool,options);
  await db.exec(`INSERT INTO organizations VALUES('test','Synthetic'),('other','Other synthetic');
    INSERT INTO sites VALUES('site','test','Synthetic site','UTC'),('other-site','other','Other site','UTC');
    INSERT INTO staff(id,org_id,site_id,name,role) VALUES('owner','test','site','Owner','owner'),('supervisor','test','site','Supervisor','supervisor');
    INSERT INTO workers(id,org_id,site_id,code,language) VALUES('worker','test','site','Synthetic worker','en'),('other-worker','other','other-site','Other worker','en');
    INSERT INTO briefings(id,org_id,site_id,title,source,state) VALUES('briefing','test','site','Synthetic title','Synthetic source','ready'),('other-briefing','other','other-site','Other title','Other source','ready');
    INSERT INTO publications(id,org_id,site_id,briefing_id,version,snapshot_json,state) VALUES('publication','test','site','briefing',1,'{"question":"Where?","rubric":{"askedFacts":["Synthetic private response"]},"languages":{"en":{"question":"Where?"}}}','published'),('other-publication','other','other-site','other-briefing',1,'{}','published');
    INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,language) VALUES('assignment','test','site','publication','worker','en'),('other-assignment','other','other-site','other-publication','other-worker','en');`);
  const attempt=async(id,{age=40,org='test',site='site',assignment='assignment',pending=false,submission=randomUUID()}={})=>{
    await db.query(`INSERT INTO attempts(id,org_id,site_id,assignment_id,submission_id,answer_text,outcome,reasons_json,evidence_json,received_at,assessment_status)
      VALUES($1,$2,$3,$4,$5,'Synthetic private response',$6,'["original_reason"]','[{"quote":"Synthetic private response","factIndex":0}]',clock_timestamp()-$7*interval '1 day',$8)`,
      [id,org,site,assignment,submission,pending?null:'matched',age,pending?'pending':'complete']);
    return submission;
  };
  const recording=async(id,{age=40}={})=>db.query(`INSERT INTO recordings(id,org_id,site_id,assignment_id,submission_id,sha256,duration_seconds,bytes,status,received_at,transcript,lease_token,lease_until)
    VALUES($1,'test','site','assignment',$2,$3,1,100,'processing',clock_timestamp()-$4*interval '1 day','Synthetic transcript','old-claim',clock_timestamp()+interval '3 minutes')`,[id,randomUUID(),'a'.repeat(64),age]);
  return {db,pool,options,attempt,recording};
}
test('text retention inputs require exact confirmed bounded policy and scoped replay preserves original receipts',async()=>{
  const input={requestId:randomUUID(),revision:0,days:30,confirmed:true};
  for(const change of [{confirmed:false},{days:0},{days:8},{revision:-1},{extra:'ignored'},{requestId:'invalid'}])assert.throws(()=>textRetentionInput({...input,...change}),/Invalid/);
  const f=await fixture();try {
    assert.equal((await getTextRetention(f.pool,owner,f.options)).days,null);
    await assert.rejects(saveTextRetention(f.pool,{...owner,site_id:'other-site'},input,f.options),/Forbidden/);
    await assert.rejects(saveTextRetention(f.pool,{...owner,principal_id:'supervisor',role:'supervisor'},input,f.options),/Forbidden/);
    assert.deepEqual(await saveTextRetention(f.pool,owner,input,f.options),{revision:1,duplicate:false});
    assert.deepEqual(await saveTextRetention(f.pool,owner,input,f.options),{revision:1,duplicate:true});
    assert.deepEqual((await textRetentionReceipt(f.pool,owner,input.requestId,f.options)).request,{revision:0,days:30,confirmed:true});
    await assert.rejects(saveTextRetention(f.pool,owner,{...input,days:7},f.options),/conflict/);
    await assert.rejects(saveTextRetention(f.pool,owner,{...input,requestId:randomUUID()},f.options),/revision changed/);
    const disable={requestId:randomUUID(),revision:1,days:null,confirmed:true};await saveTextRetention(f.pool,owner,disable,f.options);
    assert.equal((await getTextRetention(f.pool,owner,f.options)).days,null);
    assert.equal((await textRetentionReceipt(f.pool,owner,input.requestId,f.options)).revision,1);
    assert.equal(await textRetentionReceipt(f.pool,owner,randomUUID(),f.options),null);
    await assert.rejects(f.db.exec('DELETE FROM text_retention_requests'),/immutable/);
  }finally{await f.db.close();}
});
test('scheduled response redaction preserves metrics, denies restoration, fences pending jobs and expires stored export copies',async()=>{
  const f=await fixture();try {
    const oldSubmission=await f.attempt('old'),pendingSubmission=await f.attempt('pending',{pending:true});await f.attempt('fresh',{age:1});
    await f.attempt('foreign',{org:'other',site:'other-site',assignment:'other-assignment'});
    await f.db.query(`INSERT INTO presentation_artifacts(id,org_id,site_id,worker_id,assignment_id,publication_id,publication_version,
      source_kind,source_id,original_language,target_language,source_hash,status,title,text,question,provider,live,created_at,updated_at,ready_at)
      VALUES('answer-ready','test','site','worker','assignment','publication',1,'answer',$1,'en','ar',$3,'ready',NULL,
        'Synthetic private response',NULL,'synthetic-test',false,clock_timestamp(),clock_timestamp(),clock_timestamp()),
      ('answer-pending','test','site','worker','assignment','publication',1,'answer',$2,'en','ar',$3,'pending',NULL,
        NULL,NULL,NULL,NULL,clock_timestamp(),clock_timestamp(),NULL)`,
      [oldSubmission,pendingSubmission,'a'.repeat(64)]);
    await f.db.exec(`INSERT INTO assessment_jobs(id,org_id,site_id,assignment_id,attempt_id,status,lease_token,lease_until)
      VALUES('pending-job','test','site','assignment','pending','processing','previous-claim',clock_timestamp()+interval '3 minutes');
      INSERT INTO report_exports(id,org_id,site_id,publication_id,requested_by,status,snapshot_json,created_at,expires_at)
      VALUES('export','test','site','publication','owner','queued','[{"private":"Synthetic private response"}]',clock_timestamp(),clock_timestamp()+interval '1 day');`);
    assert.equal(await processOneTextPurge(f.pool,f.options),false);
    await assert.rejects(f.db.exec("UPDATE attempts SET answer_text='[Expired]',reasons_json='[]',evidence_json='[]' WHERE id='old'"),/immutable/);
    await saveTextRetention(f.pool,owner,{requestId:randomUUID(),revision:0,days:30,confirmed:true},f.options);
    assert.equal(await processOneTextPurge(f.pool,f.options),true);assert.equal(await processOneTextPurge(f.pool,f.options),true);
    assert.equal(await processOneTextPurge(f.pool,f.options),false);
    const rows=(await f.db.query('SELECT id,answer_text,outcome,assessment_status,reasons_json,evidence_json FROM attempts ORDER BY id')).rows;
    const old=rows.find(row=>row.id==='old');assert.deepEqual(old,{id:'old',answer_text:'[Expired]',outcome:'matched',assessment_status:'complete',reasons_json:[],evidence_json:[]});
    const pending=rows.find(row=>row.id==='pending');assert.equal(pending.answer_text,'[Expired]');assert.equal(pending.outcome,null);assert.equal(pending.assessment_status,'pending');
    for(const id of ['fresh','foreign'])assert.equal(rows.find(row=>row.id===id).answer_text,'Synthetic private response');
    const presentations=(await f.db.query('SELECT id,status,text,provider,live,source_hash,error_code FROM presentation_artifacts ORDER BY id')).rows;
    assert.deepEqual(presentations.find(row=>row.id==='answer-ready'),
      {id:'answer-ready',status:'ready',text:'[Expired]',provider:'synthetic-test',live:false,source_hash:'a'.repeat(64),error_code:null});
    const pendingPresentation=presentations.find(row=>row.id==='answer-pending');
    assert.equal(pendingPresentation.status,'failed');assert.equal(pendingPresentation.text,null);assert.equal(pendingPresentation.provider,null);
    assert.equal(pendingPresentation.error_code,'Response text retention expired');
    await assert.rejects(f.db.exec("UPDATE presentation_artifacts SET text='Restored' WHERE id='answer-ready'"),/immutable/);
    await assert.rejects(f.db.exec("UPDATE presentation_artifacts SET status='pending' WHERE id='answer-ready'"),/immutable/);
    assert.deepEqual((await f.db.query("SELECT status,lease_token,lease_until FROM assessment_jobs WHERE id='pending-job'")).rows[0],{status:'blocked',lease_token:null,lease_until:null});
    assert.equal(await processOneAssessment(f.pool,{assess(){assert.fail('Expired content must not be dispatched');}},f.options),false);
    assert.deepEqual((await f.db.query("SELECT status,snapshot_json,csv,checksum FROM report_exports WHERE id='export'")).rows[0],{status:'expired',snapshot_json:null,csv:null,checksum:null});
    await assert.rejects(f.db.exec("UPDATE attempts SET answer_text='Restored' WHERE id='old'"),/immutable/);
    await assert.rejects(f.db.exec("UPDATE attempts SET outcome='clarification' WHERE id='old'"),/immutable/);
    await assert.rejects(f.db.exec('DELETE FROM text_retention_purges'),/immutable/);
    assert.equal((await getTextRetention(f.pool,owner,f.options)).completed.attempt,2);
    assert.equal((await f.db.query("SELECT count(*)::integer AS n FROM audit WHERE action='retention.attempt_text.purged'")).rows[0].n,2);
    const freshExport=await requestExport(f.pool,owner,{requestId:randomUUID(),publicationId:'publication'},f.options);
    assert.equal(freshExport.status,'queued');
    assert.equal((await f.db.query('SELECT snapshot_json FROM report_exports WHERE id=$1',[freshExport.id])).rows[0].snapshot_json.length,1);
    await saveTextRetention(f.pool,owner,{requestId:randomUUID(),revision:1,days:null,confirmed:true},f.options);
    assert.equal(await processOneTextPurge(f.pool,f.options),false);
    await assert.rejects(f.db.exec("UPDATE attempts SET answer_text='Restored' WHERE id='old'"),/immutable/);
  }finally{await f.db.close();}
});
test('late assessment completion cannot resurrect expired answers or turn unassessed history into a match',async()=>{
  const f=await fixture();try {
    await f.attempt('pending',{pending:true});
    await f.db.exec("INSERT INTO assessment_jobs(id,org_id,site_id,assignment_id,attempt_id) VALUES('job','test','site','assignment','pending')");
    let requests=0;
    const adapter={async assess(answer){
      requests++;assert.equal(answer,'Synthetic private response');
      await saveTextRetention(f.pool,owner,{requestId:randomUUID(),revision:0,days:30,confirmed:true},f.options);
      assert.equal(await processOneTextPurge(f.pool,f.options),true);
      return {outcome:'matched',reasons:['original_reason'],evidence:[{factIndex:0,quote:answer}]};
    }};
    assert.equal(await processOneAssessment(f.pool,adapter,f.options),true);assert.equal(requests,1);
    assert.deepEqual((await f.db.query("SELECT answer_text,outcome,assessment_status FROM attempts WHERE id='pending'")).rows[0],{answer_text:'[Expired]',outcome:null,assessment_status:'pending'});
    assert.equal((await f.db.query("SELECT status FROM assessment_jobs WHERE id='job'")).rows[0].status,'blocked');
    await f.db.exec("UPDATE assessment_jobs SET status='queued' WHERE id='job'");
    assert.equal(await processOneAssessment(f.pool,{assess(){assert.fail('Manual job requeue cannot expose redacted input');}},f.options),true);
    assert.equal((await f.db.query("SELECT status FROM assessment_jobs WHERE id='job'")).rows[0].status,'blocked');
  }finally{await f.db.close();}
});
test('recording transcript retention fences late workers without deleting identity or claiming audio cleanup',async()=>{
  const f=await fixture();try {
    await f.recording('old-audio');await f.recording('fresh-audio',{age:1});
    await saveTextRetention(f.pool,owner,{requestId:randomUUID(),revision:0,days:30,confirmed:true},f.options);
    await assert.rejects(f.db.exec("INSERT INTO text_retention_purges VALUES('recording','fresh-audio','test','site','assignment',1,30,clock_timestamp())"),/scope or policy/);
    await assert.rejects(f.db.exec("INSERT INTO text_retention_purges VALUES('recording','old-audio','other','other-site','other-assignment',1,30,clock_timestamp())"),/scope or policy/);
    assert.equal(await processOneTextPurge(f.pool,{...f.options,kind:'recording'}),true);
    assert.equal(await processOneTextPurge(f.pool,{...f.options,kind:'recording'}),false);
    const row=(await f.db.query("SELECT status,transcript,lease_token,lease_until,retry_at,sha256 FROM recordings WHERE id='old-audio'")).rows[0];
    assert.deepEqual(row,{status:'failed',transcript:null,lease_token:null,lease_until:null,retry_at:null,sha256:'a'.repeat(64)});
    assert.equal((await f.db.query("SELECT transcript FROM recordings WHERE id='fresh-audio'")).rows[0].transcript,'Synthetic transcript');
    await assert.rejects(f.db.exec("UPDATE recordings SET transcript='Restored' WHERE id='old-audio'"),/immutable/);
    await assert.rejects(f.db.exec("UPDATE recordings SET status='received' WHERE id='old-audio'"),/immutable/);
    await f.db.exec("UPDATE recordings SET status='failed',lease_token=NULL,lease_until=NULL WHERE id='fresh-audio'");
    assert.equal(await processOneRecording(f.pool,{transcribe(){assert.fail('Expired recording must not be dispatched');},assess(){assert.fail('Expired recording must not be assessed');}},
      {read(){assert.fail('Expired recording must not be read for processing');}},f.options),false);
    assert.equal((await f.db.query('SELECT count(*)::integer n FROM recording_purges')).rows[0].n,0);
    assert.equal((await f.db.query("SELECT active FROM workers WHERE id='worker'")).rows[0].active,true);
  }finally{await f.db.close();}
});
test('linked transcript redaction preserves original provider hashes and immutable operation identities',async()=>{
  const f=await fixture();try {
    const operationId=randomUUID();
    // Deliberately seeded historical linkage to isolate database redaction guards,
    // not evidence of an application workflow or successful provider inference.
    await f.db.query(`INSERT INTO provider_operations(id,org_id,kind,reference_id,claim_token,model,data_class,reserved_requests,quota_day,input_hash,provenance_json)
      VALUES($1,'test','recording-transcription','linked-audio',$2,'fixture-model','synthetic',4,CURRENT_DATE,$3,$4)`,
      [operationId,randomUUID(),'b'.repeat(64),JSON.stringify({adapter:'fixture-transcriber',dataClass:'synthetic',model:'fixture-model',promptVersion:'fixture-v1',schemaVersion:'fixture-v1'})]);
    await f.db.query(`INSERT INTO recordings(id,org_id,site_id,assignment_id,submission_id,sha256,duration_seconds,bytes,status,received_at,transcript,transcription_operation_id)
      VALUES('linked-audio','test','site','assignment',$1,$2,1,100,'transcribed',clock_timestamp()-interval '40 days','Synthetic linked transcript',$3)`,[randomUUID(),'a'.repeat(64),operationId]);
    const before=(await f.db.query('SELECT * FROM provider_operations WHERE id=$1',[operationId])).rows[0];
    await assert.rejects(f.db.exec("UPDATE recordings SET transcript=NULL WHERE id='linked-audio'"),/immutable/);
    await saveTextRetention(f.pool,owner,{requestId:randomUUID(),revision:0,days:30,confirmed:true},f.options);
    assert.equal(await processOneTextPurge(f.pool,{...f.options,kind:'recording'}),true);
    assert.deepEqual((await f.db.query('SELECT * FROM provider_operations WHERE id=$1',[operationId])).rows[0],before);
    assert.deepEqual((await f.db.query("SELECT transcript,transcription_operation_id FROM recordings WHERE id='linked-audio'")).rows[0],{transcript:null,transcription_operation_id:operationId});
    await assert.rejects(f.db.exec("UPDATE recordings SET transcript='Restored' WHERE id='linked-audio'"),/immutable/);
    await assert.rejects(f.db.exec("UPDATE recordings SET transcription_operation_id=NULL WHERE id='linked-audio'"),/immutable/);
  }finally{await f.db.close();}
});
test('audit failure rolls back redaction, expiry and purge receipt together, permitting a truthful retry',async()=>{
  const f=await fixture();try {
    await f.attempt('old');await saveTextRetention(f.pool,owner,{requestId:randomUUID(),revision:0,days:7,confirmed:true},f.options);
    await f.db.exec(`CREATE FUNCTION fail_text_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action='retention.attempt_text.purged' THEN RAISE EXCEPTION 'Injected audit failure';END IF;RETURN NEW;END $$;
      CREATE TRIGGER fail_text_audit BEFORE INSERT ON audit FOR EACH ROW EXECUTE FUNCTION fail_text_audit();`);
    await assert.rejects(processOneTextPurge(f.pool,f.options),/Injected audit failure/);
    assert.equal((await f.db.query("SELECT answer_text FROM attempts WHERE id='old'")).rows[0].answer_text,'Synthetic private response');
    assert.equal((await f.db.query('SELECT count(*)::integer n FROM text_retention_purges')).rows[0].n,0);
    await f.db.exec('DROP TRIGGER fail_text_audit ON audit');
    assert.equal(await processOneTextPurge(f.pool,f.options),true);assert.equal(await processOneTextPurge(f.pool,f.options),false);
  }finally{await f.db.close();}
});
