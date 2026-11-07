import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {domainTransaction} from '../server/postgres/domain.mjs';
import {provisionOperator,authenticateOperator,revokeOperator} from '../server/postgres/operators.mjs';
import {saveOperatorControl,operatorReceipt} from '../server/postgres/operations.mjs';
import {readProviderControls,saveProviderPolicy,runProviderVerification} from '../server/postgres/provider-controls.mjs';
import {reserveProviderOperation,providerRequestJournal} from '../server/postgres/provider-budget.mjs';
import {resolveProviderVerification} from '../server/ai/provider-verification-config.mjs';
import {pipelineStatus} from '../server/ai/pipeline-status.mjs';
import {resolveCaseFollowup} from '../server/ai/case-followup-config.mjs';
import {resolveSourceTranscription} from '../server/ai/source-transcription-config.mjs';
import {createGeminiAdapter,GEMINI_MODELS} from '../server/ai/gemini.mjs';
import {CANONICAL_SOURCE} from '../server/domain.mjs';
import {syntheticPrepare} from '../server/domain.mjs';
import {inspectWav} from '../server/audio.mjs';
import {receiveSourceAudio,getSourceAudioReceipt} from '../server/postgres/source-audio.mjs';
import {processOneSourceAudio} from '../server/postgres/source-audio-worker.mjs';
import {resolveRecordingAdapter} from '../server/ai/recording-config.mjs';
import {receiveRecording} from '../server/postgres/recordings.mjs';
import {requestWorkerDeletion} from '../server/postgres/deletions.mjs';
import {rehearsalTasks} from '../server/postgres/runtime.mjs';
import {getProcessingProvenance} from '../server/postgres/processing-provenance.mjs';
import {checkedProviderHistory} from '../src/processing-provenance.ts';

