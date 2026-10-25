import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {configureRuntimePermissions,verifyRuntimePermissions,fenceSourceRuntime} from '../server/postgres/runtime-permissions.mjs';
import {provisionOperator,authenticateOperator,revokeOperator} from '../server/postgres/operators.mjs';
import {saveProviderPolicy,runProviderVerification,readProviderControls} from '../server/postgres/provider-controls.mjs';
import {operatorReceipt,saveOperatorControl} from '../server/postgres/operations.mjs';
import {resolveProviderVerification} from '../server/ai/provider-verification-config.mjs';
import {providerVerificationDescriptor} from '../server/ai/verification-descriptor.mjs';
import {processOneProviderVerification} from '../server/postgres/provider-verification-worker.mjs';
import {syntheticPrepare,CANONICAL_SOURCE} from '../server/domain.mjs';
import {STAGE_FIXTURE_VERSION} from '../server/ai/provider-stage-verification.mjs';
import {providerRequestJournal} from '../server/postgres/provider-budget.mjs';
import {currentVerificationAuthority} from '../server/postgres/verification-authority.mjs';
import {domainTransaction} from '../server/postgres/domain.mjs';
import {rehearsalTasks,runWorkerCycle,runRehearsalWorker} from '../server/postgres/runtime.mjs';
import {verificationJobUpdates} from '../server/postgres/verification-job-permissions.mjs';
import {recordVerificationWorker,readVerificationWorkers} from '../server/postgres/verification-workers.mjs';
import {verificationCapabilityHash} from '../server/ai/verification-descriptor.mjs';
import {createPostgresOperatorServer} from '../server/postgres/operator-http.mjs';
import {recordWorkerPresence} from '../server/postgres/worker-health.mjs';

const schema='queued_verification_test',password='Synthetic queue operator only';
const env={UNDERSTOOD_TIER:'local',UNDERSTOOD_AI_MODE:'synthetic',UNDERSTOOD_DATA_CLASS:'synthetic',UNDERSTOOD_ACCESS_MODE:'credential',UNDERSTOOD_PROVIDER_TESTS:'gemini-free',GEMINI_API_KEY:'synthetic-queued-key'};
const command=()=>({requestId:randomUUID(),kind:'provider-verification',maxRequests:1,confirmed:true});
async function fixture({duringFetch,transportFailure=false,shortDeadline=false,scriptedStage=false,badStage=false,shortFreshness=false,freshnessMs=150,serialConnections=false,heartbeatFailure=false,heartbeatHold}={}){
  let loseCommit=false,tail=Promise.resolve(),heartbeatWrites=0,freshnessWindow=shortFreshness?freshnessMs:null;
  const db=new PGlite(),queries=[],pool={async connect(){
    let release=()=>{};
    if(serialConnections){const previous=tail;tail=new Promise(done=>{release=done;});await previous;}
    return {async query(sql,args){
    queries.push(sql);if(sql==='SELECT pg_export_snapshot() AS id')return {rows:[{id:'embedded-not-native'}]};
    if(shortDeadline && sql.startsWith('INSERT INTO provider_verifications'))sql=sql.replace("interval '90 seconds'","interval '4 seconds'");
    if(freshnessWindow!==null)sql=sql.replace("interval '30 seconds'",`interval '${freshnessWindow} milliseconds'`);
    if(heartbeatFailure && sql.startsWith('INSERT INTO worker_health') && args?.[1]!=='stopped' && ++heartbeatWrites>1)throw Error('Synthetic private heartbeat connection failure');
    if(heartbeatHold && sql.startsWith('INSERT INTO worker_health') && args?.[1]!=='stopped' && ++heartbeatWrites>1 && args[1]==='idle'){
      heartbeatHold.entered();await heartbeatHold.release;throw Error('Synthetic private late heartbeat failure');
    }
    const result=args?.length?await db.query(sql,args):(await db.exec(sql)).at(-1)??{rows:[]};
    if(sql==='COMMIT' && loseCommit){loseCommit=false;throw Error('Synthetic lost commit acknowledgement');}return result;
  },release};}};
  await db.exec(`CREATE SCHEMA ${schema};SET search_path TO ${schema},pg_catalog`);await runMigrations(pool,{schema});
  await provisionOperator(pool,{id:randomUUID(),email:'operator@example.test',password,name:'Synthetic operator'},{schema});
  for(const profile of ['application','operator','worker']){
    await db.exec(`CREATE ROLE queued_${profile} LOGIN`);await configureRuntimePermissions(pool,{schema,role:`queued_${profile}`,profile,dedicatedDatabase:true,writersStopped:true});
  }
  async function as(profile,run){
    const previous=(await db.query('SELECT session_user AS name')).rows[0].name;
    await db.exec('SET SESSION AUTHORIZATION postgres;RESET ROLE');if(profile!=='owner')await db.exec(`SET SESSION AUTHORIZATION queued_${profile}`);
    try{return await run();}finally{await db.exec('SET SESSION AUTHORIZATION postgres;RESET ROLE');if(previous!=='postgres')await db.exec(`SET SESSION AUTHORIZATION ${previous}`);}
  }
  const options={schema},login=()=>as('operator',()=>authenticateOperator(pool,{email:'operator@example.test',password},'synthetic',options));
  let identity=(await login()).session,calls=0;
  const resolved=resolveProviderVerification(env,{fetchImpl:async()=>{
    calls++;if(duringFetch)await duringFetch({as,pool,identity,options});if(transportFailure)throw Error('Synthetic transport uncertain');
    const {title,facts,question,rubric}=syntheticPrepare(CANONICAL_SOURCE);
    return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({title,facts,question,askedFacts:rubric.askedFacts})}]}}]});
  }});
  const config=scriptedStage?Object.freeze({...resolved,async runStage({stage,language,maxRequests},journal){
    for(let n=0;n<maxRequests;n++){
      const id=await journal.beforeRequest();calls++;if(duringFetch)await duringFetch({as,pool,identity,options});await journal.afterRequest(id,{httpStatus:200});
    }
    return {fixtureVersion:STAGE_FIXTURE_VERSION,language,requestCount:maxRequests,capability:`synthetic-${stage}`,
      model:stage==='speech'?resolved.metadata.models.speech:resolved.metadata.models.text,
      checks:stage==='speech'?['mono_pcm16_wav','nonempty_audio']:['structured_translation','automated_comparison'],outputHash:'a'.repeat(64),
      ...(stage==='speech'?{bytes:32044,durationSeconds:1}:{}),...(badStage?{unexpected:'not accepted'}:{})};
  }}):resolved,descriptor=providerVerificationDescriptor(config);
  const workerId=randomUUID();await as('worker',()=>recordVerificationWorker(pool,workerId,config,'idle',options));
  const policy=max=>as('operator',()=>saveProviderPolicy(pool,identity,{requestId:randomUUID(),kind:'provider-policy',orgId:null,revision:0,enabled:true,maxDailyRequests:max,confirmed:true},options));
  return {db,pool,queries,options,as,identity,config,descriptor,login,policy,workerId,calls:()=>calls,loseNextCommit:()=>{loseCommit=true;},
    setFreshnessWindow(ms){if(ms!==null&&(!Number.isSafeInteger(ms)||ms<1||ms>30000))throw Error('Invalid test freshness');freshnessWindow=ms;},
    enqueue:input=>as('operator',()=>runProviderVerification(pool,identity,input,descriptor,options)),
    work:()=>as('worker',()=>rehearsalTasks(pool,{}, {...options,runtimeRoleProfile:'worker',providerVerification:config}).providerVerification()),
    receipt:input=>as('operator',()=>operatorReceipt(pool,identity,input.requestId,options)),close:()=>db.close()};
}

