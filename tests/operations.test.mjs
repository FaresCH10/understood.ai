import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {provisionOperator,authenticateOperator,operatorSession,requireOperator,revokeOperator} from '../server/postgres/operators.mjs';
import {saveOperatorControl,operationsOverview,operationsTenants,operationsAudit,operatorReceipt,operationsJobs,retryOperationsJob} from '../server/postgres/operations.mjs';
import {provisionStaffCredential,authenticateStaff,requireSession,issueWorkerGrant,redeemWorkerGrant} from '../server/postgres/auth.mjs';
import {domainTransaction,requirePrincipal,publish,submitAnswer} from '../server/postgres/domain.mjs';
import {requestExport} from '../server/postgres/exports.mjs';
import {processOnePreparation} from '../server/postgres/preparation.mjs';
import {legacyWrittenQuestion} from './helpers/legacy-written-question.mjs';
import {dispatchAllowed} from '../server/postgres/operations-gates.mjs';
import {CANONICAL_SOURCE} from '../server/domain.mjs';
import {createPostgresRehearsalServer} from '../server/postgres/http.mjs';
import {recordWorkerHealth} from '../server/postgres/worker-health.mjs';
import {runRehearsalWorker} from '../server/postgres/runtime.mjs';
const password='Synthetic-operator-test-2026';
async function fixture(schema='public') {
  const db=new PGlite(),pool={async connect(){return {query:async(sql,values)=>values?.length?db.query(sql,values):(await db.exec(sql)).at(-1)??{rows:[]},release(){}};}};
  if(schema!=='public')await db.exec(`CREATE SCHEMA "${schema}"`);await runMigrations(pool,{schema});
  const run=fn=>domainTransaction(pool,schema,fn);
  await run(client=>client.query("INSERT INTO organizations VALUES('cedar','Cedar Works'),('other','Other Works');INSERT INTO sites VALUES('beirut','cedar','Beirut','Asia/Beirut'),('other-site','other','Other site','UTC');INSERT INTO staff(id,org_id,site_id,name,role) VALUES('maya','cedar','beirut','Maya','owner');INSERT INTO workers(id,org_id,site_id,code,language) VALUES('worker-1','cedar','beirut','Worker 001','en');"));
  const options={schema},id=randomUUID();await provisionOperator(pool,{id,email:'operator@example.test',name:'Operator',password},options);
  const login=await authenticateOperator(pool,{email:'operator@example.test',password},'local',options);
  return {db,pool,run,options,login,identity:login.session,async close(){await db.close();}};
}
const tenantCommand=(revision,state)=>({requestId:randomUUID(),kind:'tenant',orgId:'cedar',revision,state,reason:'pilot_review',confirmed:true});
test('separate operator identity, audited exact replay, scoped metadata and enforced tenant suspension',async()=>{
  const f=await fixture();const {pool,options,identity,run}=f;
  try {
    await provisionStaffCredential(pool,{staffId:'maya',orgId:'cedar',siteId:'beirut',email:'maya@example.test',password},options);
    const customer=await authenticateStaff(pool,'maya@example.test',password,'customer',options),customerReq={headers:{cookie:`understood_session=${customer.session.token}`}};
    const principal={...customer.principal,principal_type:'staff',principal_id:'maya',role:'owner',access_mode:'credential'};
    assert.equal((await requireSession(pool,customerReq,options)).principal_id,'maya');
    await assert.rejects(requireOperator(pool,customerReq,options),/Operator sign in required/);
    await assert.rejects(operationsOverview(pool,principal,options),/Operator sign in required/);
    await assert.rejects(authenticateOperator(pool,{email:'maya@example.test',password},'separate',options),/Invalid credentials/);
    const grant=await issueWorkerGrant(pool,principal,'worker-1',240,options),command=tenantCommand(0,'suspended');
    assert.equal((await saveOperatorControl(pool,identity,command,options)).state,'suspended');
    assert.equal((await saveOperatorControl(pool,identity,command,options)).duplicate,true);
    await assert.rejects(saveOperatorControl(pool,identity,{...command,state:'active'},options),/conflict/);
    await assert.rejects(saveOperatorControl(pool,identity,tenantCommand(0,'active'),options),/revision/);
    assert.equal((await operatorReceipt(pool,identity,command.requestId,options)).found,true);
    await assert.rejects(requireSession(pool,customerReq,options),/Sign in required/);
    await assert.rejects(authenticateStaff(pool,'maya@example.test',password,'customer',options),/Invalid credentials/);
    await assert.rejects(redeemWorkerGrant(pool,grant.token,options),/Workspace access paused/);
    await assert.rejects(run(client=>requirePrincipal(client,principal,'staff')),/Workspace access paused/);
    assert.equal(await run(client=>dispatchAllowed(client,'cedar')),false);
    assert.equal(await run(client=>dispatchAllowed(client,'other')),true);
    const tenants=await operationsTenants(pool,identity,{state:'suspended'},options);assert.equal(tenants.total,1);assert.equal(tenants.items[0].id,'cedar');
    const overview=await operationsOverview(pool,identity,options);assert.equal(overview.tenants.suspended,1);assert.equal(overview.readiness.liveAI,'unverified');
    assert.doesNotMatch(JSON.stringify(overview),/password|answer_text|rubric|token_hash/);
    await assert.rejects(run(client=>client.query('DELETE FROM operator_audit')),/append-only/);
    await saveOperatorControl(pool,identity,tenantCommand(1,'active'),options);
    await assert.rejects(requireSession(pool,customerReq,options),/Sign in required/);
    assert.equal((await redeemWorkerGrant(pool,grant.token,options)).workerId,'worker-1');
    assert.equal((await operationsAudit(pool,identity,{},options)).items.filter(row=>row.action.startsWith('tenant.')).length,2);
    const second=await authenticateOperator(pool,{email:'operator@example.test',password},'local',options);
    await assert.rejects(operationsOverview(pool,identity,options),/Operator sign in required/);
    await revokeOperator(pool,second.session,options);await assert.rejects(operationsOverview(pool,second.session,options),/Operator sign in required/);
  }finally{await f.close();}
});
test('operator dispatch controls stop claims and fence completion without failing the draft',async()=>{
  const f=await fixture(),{pool,run,options,identity}=f;
  try {
    await run(async client=>{await client.query("INSERT INTO briefings(id,org_id,site_id,title,source,state) VALUES('shelf','cedar','beirut','Shelf',$1,'processing')",[CANONICAL_SOURCE]);await client.query("INSERT INTO jobs(id,org_id,site_id,briefing_id,revision,kind,status,due_at) VALUES('job-1','cedar','beirut','shelf',1,'prepare','queued',clock_timestamp())");});
    const system=(revision,jobsPaused,providerPaused)=>({requestId:randomUUID(),kind:'system',revision,jobsPaused,providerPaused,confirmed:true});
    await saveOperatorControl(pool,identity,system(0,false,true),options);
    assert.equal(await processOnePreparation(pool,{...options,integrationMode:'synthetic'}),false);
    assert.equal((await run(client=>client.query("SELECT attempts FROM jobs WHERE id='job-1'"))).rows[0].attempts,0);
    await saveOperatorControl(pool,identity,system(1,false,false),options);
    const {syntheticPrepare}=await import('../server/domain.mjs');
    assert.equal(await processOnePreparation(pool,{...options,integrationMode:'synthetic',prepare:async source=>{await saveOperatorControl(pool,identity,system(2,true,false),options);return syntheticPrepare(source);}}),true);
    const held=(await run(client=>client.query("SELECT state,prepared_json FROM briefings WHERE id='shelf'"))).rows[0];assert.equal(held.state,'processing');assert.equal(held.prepared_json,null);
    await saveOperatorControl(pool,identity,system(3,false,false),options);await run(client=>client.query("UPDATE jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id='job-1'"));
    assert.equal(await processOnePreparation(pool,{...options,integrationMode:'synthetic'}),true);
    assert.equal((await run(client=>client.query("SELECT state FROM briefings WHERE id='shelf'"))).rows[0].state,'ready');
  }finally{await f.close();}
});
test('operator HTTP requires a separate session, exact context and same-origin mutation',async()=>{
  const f=await fixture('understood_test_ops'),origin='http://127.0.0.1:3020';let server;
  try {
    server=createPostgresRehearsalServer(f.pool,{...f.options,operatorAccess:true,dataClass:'synthetic',tier:'local',aiMode:'synthetic',accessMode:'credential',publicOrigin:origin});
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const base=`http://127.0.0.1:${server.address().port}/api/ops`;
    assert.equal((await fetch(`${base}/overview`)).status,401);
    const login=await fetch(`${base}/login`,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({email:'operator@example.test',password})});assert.equal(login.status,200);
    const session=await login.json(),cookie=login.headers.get('set-cookie').split(';')[0],headers={cookie,'x-operator-context':session.clientContext,origin,'content-type':'application/json'};
    assert.equal(session.clientContext.length,64);assert.equal((await fetch(`${base}/overview`,{headers:{cookie}})).status,409);
    assert.equal((await fetch(`${base}/overview`,{headers})).status,200);
    const provider=await (await fetch(`${base}/providers`,{headers})).json();assert.equal(provider.global.enabled,false);assert.equal(provider.productionReady,false);
    assert.equal((await fetch(`${base}/providers?secret=invalid`,{headers})).status,400);
    const quota={requestId:randomUUID(),kind:'provider-policy',orgId:null,revision:0,enabled:true,maxDailyRequests:5,confirmed:true};
    assert.equal((await fetch(`${base}/providers/policy`,{method:'POST',headers:{...headers,origin:'https://forged.example'},body:JSON.stringify(quota)})).status,403);
    assert.equal((await fetch(`${base}/providers/policy`,{method:'POST',headers,body:JSON.stringify(quota)})).status,200);
    assert.equal((await (await fetch(`${base}/receipts/${quota.requestId}`,{headers})).json()).result.maxDailyRequests,5);
    assert.equal((await fetch(`${base}/providers/verify`,{method:'POST',headers,body:JSON.stringify({requestId:randomUUID(),kind:'provider-verification',maxRequests:1,confirmed:true})})).status,409);
    assert.equal((await fetch(`${base}/controls`,{method:'POST',headers:{...headers,origin:'https://forged.example'},body:JSON.stringify(tenantCommand(0,'suspended'))})).status,403);
    const body=tenantCommand(0,'suspended');assert.equal((await fetch(`${base}/controls`,{method:'POST',headers,body:JSON.stringify(body)})).status,200);
    const receipt=await (await fetch(`${base}/receipts/${body.requestId}`,{headers})).json();assert.equal(receipt.found,true);assert.equal(receipt.clientContext,session.clientContext);
    assert.equal((await fetch(`${base}/audit?search=ignored`,{headers})).status,400);
    assert.equal((await fetch(`${base}/logout`,{method:'POST',headers,body:'{}'})).status,200);assert.equal((await fetch(`${base}/overview`,{headers})).status,401);
  }finally{if(server)await new Promise(resolve=>server.close(resolve));await f.close();}
});
test('operator retries preserve job identity, receipts and publications without exposing private content',async()=>{
  const f=await fixture(),{pool,run,options,identity}=f,owner={org_id:'cedar',site_id:'beirut',principal_type:'staff',principal_id:'maya',role:'owner'};
  try {
    await run(async client=>{await client.query("INSERT INTO briefings(id,org_id,site_id,title,source,state) VALUES('shelf','cedar','beirut','Shelf',$1,'failed')",[CANONICAL_SOURCE]);await client.query("INSERT INTO jobs(id,org_id,site_id,briefing_id,revision,kind,status,attempts,due_at) VALUES('failed-job','cedar','beirut','shelf',1,'prepare','failed',3,clock_timestamp())");});
    const input={requestId:randomUUID(),kind:'preparation',jobId:'failed-job',attempts:3,confirmed:true};
    const queued=await retryOperationsJob(pool,identity,input,options);assert.equal(queued.status,'queued');
    assert.equal((await retryOperationsJob(pool,identity,input,options)).duplicate,true);
    await assert.rejects(retryOperationsJob(pool,identity,{...input,requestId:randomUUID()},options),/not retryable/);
    assert.equal((await operatorReceipt(pool,identity,input.requestId,options)).result.jobId,'failed-job');
    await processOnePreparation(pool,{...options,integrationMode:'synthetic'});
    await legacyWrittenQuestion(pool,'shelf',options);
    const publication=await publish(pool,owner,'shelf',{requestId:randomUUID(),revision:1,nextVersion:1,workerIds:['worker-1'],dueAt:null},{...options,integrationMode:'synthetic'});
    assert.equal((await retryOperationsJob(pool,identity,input,options)).duplicate,true);
    assert.equal((await run(client=>client.query("SELECT status FROM jobs WHERE id='failed-job'"))).rows[0].status,'ready');
    const assignment=(await run(client=>client.query('SELECT id FROM assignments WHERE publication_id=$1',[publication.id]))).rows[0];
    await submitAnswer(pool,{org_id:'cedar',site_id:'beirut',principal_type:'worker',principal_id:'worker-1'},assignment.id,randomUUID(),'Private worker answer',options);
    const assessment=(await run(async client=>(await client.query("UPDATE assessment_jobs SET status='failed',attempts=3 RETURNING id")).rows[0]));
    await retryOperationsJob(pool,identity,{requestId:randomUUID(),kind:'assessment',jobId:assessment.id,attempts:3,confirmed:true},options);
    const exportRow=await requestExport(pool,owner,{requestId:randomUUID(),publicationId:publication.id},options);
    await run(client=>client.query("UPDATE report_exports SET status='failed',attempts=1 WHERE id=$1",[exportRow.id]));
    await retryOperationsJob(pool,identity,{requestId:randomUUID(),kind:'export',jobId:exportRow.id,attempts:1,confirmed:true},options);
    const jobs=await operationsJobs(pool,identity,{},options);assert.equal(jobs.total,3);assert.doesNotMatch(JSON.stringify(jobs),/Private worker answer|snapshot_json|answer_text|rubric/);
    await assert.rejects(async()=>retryOperationsJob(pool,identity,{...input,requestId:randomUUID(),kind:'source'},options),/Invalid operator command/);
    assert.equal((await run(client=>client.query('SELECT COUNT(*)::int n FROM publications'))).rows[0].n,1);
  }finally{await f.close();}
});
test('worker health reflects persisted observations, redacted stage failures and graceful stop',async()=>{
  const f=await fixture(),{pool,run,options,identity}=f;
  try {
    assert.equal((await operationsOverview(pool,identity,options)).readiness.worker,'unverified');
    const id=randomUUID();await recordWorkerHealth(pool,id,{state:'busy',stage:'assessment'},options);
    assert.equal((await operationsOverview(pool,identity,options)).readiness.worker,'responding');
    await recordWorkerHealth(pool,id,{state:'idle',failures:['assessment']},options);
    const degraded=await operationsOverview(pool,identity,options);assert.equal(degraded.readiness.worker,'degraded');assert.deepEqual(degraded.workerHealth.items[0].failureStages,['assessment']);
    await run(client=>client.query("UPDATE worker_health SET seen_at=clock_timestamp()-interval '6 minutes' WHERE id=$1",[id]));
    assert.equal((await operationsOverview(pool,identity,options)).readiness.worker,'not recently observed');
    assert.throws(()=>recordWorkerHealth(pool,id,{state:'idle',failures:['private provider response: password']},options),/Invalid worker health/);
    await run(client=>client.query('DELETE FROM worker_health'));
    const stop=new AbortController(),timer=setTimeout(()=>stop.abort(),50);
    try{await runRehearsalWorker(pool,{},options,{signal:stop.signal,intervalMs:10});}finally{clearTimeout(timer);}
    const workers=(await operationsOverview(pool,identity,options)).workerHealth.items;assert.equal(workers.length,1);assert.equal(workers[0].state,'stopped');
  }finally{await f.close();}
});
