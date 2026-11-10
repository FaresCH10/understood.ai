import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {provisionStaffCredential} from '../server/postgres/auth.mjs';
import {createPostgresRehearsalServer} from '../server/postgres/http.mjs';
import {submitAnswer} from '../server/postgres/domain.mjs';
import {processOneAssessment} from '../server/postgres/assessment-worker.mjs';
import {requestHelp} from '../server/postgres/clarifications.mjs';
import {checkedRepeatPage,checkedRepeatReceipt,checkedReviewPage,checkedReviewReceipt} from '../src/case-workflow-contract.ts';
import {retainCaseRepeat,retainCaseReview,clearCaseReview} from '../src/case-workflow-recovery.ts';
import {retainCreation,checkedCreationSubjects,checkedCreationSubject,checkedCreationReceipt} from '../src/clarification-create.ts';
import {checkedCaseTimeline} from '../src/case-timeline.ts';

test('PostgreSQL workflow HTTP pages and receipts enforce captured context, exact intent and current case capabilities',async()=>{
  const db=new PGlite(),schema='understood_test_case_workflow_http',options={schema};
  const pool={async connect(){return {query:async(sql,args)=>args?.length?db.query(sql,args):(await db.exec(sql)).at(-1)||{rows:[]},release(){}};}};
  let server;
  try{
    await db.exec(`CREATE SCHEMA ${schema};SET search_path TO ${schema},pg_catalog`);await runMigrations(pool,options);
    await db.exec(`INSERT INTO organizations VALUES('qa','Synthetic workflow');INSERT INTO sites VALUES('qa','qa','Synthetic site','Asia/Beirut');
      INSERT INTO staff(id,org_id,site_id,name,role) VALUES('owner','qa','qa','Synthetic owner','owner'),('other','qa','qa','Synthetic supervisor','supervisor');
      INSERT INTO workers(id,org_id,site_id,code,language) VALUES('worker','qa','qa','Worker 014','en'),('help-worker','qa','qa','Worker 021','en');
      INSERT INTO briefings(id,org_id,site_id,title,source,state) VALUES('brief','qa','qa','Synthetic','Finished blue. Unfinished yellow.','draft');
      INSERT INTO publications(id,org_id,site_id,briefing_id,version,snapshot_json,state) VALUES('publication','qa','qa','brief',3,'{"title":"Synthetic","question":"Where?","facts":["Finished blue","Unfinished yellow"],"rubric":{"askedFacts":["Finished blue","Unfinished yellow"]},"languages":{"en":{"text":"Finished blue. Unfinished yellow.","question":"Where?"}}}','published');
      INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,language) VALUES('assignment','qa','qa','publication','worker','en'),('help-assignment','qa','qa','publication','help-worker','en');`);
    const worker={principal_type:'worker',principal_id:'worker',org_id:'qa',site_id:'qa'};
    await submitAnswer(pool,worker,'assignment',randomUUID(),'Finished blue.',options);
    await processOneAssessment(pool,{assess:async()=>({outcome:'clarification',reasons:['missing_asked_fact'],evidence:[]})},options);
    const caseId=(await db.query('SELECT id FROM clarifications')).rows[0].id,helpId=randomUUID();
    await requestHelp(pool,{...worker,principal_id:'help-worker'},'help-assignment',{requestId:helpId,text:'Synthetic independent help'},options);
    const original=JSON.stringify((await db.query('SELECT * FROM attempts ORDER BY id')).rows);
    for(const staffId of ['owner','other'])await provisionStaffCredential(pool,{staffId,orgId:'qa',siteId:'qa',email:staffId+'@qa.example.test',password:'Synthetic workflow password'},options);
    const origin='http://127.0.0.1:3031';server=createPostgresRehearsalServer(pool,{...options,tier:'local',dataClass:'synthetic',aiMode:'synthetic',accessMode:'credential',publicOrigin:origin});
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const base=`http://127.0.0.1:${server.address().port}/api`,call=(path,cookie,context,body)=>fetch(base+path,{method:body===undefined?'GET':'POST',headers:{origin,...(cookie?{cookie}:{}),...(context===undefined?{}:{'x-client-session-context':context}),...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
    const login=async id=>{const response=await call('/auth/staff/login',null,undefined,{email:id+'@qa.example.test',password:'Synthetic workflow password'});assert.equal(response.status,200);const cookie=response.headers.get('set-cookie').split(';')[0],session=await (await call('/session',cookie)).json();return {cookie,session};};
    const owner=await login('owner'),other=await login('other'),context=owner.session.clientContext,path=`/clarifications/${caseId}`;
    const timelineResponse=await call(path+'/timeline?page=1&pageSize=10',owner.cookie,context),timeline=checkedCaseTimeline(await timelineResponse.json(),caseId,1,context);
    assert.equal(timelineResponse.status,200);assert.equal(timelineResponse.headers.get('cache-control'),'no-store');assert.ok(timeline.items.some(row=>row.kind==='assessment_recorded'));
    assert.equal((await call(path+'/timeline')).status,401);assert.equal((await call(path+'/timeline',owner.cookie)).status,409);assert.equal((await call(path+'/timeline',owner.cookie,'f'.repeat(64))).status,409);
    for(const query of ['?page=1&page=2','?pageSize=50','?org_id=foreign'])assert.equal((await call(path+'/timeline'+query,owner.cookie,context)).status,400);
    for(const endpoint of ['/repeats?page=1&pageSize=10','/reviews?page=1&pageSize=10','/repeats/'+randomUUID(),'/reviews/'+randomUUID()]){
      assert.equal((await call(path+endpoint)).status,401);assert.equal((await call(path+endpoint,owner.cookie)).status,409);assert.equal((await call(path+endpoint,owner.cookie,'f'.repeat(64))).status,409);
    }
    const repeatResponse=await call(path+'/repeats?page=1&pageSize=10',owner.cookie,context),repeatPage=checkedRepeatPage(await repeatResponse.json(),caseId,1,10,context);assert.equal(repeatPage.canRequest,true);assert.equal(repeatResponse.headers.get('cache-control'),'no-store');
    const independent=checkedRepeatPage(await (await call(`/clarifications/${helpId}/repeats?page=1&pageSize=10`,owner.cookie,context)).json(),helpId,1,10,context);assert.equal(independent.blockedReason,'no_answer');
    const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)},dueAt=new Date(Date.now()+3600000).toISOString();
    const repeat=retainCaseRepeat(storage,owner.session,caseId,dueAt,()=>true),body={requestId:repeat.id,dueAt};
    const accepted=checkedRepeatReceipt(await (await call(path+'/repeats',owner.cookie,context,body)).json(),caseId,repeat,context);assert.equal(accepted.status,'pending');
    assert.deepEqual(checkedRepeatReceipt(await (await call(path+'/repeats/'+repeat.id,owner.cookie,context)).json(),caseId,repeat,context),accepted);
    assert.equal((await call(path+'/repeats/'+repeat.id,other.cookie,other.session.clientContext)).status,404);
    const blocked=checkedRepeatPage(await (await call(path+'/repeats?page=1&pageSize=10',owner.cookie,context)).json(),caseId,1,10,context);assert.equal(blocked.blockedReason,'active_repeat');
    const reviewPage=checkedReviewPage(await (await call(path+'/reviews?page=1&pageSize=10',owner.cookie,context)).json(),caseId,1,10,context);assert.equal(reviewPage.canDisagree,true);
    const content={kind:'disagree',reason:'Synthetic private HTTP disagreement'},pending=await retainCaseReview(storage,owner.session,caseId,content,()=>true);
    const saved=await checkedReviewReceipt(await (await call(path+'/reviews',owner.cookie,context,{requestId:pending.id,...content})).json(),caseId,pending,context);assert.equal(saved.reason,content.reason);
    const recovered=await checkedReviewReceipt(await (await call(path+'/reviews/'+pending.id,owner.cookie,context)).json(),caseId,pending,context);assert.deepEqual(recovered,saved);clearCaseReview(storage,owner.session,caseId,pending);
    assert.equal((await call(path+'/reviews/'+pending.id,other.cookie,other.session.clientContext)).status,404);
    for(const endpoint of ['/reviews?page=1&page=2','/repeats?pageSize=100','/reviews?org_id=foreign','/repeats/'+repeat.id+'?x=1','/reviews/'+pending.id+'?x=1'])assert.equal((await call(path+endpoint,owner.cookie,context)).status,400,endpoint);
    assert.equal(Array.isArray(await (await call(path+'/reviews',owner.cookie,context)).json()),true);
    assert.equal(JSON.stringify((await db.query('SELECT * FROM attempts ORDER BY id')).rows),original);
    assert.equal((await db.query('SELECT count(*)::int n FROM submission_receipts')).rows[0].n,1);assert.equal((await db.query('SELECT count(*)::int n FROM case_repeats')).rows[0].n,1);assert.equal((await db.query('SELECT count(*)::int n FROM case_reviews')).rows[0].n,1);
    for(const endpoint of ['/clarification-creations/subjects','/clarification-creations/subjects/assignment','/clarification-creations/'+randomUUID()]){
      assert.equal((await call(endpoint)).status,401);assert.equal((await call(endpoint,owner.cookie)).status,409);assert.equal((await call(endpoint,owner.cookie,'f'.repeat(64))).status,409);
    }
    const creationSubjects=checkedCreationSubjects(await (await call('/clarification-creations/subjects',owner.cookie,context)).json(),1,'',context);assert.equal(creationSubjects.total,2);
    const creationSubject=checkedCreationSubject(await (await call('/clarification-creations/subjects/assignment',owner.cookie,context)).json(),'assignment',context);assert.equal(creationSubject.latestAttempt.existingCaseId,caseId);
    const creationContent={assignmentId:'assignment',publicationId:'publication',version:3,attemptId:null,reason:'Synthetic private HTTP staff follow-up'},creationPending=await retainCreation(storage,owner.session,creationContent,()=>true),creationBody={requestId:creationPending.id,...creationContent};
    assert.equal((await call('/clarification-creations',owner.cookie,undefined,creationBody)).status,409);
    const creationResponse=await call('/clarification-creations',owner.cookie,context,creationBody);assert.equal(creationResponse.status,200);
    const creation=await checkedCreationReceipt(await creationResponse.json(),creationPending,owner.session);assert.equal(creation.attemptId,null);
    assert.deepEqual(await checkedCreationReceipt(await (await call('/clarification-creations/'+creationPending.id,owner.cookie,context)).json(),creationPending,owner.session),creation);
    assert.equal((await call('/clarification-creations/'+creationPending.id,other.cookie,other.session.clientContext)).status,404);
    assert.equal((await call('/clarification-creations',owner.cookie,context,{...creationBody,reason:'Different private intent'})).status,409);
    for(const endpoint of ['/clarification-creations/subjects?page=1&page=2','/clarification-creations/subjects?org_id=foreign','/clarification-creations/subjects/assignment?x=1','/clarification-creations/'+creationPending.id+'?x=1'])assert.equal((await call(endpoint,owner.cookie,context)).status,400,endpoint);
    assert.equal(JSON.stringify((await db.query('SELECT * FROM attempts ORDER BY id')).rows),original);
    assert.equal((await db.query('SELECT count(*)::int n FROM help_requests')).rows[0].n,1);
    assert.equal((await db.query('SELECT count(*)::int n FROM case_messages')).rows[0].n,0);
  }finally{if(server)await new Promise(resolve=>server.close(resolve));await db.close();}
});

test('check-back HTTP route sends the frozen worker-language question once and fences methods, input and context',async()=>{
  const db=new PGlite(),schema='understood_test_case_workflow_http_checkback',options={schema};
  const pool={async connect(){return {query:async(sql,args)=>args?.length?db.query(sql,args):(await db.exec(sql)).at(-1)||{rows:[]},release(){}};}};
  let server;
  try{
    await db.exec(`CREATE SCHEMA ${schema};SET search_path TO ${schema},pg_catalog`);await runMigrations(pool,options);
    await db.exec(`INSERT INTO organizations VALUES('qa','Synthetic check-back');INSERT INTO sites VALUES('qa','qa','Synthetic site','Asia/Beirut');
      INSERT INTO staff(id,org_id,site_id,name,role) VALUES('owner','qa','qa','Synthetic owner','owner');
      INSERT INTO workers(id,org_id,site_id,code,language) VALUES('worker','qa','qa','Worker 014','en');
      INSERT INTO briefings(id,org_id,site_id,title,source,state) VALUES('brief','qa','qa','Synthetic','Finished blue. Unfinished yellow.','draft');
      INSERT INTO publications(id,org_id,site_id,briefing_id,version,snapshot_json,state) VALUES('publication','qa','qa','brief',3,'{"title":"Synthetic","question":"Where?","facts":["Finished blue","Unfinished yellow"],"rubric":{"askedFacts":["Finished blue","Unfinished yellow"]},"languages":{"en":{"title":"Synthetic shelf","text":"Finished blue. Unfinished yellow.","question":"Where do items go?"}}}','published');
      INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,language) VALUES('assignment','qa','qa','publication','worker','en');`);
    const worker={principal_type:'worker',principal_id:'worker',org_id:'qa',site_id:'qa'};
    await submitAnswer(pool,worker,'assignment',randomUUID(),'Finished blue.',options);
    await processOneAssessment(pool,{assess:async()=>({outcome:'clarification',reasons:['missing_asked_fact'],evidence:[]})},options);
    const caseId=(await db.query('SELECT id FROM clarifications')).rows[0].id,original=JSON.stringify((await db.query('SELECT * FROM attempts ORDER BY id')).rows);
    await provisionStaffCredential(pool,{staffId:'owner',orgId:'qa',siteId:'qa',email:'owner@qa.example.test',password:'Synthetic check-back password'},options);
    const origin='http://127.0.0.1:3031';server=createPostgresRehearsalServer(pool,{...options,tier:'local',dataClass:'synthetic',aiMode:'synthetic',accessMode:'credential',publicOrigin:origin});
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const base=`http://127.0.0.1:${server.address().port}/api`,call=(path,cookie,context,body)=>fetch(base+path,{method:body===undefined?'GET':'POST',headers:{origin,...(cookie?{cookie}:{}),...(context===undefined?{}:{'x-client-session-context':context}),...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
    const login=await call('/auth/staff/login',null,undefined,{email:'owner@qa.example.test',password:'Synthetic check-back password'});assert.equal(login.status,200);
    const cookie=login.headers.get('set-cookie').split(';')[0],session=await (await call('/session',cookie)).json(),context=session.clientContext;
    const path=`/clarifications/${caseId}/question-repeat`,requestId=randomUUID(),dueAt=new Date(Date.now()+3600000).toISOString(),body={requestId,dueAt};
    assert.equal((await call(path,undefined,undefined,body)).status,401);assert.equal((await call(path,cookie)).status,409);assert.equal((await call(path,cookie,'f'.repeat(64))).status,409);
    assert.equal((await call(path,cookie,undefined,body)).status,409);assert.equal((await call(path,cookie,context)).status,400);assert.equal((await call(path+'?x=1',cookie,context,body)).status,400);
    for(const input of [{...body,extra:true},{...body,dueAt:'bad'},{...body,requestId:'bad'}])assert.equal((await call(path,cookie,context,input)).status,400);
    assert.equal((await call(`/clarifications/${randomUUID()}/question-repeat`,cookie,context,body)).status,404);
    const accepted=await call(path,cookie,context,body);assert.equal(accepted.status,200);assert.equal(accepted.headers.get('cache-control'),'no-store');
    const receipt=checkedRepeatReceipt(await accepted.json(),caseId,{id:requestId,dueAt},context);assert.equal(receipt.status,'pending');
    const message=(await db.query('SELECT * FROM case_messages')).rows[0];
    assert.equal(message.text,'Synthetic shelf\n\nWhere do items go?');assert.equal(message.language,'en');assert.equal(message.actor_type,'staff');assert.equal(message.actor_id,'owner');
    assert.deepEqual((await db.query('SELECT status,actor_role FROM case_repeats')).rows[0],{status:'pending',actor_role:'owner'});
    assert.deepEqual(checkedRepeatReceipt(await (await call(path,cookie,context,body)).json(),caseId,{id:requestId,dueAt},context),receipt);
    assert.equal((await call(path,cookie,context,{requestId:randomUUID(),dueAt})).status,409);
    assert.equal((await db.query('SELECT count(*)::int n FROM case_messages')).rows[0].n,1);assert.equal((await db.query('SELECT count(*)::int n FROM case_repeats')).rows[0].n,1);
    assert.deepEqual((await db.query("SELECT kind FROM notification_events WHERE audience='worker' ORDER BY kind")).rows.map(row=>row.kind),['clarification.followup','repeat.available']);
    assert.equal((await db.query('SELECT count(*)::int n FROM audit WHERE action=\'clarification.message\'')).rows[0].n,1);
    assert.equal(JSON.stringify((await db.query('SELECT * FROM attempts ORDER BY id')).rows),original);
  }finally{if(server)await new Promise(resolve=>server.close(resolve));await db.close();}
});