test('operator queues once with no provider key; actual worker claims and seals the original quota/receipt',async()=>{
  const f=await fixture();try{
    await f.policy(4);const input=command(),queued=await f.enqueue(input);assert.equal(queued.state,'pending');assert.equal(f.calls(),0);
    assert.doesNotMatch(JSON.stringify(f.descriptor),/synthetic-queued-key|runStage|blue shelf/);
    assert.equal((await f.enqueue(input)).duplicate,true);assert.equal(f.calls(),0);
    await f.as('application',async()=>{
      assert.equal(await rehearsalTasks(f.pool,{}, {...f.options,runtimeRoleProfile:'application',providerVerification:f.config}).providerVerification(),false);
      await assert.rejects(f.db.query('SELECT * FROM provider_verification_jobs'),error=>error.code==='42501');
    });
    await f.as('operator',async()=>{
      for(const sql of ['SELECT lease_token FROM provider_verification_jobs',"UPDATE provider_verification_jobs SET status='verified'",'DELETE FROM provider_verification_jobs',"UPDATE provider_verifications SET state='verified',finished_at=clock_timestamp()"])
        await assert.rejects(f.db.query(sql),error=>error.code==='42501',sql);
    });
    await f.as('worker',async()=>{
      assert.equal((await verifyRuntimePermissions(f.pool,{...f.options,profile:'worker'})).restricted,true);
      for(const sql of ['INSERT INTO provider_verification_jobs DEFAULT VALUES','DELETE FROM provider_verification_jobs',"UPDATE provider_verification_jobs SET model='forged'"])
        await assert.rejects(f.db.query(sql),error=>error.code==='42501',sql);
    });
    assert.equal(await f.work(),true);assert.equal(f.calls(),1);assert.equal(await f.work(),false);assert.equal(f.calls(),1);
    const receipt=await f.receipt(input);assert.equal(receipt.result.state,'verified');assert.equal(receipt.result.operationId,queued.operationId);
    assert.equal((await f.enqueue(input)).state,'verified');assert.equal(f.calls(),1);
    await f.as('operator',async()=>{const report=await readProviderControls(f.pool,f.identity,f.descriptor,{},f.options);assert.equal(report.connection.state,'verified');assert.equal(report.usage.reservedRequests,1);});
    await f.as('worker',()=>assert.rejects(f.db.query("UPDATE provider_verification_jobs SET diagnostic_code='invalid_output' WHERE request_id=$1",[input.requestId]),/immutable/));
  }finally{await f.close();}
});

test('uncertain worker transport never repeats the test or refunds its original quota',async()=>{
  const f=await fixture({transportFailure:true});try{
    await f.policy(1);const input=command();await f.enqueue(input);await f.work();assert.equal(f.calls(),1);
    assert.equal((await f.receipt(input)).result.state,'uncertain');assert.equal(await f.work(),false);
    assert.equal((await f.enqueue(input)).duplicate,true);assert.equal(f.calls(),1);
    await assert.rejects(f.enqueue(command()),/quota reached/);
  }finally{await f.close();}
});

