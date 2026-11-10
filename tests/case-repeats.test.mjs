import {postgresWorkspace} from '../server/postgres/workspace.mjs';
import {workerSubmission} from '../server/postgres/responses.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {submitAnswer} from '../server/postgres/domain.mjs';
import {processOneAssessment} from '../server/postgres/assessment-worker.mjs';
import {requestCaseRepeat,caseRepeatReceipt,listCaseRepeats} from '../server/postgres/case-repeats.mjs';
import {getClarification,resolveClarification,requestHelp} from '../server/postgres/clarifications.mjs';
import {workerBriefing,workerBriefings} from '../server/postgres/read-models.mjs';
import {readPublicationReport} from '../server/postgres/reports.mjs';
import {receiveRecording} from '../server/postgres/recordings.mjs';
import {processOneRecording} from '../server/postgres/recording-worker.mjs';
import {requestWorkerDeletion} from '../server/postgres/deletions.mjs';
import {encodeWav} from '../src/audio.ts';
import {caseRepeatPage} from '../server/postgres/case-workflow-pages.mjs';
import {checkedRepeatPage} from '../src/case-workflow-contract.ts';

const owner={principal_type:'staff',principal_id:'maya',org_id:'cedar',site_id:'beirut',role:'owner'};
const worker={principal_type:'worker',principal_id:'worker-14',org_id:'cedar',site_id:'beirut'};
const missing={outcome:'clarification',reasons:['missing_asked_fact'],evidence:[]};
const command=()=>({requestId:randomUUID(),dueAt:new Date(Date.now()+3600000).toISOString()});
async function fixture() {
  const db=new PGlite(),pool={async connect(){return {query:async(sql,args)=>args?.length?db.query(sql,args):(await db.exec(sql)).at(-1)??{rows:[]},release(){}};}};
  await runMigrations(pool);
  await db.exec(`INSERT INTO organizations VALUES('cedar','Synthetic');INSERT INTO sites VALUES('beirut','cedar','Synthetic','UTC');
    INSERT INTO staff(id,org_id,site_id,name,role) VALUES('maya','cedar','beirut','Maya','owner'),('other','cedar','beirut','Other','supervisor'),('audit','cedar','beirut','Audit','auditor');
    INSERT INTO workers(id,org_id,site_id,code,language) VALUES('worker-14','cedar','beirut','Worker 014','en'),('worker-2','cedar','beirut','Worker 002','en');
    INSERT INTO briefings(id,org_id,site_id,title,source,state) VALUES('shelf','cedar','beirut','Synthetic','Synthetic','draft');
    INSERT INTO publications(id,org_id,site_id,briefing_id,version,snapshot_json,state) VALUES('shelf-v3','cedar','beirut','shelf',3,
      '{"title":"Synthetic","question":"Where do items go?","facts":["Finished: blue","Unfinished: yellow"],"rubric":{"askedFacts":["Finished: blue","Unfinished: yellow"]},"languages":{"en":{"title":"Synthetic","text":"Finished: blue. Unfinished: yellow.","question":"Where do items go?"},"ar":{"title":"تعليمات الرف","text":"الأزرق مكتمل. الأصفر غير مكتمل.","question":"أين توضع العناصر؟"}}}','published');
    INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,language) VALUES('assignment-14','cedar','beirut','shelf-v3','worker-14','en');`);
  const original=await submitAnswer(pool,worker,'assignment-14',randomUUID(),'Finished: blue');
  await processOneAssessment(pool,{assess:async()=>missing});
  const caseId=(await db.query('SELECT id FROM clarifications')).rows[0].id;
  await db.exec("UPDATE assignments SET due_at=clock_timestamp()-interval '1 hour'");
  return {db,pool,caseId,original,close:()=>db.close(),request:(input,options={})=>requestCaseRepeat(pool,owner,caseId,input,options)};
}
test('repeat admits one new typed receipt after original deadline, preserves original evidence and reassesses without a duplicate case',async()=>{
  const f=await fixture();try {
    const before=(await f.db.query('SELECT * FROM attempts WHERE id=$1',[f.original.id])).rows[0],assignment=(await f.db.query('SELECT * FROM assignments')).rows;
    await assert.rejects(submitAnswer(f.pool,worker,'assignment-14',randomUUID(),'Finished: blue. Unfinished: yellow.'),/deadline/);
    const input=command(),receipt=await f.request(input);assert.equal(receipt.status,'pending');assert.deepEqual(await f.request(input),receipt);
    assert.deepEqual(await caseRepeatReceipt(f.pool,owner,f.caseId,input.requestId),receipt);
    await assert.rejects(f.request({...input,dueAt:new Date(Date.now()+7200000).toISOString()}),/conflict/);
    await assert.rejects(f.request(command()),/already requested/);
    await assert.rejects(caseRepeatReceipt(f.pool,{...owner,principal_id:'other',role:'supervisor'},f.caseId,input.requestId),/unavailable/);
    for(const view of ['todo','followup']){const inbox=await workerBriefings(f.pool,worker,{}, {view});assert.equal(inbox.total,1);assert.equal(inbox.items[0].repeatRequest.id,input.requestId);}
    const detail=await workerBriefing(f.pool,worker,'assignment-14');assert.equal(detail.repeatRequest.id,input.requestId);assert.equal(detail.repeatRequest.message,undefined);assert.equal(detail.outcome,'clarification');assert.equal(JSON.stringify(detail).includes('reasons_json'),false);
    const id=randomUUID(),text='Finished: blue. Unfinished: yellow.',next=await submitAnswer(f.pool,worker,'assignment-14',id,text);assert.equal(next.assessmentStatus,'pending');
    assert.equal((await f.request(input)).status,'submitted');assert.equal((await submitAnswer(f.pool,worker,'assignment-14',id,text)).duplicate,true);
    assert.equal((await workerBriefings(f.pool,worker,{}, {view:'todo'})).total,0);
    await assert.rejects(submitAnswer(f.pool,worker,'assignment-14',randomUUID(),text),/deadline/);
    await processOneAssessment(f.pool,{assess:async()=>({outcome:'matched',reasons:['asked_facts_present'],evidence:[{factIndex:0,quote:'Finished: blue'},{factIndex:1,quote:'Unfinished: yellow'}]})});
    const report=await readPublicationReport(f.pool,owner,{publicationId:'shelf-v3'});assert.equal(report.metrics.assigned,1);assert.equal(report.metrics.responses,1);assert.equal(report.metrics.matches,1);
    assert.deepEqual((await f.db.query('SELECT * FROM attempts WHERE id=$1',[f.original.id])).rows[0],before);
    assert.deepEqual((await f.db.query('SELECT * FROM assignments')).rows,assignment);
    const caseDetail=await getClarification(f.pool,owner,f.caseId);assert.equal(caseDetail.outcome,'clarification');assert.equal(caseDetail.attempts.length,2);assert.equal(caseDetail.status,'open');
    assert.equal((await f.db.query('SELECT count(*)::int n FROM clarifications')).rows[0].n,1);
    await f.request(command());await submitAnswer(f.pool,worker,'assignment-14',randomUUID(),'Still unsure');await processOneAssessment(f.pool,{assess:async()=>missing});
    assert.equal((await f.db.query('SELECT count(*)::int n FROM clarifications')).rows[0].n,1);assert.equal((await listCaseRepeats(f.pool,owner,f.caseId)).length,2);
    await assert.rejects(f.db.exec("UPDATE case_repeats SET due_at=due_at+interval '1 hour'"),/immutable/);
    await assert.rejects(f.db.exec("UPDATE case_repeats SET status='pending',submission_id=NULL,submitted_at=NULL"),/immutable/);
    await assert.rejects(f.db.exec('DELETE FROM case_repeats'),/immutable/);
  } finally {await f.close();}
});
test('check-back sends the frozen worker-language question with an atomic repeat and exact retry stays idempotent',async()=>{
  const f=await fixture();try{
    const input=command(),receipt=await f.request(input,{withQuestion:true}),text='Synthetic\n\nWhere do items go?';
    assert.equal(receipt.status,'pending');
    const messages=(await f.db.query('SELECT * FROM case_messages')).rows;
    assert.equal(messages.length,1);
    assert.deepEqual({id:messages[0].id,case_id:messages[0].case_id,assignment_id:messages[0].assignment_id,actor_type:messages[0].actor_type,actor_id:messages[0].actor_id,language:messages[0].language,text:messages[0].text,request_hash:messages[0].request_hash},
      {id:input.requestId,case_id:f.caseId,assignment_id:'assignment-14',actor_type:'staff',actor_id:'maya',language:'en',text,request_hash:createHash('sha256').update(text).digest('hex')});
    assert.deepEqual(await f.request(input,{withQuestion:true}),receipt);
    assert.equal((await f.db.query('SELECT count(*)::int n FROM case_messages')).rows[0].n,1);
    const detail=await workerBriefing(f.pool,worker,'assignment-14');
    assert.equal(detail.repeatRequest.message,text);
    assert.equal((await workerBriefings(f.pool,worker,{}, {view:'todo'})).items[0].repeatRequest.message,undefined);
    assert.deepEqual((await f.db.query('SELECT kind FROM notification_events WHERE object_id=$1 ORDER BY kind',[input.requestId])).rows.map(row=>row.kind),['clarification.followup','repeat.available']);
    await submitAnswer(f.pool,worker,'assignment-14',randomUUID(),'Finished: blue. Unfinished: yellow.');
    assert.equal((await f.request(input,{withQuestion:true})).status,'submitted');
  }finally{await f.close();}
});
test('check-back uses the assignment language question and fences plain repeats and message failures',async()=>{
  const f=await fixture();try{
    await f.db.exec("INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,language) VALUES('assignment-ar','cedar','beirut','shelf-v3','worker-2','ar')");
    await submitAnswer(f.pool,{...worker,principal_id:'worker-2'},'assignment-ar',randomUUID(),'إجابة أولية');
    await processOneAssessment(f.pool,{assess:async()=>missing});
    const caseAr=(await f.db.query("SELECT id FROM clarifications WHERE assignment_id='assignment-ar'")).rows[0].id;
    await requestCaseRepeat(f.pool,owner,caseAr,command(),{withQuestion:true});
    const message=(await f.db.query('SELECT language,text FROM case_messages WHERE case_id=$1',[caseAr])).rows[0];
    assert.equal(message.language,'ar');assert.equal(message.text,'تعليمات الرف\n\nأين توضع العناصر؟');
    await assert.rejects(requestCaseRepeat(f.pool,owner,caseAr,command(),{withQuestion:true}),/already requested/);
    await resolveClarification(f.pool,owner,caseAr,{notes:'Synthetic check-back closure'});
    await assert.rejects(requestCaseRepeat(f.pool,owner,caseAr,command(),{withQuestion:true}),/unavailable/);
  }finally{await f.close();}
  const g=await fixture();try{
    const plain=command();await g.request(plain);
    await assert.rejects(g.request(plain,{withQuestion:true}),/Repeat request conflict/);
    assert.equal((await g.db.query('SELECT count(*)::int n FROM case_messages')).rows[0].n,0);
  }finally{await g.close();}
  const h=await fixture();try{
    await h.db.exec("INSERT INTO workers(id,org_id,site_id,code,language) VALUES('worker-3','cedar','beirut','Worker 003','en');INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,language) VALUES('assignment-hi','cedar','beirut','shelf-v3','worker-3','hi')");
    await submitAnswer(h.pool,{...worker,principal_id:'worker-3'},'assignment-hi',randomUUID(),'Synthetic answer');
    await processOneAssessment(h.pool,{assess:async()=>missing});
    const caseHi=(await h.db.query("SELECT id FROM clarifications WHERE assignment_id='assignment-hi'")).rows[0].id;
    await assert.rejects(requestCaseRepeat(h.pool,owner,caseHi,command(),{withQuestion:true}),/Check-back question unavailable/);
    assert.equal((await h.db.query("SELECT count(*)::int n FROM case_repeats WHERE assignment_id='assignment-hi'")).rows[0].n,0);
  }finally{await h.close();}
  const j=await fixture();try{
    await j.db.exec("CREATE FUNCTION deny_case_message() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic message failure'; END $$;CREATE TRIGGER deny_case_message BEFORE INSERT ON case_messages FOR EACH ROW EXECUTE FUNCTION deny_case_message()");
    await assert.rejects(j.request(command(),{withQuestion:true}),/Synthetic message failure/);
    assert.equal((await j.db.query('SELECT count(*)::int n FROM case_repeats')).rows[0].n,0);
    assert.equal((await j.db.query('SELECT count(*)::int n FROM case_messages')).rows[0].n,0);
  }finally{await j.close();}
});
test('repeat role, site, worker activation, publication, deadline and prior-answer fences are enforced',async()=>{
  const f=await fixture();try {
    for(const principal of [worker,{...owner,role:'auditor',principal_id:'audit'},{...owner,site_id:'foreign'}])await assert.rejects(requestCaseRepeat(f.pool,principal,f.caseId,command()),/Forbidden|unavailable/);
    for(const dueAt of ['bad',new Date(Date.now()-1000).toISOString(),new Date(Date.now()+31*86400000).toISOString()])await assert.rejects(f.request({...command(),dueAt}),/Invalid repeat/);
    await assert.rejects(f.request({...command(),extra:true}),/Invalid/);
    await f.db.exec("UPDATE workers SET active=false WHERE id='worker-14'");await assert.rejects(f.request(command()),/unavailable/);
    await f.db.exec("UPDATE workers SET active=true WHERE id='worker-14';UPDATE publications SET state='withdrawn'");await assert.rejects(f.request(command()),/unavailable/);
  }finally{await f.close();}
});
test('case closure cancels effective admission and exact command recovery stays readable without reopening it',async()=>{
  const f=await fixture();try {
    const input=command();await f.request(input);await resolveClarification(f.pool,owner,f.caseId,{notes:'Synthetic human resolution'});
    assert.equal((await f.request(input)).id,input.requestId);assert.equal((await workerBriefing(f.pool,worker,'assignment-14')).repeatRequest,undefined);
    assert.equal((await workerBriefings(f.pool,worker,{}, {view:'followup'})).total,0);await assert.rejects(submitAnswer(f.pool,worker,'assignment-14',randomUUID(),'New answer'),/deadline/);
    await assert.rejects(f.request(command()),/unavailable/);
    const second=randomUUID();await requestHelp(f.pool,worker,'assignment-14',{requestId:second,text:'Synthetic new question'});
    await requestCaseRepeat(f.pool,owner,second,command());assert.equal((await caseRepeatReceipt(f.pool,owner,f.caseId,input.requestId)).status,'cancelled');
  }finally{await f.close();}
});
test('repeat receipt acceptance and audit fail atomically',async()=>{
  const f=await fixture();try {
    const input=command();await f.request(input);
    await f.db.exec("CREATE FUNCTION deny_repeat_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='answer.received' THEN RAISE EXCEPTION 'Synthetic audit failure'; END IF; RETURN NEW; END $$;CREATE TRIGGER deny_repeat_audit BEFORE INSERT ON audit FOR EACH ROW EXECUTE FUNCTION deny_repeat_audit()");
    await assert.rejects(submitAnswer(f.pool,worker,'assignment-14',randomUUID(),'New answer'),/audit failure/);
    assert.equal((await f.request(input)).status,'pending');assert.equal((await f.db.query('SELECT count(*)::int n FROM submission_receipts')).rows[0].n,1);
  }finally{await f.close();}
});
test('recording consumes repeat only after private storage, rechecks closure and accepts exact retries without another receipt',async()=>{
  const f=await fixture();try {
    const input=command();await f.request(input);
    const bytes=Buffer.from(encodeWav({duration:1,sampleRate:16000,numberOfChannels:1,getChannelData:()=>new Float32Array(16000).fill(0.2)})),objects=new Map();
    const storage={async save(row,data){assert.equal((await f.request(input)).status,'pending');objects.set(row.id,Buffer.from(data));},async remove(row){objects.delete(row.id);}};
    const id=randomUUID(),receipt=await receiveRecording(f.pool,worker,'assignment-14',id,bytes,storage);assert.equal(receipt.status,'received');assert.equal((await f.request(input)).status,'submitted');
    assert.equal((await receiveRecording(f.pool,worker,'assignment-14',id,bytes,storage)).duplicate,true);
    assert.equal(objects.size,1);assert.equal((await f.db.query('SELECT count(*)::int n FROM submission_receipts')).rows[0].n,2);
    const original=(await f.db.query('SELECT * FROM attempts WHERE id=$1',[f.original.id])).rows[0];
    storage.read=async row=>objects.get(row.id);
    await processOneRecording(f.pool,{transcribe:async()=>({text:'Still unsure about yellow'}),assess:async()=>missing},storage);
    assert.equal((await f.db.query('SELECT status FROM recordings WHERE id=$1',[receipt.id])).rows[0].status,'transcribed');
    assert.equal((await f.db.query('SELECT count(*)::int n FROM clarifications')).rows[0].n,1);
    assert.equal((await f.db.query('SELECT count(*)::int n FROM attempts')).rows[0].n,2);
    assert.deepEqual((await f.db.query('SELECT * FROM attempts WHERE id=$1',[f.original.id])).rows[0],original);
    const next=command();await f.request(next);storage.save=async(row,data)=>{objects.set(row.id,data);await resolveClarification(f.pool,owner,f.caseId,{notes:'Synthetic closure during upload'});};
    await assert.rejects(receiveRecording(f.pool,worker,'assignment-14',randomUUID(),bytes,storage),/not received/);
    assert.equal(objects.size,1);assert.equal((await f.db.query('SELECT count(*)::int n FROM submission_receipts')).rows[0].n,2);
  }finally{await f.close();}
});
test('worker deletion immediately fences a pending repeat without erasing original receipt metadata',async()=>{
  const f=await fixture();try {
    const input=command();await f.request(input);
    await requestWorkerDeletion(f.pool,owner,'worker-14',{requestId:randomUUID(),expectedCode:'Worker 014',reason:'worker_request',confirmed:true});
    await assert.rejects(submitAnswer(f.pool,worker,'assignment-14',randomUUID(),'New answer'),/Forbidden/);
    await assert.rejects(f.request(command()),/unavailable/);assert.equal((await f.db.query('SELECT count(*)::int n FROM submission_receipts')).rows[0].n,1);
  }finally{await f.close();}
});