const env={UNDERSTOOD_TIER:'local',UNDERSTOOD_AI_MODE:'synthetic',UNDERSTOOD_DATA_CLASS:'synthetic',UNDERSTOOD_ACCESS_MODE:'credential',UNDERSTOOD_PROVIDER_TESTS:'gemini-free',GEMINI_API_KEY:'synthetic-test-key'};
const verification=()=>({requestId:randomUUID(),kind:'provider-verification',maxRequests:1,confirmed:true});
const policy=(orgId,revision,maxDailyRequests,enabled=true)=>({requestId:randomUUID(),kind:'provider-policy',orgId,revision,maxDailyRequests,enabled,confirmed:true});
const reservation=()=>({orgId:null,kind:'connection-test',referenceId:randomUUID(),model:GEMINI_MODELS.text,dataClass:'synthetic',maxRequests:1});
async function fixture() {
  const db=new PGlite(),pool={async connect(){return {query:async(sql,values)=>values?.length?db.query(sql,values):(await db.exec(sql)).at(-1)??{rows:[]},release(){}};}};
  await runMigrations(pool);const run=fn=>domainTransaction(pool,'public',fn);
  await run(client=>client.query("INSERT INTO organizations VALUES('cedar','Cedar Works');INSERT INTO sites VALUES('beirut','cedar','Beirut','Asia/Beirut');INSERT INTO staff(id,org_id,site_id,name,role) VALUES('maya','cedar','beirut','Maya','owner')"));
  const password='Synthetic-operator-test-2026';await provisionOperator(pool,{id:randomUUID(),name:'Operator',email:'operator@example.test',password});
  const login=await authenticateOperator(pool,{email:'operator@example.test',password},'local');
  return {db,pool,run,identity:login.session};
}
test('provider quotas are closed by default, revision checked, receipt recoverable and conservatively reserved',async()=>{
  const f=await fixture(),{pool,identity,run}=f;
  try {
    const initial=await readProviderControls(pool,identity,resolveProviderVerification({}));assert.equal(initial.global.enabled,false);assert.equal(initial.productionReady,false);assert.equal(initial.billing.actualUsd,null);
    await assert.rejects(run(client=>reserveProviderOperation(client,reservation())),/quota is closed/);
    const command=policy(null,0,2);await saveProviderPolicy(pool,identity,command);assert.equal((await saveProviderPolicy(pool,identity,command)).duplicate,true);
    assert.equal((await operatorReceipt(pool,identity,command.requestId)).result.maxDailyRequests,2);
    await assert.rejects(saveProviderPolicy(pool,identity,{...command,maxDailyRequests:3}),/conflict/);
    await assert.rejects(saveProviderPolicy(pool,identity,policy(null,0,3)),/revision/);
    await run(client=>reserveProviderOperation(client,reservation()));await run(client=>reserveProviderOperation(client,reservation()));
    await assert.rejects(run(client=>reserveProviderOperation(client,reservation())),/quota reached/);
    const controls=await readProviderControls(pool,identity,null,{orgId:'cedar'});assert.equal(controls.usage.reservedRequests,2);assert.equal(controls.tenant.enabled,false);
    await assert.rejects(run(client=>client.query('DELETE FROM provider_operations')),/immutable/);
    await saveProviderPolicy(pool,identity,policy(null,1,0,false));
    assert.equal((await readProviderControls(pool,identity)).usage.reservedRequests,2);
  }finally{await f.db.close();}
});
test('fixed synthetic provider verification requires a quota, validates output and never repeats an accepted command',async()=>{
  const f=await fixture(),{pool,identity,run}=f;let calls=0;
  const mutable={...env},config=resolveProviderVerification(mutable,{fetchImpl:async(url,options)=>{
    calls++;assert.equal(options.headers['x-goog-api-key'],'synthetic-test-key');assert.match(options.body,/blue shelf/);
    const {title,facts,question,rubric}=syntheticPrepare(CANONICAL_SOURCE);
    return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({title,facts,question,askedFacts:rubric.askedFacts})}]}}]});
  }});mutable.GEMINI_API_KEY='changed-after-config';
  try {
    await assert.rejects(runProviderVerification(pool,identity,verification(),config),/quota is closed/);assert.equal(calls,0);
    await saveProviderPolicy(pool,identity,policy(null,0,3));const command=verification();
    assert.equal((await runProviderVerification(pool,identity,command,config)).state,'verified');assert.equal(calls,1);
    assert.equal((await runProviderVerification(pool,identity,command,config)).duplicate,true);assert.equal(calls,1);
    assert.equal((await operatorReceipt(pool,identity,command.requestId)).result.state,'verified');
    const pipeline=pipelineStatus({caseFollowupAdapter:resolveCaseFollowup({...env,UNDERSTOOD_CASE_FOLLOWUP_ADAPTER:'gemini'})});
    const report=await readProviderControls(pool,identity,config,{}, {pipeline});assert.equal(report.connection.state,'verified');assert.equal(report.sourceConnection,'unverified');assert.equal(report.productionReady,false);
    assert.equal(report.pipeline.stages.find(stage=>stage.id==='followup').configuration,'configured');
    assert.ok(report.pipeline.stages.every(stage=>stage.verification==='not_tested'));
    assert.doesNotMatch(JSON.stringify(report),/synthetic-test-key|changed-after-config|config_hash|session_hash|blue shelf/);
    assert.equal((await readProviderControls(pool,identity,resolveProviderVerification({...env,GEMINI_API_KEY:'rotated'}))).connection.state,'untested');
    await assert.rejects(saveOperatorPolicyCollision(),/conflict/);
    async function saveOperatorPolicyCollision(){return saveProviderPolicy(pool,identity,{...policy(null,1,3),requestId:command.requestId});}
    const uncertain=resolveProviderVerification(env,{fetchImpl:async()=>{calls++;throw Error('secret response detail');}});
    assert.equal((await runProviderVerification(pool,identity,verification(),uncertain)).state,'uncertain');
    const malformed=resolveProviderVerification(env,{fetchImpl:async()=>{calls++;return Response.json({});}});
    assert.equal((await runProviderVerification(pool,identity,verification(),malformed)).state,'failed');
    assert.equal((await readProviderControls(pool,identity,config)).usage.reservedRequests,3);
    await assert.rejects(run(client=>client.query("UPDATE provider_requests SET http_status=201 WHERE state='accepted'")),/immutable/);
    await assert.rejects(createGeminiAdapter({apiKey:'never-used',dataClass:'synthetic'}).prepare(CANONICAL_SOURCE),/budget is required/);
  }finally{await f.db.close();}
});
function wav(){const b=Buffer.alloc(32044);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(32000,40);b.writeInt16LE(1000,44);return b;}