test('shutdown drains the already claimed verification but does not start a following stage',async()=>{
  const stop=new AbortController(),f=await fixture({duringFetch:async()=>stop.abort()});try{
    await f.policy(1);const input=command();await f.enqueue(input);
    const tasks=rehearsalTasks(f.pool,{}, {...f.options,runtimeRoleProfile:'worker',providerVerification:f.config});
    const results=await f.as('worker',()=>runWorkerCycle({providerVerification:tasks.providerVerification,next:()=>assert.fail('Stage ran after shutdown')},{signal:stop.signal}));
    assert.deepEqual(results,{providerVerification:true});assert.equal(f.calls(),1);
    assert.equal((await f.receipt(input)).result.state,'verified');assert.equal(await f.work(),false);
  }finally{await f.close();}
});

test('operator revocation during a worker request cannot promote an accepted response',async()=>{
  const f=await fixture({duringFetch:async({as,pool,identity,options})=>as('operator',()=>revokeOperator(pool,identity,options))});try{
    await f.policy(2);const input=command();await f.enqueue(input);await f.work();assert.equal(f.calls(),1);
    const row=await f.as('worker',async()=>(await f.db.query('SELECT status,diagnostic_code,result_json FROM provider_verification_jobs')).rows[0]);
    assert.equal(row.status,'failed');assert.equal(row.diagnostic_code,'authority_changed');assert.equal(row.result_json,null);
    assert.equal(await f.work(),false);assert.equal(f.calls(),1);
  }finally{await f.close();}
});

test('all four queued stage fixtures retain exact request counts and bounded original evidence',async()=>{
  const f=await fixture({scriptedStage:true});try{
    await f.policy(6);let expected=0;
    for(const [stage,language,maxRequests] of [['translation','ar',2],['translation','ur',2],['speech','en',1],['speech','ar',1]]){
      const input={requestId:randomUUID(),kind:'provider-stage-verification',stage,language,maxRequests,confirmed:true};
      await f.enqueue(input);assert.equal(f.calls(),expected);await f.work();expected+=maxRequests;assert.equal(f.calls(),expected);
      const receipt=await f.receipt(input);assert.equal(receipt.result.state,'verified');assert.equal(receipt.result.evidence.requestCount,maxRequests);
      assert.equal(receipt.result.evidence.language,language);assert.equal((await f.enqueue(input)).duplicate,true);
    }
    const report=await f.as('operator',()=>readProviderControls(f.pool,f.identity,f.descriptor,{},f.options));
    assert.ok(report.stageTests.every(row=>row.state==='verified'));assert.equal(report.usage.reservedRequests,6);
    assert.doesNotMatch(JSON.stringify(report),/synthetic-queued-key|session_hash|lease_token|unexpected/);
    await assert.rejects(f.enqueue({requestId:randomUUID(),kind:'provider-stage-verification',stage:'speech',language:'ur',maxRequests:1,confirmed:true}),/Unsupported/);
  }finally{await f.close();}
});

test('a revoked translation approval cannot dispatch its second reserved request',async()=>{
  const f=await fixture({scriptedStage:true,duringFetch:async({as,pool,identity,options})=>as('operator',()=>revokeOperator(pool,identity,options))});try{
    await f.policy(2);await f.enqueue({requestId:randomUUID(),kind:'provider-stage-verification',stage:'translation',language:'ar',maxRequests:2,confirmed:true});
    await f.work();assert.equal(f.calls(),1);assert.equal(await f.work(),false);
    const row=await f.as('worker',async()=>(await f.db.query('SELECT status,diagnostic_code,result_json FROM provider_verification_jobs')).rows[0]);
    assert.equal(row.status,'failed');assert.equal(row.diagnostic_code,'authority_changed');assert.equal(row.result_json,null);
    assert.equal((await f.as('worker',async()=>(await f.db.query('SELECT SUM(reserved_requests)::int AS n FROM provider_operations')).rows[0])).n,2);
  }finally{await f.close();}
});

test('malformed worker stage evidence cannot become a verified result even after accepted transport',async()=>{
  const f=await fixture({scriptedStage:true,badStage:true});try{
    await f.policy(2);const input={requestId:randomUUID(),kind:'provider-stage-verification',stage:'translation',language:'ar',maxRequests:2,confirmed:true};
    await f.enqueue(input);await f.work();const receipt=await f.receipt(input);
    assert.equal(f.calls(),2);assert.equal(receipt.result.state,'failed');assert.equal(receipt.result.diagnosticCode,'invalid_output');assert.equal(receipt.result.evidence,undefined);
  }finally{await f.close();}
});

test('lost enqueue acknowledgement retains the exact request without reserving or sending again',async()=>{
  const f=await fixture();try{
    await f.policy(1);const input=command();f.loseNextCommit();await assert.rejects(f.enqueue(input),/lost commit acknowledgement/);
    assert.equal((await f.enqueue(input)).duplicate,true);assert.equal(f.calls(),0);await f.work();assert.equal(f.calls(),1);
    assert.equal((await f.receipt(input)).result.state,'verified');
    const counts=await f.as('worker',async()=>(await f.db.query('SELECT COUNT(*)::int AS n,SUM(reserved_requests)::int AS slots FROM provider_operations')).rows[0]);
    assert.deepEqual(counts,{n:1,slots:1});
  }finally{await f.close();}
});

