import test from 'node:test';
import {createSessionContextFetch} from './helpers/session-http.mjs';
const fetch=createSessionContextFetch();
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {getBriefingRetention,saveBriefingRetention,briefingRetentionReceipt,processOneBriefingContentPurge} from '../server/postgres/briefing-retention.mjs';
import {getBriefing,workerBriefing,workerBriefings} from '../server/postgres/read-models.mjs';
import {getPublicationHistoryDetail,listPublicationHistory} from '../server/postgres/publication-history.mjs';
import {saveDraftReview,draftReviewReceipt,verifyDraftReviewReceipt} from '../server/postgres/draft-review.mjs';
import {copyDraft} from '../server/postgres/preparation.mjs';
import {rehearsalTasks} from '../server/postgres/runtime.mjs';
import {createPostgresRehearsalServer} from '../server/postgres/http.mjs';
import {provisionStaffCredential} from '../server/postgres/auth.mjs';
const owner={principal_type:'staff',principal_id:'owner',org_id:'org',site_id:'site',role:'owner'};
const change=(revision=0,days=7)=>({requestId:randomUUID(),revision,days,confirmed:true});
const review={revision:1,question:'PRIVATE question?',facts:['PRIVATE fact'],askedFacts:['PRIVATE fact']};
async function fixture(){
  const db=new PGlite(),options={schema:'understood_test_briefing_retention'};let fail=false;
  const pool={async connect(){return {async query(sql,args){if(fail && sql.startsWith('INSERT INTO audit'))throw Error('Injected audit failure');return args?.length?db.query(sql,args):(await db.exec(sql)).at(-1)||{rows:[]};},release(){}};}};
  await db.exec(`CREATE SCHEMA ${options.schema};SET search_path TO ${options.schema},pg_catalog`);await runMigrations(pool,options);
  await db.exec("INSERT INTO organizations VALUES('org','Synthetic'),('foreign','Foreign');INSERT INTO sites VALUES('site','org','Site','UTC'),('other','org','Other','UTC'),('foreign','foreign','Foreign','UTC');INSERT INTO staff(id,org_id,site_id,name,role) VALUES('owner','org','site','Owner','owner'),('admin','org','site','Admin','administrator'),('supervisor','org','site','Supervisor','supervisor');INSERT INTO workers(id,org_id,site_id,code,language) VALUES('worker','org','site','001','en');");
  const briefing=async(id,{org='org',site='site',age=10,archived=true}={})=>{
    await db.query("INSERT INTO briefings(id,org_id,site_id,title,source,state,prepared_json) VALUES($1,$2,$3,'PRIVATE title','PRIVATE source','ready','{\"facts\":[\"PRIVATE fact\"]}')",[id,org,site]);
    if(archived)await db.query("INSERT INTO briefing_archives(request_id,org_id,site_id,briefing_id,request_json,publication_ids_json,archived_by,occurred_at) VALUES($1,$2,$3,$1,'{}','[]','owner',clock_timestamp()-$4*interval '1 day')",[id,org,site,age]);
  };
  // Foreign archive receipts need an actual scoped staff principal.
  await db.exec("INSERT INTO staff(id,org_id,site_id,name,role) VALUES('other-owner','org','other','Other','owner'),('foreign-owner','foreign','foreign','Foreign','owner')");
  return {db,pool,options,briefing,fail:value=>{fail=value;}};
}
test('archived briefing policy is default off, scoped, confirmed, revisioned and exact replay recoverable',async()=>{
  const f=await fixture(),input=change();try{
    await f.briefing('old');assert.equal(await processOneBriefingContentPurge(f.pool,f.options),false);assert.equal((await getBriefingRetention(f.pool,owner,f.options)).days,null);
    for(const session of [{...owner,principal_type:'worker'},{...owner,site_id:'other'},{...owner,principal_id:'supervisor',role:'supervisor'}])await assert.rejects(saveBriefingRetention(f.pool,session,input,f.options),/Forbidden/);
    assert.throws(()=>saveBriefingRetention(f.pool,owner,{...input,confirmed:false},f.options),/Invalid/);
    assert.deepEqual(await saveBriefingRetention(f.pool,owner,input,f.options),{revision:1,duplicate:false});assert.deepEqual(await saveBriefingRetention(f.pool,owner,input,f.options),{revision:1,duplicate:true});
    assert.equal((await briefingRetentionReceipt(f.pool,owner,input.requestId,f.options)).request.days,7);
    assert.equal(await briefingRetentionReceipt(f.pool,{...owner,principal_id:'admin',role:'administrator'},input.requestId,f.options),null);
    await assert.rejects(saveBriefingRetention(f.pool,owner,{...input,days:30},f.options),/conflict/);await assert.rejects(saveBriefingRetention(f.pool,owner,change(),f.options),/revision changed/);
    await assert.rejects(f.db.exec('DELETE FROM briefing_retention_requests'),/immutable/);
  }finally{await f.db.close();}
});
test('physical content expiry removes all eight owned copies, preserves version/outcome evidence and exact command replays',async()=>{
  const f=await fixture(),reviewId=randomUUID(),copyId=randomUUID(),bundleId=randomUUID();try{
    await f.briefing('old');await f.briefing('active',{archived:false});
    await f.db.exec("INSERT INTO publications(id,org_id,site_id,briefing_id,version,snapshot_json,state) VALUES('pub','org','site','old',1,'{\"title\":\"PRIVATE title\",\"question\":\"PRIVATE question\",\"facts\":[\"PRIVATE fact\"]}','archived');INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,language) VALUES('assignment','org','site','pub','worker','en');INSERT INTO attempts(id,org_id,site_id,assignment_id,submission_id,answer_text,outcome,reasons_json,received_at) VALUES('attempt','org','site','assignment','submission','Worker answer','matched','[]',clock_timestamp()-interval '10 days');INSERT INTO draft_reviews VALUES('old','org','site','{\"facts\":[\"PRIVATE fact\"]}');INSERT INTO jobs(id,org_id,site_id,briefing_id,revision,kind,status,due_at) VALUES('job','org','site','old',1,'prepare','ready',clock_timestamp());");
    await f.db.query('INSERT INTO briefing_review_requests(request_id,org_id,site_id,briefing_id,accepted_revision,request_json,requested_by) VALUES($1,\'org\',\'site\',\'old\',2,$2,\'owner\')',[reviewId,JSON.stringify(review)]);
    await f.db.query("INSERT INTO generated_bundles(id,org_id,site_id,briefing_id,revision,job_id,job_lease,manifest_json,manifest_hash,dependency_hash,state) VALUES($1,'org','site','old',1,'job','lease','{\"text\":\"PRIVATE generated\"}',$2,$2,'cleaned')",[bundleId,'a'.repeat(64)]);
    await f.db.query("INSERT INTO generated_audio_removals(bundle_id,org_id,site_id) VALUES($1,'org','site')",[bundleId]);
    await f.db.query("INSERT INTO briefing_regeneration_requests(request_id,org_id,site_id,briefing_id,accepted_revision,baseline_revision,baseline_bundle_id,job_id,request_json,baseline_review_json,requested_by,requested_role) VALUES($1,'org','site','old',2,1,$2,'job2','{}','{\"text\":\"PRIVATE baseline\"}','owner','owner')",[randomUUID(),bundleId]).catch(async error=>{
      if(!/foreign key/.test(error.message))throw error;
      await f.db.exec("INSERT INTO jobs(id,org_id,site_id,briefing_id,revision,kind,status,due_at) VALUES('job2','org','site','old',2,'prepare','ready',clock_timestamp())");
      await f.db.query("INSERT INTO briefing_regeneration_requests(request_id,org_id,site_id,briefing_id,accepted_revision,baseline_revision,baseline_bundle_id,job_id,request_json,baseline_review_json,requested_by,requested_role) VALUES($1,'org','site','old',2,1,$2,'job2','{}','{\"text\":\"PRIVATE baseline\"}','owner','owner')",[randomUUID(),bundleId]);
    });
    await f.db.query("INSERT INTO briefing_copies(request_id,org_id,site_id,source_briefing_id,source_revision,copy_briefing_id,title,requested_by) VALUES($1,'org','site','active',1,'old','PRIVATE copied title','owner')",[copyId]);
    await f.db.query("INSERT INTO source_audio_requests(request_id,org_id,site_id,requested_by,request_hash,title,id,sha256,bytes,duration_seconds,original_id,original_sha256,original_bytes,original_type,authority_json,status,created_at,received_at,briefing_id) VALUES('source','org','site','owner',$1,'PRIVATE audio title','audio',$1,32044,1,'original',$1,100,'audio/wav','{}','transcribed',clock_timestamp()-interval '10 days',clock_timestamp()-interval '10 days','old')",['a'.repeat(64)]);
    await f.db.query(`INSERT INTO instruction_sends(request_id,org_id,site_id,briefing_id,publication_request_id,audience_json,
      response_mode,delivery_mode,state,publication_id,audience_count,delivered,undelivered,undelivered_json,request_json,
      requested_by,created_at,updated_at) VALUES('send-old','org','site','old','pub-request',
      '{"type":"all","workers":[{"id":"worker","language":"en"}]}','question','text','published','pub',1,1,0,'[]',
      '{"title":"PRIVATE send title","source":"PRIVATE send source","responseMode":"question","deliveryMode":"text","sourceHash":"${'f'.repeat(64)}"}',
      'owner',clock_timestamp()-interval '10 days',clock_timestamp()-interval '10 days')`);
    await f.db.query(`INSERT INTO instruction_deliveries(request_id,org_id,site_id,worker_id,language,state,reason,attempts,
      assignment_id,content_json,content_hash,updated_at) VALUES('send-old','org','site','worker','en','available',NULL,0,
      'assignment','{"title":"PRIVATE late title","text":"PRIVATE late text"}',$1,clock_timestamp()-interval '10 days')`,['e'.repeat(64)]);
    const evidence=(await f.db.query("SELECT to_jsonb(p)-'snapshot_json' AS publication FROM publications p WHERE id='pub'")).rows[0];
    await f.db.exec("INSERT INTO submission_receipts(org_id,assignment_id,submission_id,kind,received_at) SELECT org_id,assignment_id,submission_id,'typed',received_at FROM attempts WHERE id='attempt'");
    await f.db.exec(`INSERT INTO presentation_artifacts(id,org_id,site_id,worker_id,assignment_id,publication_id,publication_version,
      source_kind,source_id,original_language,target_language,source_hash,status,title,text,question,provider,live,created_at,updated_at,ready_at)
      VALUES('instruction-ready','org','site','worker','assignment','pub',1,'instruction','','en','ur','${'b'.repeat(64)}','ready',
        'PRIVATE translated title','PRIVATE translated text','PRIVATE translated question','synthetic-test',false,clock_timestamp(),clock_timestamp(),clock_timestamp()),
      ('instruction-pending','org','site','worker','assignment','pub',1,'instruction','','en','ar','${'c'.repeat(64)}','pending',
        NULL,NULL,NULL,NULL,NULL,clock_timestamp(),clock_timestamp(),NULL);
      INSERT INTO answer_presentation_bindings(attempt_id,org_id,site_id,assignment_id,presentation_id,presentation_language,presented_question,created_at)
        VALUES('attempt','org','site','assignment','instruction-ready','ur','PRIVATE translated question',clock_timestamp());
      INSERT INTO recordings(id,org_id,site_id,assignment_id,submission_id,sha256,duration_seconds,bytes,status,transcript,created_at,received_at,presentation_id,presentation_language,presented_question)
        VALUES('recording','org','site','assignment','recording-submission','${'d'.repeat(64)}',1,100,'transcribed','Worker transcript',
          clock_timestamp()-interval '10 days',clock_timestamp()-interval '10 days','instruction-ready','ur','PRIVATE translated question');`);
    const attempt=(await f.db.query("SELECT * FROM attempts WHERE id='attempt'")).rows[0];
    await saveBriefingRetention(f.pool,owner,change(),f.options);
    assert.equal(await rehearsalTasks(f.pool,null,f.options).briefingContentRetention(),true);assert.equal(await processOneBriefingContentPurge(f.pool,f.options),false);
    const proofs=(await f.db.query('SELECT proofs_json FROM briefing_content_purges')).rows[0].proofs_json;assert.equal(Object.keys(proofs).length,8);assert.doesNotMatch(JSON.stringify(proofs),/PRIVATE/);
    const origin=(await f.db.query('SELECT * FROM briefing_content_origins')).rows[0];
    assert.doesNotMatch(JSON.stringify(origin),/PRIVATE|Worker answer/);
    assert.deepEqual(origin.source_receipt_json.proofs_json,proofs);
    assert.equal(origin.context_json.briefing.revision,1);assert.equal(origin.context_json.publications[0].state,'archived');
    assert.equal(origin.context_json.assignments[0].worker_id,'worker');assert.equal(origin.context_json.attempts[0].outcome,'matched');
    assert.equal(origin.context_json.generated_bundles[0].state,'cleaned');assert.ok(origin.context_json.generated_bundles[0].removed_at);
    assert.equal(origin.source_policy_json.request_json.days,7);assert.equal(origin.context_json.archive.archived_by,'owner');
    assert.equal(origin.context_json.archive.request_sha256.length,64);
    assert.ok(new Date(origin.captured_at).getTime()>=Date.parse(origin.source_receipt_json.completed_at));
    for(const sql of ["UPDATE briefing_content_origins SET context_json='{}'",'DELETE FROM briefing_content_origins'])await assert.rejects(f.db.exec(sql),/immutable/);
    for(const table of ['briefings','publications','draft_reviews','briefing_review_requests','briefing_regeneration_requests','generated_bundles','briefing_copies','source_audio_requests']){
      const column=table==='briefings'?'id':table==='briefing_copies'?'copy_briefing_id':'briefing_id';
      assert.doesNotMatch(JSON.stringify((await f.db.query(`SELECT * FROM ${table} WHERE ${column}='old'`)).rows),/PRIVATE/);
    }
    const send=(await f.db.query("SELECT request_json,response_mode,delivery_mode,audience_json,audience_count,delivered,undelivered FROM instruction_sends WHERE request_id='send-old'")).rows[0];
    assert.equal(send.request_json.title,'[Expired]');assert.equal(send.request_json.source,'[Expired]');
    assert.equal(send.request_json.responseMode,'question');assert.equal(send.request_json.sourceHash,'f'.repeat(64));
    assert.equal(send.response_mode,'question');assert.equal(send.delivery_mode,'text');assert.equal(send.audience_count,1);assert.equal(send.delivered,1);
    assert.equal((await f.db.query("SELECT content_json FROM instruction_deliveries WHERE request_id='send-old'")).rows[0].content_json,null);
    const delivery=(await f.db.query("SELECT state,assignment_id,content_hash FROM instruction_deliveries WHERE request_id='send-old'")).rows[0];
    assert.deepEqual(delivery,{state:'available',assignment_id:'assignment',content_hash:'e'.repeat(64)});
    for(const sql of [`UPDATE instruction_sends SET request_json=request_json||'{"title":"PRIVATE restored"}' WHERE request_id='send-old'`,
      `UPDATE instruction_deliveries SET content_json='{"title":"PRIVATE restored","text":"PRIVATE restored"}' WHERE request_id='send-old'`])
      await assert.rejects(f.db.exec(sql),/immutable/,sql);
    assert.doesNotMatch(JSON.stringify((await f.db.query("SELECT request_json FROM instruction_sends WHERE request_id='send-old'")).rows),/PRIVATE/);
    const presentations=(await f.db.query("SELECT id,status,title,text,question,provider,live,source_hash,error_code FROM presentation_artifacts ORDER BY id")).rows;
    assert.deepEqual(presentations.find(row=>row.id==='instruction-ready'),
      {id:'instruction-ready',status:'ready',title:'[Expired]',text:'[Expired]',question:'[Expired]',provider:'synthetic-test',
        live:false,source_hash:'b'.repeat(64),error_code:null});
    const pendingPresentation=presentations.find(row=>row.id==='instruction-pending');
    assert.equal(pendingPresentation.status,'failed');assert.equal(pendingPresentation.text,null);assert.equal(pendingPresentation.title,null);
    assert.equal(pendingPresentation.provider,null);assert.equal(pendingPresentation.error_code,'Briefing content retention expired');
    assert.equal((await f.db.query("SELECT presented_question FROM answer_presentation_bindings WHERE attempt_id='attempt'")).rows[0].presented_question,'[Expired]');
    const retainedRecording=(await f.db.query("SELECT presented_question,sha256,transcript FROM recordings WHERE id='recording'")).rows[0];
    assert.deepEqual(retainedRecording,{presented_question:'[Expired]',sha256:'d'.repeat(64),transcript:'Worker transcript'});
    for(const sql of ["UPDATE presentation_artifacts SET text='Restored' WHERE id='instruction-ready'",
      "UPDATE presentation_artifacts SET status='pending' WHERE id='instruction-ready'",
      "UPDATE answer_presentation_bindings SET presented_question='Restored' WHERE attempt_id='attempt'",
      "UPDATE recordings SET presented_question='Restored' WHERE id='recording'"])await assert.rejects(f.db.exec(sql),/immutable/,sql);
    assert.deepEqual((await f.db.query("SELECT to_jsonb(p)-'snapshot_json' AS publication FROM publications p WHERE id='pub'")).rows[0],evidence);
    assert.deepEqual((await f.db.query("SELECT * FROM attempts WHERE id='attempt'")).rows[0],attempt);
    const read=await getBriefing(f.pool,owner,'old',f.options);assert.equal(read.contentExpired,true);assert.equal(read.review,null);assert.deepEqual(read.publications[0].snapshot.facts,[]);
    const exact=await getPublicationHistoryDetail(f.pool,owner,'old','pub',f.options);assert.deepEqual(exact.snapshot,read.publications[0].snapshot);assert.equal(exact.artifactAudio,null);assert.doesNotMatch(JSON.stringify(exact),/PRIVATE/);
    const catalog=await listPublicationHistory(f.pool,owner,'old',{},f.options);assert.equal(catalog.total,1);assert.equal(catalog.items[0].state,'archived');assert.doesNotMatch(JSON.stringify(catalog),/snapshot|rubric|PRIVATE/);
    const worker={principal_type:'worker',principal_id:'worker',org_id:'org',site_id:'site'};
    const history=await workerBriefing(f.pool,worker,'assignment',f.options);
    assert.equal(history.contentExpired,true);assert.equal(history.state,'archived');assert.equal(history.outcome,'matched');
    assert.equal(history.content,null);assert.equal(history.speechAvailable,null);assert.equal(history.speechUrls,undefined);
    assert.equal((await workerBriefings(f.pool,worker,{...f.options,history:true})).items[0].contentExpired,true);
    assert.equal((await workerBriefings(f.pool,worker,f.options)).items.length,0);
    assert.deepEqual(await saveDraftReview(f.pool,owner,'old',{requestId:reviewId,...review,confirmed:true},f.options),{id:'old',revision:2,duplicate:true});
    assert.deepEqual(await draftReviewReceipt(f.pool,owner,reviewId,f.options),{found:true,id:'old',revision:2,contentExpired:true});
    const beforeVerification=(await f.db.query('SELECT count(*)::int AS n FROM audit')).rows[0].n;
    assert.deepEqual(await verifyDraftReviewReceipt(f.pool,owner,reviewId,{...review,confirmed:true},f.options),{found:true,id:'old',revision:2,matches:true});
    await assert.rejects(verifyDraftReviewReceipt(f.pool,owner,reviewId,{...review,question:'Different',confirmed:true},f.options),/conflict/);
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM audit')).rows[0].n,beforeVerification);
    await assert.rejects(saveDraftReview(f.pool,owner,'old',{requestId:reviewId,...review,question:'Different',confirmed:true},f.options),/conflict/);
    const copied=await copyDraft(f.pool,owner,'active',{requestId:copyId,revision:1,title:'PRIVATE copied title',confirmed:true},f.options);assert.equal(copied.duplicate,true);
    await assert.rejects(copyDraft(f.pool,owner,'old',{requestId:randomUUID(),revision:1,title:'New copy',confirmed:true},f.options),/Expired/);
    for(const sql of ["UPDATE briefings SET source='restored' WHERE id='old'","UPDATE briefings SET revision=2 WHERE id='old'","UPDATE publications SET snapshot_json='{}' WHERE id='pub'","UPDATE draft_reviews SET content_json='{\"facts\":[]}' WHERE briefing_id='old'","UPDATE generated_bundles SET manifest_json='{\"text\":\"restored\"}'",'DELETE FROM briefing_content_purges'])await assert.rejects(f.db.exec(sql),/immutable/,sql);
    await saveBriefingRetention(f.pool,owner,change(1,null),f.options);assert.equal((await getBriefingRetention(f.pool,owner,f.options)).completed.briefing,1);
    assert.equal((await f.db.query("SELECT source FROM briefings WHERE id='old'")).rows[0].source,'[Expired]');
  }finally{await f.db.close();}
});
test('elapsed scope/proofs and deferred physical completion are required; audit failure rolls all redactions back',async()=>{
  const f=await fixture();try{
    await f.briefing('old');await f.briefing('fresh',{age:1});await saveBriefingRetention(f.pool,owner,change(),f.options);
    const insert=(id,org='org',revision=1)=>f.db.query('INSERT INTO briefing_content_purges(briefing_id,org_id,site_id,policy_revision,days,proofs_json) VALUES($1,$2,\'site\',$3,7,briefing_content_proofs($1,$2,\'site\'))',[id,org,revision]);
    await assert.rejects(insert('fresh'),/scope, policy/);await assert.rejects(insert('old','foreign'),/scope, policy/);await assert.rejects(insert('old','org',2),/scope, policy/);
    for(const timestamp of ["clock_timestamp()-interval '1 day'","clock_timestamp()+interval '1 day'"])
      await assert.rejects(f.db.exec(`INSERT INTO briefing_content_purges(briefing_id,org_id,site_id,policy_revision,days,proofs_json,completed_at)
        VALUES('old','org','site',1,7,briefing_content_proofs('old','org','site'),${timestamp})`),/completion must belong/);
    await assert.rejects(insert('old'),/redaction incomplete/);assert.equal((await f.db.query('SELECT count(*)::int AS n FROM briefing_content_purges')).rows[0].n,0);
    f.fail(true);await assert.rejects(processOneBriefingContentPurge(f.pool,f.options),/audit failure/);f.fail(false);assert.equal((await f.db.query("SELECT source FROM briefings WHERE id='old'")).rows[0].source,'PRIVATE source');
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM briefing_content_origins')).rows[0].n,0);
    assert.equal(await processOneBriefingContentPurge(f.pool,f.options),true);
  }finally{await f.db.close();}
});