test('repeat pages include every preserved request and prevent an inert request control before an earlier answer',async()=>{
  const f=await fixture();try{
    const original=(await f.db.query('SELECT * FROM attempts WHERE id=$1',[f.original.id])).rows[0],context='a'.repeat(64);
    for(let n=0;n<13;n++){await f.request(command());await submitAnswer(f.pool,worker,'assignment-14',randomUUID(),'Synthetic deliberate repeat '+n);}
    const active=await f.request(command()),ids=new Set();
    for(let page=1;page<=3;page++){
      const result={...await caseRepeatPage(f.pool,owner,f.caseId,{page,pageSize:5}),clientContext:context};checkedRepeatPage(result,f.caseId,page,5,context);
      assert.equal(result.total,14);assert.equal(result.canRequest,false);assert.equal(result.blockedReason,'active_repeat');
      for(const row of result.items){assert.equal(ids.has(row.id),false);ids.add(row.id);}
    }
    assert.equal(ids.size,14);assert.equal((await caseRepeatPage(f.pool,owner,f.caseId)).items[0].id,active.id);
    assert.deepEqual((await f.db.query('SELECT * FROM attempts WHERE id=$1',[f.original.id])).rows[0],original);
    await f.db.exec("INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,language) VALUES('no-answer','cedar','beirut','shelf-v3','worker-2','en')");
    const id=randomUUID();await requestHelp(f.pool,{...worker,principal_id:'worker-2'},'no-answer',{requestId:id,text:'Synthetic independent help'});
    const independent=await caseRepeatPage(f.pool,owner,id);assert.equal(independent.canRequest,false);assert.equal(independent.blockedReason,'no_answer');
    const audit=await caseRepeatPage(f.pool,{...owner,principal_id:'audit',role:'auditor'},f.caseId);assert.equal(audit.blockedReason,'read_only');
    await resolveClarification(f.pool,owner,f.caseId,{notes:'Synthetic closed repeat case'});assert.equal((await caseRepeatPage(f.pool,owner,f.caseId)).blockedReason,'case_resolved');
    await assert.rejects(caseRepeatPage(f.pool,worker,f.caseId),/Forbidden/);
  }finally{await f.close();}
});