for(const started of [false,true])test(`expired lost claim with ${started?'started':'no'} transport is sealed without automatic replay`,async()=>{
  const f=await fixture({shortDeadline:true});try{
    await f.policy(1);const input=command();await f.enqueue(input);const token=randomUUID();
    const row=await f.as('worker',async()=>{
      await f.db.query("UPDATE provider_verification_jobs SET status='processing',attempts=1,lease_token=$2,lease_until=deadline_at WHERE request_id=$1",[input.requestId,token]);
      return (await f.db.query('SELECT operation_id FROM provider_verification_jobs WHERE request_id=$1',[input.requestId])).rows[0];
    });
    if(started)await f.as('worker',()=>providerRequestJournal(f.pool,{id:row.operation_id,orgId:null,maxRequests:1,verificationToken:token},f.options).beforeRequest());
    await new Promise(resolve=>setTimeout(resolve,4100));assert.equal(await f.as('worker',()=>rehearsalTasks(f.pool,{},f.options).providerVerification()),true);assert.equal(f.calls(),0);
    const receipt=await f.receipt(input);assert.equal(receipt.result.state,'uncertain');assert.equal(receipt.result.diagnosticCode,'test_interrupted');
    assert.equal(await f.work(),false);assert.equal((await f.enqueue(input)).duplicate,true);assert.equal(f.calls(),0);
    await f.as('worker',()=>assert.rejects(domainTransaction(f.pool,schema,client=>currentVerificationAuthority(client,input.requestId)),/authority changed/));
  }finally{await f.close();}
});

test('worker config mismatch leaves the original queued job untouched and cannot dispatch',async()=>{
  const f=await fixture();try{
    await f.policy(1);const input=command();await f.enqueue(input);
    const changed={...f.config,fingerprint:'0'.repeat(64)};
    assert.equal(await f.as('worker',()=>processOneProviderVerification(f.pool,changed,f.options)),false);assert.equal(f.calls(),0);
    const row=await f.as('worker',async()=>(await f.db.query('SELECT status,attempts FROM provider_verification_jobs')).rows[0]);assert.deepEqual(row,{status:'queued',attempts:0});
    const forged={...f.descriptor,apiKey:'not accepted'};
    await assert.rejects(f.as('operator',()=>runProviderVerification(f.pool,f.identity,command(),forged,f.options)),/verification unavailable/);
  }finally{await f.close();}
});

test('operator SQL cannot bypass global test quota or create a preverified approval',async()=>{
  const f=await fixture();try{
    await f.policy(1);
    await f.as('operator',async()=>{
      await assert.rejects(f.db.query(`INSERT INTO provider_operations(id,org_id,kind,reference_id,claim_token,model,data_class,reserved_requests,quota_day)
        VALUES($1,NULL,'connection-test',$2,NULL,$3,'synthetic',2,(clock_timestamp() AT TIME ZONE 'UTC')::date)`,[randomUUID(),randomUUID(),f.descriptor.metadata.models.text]),/quota reached/);
    });
    const input=command();await f.enqueue(input);
    await f.as('operator',async()=>{
      const row=(await f.db.query('SELECT operation_id FROM provider_verification_jobs')).rows[0];
      await assert.rejects(f.db.query(`INSERT INTO provider_verifications(request_id,operator_id,session_hash,operation_id,config_hash,request_json,state,deadline_at,test_stage,language)
        VALUES($1,$2,$3,$4,$5,$6,'verified',clock_timestamp()+interval '90 seconds','connection','en')`,
        [randomUUID(),f.identity.operator_id,f.identity.token_hash,row.operation_id,f.descriptor.fingerprint,JSON.stringify({kind:'provider-verification',maxRequests:1,confirmed:true})]),error=>error.code==='42501');
    });
    assert.equal(f.calls(),0);
  }finally{await f.close();}
});

test('durable three-role source fencing revokes the new worker column writes too',async()=>{
  const f=await fixture();try{
    await f.policy(1);await f.enqueue(command());
    await f.as('operator',()=>saveOperatorControl(f.pool,f.identity,{requestId:randomUUID(),kind:'system',revision:0,jobsPaused:true,providerPaused:true,confirmed:true},f.options));
    const result=await f.as('owner',()=>fenceSourceRuntime(f.pool,{schema,roles:['queued_application','queued_worker','queued_operator'],profiles:{queued_worker:'worker',queued_operator:'operator'},writersStopped:true}));
    assert.equal(result.runtimeWriteFenceVerified,true);
    await f.as('worker',()=>assert.rejects(f.db.query("UPDATE provider_verification_jobs SET status='failed',finished_at=clock_timestamp(),diagnostic_code='authority_changed'"),error=>error.code==='42501'));
  }finally{await f.close();}
});

test('pause blocks new claims and rechecks in-flight results without releasing reserved slots',async()=>{
  const f=await fixture({duringFetch:async({as,pool,identity,options})=>as('operator',()=>saveOperatorControl(pool,identity,
    {requestId:randomUUID(),kind:'system',revision:2,jobsPaused:false,providerPaused:true,confirmed:true},options))});try{
    await f.policy(1);const input=command();await f.enqueue(input);
    const control=(revision,providerPaused)=>f.as('operator',()=>saveOperatorControl(f.pool,f.identity,{requestId:randomUUID(),kind:'system',revision,jobsPaused:false,providerPaused,confirmed:true},f.options));
    await control(0,true);assert.equal(await f.work(),false);assert.equal(f.calls(),0);
    await assert.rejects(f.enqueue(command()),/dispatch paused/);
    await control(1,false);assert.equal(await f.work(),true);assert.equal(f.calls(),1);
    const receipt=await f.receipt(input);assert.equal(receipt.result.state,'failed');assert.equal(receipt.result.diagnosticCode,'authority_changed');
    const report=await f.as('operator',()=>readProviderControls(f.pool,f.identity,f.descriptor,{},f.options));assert.equal(report.usage.reservedRequests,1);
  }finally{await f.close();}
});