test('expiry requires an original confirmed policy receipt and captures its historical decision before later disable',async()=>{
  const f=await fixture();try{
    await f.briefing('old');
    await f.db.exec("INSERT INTO briefing_retention_policies VALUES('site','org',1,7,clock_timestamp())");
    await assert.rejects(processOneBriefingContentPurge(f.pool,f.options),/policy receipt unavailable/);
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM briefing_content_purges')).rows[0].n,0);
    assert.equal((await f.db.query("SELECT source FROM briefings WHERE id='old'")).rows[0].source,'PRIVATE source');
    const request=change();
    await f.db.query("INSERT INTO briefing_retention_requests VALUES($1,'org','site','owner',$2,1,clock_timestamp())",[request.requestId,JSON.stringify({revision:0,days:7,confirmed:true})]);
    assert.equal(await processOneBriefingContentPurge(f.pool,f.options),true);
    const original=(await f.db.query('SELECT * FROM briefing_content_origins')).rows[0];
    await saveBriefingRetention(f.pool,owner,change(1,null),f.options);
    assert.deepEqual((await f.db.query('SELECT * FROM briefing_content_origins')).rows[0],original);
    assert.equal((await f.db.query('SELECT days FROM briefing_retention_policies')).rows[0].days,null);
  }finally{await f.db.close();}
});