test('approved repeat can finish after the original answer deadline and rejects unauthorized extra answers',async()=>{
 const f=await fixture();try{
  await f.request(command());
  await submitAnswer(f.pool,worker,'assignment-14',randomUUID(),'Finished: blue. Unfinished: yellow.');
  await processOneAssessment(f.pool,{assess:async()=>({outcome:'matched',reasons:['asked_facts_present'],evidence:[{factIndex:0,quote:'Finished: blue'},{factIndex:1,quote:'Unfinished: yellow'}]})});
  await resolveClarification(f.pool,owner,f.caseId,{notes:'[Understood:ready]\nExplained; worker can continue.'});
  const item=(await postgresWorkspace(f.pool,worker,'work',{assignmentId:'assignment-14'})).item;
  assert.equal(item.canComplete,true);
  assert.equal((await postgresWorkspace(f.pool,worker,'work',{complete:'assignment-14'})).status,'done');
  await f.db.exec("UPDATE assignments SET due_at=clock_timestamp()+interval '1 hour'");
  await assert.rejects(submitAnswer(f.pool,worker,'assignment-14',randomUUID(),'Another answer'),/approved repeat/);
 }finally{await f.close();}
});

test('exhausted checks remain received, show failed instead of pending, and retain an open follow-up',async()=>{
 const f=await fixture();try{
  await f.request(command());const requestId=randomUUID();
  await submitAnswer(f.pool,worker,'assignment-14',requestId,'Answer awaiting a provider check');
  for(let n=0;n<3;n++){await f.db.exec("UPDATE assessment_jobs SET due_at=clock_timestamp()-interval '1 second' WHERE status='queued'");await processOneAssessment(f.pool,{assess:async()=>{throw Error('Synthetic unavailable provider');}});}
  assert.equal((await workerBriefing(f.pool,worker,'assignment-14')).assessmentStatus,'failed');
  assert.equal((await workerSubmission(f.pool,worker,'assignment-14',requestId)).receipt.assessmentFailed,true);
  assert.equal((await f.db.query("SELECT count(*)::int n FROM clarifications WHERE status='open'")).rows[0].n,1);
 }finally{await f.close();}
});

test('help after a wrong answer joins the active conversation and exact retries do not duplicate messages',async()=>{
 const f=await fixture();try{
  const input={requestId:randomUUID(),text:'Please explain the shelf colours.'};
  const receipt=await requestHelp(f.pool,worker,'assignment-14',input);
  assert.equal(receipt.id,input.requestId);assert.equal((await requestHelp(f.pool,worker,'assignment-14',input)).duplicate,true);
  assert.equal((await f.db.query('SELECT count(*)::int n FROM clarifications')).rows[0].n,1);
  const messages=(await f.db.query('SELECT case_id,text FROM case_messages')).rows;
  assert.equal(messages.length,1);assert.equal(messages[0].case_id,f.caseId);assert.equal(messages[0].text,input.text);
  await assert.rejects(requestHelp(f.pool,worker,'assignment-14',{...input,text:'Different text'}),/conflict/);
 }finally{await f.close();}
});