test('enqueue audit failure rolls back job, approval, authority and quota atomically',async()=>{
  const f=await fixture();try{
    await f.policy(1);
    await f.as('owner',()=>f.db.exec("CREATE FUNCTION reject_queue_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic queue audit failed'; END $$;CREATE TRIGGER reject_queue_audit BEFORE INSERT ON operator_audit FOR EACH ROW EXECUTE FUNCTION reject_queue_audit()"));
    await assert.rejects(f.enqueue(command()),/queue audit failed/);assert.equal(f.calls(),0);
    const counts=await f.as('owner',async()=>{
      const output={};for(const table of ['provider_operations','provider_verifications','provider_verification_authorities','provider_verification_jobs'])output[table]=(await f.db.query(`SELECT COUNT(*)::int n FROM ${table}`)).rows[0].n;return output;
    });assert.ok(Object.values(counts).every(n=>n===0));
  }finally{await f.close();}
});

test('SQL result promotion requires accepted evidence and admission rejects worker grant or queue-guard drift',async()=>{
  const f=await fixture();try{
    await f.policy(1);const input=command();await f.enqueue(input);
    await f.as('worker',async()=>{
      await f.db.query("UPDATE provider_verification_jobs SET status='processing',attempts=1,lease_token=$2,lease_until=deadline_at WHERE request_id=$1",[input.requestId,randomUUID()]);
      await assert.rejects(f.db.query("UPDATE provider_verification_jobs SET status='verified',lease_token=NULL,lease_until=NULL,finished_at=clock_timestamp() WHERE request_id=$1",[input.requestId]),/evidence unavailable/);
    });
    for(const [grant,revoke] of [
      ['GRANT UPDATE(model) ON provider_verification_jobs TO queued_worker','REVOKE UPDATE(model) ON provider_verification_jobs FROM queued_worker'],
      ['GRANT UPDATE ON provider_verification_jobs TO queued_worker',`REVOKE UPDATE ON provider_verification_jobs FROM queued_worker;GRANT UPDATE(${verificationJobUpdates.join(',')}) ON provider_verification_jobs TO queued_worker`],
      ['ALTER TABLE provider_verification_jobs DISABLE TRIGGER verification_job_frozen','ALTER TABLE provider_verification_jobs ENABLE TRIGGER verification_job_frozen'],
    ]){
      await f.as('owner',()=>f.db.exec(grant));await f.as('worker',()=>assert.rejects(verifyRuntimePermissions(f.pool,{...f.options,profile:'worker'}),/column privileges|authority guards/));await f.as('owner',()=>f.db.exec(revoke));
    }
    await f.as('worker',()=>verifyRuntimePermissions(f.pool,{...f.options,profile:'worker'}));assert.equal(f.calls(),0);
  }finally{await f.close();}
});

test('worker capability metadata is private from API writes, database-timed, immutable and terminal on stop',async()=>{
  const f=await fixture();try{
    await f.as('application',()=>assert.rejects(f.db.query('SELECT * FROM provider_verification_workers'),e=>e.code==='42501'));
    await f.as('operator',async()=>{
      await assert.rejects(f.db.query("UPDATE provider_verification_workers SET state='active'"),e=>e.code==='42501');
      await assert.rejects(f.db.query('SELECT worker_id FROM provider_verification_workers'),e=>e.code==='42501');
    });
    await f.as('worker',async()=>{
      await f.db.query("UPDATE provider_verification_workers SET seen_at=clock_timestamp()+interval '1 year' WHERE worker_id=$1",[f.workerId]);
      assert.equal((await f.db.query("SELECT seen_at<=clock_timestamp() AND seen_at>clock_timestamp()-interval '1 second' AS valid FROM provider_verification_workers")).rows[0].valid,true);
      for(const sql of ["UPDATE provider_verification_workers SET config_hash=repeat('0',64)",'DELETE FROM provider_verification_workers'])await assert.rejects(f.db.query(sql),/immutable|not expired/);
      await recordVerificationWorker(f.pool,f.workerId,f.config,'stopped',f.options);
      assert.equal((await readVerificationWorkers(await f.pool.connect())).status,'stopped');
      await assert.rejects(recordVerificationWorker(f.pool,f.workerId,f.config,'idle',f.options),/immutable/);
    });assert.equal(f.calls(),0);
  }finally{await f.close();}
});

test('stale worker blocks new reservations and claims while original receipts survive fresh recovery',async()=>{
  const f=await fixture();try{
    await f.policy(2);const input=command();await f.enqueue(input);
    f.setFreshnessWindow(150);
    await new Promise(resolve=>setTimeout(resolve,200));assert.equal(await f.work(),false);
    const report=await f.as('operator',()=>readProviderControls(f.pool,f.identity,undefined,{}, {...f.options,workerVerification:true}));
    assert.equal(report.worker.status,'stale');assert.equal(report.configuration.testEnabled,false);
    await assert.rejects(f.enqueue(command()),/worker unavailable/);assert.equal((await f.enqueue(input)).duplicate,true);assert.equal(f.calls(),0);
    // Accelerate only the stale phase; recovered work uses the actual 30s policy,
    // not a 150ms completion deadline that varies with full-suite machine load.
    f.setFreshnessWindow(null);
    await f.as('worker',()=>recordVerificationWorker(f.pool,f.workerId,f.config,'idle',f.options));
    await f.work();assert.equal((await f.receipt(input)).result.state,'verified');assert.equal(f.calls(),1);
  }finally{await f.close();}
});