test('ambiguous or content-bearing policy receipts cannot become original expiry authority',async()=>{
  for(const ambiguous of [false,true]) {
    const f=await fixture();try{
      await f.briefing('old');await saveBriefingRetention(f.pool,owner,change(),f.options);
      await f.db.query("INSERT INTO briefing_retention_requests VALUES($1,'org','site','owner',$2,1,clock_timestamp())",[randomUUID(),
        JSON.stringify(ambiguous?{revision:0,days:7,confirmed:true}:{revision:0,days:7,confirmed:true,privateNote:'PRIVATE note'})]);
      await assert.rejects(processOneBriefingContentPurge(f.pool,f.options),/unavailable or ambiguous/);
      assert.equal((await f.db.query('SELECT count(*)::int AS n FROM briefing_content_purges')).rows[0].n,0);
      assert.equal((await f.db.query('SELECT count(*)::int AS n FROM briefing_content_origins')).rows[0].n,0);
      assert.equal((await f.db.query("SELECT source FROM briefings WHERE id='old'")).rows[0].source,'PRIVATE source');
    }finally{await f.db.close();}
  }
});
test('active/fresh archives, recent answers, pending assessments, open cases and unverified generated cleanup defer content expiry',async()=>{
  const f=await fixture();try{
    await f.briefing('active',{archived:false});await f.briefing('fresh',{age:1});await f.briefing('pending');await f.briefing('audio');
    await saveBriefingRetention(f.pool,owner,change(),f.options);
    await f.db.exec("INSERT INTO publications(id,org_id,site_id,briefing_id,version,snapshot_json,state) VALUES('pub','org','site','pending',1,'{}','archived');INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,language) VALUES('assignment','org','site','pub','worker','en');INSERT INTO attempts(id,org_id,site_id,assignment_id,submission_id,answer_text,outcome,assessment_status,reasons_json,received_at) VALUES('attempt','org','site','assignment','submission','Answer',NULL,'pending','[]',clock_timestamp()-interval '10 days');INSERT INTO jobs(id,org_id,site_id,briefing_id,revision,kind,status,due_at) VALUES('job','org','site','audio',1,'prepare','ready',clock_timestamp());");
    await f.db.query("INSERT INTO generated_bundles(id,org_id,site_id,briefing_id,revision,job_id,job_lease,manifest_json,manifest_hash,dependency_hash,state) VALUES($1,'org','site','audio',1,'job','lease','{}',$2,$2,'cleaned')",[randomUUID(),'a'.repeat(64)]);
    assert.equal(await processOneBriefingContentPurge(f.pool,f.options),false);
    await f.db.exec("UPDATE attempts SET assessment_status='complete',outcome='matched' WHERE id='attempt';INSERT INTO clarifications(id,org_id,site_id,assignment_id,attempt_id,reason,status) VALUES('case','org','site','assignment','attempt','Missing detail','open')");
    assert.equal(await processOneBriefingContentPurge(f.pool,f.options),false);
    await f.db.exec("UPDATE clarifications SET status='resolved',resolved_at=clock_timestamp()-interval '1 day' WHERE id='case'");
    assert.equal(await processOneBriefingContentPurge(f.pool,f.options),false);
  }finally{await f.db.close();}
});

