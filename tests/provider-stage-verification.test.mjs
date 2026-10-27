import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {domainTransaction} from '../server/postgres/domain.mjs';
import {provisionOperator,authenticateOperator,revokeOperator} from '../server/postgres/operators.mjs';
import {saveOperatorControl,operatorReceipt} from '../server/postgres/operations.mjs';
import {readProviderControls,saveProviderPolicy,runProviderVerification} from '../server/postgres/provider-controls.mjs';
import {providerRequestJournal} from '../server/postgres/provider-budget.mjs';
import {resolveProviderVerification} from '../server/ai/provider-verification-config.mjs';
import {STAGE_TESTS,checkedStageResult} from '../server/ai/provider-stage-verification.mjs';
import {providerStageVerificationInput} from '../server/provider-input.mjs';
import {GEMINI_MODELS} from '../server/ai/gemini.mjs';
import {CANONICAL_SOURCE,syntheticPrepare} from '../server/domain.mjs';
import {pipelineStatus} from '../server/ai/pipeline-status.mjs';
import {resolvePreparationAdapter} from '../server/ai/preparation-config.mjs';
import {getLanguageReadiness,runLanguageReadiness} from '../server/postgres/language-readiness.mjs';

const env={UNDERSTOOD_TIER:'local',UNDERSTOOD_AI_MODE:'synthetic',UNDERSTOOD_DATA_CLASS:'synthetic',UNDERSTOOD_ACCESS_MODE:'credential',UNDERSTOOD_PROVIDER_TESTS:'gemini-free',GEMINI_API_KEY:'synthetic-key-never-live'};
const command=(stage,language)=>({requestId:randomUUID(),kind:'provider-stage-verification',stage,language,maxRequests:stage==='translation'?2:1,confirmed:true});
const json=value=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(value)}]}}]});
function wav(){const b=Buffer.alloc(32044);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(32000,40);b.writeInt16LE(1000,44);return b;}
function mockProvider(calls,{comparison=true,audio=wav(),afterResponse}={}) {
  return async(url,options)=>{
    const body=JSON.parse(options.body);calls.push({url,body});let response;
    if(body.response_format?.type==='audio')response=Response.json({status:'completed',model:GEMINI_MODELS.speech,steps:[{type:'model_output',content:[{type:'audio',mime_type:'audio/wav',data:audio.toString('base64')}]}]});
    else if(body.generationConfig.responseFormat.text.schema.properties.faithful)response=json({faithful:comparison,complete:true,languageCorrect:true,terminologyApplied:true,reasons:comparison?[]:['incomplete_translation']});
    else {
      const language=body.systemInstruction.parts[0].text.includes('into Urdu')?'ur':'ar';
      const {title,text,question}=syntheticPrepare(CANONICAL_SOURCE).languages[language];response=json({title,text,question});
    }
    if(afterResponse)await afterResponse(calls.length);return response;
  };
}
async function fixture({shortDeadline=false}={}) {
  const db=new PGlite(),pool={async connect(){return {query:async(sql,values)=>{
    if(shortDeadline && sql.startsWith('INSERT INTO provider_verifications'))sql=sql.replace("interval '90 seconds'","interval '15 milliseconds'");
    return values?.length?db.query(sql,values):(await db.exec(sql)).at(-1)??{rows:[]};},release(){}};}};
  await runMigrations(pool);const run=fn=>domainTransaction(pool,'public',fn);
  await run(client=>client.query("INSERT INTO organizations VALUES('cedar','Synthetic Cedar');INSERT INTO sites VALUES('beirut','cedar','Synthetic Beirut','Asia/Beirut');INSERT INTO staff(id,org_id,site_id,name,role) VALUES('maya','cedar','beirut','Synthetic Owner','owner'),('auditor','cedar','beirut','Synthetic Auditor','auditor')"));
  const password='Synthetic-stage-password-2026';await provisionOperator(pool,{id:randomUUID(),name:'Synthetic Operator',email:'operator@example.test',password});
  const login=await authenticateOperator(pool,{email:'operator@example.test',password},'local');
  await saveProviderPolicy(pool,login.session,{requestId:randomUUID(),kind:'provider-policy',orgId:null,revision:0,enabled:true,maxDailyRequests:20,confirmed:true});
  return {db,pool,run,identity:login.session};
}
test('stage commands are fixed, exact-budget and cannot carry worker content or unsupported Urdu speech',()=>{
  for(const spec of STAGE_TESTS)assert.deepEqual(providerStageVerificationInput(command(spec.stage,spec.language)),{kind:'provider-stage-verification',...spec,confirmed:true});
  assert.throws(()=>providerStageVerificationInput({...command('translation','ar'),text:'Private response'}),/Invalid/);
  assert.throws(()=>providerStageVerificationInput({...command('translation','ar'),maxRequests:1}),/Invalid/);
  assert.throws(()=>providerStageVerificationInput(command('speech','ur')),/Unsupported/);
  assert.throws(()=>providerStageVerificationInput({...command('speech','en'),confirmed:false}),/Invalid/);
  const evidence={fixtureVersion:'provider-stage-fixture-v3',language:'en',requestCount:1,capability:'synthetic-speech',model:GEMINI_MODELS.speech,checks:['mono_pcm16_wav','nonempty_audio'],outputHash:'ab'.repeat(32),bytes:32044,durationSeconds:1};
  assert.deepEqual(checkedStageResult(evidence,STAGE_TESTS[2],GEMINI_MODELS.speech),evidence);
  assert.throws(()=>checkedStageResult({...evidence,bytes:32045},STAGE_TESTS[2],GEMINI_MODELS.speech),/evidence/);
  assert.throws(()=>checkedStageResult({...evidence,privateAudio:'secret'},STAGE_TESTS[2],GEMINI_MODELS.speech),/evidence/);
});
test('all supported fixed stage tests meter exact requests, preserve immutable receipts and expose bounded current-config results',async()=>{
  const f=await fixture(),calls=[],config=resolveProviderVerification(env,{fetchImpl:mockProvider(calls)});
  const pipeline=pipelineStatus({preparationAdapter:resolvePreparationAdapter({...env,UNDERSTOOD_PREPARATION_ADAPTER:'gemini-free',UNDERSTOOD_SYNTHETIC_PREPARATION_HASHES:JSON.stringify(['ab'.repeat(32)])})});
  try {
    for(const spec of STAGE_TESTS){
      const input=command(spec.stage,spec.language),result=await runProviderVerification(f.pool,f.identity,input,config),count=calls.length;
      assert.equal(result.state,'verified');assert.equal(result.evidence.requestCount,spec.maxRequests);assert.equal(result.stage,spec.stage);assert.equal(result.language,spec.language);
      assert.equal((await runProviderVerification(f.pool,f.identity,input,resolveProviderVerification({}))).duplicate,true);assert.equal(calls.length,count);
      const receipt=await operatorReceipt(f.pool,f.identity,input.requestId);assert.equal(receipt.result.state,'verified');assert.deepEqual(receipt.result.evidence,result.evidence);
      await assert.rejects(runProviderVerification(f.pool,f.identity,{...input,language:spec.language==='ar'?'ur':'ar'},config),/conflict|Unsupported/);
    }
    assert.equal(calls.length,6);
    const report=await readProviderControls(f.pool,f.identity,config,{}, {pipeline});
    assert.equal(report.connection.state,'untested');assert.equal(report.usage.reservedRequests,6);assert.equal(report.stageTests.length,4);assert.ok(report.stageTests.every(row=>row.state==='verified'));
    assert.ok(report.pipeline.stages.filter(row=>['translation','speech'].includes(row.id)).every(row=>row.verification==='fixed_fixtures_passed'));
    assert.ok(report.pipeline.stages.filter(row=>!['translation','speech'].includes(row.id)).every(row=>row.verification==='not_tested'));
    const owner={principal_type:'staff',principal_id:'maya',org_id:'cedar',site_id:'beirut',role:'owner'},options={pipeline,providerVerification:config};
    const staff=await getLanguageReadiness(f.pool,owner,options);assert.equal(staff.languages.find(row=>row.code==='ar').translation.state,'technical_test_passed');assert.equal(staff.languages.find(row=>row.code==='ur').speech.state,'not_tested');
    assert.deepEqual((await runLanguageReadiness(f.pool,owner,{},options)).stageTests,staff.stageTests);assert.equal(calls.length,6);
    await assert.rejects(getLanguageReadiness(f.pool,{...owner,principal_id:'missing'},options),/^Error: Forbidden$/);
    assert.doesNotMatch(JSON.stringify([report,staff]),/synthetic-key-never-live|fingerprint|config_hash|session_hash|blue shelf|privateAudio/);
    assert.equal(report.productionReady,false);assert.equal(staff.realDataAllowed,false);
    const rotated=await readProviderControls(f.pool,f.identity,resolveProviderVerification({...env,GEMINI_API_KEY:'different-key'}));assert.ok(rotated.stageTests.every(row=>row.state==='untested'));
    const disabled=await readProviderControls(f.pool,f.identity,config);assert.ok(disabled.pipeline.stages.every(row=>row.verification==='not_tested'));
    await assert.rejects(f.run(client=>client.query("UPDATE provider_verifications SET result_json='{}' WHERE test_stage='speech'")),/immutable/);
    const rows=(await f.run(client=>client.query('SELECT model,reserved_requests,kind FROM provider_operations ORDER BY created_at'))).rows;
    assert.deepEqual(rows.map(row=>row.reserved_requests),[2,2,1,1]);assert.ok(rows.every(row=>row.kind==='stage-test'));
    assert.deepEqual(rows.map(row=>row.model),[GEMINI_MODELS.text,GEMINI_MODELS.text,GEMINI_MODELS.speech,GEMINI_MODELS.speech]);
  }finally{await f.db.close();}
});
test('failed comparison, corrupt audio and uncertain transport cannot create passing stage evidence or reuse slots',async()=>{
  const f=await fixture(),calls=[];
  try {
    const negative=await runProviderVerification(f.pool,f.identity,command('translation','ar'),resolveProviderVerification(env,{fetchImpl:mockProvider(calls,{comparison:false})}));
    assert.equal(negative.state,'failed');assert.equal(negative.diagnosticCode,'invalid_output');assert.equal(negative.evidence,undefined);assert.equal(calls.length,2);
    const corrupt=await runProviderVerification(f.pool,f.identity,command('speech','en'),resolveProviderVerification(env,{fetchImpl:mockProvider(calls,{audio:Buffer.from('bad wav')})}));assert.equal(corrupt.state,'failed');assert.equal(corrupt.evidence,undefined);
    const uncertain=await runProviderVerification(f.pool,f.identity,command('translation','ur'),resolveProviderVerification(env,{fetchImpl:async()=>{throw Error('Private transport detail');}}));assert.equal(uncertain.state,'uncertain');assert.equal(uncertain.diagnosticCode,'transport_uncertain');
    assert.doesNotMatch(JSON.stringify(uncertain),/Private transport/);
    const report=await readProviderControls(f.pool,f.identity,resolveProviderVerification(env));assert.equal(report.usage.reservedRequests,5);assert.equal(report.connection.state,'untested');
    const operation=(await f.run(client=>client.query("SELECT id,org_id AS \"orgId\",reserved_requests AS \"maxRequests\" FROM provider_operations WHERE kind='stage-test' ORDER BY created_at LIMIT 1"))).rows[0];
    await assert.rejects(providerRequestJournal(f.pool,operation).beforeRequest(),/verification unavailable/);
    await assert.rejects(providerRequestJournal(f.pool,operation).beforeRequest({cleanup:true}),/cleanup is not permitted/);
  }finally{await f.db.close();}
});
test('global quota rejects a two-request test before any reservation or dispatch',async()=>{
  const f=await fixture(),calls=[],config=resolveProviderVerification(env,{fetchImpl:mockProvider(calls)});
  try {
    await saveProviderPolicy(f.pool,f.identity,{requestId:randomUUID(),kind:'provider-policy',orgId:null,revision:1,enabled:true,maxDailyRequests:1,confirmed:true});
    await assert.rejects(runProviderVerification(f.pool,f.identity,command('translation','ar'),config),/quota reached/);
    await assert.rejects(runProviderVerification(f.pool,f.identity,command('speech','ur'),config),/Unsupported/);
    assert.equal(calls.length,0);assert.equal((await readProviderControls(f.pool,f.identity,config)).usage.operations,0);
    assert.equal((await runProviderVerification(f.pool,f.identity,command('speech','ar'),config)).state,'verified');assert.equal(calls.length,1);
  }finally{await f.db.close();}
});
test('stage results are fenced after provider dispatch when the operator is revoked or dispatch is paused',async()=>{
  for(const mode of ['revoke','pause']) {
    const f=await fixture(),calls=[];
    try {
      const config=resolveProviderVerification(env,{fetchImpl:mockProvider(calls,{afterResponse:async()=>{
        if(mode==='revoke')await revokeOperator(f.pool,f.identity);
        else await saveOperatorControl(f.pool,f.identity,{requestId:randomUUID(),kind:'system',revision:0,jobsPaused:false,providerPaused:true,confirmed:true});
      }})});
      const result=await runProviderVerification(f.pool,f.identity,command('speech','en'),config);
      assert.equal(calls.length,1);assert.equal(result.state,'failed');assert.equal(result.diagnosticCode,'authority_changed');assert.equal(result.evidence,undefined);
      assert.equal((await f.run(client=>client.query('SELECT result_json FROM provider_verifications'))).rows[0].result_json,null);
    }finally{await f.db.close();}
  }
});
test('pending replay and elapsed deadlines return receipts without dispatching another test',async()=>{
  const f=await fixture({shortDeadline:true}),calls=[];let release,started;
  const ready=new Promise(resolve=>{started=resolve;}),hold=new Promise(resolve=>{release=resolve;});
  const base=resolveProviderVerification(env,{fetchImpl:mockProvider(calls)}),input=command('speech','en');
  const config={...base,async runStage(spec,journal){started();await hold;return base.runStage(spec,journal);}};
  try {
    const running=runProviderVerification(f.pool,f.identity,input,config);await ready;
    const replay=await runProviderVerification(f.pool,f.identity,input,config);assert.equal(replay.duplicate,true);assert.ok(['pending','interrupted'].includes(replay.state));assert.equal(calls.length,0);
    await new Promise(resolve=>setTimeout(resolve,25));const receipt=await operatorReceipt(f.pool,f.identity,input.requestId);assert.equal(receipt.result.state,'interrupted');
    release();const result=await running;assert.equal(result.state,'uncertain');assert.equal(result.diagnosticCode,'test_interrupted');assert.equal(result.evidence,undefined);assert.equal(calls.length,0);
    assert.equal((await runProviderVerification(f.pool,f.identity,input,base)).state,'uncertain');assert.equal(calls.length,0);
  }finally{release();await f.db.close();}
});