test('conflicting and incompatible fresh workers cannot select a different configuration or spend quota',async()=>{
  const f=await fixture();try{
    await f.policy(2);const input=command();await f.enqueue(input);const other=randomUUID();
    await f.as('worker',()=>recordVerificationWorker(f.pool,other,{...f.config,fingerprint:'0'.repeat(64)},'idle',f.options));
    assert.equal(await f.work(),false);await assert.rejects(f.enqueue(command()),/worker unavailable/);assert.equal(f.calls(),0);
    let report=await f.as('operator',()=>readProviderControls(f.pool,f.identity,undefined,{}, {...f.options,workerVerification:true}));assert.equal(report.worker.status,'conflicting');
    await f.as('worker',()=>recordVerificationWorker(f.pool,other,undefined,'stopped',f.options));
    await f.work();assert.equal((await f.receipt(input)).result.state,'verified');assert.equal(f.calls(),1);
    await f.as('worker',async()=>{
      await recordVerificationWorker(f.pool,f.workerId,undefined,'stopped',f.options);
      await f.db.query("INSERT INTO provider_verification_workers(worker_id,config_hash,capability_hash,state) VALUES($1,$2,$3,'active')",[randomUUID(),f.config.fingerprint,'0'.repeat(64)]);
    });
    report=await f.as('operator',()=>readProviderControls(f.pool,f.identity,undefined,{}, {...f.options,workerVerification:true}));
    assert.equal(report.worker.status,'incompatible');assert.equal(report.worker.configFingerprint,null);
    await assert.rejects(f.enqueue(command()),/worker unavailable/);
    assert.equal((await f.enqueue(input)).state,'verified');assert.equal(f.calls(),1);
  }finally{await f.close();}
});

test('worker configuration conflict during translation prevents the second request and late promotion',async()=>{
  let f;f=await fixture({scriptedStage:true,duringFetch:async()=>f.as('worker',()=>recordVerificationWorker(f.pool,randomUUID(),{...f.config,fingerprint:'0'.repeat(64)},'idle',f.options))});try{
    await f.policy(2);const input={requestId:randomUUID(),kind:'provider-stage-verification',stage:'translation',language:'ar',maxRequests:2,confirmed:true};
    await f.enqueue(input);await f.work();assert.equal(f.calls(),1);
    assert.equal((await f.receipt(input)).result.state,'failed');assert.equal((await f.receipt(input)).result.diagnosticCode,'authority_changed');
    assert.equal(await f.work(),false);
  }finally{await f.close();}
});

test('normal worker startup publishes capabilities and graceful in-flight shutdown closes them',async()=>{
  const stop=new AbortController(),f=await fixture({duringFetch:async()=>stop.abort()});try{
    await f.policy(1);const input=command();await f.enqueue(input);
    await f.as('worker',()=>recordVerificationWorker(f.pool,f.workerId,undefined,'stopped',f.options));
    const errors=[];
    await f.as('worker',()=>runRehearsalWorker(f.pool,{}, {...f.options,runtimeRoleProfile:'worker',runtimePermissionsRequired:true,providerVerification:f.config},
      {signal:stop.signal,onError:name=>errors.push(name)}));
    assert.deepEqual(errors,[]);assert.equal(f.calls(),1);assert.equal((await f.receipt(input)).result.state,'verified');
    await f.as('worker',async()=>{
      assert.equal((await readVerificationWorkers(await f.pool.connect())).status,'stopped');
      assert.equal((await f.db.query("SELECT COUNT(*)::int n FROM worker_health WHERE state='stopped'")).rows[0].n,1);
    });
  }finally{await f.close();}
});