test('HTTP policy and expired review recovery require scoped credentials and verify without restoring content',async()=>{
  const f=await fixture(),reviewId=randomUUID();let server;
  try{
    await f.briefing('old');
    await f.db.query("INSERT INTO briefing_review_requests(request_id,org_id,site_id,briefing_id,accepted_revision,request_json,requested_by) VALUES($1,'org','site','old',2,$2,'owner')",[reviewId,JSON.stringify(review)]);
    const password='Synthetic-retention-password-123';
    for(const id of ['owner','supervisor'])await provisionStaffCredential(f.pool,{staffId:id,orgId:'org',siteId:'site',email:`${id}@qa.example.test`,password},f.options);
    const config={...f.options,tier:'local',aiMode:'synthetic',accessMode:'credential',dataClass:'synthetic',publicOrigin:'http://127.0.0.1:3020'};
    server=createPostgresRehearsalServer(f.pool,config);
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const base=`http://127.0.0.1:${server.address().port}/api`;
    const call=(path,cookie,body)=>fetch(base+path,{method:body?'POST':'GET',headers:{origin:config.publicOrigin,'content-type':'application/json',...(cookie?{cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const login=async id=>{const response=await call('/auth/staff/login',null,{email:`${id}@qa.example.test`,password});assert.equal(response.status,200);return response.headers.get('set-cookie').split(';')[0];};
    const cookie=await login('owner'),supervisor=await login('supervisor'),input=change();
    assert.equal((await call('/retention/briefings')).status,401);
    assert.equal((await call('/retention/briefings',supervisor,input)).status,403);
    assert.equal((await call('/retention/briefings?site=foreign',cookie)).status,400);
    assert.equal((await call('/retention/briefings',cookie,{...input,confirmed:false})).status,400);
    const saved=await call('/retention/briefings',cookie,input);assert.equal(saved.status,200);assert.match(saved.headers.get('cache-control'),/no-store/);
    assert.equal((await (await call('/retention/briefings',cookie,input)).json()).duplicate,true);
    const receipt=await (await call(`/retention/briefings/requests/${input.requestId}`,cookie)).json();assert.equal(receipt.revision,1);assert.equal(receipt.request.days,7);
    assert.equal((await call(`/retention/briefings/requests/${input.requestId}?scope=foreign`,cookie)).status,400);
    assert.equal(await processOneBriefingContentPurge(f.pool,f.options),true);
    const expired=await (await call(`/briefing-review/receipts/${reviewId}`,cookie)).json();assert.equal(expired.contentExpired,true);assert.equal('request' in expired,false);
    const audit=(await f.db.query('SELECT count(*)::int AS n FROM audit')).rows[0].n,path=`/briefing-review/receipts/${reviewId}/verify`;
    assert.equal((await call(path,null,{...review,confirmed:true})).status,401);
    assert.equal((await call(path+'?site=foreign',cookie,{...review,confirmed:true})).status,400);
    assert.equal((await call(path,cookie,{...review,question:'Changed',confirmed:true})).status,409);
    const verified=await call(path,cookie,{...review,confirmed:true});assert.equal(verified.status,200);assert.match(verified.headers.get('cache-control'),/no-store/);assert.equal((await verified.json()).matches,true);
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM audit')).rows[0].n,audit);
    assert.deepEqual((await f.db.query('SELECT request_json FROM briefing_review_requests')).rows[0].request_json,{});
  }finally{if(server?.listening)await new Promise(resolve=>server.close(resolve));await f.db.close();}
});