test('scheduled recording pipeline meters allowlisted transcription and assessment and reuses the transcript after failure',async()=>{
  const f=await fixture(),{pool,identity,run}=f,objects=new Map(),audio=wav();let calls=0,assessmentCalls=0,failAssessment=true,pauseUpload=false;
  const answer='Finished blue; unfinished yellow.';
  const adapter=resolveRecordingAdapter({...env,UNDERSTOOD_RECORDING_ADAPTER:'gemini-free',UNDERSTOOD_SYNTHETIC_AUDIO_HASHES:JSON.stringify([inspectWav(audio).sha256])},{fetchImpl:async(url,options)=>{
    calls++;
    if(options.method==='DELETE')return new Response(null,{status:204});
    if(url.endsWith('/upload/v1beta/files'))return new Response('{}',{headers:{'x-goog-upload-url':'https://generativelanguage.googleapis.com/upload/synthetic'}});
    if(url.endsWith('/upload/synthetic')){
      if(pauseUpload)await saveOperatorControl(pool,identity,{requestId:randomUUID(),kind:'system',revision:0,jobsPaused:false,providerPaused:true,confirmed:true});
      return Response.json({file:{name:'files/synthetic',uri:'https://generativelanguage.googleapis.com/v1beta/files/synthetic'}});
    }
    if(url.endsWith('/interactions'))return Response.json({status:'completed',model:GEMINI_MODELS.transcription,steps:[{type:'model_output',content:[{type:'text',text:answer}]}]});
    assessmentCalls++;if(failAssessment)throw Error('Private provider error');
    return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({outcome:'matched',reasons:['asked_facts_present'],evidence:[{factIndex:0,quote:'Finished blue'},{factIndex:1,quote:'unfinished yellow'}]})}]}}]});
  }});
  const storage={save:async(row,bytes)=>objects.set(row.id,Buffer.from(bytes)),read:async row=>objects.get(row.id),remove:async row=>objects.delete(row.id)};
  try {
    await run(client=>client.query(`INSERT INTO workers(id,org_id,site_id,code,language) VALUES('w','cedar','beirut','001','en'),('w2','cedar','beirut','002','en');
      INSERT INTO briefings(id,org_id,site_id,title,source,state) VALUES('b','cedar','beirut','Synthetic','Synthetic','draft');
      INSERT INTO publications(id,org_id,site_id,briefing_id,version,snapshot_json,state) VALUES('p','cedar','beirut','b',1,
      '{"question":"Where?","rubric":{"askedFacts":["finished -> blue shelf","unfinished -> yellow shelf"]}}','published');
      INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,language) VALUES('a','cedar','beirut','p','w','en'),('a2','cedar','beirut','p','w2','en')`));
    const worker={principal_type:'worker',principal_id:'w',org_id:'cedar',site_id:'beirut'};
    const worker2={principal_type:'worker',principal_id:'w2',org_id:'cedar',site_id:'beirut'};
    const receipt=await receiveRecording(pool,worker,'a',randomUUID(),audio,storage);
    const task=rehearsalTasks(pool,storage,{schema:'public',recordingAdapter:adapter}).recording;
    await saveProviderPolicy(pool,identity,policy(null,0,10));await saveProviderPolicy(pool,identity,policy('cedar',0,3));
    assert.equal(await task(),true);assert.equal(calls,0);
    await saveProviderPolicy(pool,identity,policy('cedar',1,10));await run(client=>client.query('UPDATE recordings SET retry_at=NULL'));
    assert.equal(await task(),true);assert.equal(calls,5);assert.equal(assessmentCalls,1);
    const pending=(await run(client=>client.query('SELECT transcript,status,error,transcription_operation_id,assessment_operation_id FROM recordings WHERE id=$1',[receipt.id]))).rows[0];
    assert.equal(pending.transcript,answer);assert.equal(pending.status,'received');assert.equal(pending.error,'Recording AI processing failed');
    assert.ok(pending.transcription_operation_id);assert.equal(pending.assessment_operation_id,null);
    failAssessment=false;await run(client=>client.query('UPDATE recordings SET retry_at=NULL'));assert.equal(await task(),true);
    assert.equal(calls,6);assert.equal(assessmentCalls,2);assert.equal(await task(),false);
    assert.equal((await run(client=>client.query('SELECT status FROM recordings WHERE id=$1',[receipt.id]))).rows[0].status,'transcribed');
    assert.equal((await run(client=>client.query('SELECT outcome,assessment_status FROM attempts'))).rows[0].outcome,'matched');
    assert.equal((await run(client=>client.query('SELECT count(*)::int n FROM submission_receipts'))).rows[0].n,1);
    const operations=(await run(client=>client.query('SELECT id,kind,reserved_requests,input_hash,provenance_json FROM provider_operations ORDER BY created_at'))).rows;
    assert.deepEqual(operations.map(row=>[row.kind,row.reserved_requests]),[['recording-transcription',4],['recording-assessment',1],['recording-assessment',1]]);
    const completed=(await run(client=>client.query('SELECT transcription_operation_id,assessment_operation_id FROM recordings WHERE id=$1',[receipt.id]))).rows[0];
    assert.equal(completed.transcription_operation_id,pending.transcription_operation_id);
    assert.equal(completed.transcription_operation_id,operations[0].id);
    assert.equal(completed.assessment_operation_id,operations[2].id);
    assert.ok(operations.every(row=>/^[a-f0-9]{64}$/.test(row.input_hash)&&row.provenance_json.dataClass==='synthetic'));
    await assert.rejects(run(client=>client.query('UPDATE recordings SET transcript=NULL WHERE id=$1',[receipt.id])),/Provider transcript is immutable/);
    const requests=(await run(client=>client.query('SELECT state,cleanup FROM provider_requests ORDER BY created_at'))).rows;
    assert.equal(requests.length,6);assert.equal(requests.filter(row=>row.state==='uncertain').length,1);assert.equal(requests.filter(row=>row.cleanup).length,1);
    const historyOwner={principal_type:'staff',principal_id:'maya',org_id:'cedar',site_id:'beirut',role:'owner'},voiceJob=`response_transcription:${receipt.id}`;
    const history=await getProcessingProvenance(pool,historyOwner,voiceJob);assert.equal(history.total,3);
    checkedProviderHistory(history,{id:voiceJob,kind:'response_transcription',publication_id:'p',publication_version:1,assignment_id:'a'},1);
    assert.equal(history.items.filter(row=>row.resultReference==='transcription').length,1);assert.equal(history.items.filter(row=>row.resultReference==='assessment').length,1);
    assert.equal(history.items.filter(row=>row.currentRun).length,0);assert.equal(new Set(history.items.map(row=>row.runId)).size,2);
    assert.equal(history.items.flatMap(row=>row.requests).length,6);assert.equal(history.items.flatMap(row=>row.requests).filter(row=>row.state==='uncertain').length,1);
    assert.doesNotMatch(JSON.stringify(history),/Finished blue|unfinished yellow|input_hash|claim_token|lease_token|sha256|synthetic-test-key|snapshot_json|storage/);
    const second=await receiveRecording(pool,worker2,'a2',randomUUID(),audio,storage);pauseUpload=true;await task();
    assert.equal(calls,9);assert.equal(assessmentCalls,2);assert.equal(await task(),false);
    const stopped=(await run(client=>client.query('SELECT status,transcript FROM recordings WHERE id=$1',[second.id]))).rows[0];
    assert.equal(stopped.status,'received');assert.equal(stopped.transcript,null);
    const cleanup=(await run(client=>client.query('SELECT cleanup,state FROM provider_requests ORDER BY created_at'))).rows.at(-1);
    assert.deepEqual(cleanup,{cleanup:true,state:'accepted'});
    assert.equal((await run(client=>client.query('SELECT count(*)::int n FROM attempts'))).rows[0].n,1);
    const owner={principal_type:'staff',principal_id:'maya',org_id:'cedar',site_id:'beirut',role:'owner'};
    await requestWorkerDeletion(pool,owner,'w',{requestId:randomUUID(),expectedCode:'001',reason:'worker_request',confirmed:true});
    const redacted=(await run(client=>client.query('SELECT status,transcript,transcription_operation_id,assessment_operation_id FROM recordings WHERE id=$1',[receipt.id]))).rows[0];
    assert.deepEqual(redacted,{status:'failed',transcript:null,...completed});
    assert.deepEqual((await run(client=>client.query('SELECT id,kind,reserved_requests,input_hash,provenance_json FROM provider_operations WHERE id=ANY($1::text[]) ORDER BY created_at',[operations.map(row=>row.id)]))).rows,operations);
    assert.equal(await task(),false);assert.equal(calls,9);
  }finally{await f.db.close();}
});
test('allowlisted synthetic source uses tenant and global quotas; pause blocks new dispatch but keeps reserved cleanup',async()=>{
  const f=await fixture(),{pool,identity,run}=f,objects=new Map(),source=wav(),owner={principal_type:'staff',principal_id:'maya',org_id:'cedar',site_id:'beirut',role:'owner'};
  const storage={save:async(r,b)=>objects.set(r.id,Buffer.from(b)),saveOriginal:async(r,b)=>objects.set(r.id,Buffer.from(b)),read:async r=>Buffer.from(objects.get(r.id)),readOriginal:async r=>Buffer.from(objects.get(r.id))};
  const upload=async()=>{const input={requestId:randomUUID(),title:'Synthetic source',originalType:'audio/webm',generationLanguages:['en','ar']};await receiveSourceAudio(pool,owner,input,Buffer.from('Synthetic original'),source,storage);return input;};
  let calls=0,pause=false;
  const adapter=resolveSourceTranscription({...env,UNDERSTOOD_SOURCE_TRANSCRIPTION:'gemini-free',UNDERSTOOD_SYNTHETIC_AUDIO_HASHES:JSON.stringify([inspectWav(source).sha256])},{fetchImpl:async(url,options)=>{
    calls++;if(options.method==='DELETE')return new Response(null,{status:204});
    if(url.endsWith('/upload/v1beta/files'))return new Response('{}',{headers:{'x-goog-upload-url':'https://generativelanguage.googleapis.com/upload/synthetic'}});
    if(url.endsWith('/upload/synthetic')){
      if(pause)await saveOperatorControl(pool,identity,{requestId:randomUUID(),kind:'system',revision:0,jobsPaused:false,providerPaused:true,confirmed:true});
      return Response.json({file:{name:'files/synthetic',uri:'https://generativelanguage.googleapis.com/v1beta/files/synthetic'}});
    }
    return Response.json({status:'completed',model:GEMINI_MODELS.transcription,steps:[{type:'model_output',content:[{type:'text',text:CANONICAL_SOURCE}]}]});
  }});
  try {
    await saveProviderPolicy(pool,identity,policy(null,0,12));const first=await upload();
    await processOneSourceAudio(pool,adapter,storage);assert.equal(calls,0);
    await saveProviderPolicy(pool,identity,policy('cedar',0,3));await run(client=>client.query('UPDATE source_audio_requests SET retry_at=NULL'));
    await processOneSourceAudio(pool,adapter,storage);assert.equal(calls,0);
    await saveProviderPolicy(pool,identity,policy('cedar',1,8));await run(client=>client.query('UPDATE source_audio_requests SET retry_at=NULL'));
    await processOneSourceAudio(pool,adapter,storage);assert.equal(calls,4);assert.equal((await getSourceAudioReceipt(pool,owner,first.requestId)).status,'transcribed');
    const sourceHistory=await getProcessingProvenance(pool,owner,`source_transcription:${first.requestId}`);assert.equal(sourceHistory.total,1);assert.equal(sourceHistory.items[0].resultReference,'transcription');
    assert.equal(sourceHistory.items[0].requests.length,4);assert.equal(sourceHistory.items[0].requests.filter(row=>row.cleanup).length,1);
    const second=await upload();pause=true;await processOneSourceAudio(pool,adapter,storage);assert.equal(calls,7);
    const requests=(await run(client=>client.query('SELECT cleanup,state FROM provider_requests ORDER BY created_at,sequence'))).rows;
    assert.equal(requests.at(-1).cleanup,true);assert.equal(requests.at(-1).state,'accepted');
    assert.notEqual((await getSourceAudioReceipt(pool,owner,second.requestId)).status,'transcribed');
    assert.equal((await readProviderControls(pool,identity,null,{orgId:'cedar'})).usage.tenantReservedRequests,8);
    assert.equal(await processOneSourceAudio(pool,adapter,storage),false);
    await assert.rejects(run(client=>reserveProviderOperation(client,reservation())),/dispatch paused/);
  }finally{await f.db.close();}
});
test('verification dispatch rechecks operator session and exposes no credentials when disabled',async()=>{
  const f=await fixture(),{pool,identity,run}=f;let calls=0;
  try {
    assert.throws(()=>resolveProviderVerification({...env,UNDERSTOOD_DATA_CLASS:'real'}),/isolated synthetic/);
    assert.equal(resolveProviderVerification({GEMINI_API_KEY:'present'}).metadata.testEnabled,false);
    await saveProviderPolicy(pool,identity,policy(null,0,2));const base=resolveProviderVerification(env,{fetchImpl:async()=>{calls++;throw Error('Must not dispatch');}});
    const config={...base,async run(journal){await revokeOperator(pool,identity);return base.run(journal);}};
    assert.equal((await runProviderVerification(pool,identity,verification(),config)).state,'failed');assert.equal(calls,0);
    assert.equal((await run(client=>client.query('SELECT COUNT(*)::int n FROM provider_operations'))).rows[0].n,1);
    assert.equal((await run(client=>client.query('SELECT COUNT(*)::int n FROM provider_requests'))).rows[0].n,0);
  }finally{await f.db.close();}
});