test('dedicated keyless operator HTTP binds displayed configuration and reconciles accepted tests after worker stop',async()=>{
  const f=await fixture(),origin='https://operations.example.test';let server;
  try{
    await f.policy(2);
    server=createPostgresOperatorServer(f.pool,{config:{service:'operator',runtimeRoleProfile:'operator',operatorAccess:true,
      tier:'staging',dataClass:'synthetic',integrationMode:'synthetic',aiMode:'synthetic',accessMode:'credential',publicOrigin:origin,
      customerOrigin:'https://customer.example.test',storageChecks:false,mail:{available:false},pilotDestination:null,schema,
      requestAddress:()=> 'synthetic'},publicBuild:(_req,res)=>res.end('synthetic')});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
    const request=(path,options={})=>f.as('operator',()=>fetch(base+'/api/ops/'+path,options));
    const login=await request('login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({email:'operator@example.test',password})});
    assert.equal(login.status,200);const session=await login.json();
    const headers={origin,'content-type':'application/json',cookie:login.headers.get('set-cookie').split(';')[0],'x-operator-context':session.clientContext};
    const providers=await (await request('providers',{headers})).json();assert.equal(providers.worker.status,'available');
    assert.equal(providers.worker.configFingerprint,f.config.fingerprint);assert.equal(providers.configuration.testEnabled,true);
    assert.doesNotMatch(JSON.stringify(providers),/synthetic-queued-key|worker_id|lease_token|session_hash/);
    const input=command(),post=(body,fp=providers.worker.configFingerprint)=>request('providers/verify',{method:'POST',headers:{...headers,'x-verification-config':fp},body:JSON.stringify(body)});
    assert.equal((await post(command(),'0'.repeat(64))).status,409);assert.equal(f.calls(),0);
    const queued=await post(input);assert.equal(queued.status,200);assert.equal((await queued.json()).state,'pending');assert.equal(f.calls(),0);
    assert.equal((await (await post(input)).json()).duplicate,true);
    const receipt=()=>request('receipts/'+input.requestId,{headers}).then(r=>r.json());assert.equal((await receipt()).result.configFingerprint,f.config.fingerprint);
    await f.work();assert.equal(f.calls(),1);assert.equal((await receipt()).result.state,'verified');
    await f.as('worker',()=>recordVerificationWorker(f.pool,f.workerId,undefined,'stopped',f.options));
    assert.equal((await (await request('providers',{headers})).json()).worker.status,'stopped');
    assert.equal((await (await post(input)).json()).state,'verified');assert.equal((await post(command())).status,409);assert.equal(f.calls(),1);
    assert.equal((await f.as('worker',async()=>(await f.db.query('SELECT SUM(reserved_requests)::int n FROM provider_operations')).rows[0])).n,1);
    const logout=await request('logout',{method:'POST',headers,body:'{}'});assert.equal(logout.status,200);
  }finally{if(server)await new Promise(resolve=>server.close(resolve));await f.close();}
});

test('atomic worker presence rolls back health when capability publication is rejected',async()=>{
  const f=await fixture();try{
    const id=randomUUID();
    await f.as('owner',()=>f.db.exec("CREATE FUNCTION reject_presence_capability() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic capability publication failure'; END $$;CREATE TRIGGER reject_presence_capability AFTER INSERT OR UPDATE ON provider_verification_workers FOR EACH ROW EXECUTE FUNCTION reject_presence_capability()"));
    await f.as('worker',async()=>{
      await assert.rejects(recordWorkerPresence(f.pool,id,{state:'idle'}, {...f.options,runtimeRoleProfile:'worker',providerVerification:f.config}),/capability publication failure/);
      assert.equal((await f.db.query('SELECT COUNT(*)::int n FROM worker_health WHERE id=$1',[id])).rows[0].n,0);
      assert.equal((await f.db.query('SELECT COUNT(*)::int n FROM provider_verification_workers WHERE worker_id=$1',[id])).rows[0].n,0);
    });
  }finally{await f.close();}
});

test('independent heartbeat keeps a held provider stage fresh past the observation window and through graceful drain',async()=>{
  const stop=new AbortController();let f,observed=false;
  f=await fixture({serialConnections:true,shortFreshness:true,freshnessMs:800,duringFetch:async()=>{
    await new Promise(resolve=>setTimeout(resolve,1800));
    const first=await domainTransaction(f.pool,schema,async client=>({
      worker:await readVerificationWorkers(client),
      row:(await client.query("SELECT w.state,w.stage,c.seen_at,c.seen_at>c.created_at+interval '800 milliseconds' AS advanced FROM worker_health w JOIN provider_verification_workers c ON c.worker_id=w.id WHERE c.state='active'")).rows[0],
    }));
    assert.equal(first.worker.status,'available');assert.equal(first.worker.workers,1);assert.equal(first.row.advanced,true);
    assert.equal(first.row.state,'busy');assert.equal(first.row.stage,'providerVerification');
    stop.abort();await new Promise(resolve=>setTimeout(resolve,250));
    const second=await domainTransaction(f.pool,schema,async client=>({worker:await readVerificationWorkers(client),row:(await client.query("SELECT seen_at FROM provider_verification_workers WHERE state='active'")).rows[0]}));
    assert.equal(second.worker.status,'available');assert.ok(new Date(second.row.seen_at)>new Date(first.row.seen_at));observed=true;
  }});
  try{
    await f.policy(1);const input=command();await f.enqueue(input);
    await f.as('worker',()=>recordVerificationWorker(f.pool,f.workerId,undefined,'stopped',f.options));
    const errors=[];
    await f.as('worker',()=>runRehearsalWorker(f.pool,{}, {...f.options,runtimeRoleProfile:'worker',runtimePermissionsRequired:true,providerVerification:f.config},
      {signal:stop.signal,heartbeatIntervalMs:50,onError:stage=>errors.push(stage)}));
    assert.equal(observed,true);assert.deepEqual(errors,[]);assert.equal(f.calls(),1);assert.equal((await f.receipt(input)).result.state,'verified');
    await f.as('worker',()=>domainTransaction(f.pool,schema,async client=>{
      assert.equal((await readVerificationWorkers(client)).status,'stopped');
      assert.equal((await client.query("SELECT COUNT(*)::int n FROM worker_health WHERE state='stopped'")).rows[0].n,1);
    }));
  }finally{stop.abort();await f.close();}
});

test('heartbeat failure during translation blocks the second dispatch and late result promotion with redacted supervisor failure',async()=>{
  const stop=new AbortController(),errors=[];let notify,watchdog;
  const failed=new Promise(resolve=>{notify=resolve;});
  const f=await fixture({serialConnections:true,heartbeatFailure:true,scriptedStage:true,duringFetch:async()=>{
    const notified=await new Promise(resolve=>{
      watchdog=setTimeout(()=>{stop.abort();resolve(false);},5000);
      failed.then(()=>{clearTimeout(watchdog);resolve(true);});
    });assert.equal(notified,true);
  }});
  try{
    await f.policy(2);const input={requestId:randomUUID(),kind:'provider-stage-verification',stage:'translation',language:'ar',maxRequests:2,confirmed:true};await f.enqueue(input);
    await f.as('worker',()=>recordVerificationWorker(f.pool,f.workerId,undefined,'stopped',f.options));
    await assert.rejects(f.as('worker',()=>runRehearsalWorker(f.pool,{}, {...f.options,runtimeRoleProfile:'worker',runtimePermissionsRequired:true,providerVerification:f.config},
      {signal:stop.signal,heartbeatIntervalMs:20,onError:stage=>{errors.push(stage);if(stage==='workerHealth')notify();}})),e=>e.message==='Worker heartbeat unavailable');
    assert.deepEqual(errors,['workerHealth']);assert.equal(f.calls(),1);
    const receipt=await f.receipt(input);assert.equal(receipt.result.state,'failed');assert.equal(receipt.result.diagnosticCode,'authority_changed');
    await f.as('worker',()=>domainTransaction(f.pool,schema,async client=>{
      assert.equal((await readVerificationWorkers(client)).status,'stopped');
      assert.deepEqual((await client.query('SELECT state,failure_stages FROM worker_health')).rows[0],{state:'stopped',failure_stages:['workerHealth']});
      assert.equal((await client.query('SELECT SUM(reserved_requests)::int n FROM provider_operations')).rows[0].n,2);
    }));
  }finally{stop.abort();clearTimeout(watchdog);await f.close();}
});

test('default five-second heartbeat preserves a two-request stage beyond the real thirty-second freshness window',async()=>{
  const stop=new AbortController();let f,observed=false;
  f=await fixture({serialConnections:true,scriptedStage:true,duringFetch:async()=>{
    await new Promise(resolve=>setTimeout(resolve,18000));
    if(f.calls()!==2)return;
    try{
      const snapshot=await domainTransaction(f.pool,schema,async client=>({worker:await readVerificationWorkers(client),
        row:(await client.query("SELECT h.state,h.stage,c.seen_at>c.created_at+interval '25 seconds' AS advanced FROM worker_health h JOIN provider_verification_workers c ON c.worker_id=h.id WHERE c.state='active'")).rows[0]}));
      assert.equal(snapshot.worker.status,'available');assert.equal(snapshot.worker.workers,1);
      assert.deepEqual(snapshot.row,{state:'busy',stage:'providerVerification',advanced:true});observed=true;
    }finally{stop.abort();}
  }});
  const watchdog=setTimeout(()=>stop.abort(),60000);
  try{
    await f.policy(2);const input={requestId:randomUUID(),kind:'provider-stage-verification',stage:'translation',language:'ar',maxRequests:2,confirmed:true};await f.enqueue(input);
    await f.as('worker',()=>recordVerificationWorker(f.pool,f.workerId,undefined,'stopped',f.options));
    const errors=[];
    await f.as('worker',()=>runRehearsalWorker(f.pool,{}, {...f.options,runtimeRoleProfile:'worker',runtimePermissionsRequired:true,providerVerification:f.config},
      {signal:stop.signal,onError:stage=>errors.push(stage)}));
    assert.equal(observed,true);assert.deepEqual(errors,[]);assert.equal(f.calls(),2);assert.equal((await f.receipt(input)).result.state,'verified');
  }finally{stop.abort();clearTimeout(watchdog);await f.close();}
});

test('an idle heartbeat that fails during graceful shutdown still rejects the runtime and persists its failure',async()=>{
  const stop=new AbortController(),errors=[];let entered,release;
  const started=new Promise(resolve=>{entered=resolve;}),held=new Promise(resolve=>{release=resolve;});
  const f=await fixture({serialConnections:true,heartbeatHold:{entered,release:held}});let outcome;
  const storage=Object.fromEntries(['save','read','remove','exists'].map(name=>[name,()=>assert.fail(`Unexpected synthetic storage ${name}`)]));
  const watchdog=setTimeout(()=>{entered(false);stop.abort();},5000);
  try{
    await f.as('worker',()=>recordVerificationWorker(f.pool,f.workerId,undefined,'stopped',f.options));
    outcome=f.as('worker',()=>runRehearsalWorker(f.pool,storage, {...f.options,runtimeRoleProfile:'worker',runtimePermissionsRequired:true,providerVerification:f.config},
      {signal:stop.signal,intervalMs:1000,heartbeatIntervalMs:100,onError:stage=>errors.push(stage)})).then(()=>null,error=>error);
    assert.notEqual(await started,false);stop.abort();await new Promise(resolve=>setTimeout(resolve,25));release();
    assert.equal((await outcome)?.message,'Worker heartbeat unavailable');assert.deepEqual(errors,['workerHealth']);assert.equal(f.calls(),0);
    await f.as('worker',()=>domainTransaction(f.pool,schema,async client=>{
      assert.deepEqual((await client.query('SELECT state,failure_stages FROM worker_health')).rows[0],{state:'stopped',failure_stages:['workerHealth']});
      assert.equal((await readVerificationWorkers(client)).status,'stopped');
    }));
  }finally{stop.abort();release();clearTimeout(watchdog);if(outcome)await outcome;await f.close();}
});
