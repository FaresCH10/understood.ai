import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {bootstrapWorkspace} from '../server/postgres/workspace-bootstrap.mjs';
import {authenticateStaff,requireSession,issueWorkerGrant,redeemWorkerGrant,revokeWorkerGrant} from '../server/postgres/auth.mjs';
import {createWorker} from '../server/postgres/people.mjs';
import {receiveSourceAudio,getSourceAudioReceipt,getSourceAudio} from '../server/postgres/source-audio.mjs';
import {createDraft,queuePreparation,editDraft} from '../server/postgres/preparation.mjs';
import {readGlossarySnapshot} from '../server/postgres/glossary.mjs';
import {domainTransaction,publish,submitAnswer} from '../server/postgres/domain.mjs';
import {getAssignmentSpeech} from '../server/postgres/generated-audio.mjs';
import {receiveRecording} from '../server/postgres/recordings.mjs';
import {requestHelp} from '../server/postgres/clarifications.mjs';
import {queueCaseFollowup,followupReceipt,getCaseFollowupAudio} from '../server/postgres/case-followups.mjs';
import {receiveCaseVoice,caseVoiceReceipt,getCaseVoiceAudio} from '../server/postgres/case-voice.mjs';
import {privateObjectInventory} from '../server/postgres/backup.mjs';
import {readPublicationReport} from '../server/postgres/reports.mjs';
import {rehearsalTasks} from '../server/postgres/runtime.mjs';
import {resolveSourceTranscription} from '../server/ai/source-transcription-config.mjs';
import {resolvePreparationAdapter,preparationInputHash} from '../server/ai/preparation-config.mjs';
import {resolveAssessmentAdapter,assessmentInputHash} from '../server/ai/assessment-config.mjs';
import {resolveRecordingAdapter} from '../server/ai/recording-config.mjs';
import {resolveCaseFollowup} from '../server/ai/case-followup-config.mjs';
import {readEvaluationObservations,UNKNOWN_EVALUATION_PROVENANCE} from '../server/postgres/evaluation-observations.mjs';
import {evaluationDataset,sampleInput,evaluateDataset} from './runner.mjs';
import {observedEvaluator} from './evaluators.mjs';
import {scriptedProvider} from './scripted-provider.mjs';
import {bundleHash} from '../server/ai/prepared-bundle.mjs';
import {encodeWav} from '../src/audio.ts';
import {sourceTranscriptionInputHash,recordingTranscriptionInputHash} from '../server/ai/audio-provenance.mjs';
import {caseFollowupInputHash} from '../server/ai/case-followup-bundle.mjs';
import {preparationBundleOperations} from '../server/postgres/preparation-evidence.mjs';
import {configureRuntimePermissions,verifyRuntimePermissions} from '../server/postgres/runtime-permissions.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const wav=amplitude=>Buffer.from(encodeWav({duration:1,sampleRate:16000,numberOfChannels:1,
  getChannelData:()=>Float32Array.from({length:16000},(_,i)=>Math.sin(i/10)*amplitude)}));
export const PIPELINE_AUDIO_HASHES=Object.freeze([.2,.15,.25,.18].map(amplitude=>hash(wav(amplitude))));
const faithful={faithful:true,complete:true,languageCorrect:true,terminologyApplied:true,reasons:[]};
const freeze=value=>{if(value && typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
export const PIPELINE_DATASET=evaluationDataset(JSON.parse(readFileSync(new URL('./pipeline-v1.json',import.meta.url),'utf8')));

function privateMemoryStore() {
  const objects=new Map(),key=(row,original)=>JSON.stringify([original?'original':'canonical',row.org_id,row.site_id,row.id]);
  const save=(row,bytes,original=false)=>{const id=key(row,original),value=Buffer.from(bytes),old=objects.get(id);
    if(old && !old.equals(value))throw Error('Private fixture object conflict');objects.set(id,value);};
  const read=(row,original=false)=>{const value=objects.get(key(row,original));if(!value)throw Error('Private fixture object unavailable');return Buffer.from(value);};
  return {async save(row,bytes){save(row,bytes);},async read(row){return read(row);},async remove(row){objects.delete(key(row,false));},
    async exists(row){return objects.has(key(row,false));},async saveOriginal(row,bytes){save(row,bytes,true);},
    async readOriginal(row){return read(row,true);},async removeOriginal(row){objects.delete(key(row,true));},get count(){return objects.size;}};
}

// No caller-supplied connection, credential, provider transport or fixture content.
export async function runPipelineRehearsal({onStage=()=>{}}={}) {
  return runSyntheticPipeline({onStage,storage:privateMemoryStore(),storageAdapter:'scoped-in-memory-fixture'});
}

// Only the storage transport varies: data, in-memory DB and provider responses
// remain fixed. Live use belongs to the explicitly confirmed Neon test runner.
export async function runPrivateStorageApplicationRehearsal(storage,{onStage=()=>{},onInventory=()=>{}}={}) {
  if(!['save','read','remove','exists','saveOriginal','readOriginal','removeOriginal','existsOriginal']
    .every(method=>typeof storage?.[method]==='function'))throw Error('Complete private test storage is required');
  return runSyntheticPipeline({onStage,onInventory,storage,storageAdapter:'explicit-private-test-adapter'});
}

async function runSyntheticPipeline({onStage,storage,storageAdapter,onInventory=()=>{}}) {
  const startedAt=new Date().toISOString(),schema=`understood_test_pipeline_${randomUUID().replaceAll('-','')}`;
  const db=new PGlite(),pool={async connect(){return {query:async(sql,args)=>args?.length ? db.query(sql,args) : (await db.exec(sql)).at(-1) ?? {rows:[]},release(){}};}};
  const options={schema},checks=[],mock=scriptedProvider();
  const env={UNDERSTOOD_TIER:'local',UNDERSTOOD_AI_MODE:'synthetic',UNDERSTOOD_ACCESS_MODE:'credential',UNDERSTOOD_DATA_CLASS:'synthetic',GEMINI_API_KEY:'scripted-provider-only-not-a-key'};
  const config={...options,tier:'local',aiMode:'synthetic',accessMode:'credential',integrationMode:'synthetic',dataClass:'synthetic'};
  const apiRole='understood_pipeline_api',workerRole='understood_pipeline_worker',workerStages=new Set(),apiStages=new Set(),maintenanceStages=[];
  let workerTaskActive=false,apiTaskActive=false,workerTaskExecutions=0,apiTaskExecutions=0,workerPolicy,apiPolicy;
  const identity=async()=>{
    const row=(await db.query('SELECT current_user AS current,session_user AS session')).rows[0];
    assert.equal(row.current,row.session);assert.ok(['postgres',apiRole,workerRole].includes(row.session));return row.session;
  };
  // PGlite has one SQL session: switch only around a whole awaited operation,
  // and restore its caller's identity after nested worker/maintenance work.
  const inRole=async(role,operation)=>{
    const previous=await identity();if(previous!==role)await db.exec(`SET SESSION AUTHORIZATION ${role}`);
    try{assert.equal(await identity(),role);return await operation();}
    finally{
      try{assert.equal(await identity(),role);}
      finally{if(previous!==role)await db.exec(`SET SESSION AUTHORIZATION ${previous}`);assert.equal(await identity(),previous);}
    }
  };
  const maintenance=async(name,operation)=>inRole('postgres',async()=>{const result=await operation();maintenanceStages.push(name);return result;});
  const check=async(name,operation)=>{
    await onStage(name);assert.equal(apiTaskActive,false);apiTaskActive=true;
    try{await inRole(apiRole,operation);apiTaskExecutions++;apiStages.add(name);checks.push({name,status:'passed'});}
    finally{apiTaskActive=false;}
  };
  const pipelineTasks=stageConfig=>Object.fromEntries(Object.entries(rehearsalTasks(pool,storage,stageConfig)).map(([name,task])=>[name,async()=>{
    assert.equal(workerTaskActive,false,'Pipeline worker tasks must stay serialized');workerTaskActive=true;
    try {
      const result=await inRole(workerRole,task);workerTaskExecutions++;workerStages.add(name);return result;
    }finally{workerTaskActive=false;}
  }]));
  const session=token=>requireSession(pool,{headers:{cookie:`understood_session=${token}`}},options);
  const publication=PIPELINE_DATASET.publications[0],content={title:'Carton handover',facts:publication.askedFacts,question:publication.question,askedFacts:publication.askedFacts};
  const choices=['Put 12 cartons at bay 4 and keep the exit clear.','Put 4 cartons at bay 12 and keep the exit clear.','Put 12 cartons at bay 4 and block the exit.','Put 12 cartons at bay 7 and keep the exit clear.'];
  content.choices=choices;
  const english={title:'Synthetic carton source',text:publication.source,question:publication.question,answerChoices:choices};
  const arabic={title:'تسليم الصناديق',text:'ضع 12 صندوقاً في المنطقة 4. أبق المخرج خالياً.',question:publication.languageQuestions.ar};
  arabic.answerChoices=['ضع 12 صندوقاً في المنطقة 4 وأبق المخرج خالياً.','ضع 4 صناديق في المنطقة 12 وأبق المخرج خالياً.','ضع 12 صندوقاً في المنطقة 4 وأغلق المخرج.','ضع 12 صندوقاً في المنطقة 7 وأبق المخرج خالياً.'];
  const sourceBytes=wav(.2),answerBytes=wav(.15),speechBytes=wav(.25),voiceBytes=wav(.18);
  let owner,scope,draftId,pub,snapshot,typedEvaluation,recordedEvaluation,sourceEvidence,preparationEvidence,followupEvidence,metrics,voice;
  const workers=[],bindings=[];
  try {
    await db.exec(`CREATE SCHEMA ${schema};SET search_path TO ${schema},pg_catalog`);await runMigrations(pool,options);
    await db.exec(`CREATE ROLE ${apiRole} LOGIN;CREATE ROLE ${workerRole} LOGIN`);
    await configureRuntimePermissions(pool,{...options,role:apiRole,profile:'application',dedicatedDatabase:true,writersStopped:true});
    await configureRuntimePermissions(pool,{...options,role:workerRole,profile:'worker',dedicatedDatabase:true,writersStopped:true});
    await inRole(apiRole,async()=>{apiPolicy=await verifyRuntimePermissions(pool,{...options,role:apiRole,profile:'application'});});
    await inRole(workerRole,async()=>{workerPolicy=await verifyRuntimePermissions(pool,{...options,role:workerRole,profile:'worker'});});
    await check('credential_bootstrap_and_worker_grants',async()=>{
      const input={requestId:randomUUID(),synthetic:true,confirmed:true,organizationName:'Synthetic pipeline workshop',siteName:'Synthetic Beirut site',
        timezone:'Asia/Beirut',generationLanguages:['en','ar'],supportEmail:'support@example.test',
        owner:{name:'Synthetic owner',email:'pipeline-owner@example.test',password:`Synthetic-${randomBytes(20).toString('hex')}`}};
      await maintenance('workspace-bootstrap',async()=>{scope=await bootstrapWorkspace(pool,input,config);assert.equal((await bootstrapWorkspace(pool,input,config)).duplicate,true);});
      const login=await authenticateStaff(pool,input.owner.email,input.owner.password,'synthetic-pipeline',options);owner=await session(login.session.token);
      assert.equal(owner.principal_id,scope.ownerId);
      for(const [index,language] of [...PIPELINE_DATASET.samples.map(item=>item.language),'ar'].entries()) {
        const worker=await createWorker(pool,owner,{code:`Synthetic ${index+1}`,language},options);
        const grant=await issueWorkerGrant(pool,owner,worker.id,240,options),redeemed=await redeemWorkerGrant(pool,grant.token,options);
        await assert.rejects(redeemWorkerGrant(pool,grant.token,options),/Invalid credentials/);
        workers.push({id:worker.id,grantId:grant.id,token:redeemed.token,session:await session(redeemed.token)});
      }
      // Maintenance policies in this fresh disposable schema, not fabricated business results.
      await maintenance('provider-policy-fixture',async()=>{await db.query(`INSERT INTO provider_policies(scope_key,org_id,revision,enabled,max_daily_requests)
        VALUES('global',NULL,1,true,24),($1,$2,1,true,24)`,[`tenant:${scope.orgId}`,scope.orgId]);
      await db.exec("INSERT INTO system_controls(id,revision,jobs_paused,provider_paused) VALUES('global',1,false,false)");});
    });
    await check('private_source_upload_transcription_and_replay',async()=>{
      const input={requestId:randomUUID(),title:'Synthetic carton source',originalType:'audio/wav',generationLanguages:['en','ar']};
      const receipt=await receiveSourceAudio(pool,owner,input,sourceBytes,sourceBytes,storage,options);draftId=input.requestId;
      assert.equal(receipt.status,'received');assert.equal((await receiveSourceAudio(pool,owner,input,sourceBytes,sourceBytes,storage,options)).duplicate,true);
      assert.deepEqual(await getSourceAudio(pool,owner,draftId,storage,'canonical',options),sourceBytes);
      assert.deepEqual(await getSourceAudio(pool,owner,draftId,storage,'original',options),sourceBytes);
      await assert.rejects(getSourceAudio(pool,workers[0].session,draftId,storage,'canonical',options),/Forbidden/);
      await assert.rejects(getSourceAudio(pool,workers[0].session,draftId,storage,'original',options),/Forbidden/);
      mock.transcription('source',sourceBytes,publication.source);
      const sourceAdapter=resolveSourceTranscription({...env,UNDERSTOOD_SOURCE_TRANSCRIPTION:'gemini-free',
        UNDERSTOOD_SYNTHETIC_AUDIO_HASHES:JSON.stringify([hash(sourceBytes)])},{fetchImpl:mock.fetchImpl});
      const tasks=pipelineTasks({...config,sourceAdapter});
      await maintenance('pause-provider',()=>db.exec("UPDATE system_controls SET provider_paused=true WHERE id='global'"));
      assert.equal(await tasks.sourceTranscription(),false);assert.equal(mock.requestCount,0);
      await maintenance('resume-provider',()=>db.exec("UPDATE system_controls SET provider_paused=false WHERE id='global'"));
      assert.equal(await tasks.sourceTranscription(),true);assert.equal(await tasks.sourceTranscription(),false);
      const completed=await getSourceAudioReceipt(pool,owner,draftId,options);assert.equal(completed.status,'transcribed');assert.equal(completed.briefingId,draftId);
      assert.equal((await db.query('SELECT source FROM briefings WHERE id=$1',[draftId])).rows[0].source,publication.source);
      const row=(await db.query('SELECT * FROM source_audio_requests WHERE request_id=$1',[draftId])).rows[0];
      const operation=(await db.query('SELECT * FROM provider_operations WHERE id=$1',[row.transcription_operation_id])).rows[0];
      assert.equal(operation.input_hash,sourceTranscriptionInputHash(row));assert.deepEqual(operation.provenance_json,sourceAdapter.transcriptionProvenance);
      sourceEvidence={inputHash:operation.input_hash,provenance:operation.provenance_json};
      await assert.rejects(db.query('UPDATE source_audio_requests SET transcription_operation_id=NULL WHERE request_id=$1',[draftId]),/immutable/);
    });
    await check('automatic_preparation_translation_private_speech',async()=>{
      mock.structured('prepare',{source:publication.source,review:null},content,'askedFacts');
      mock.structured('grounding',{source:publication.source,candidate:content},{sourceGrounded:true,questionAligned:true,choicesAligned:true,ambiguous:false,
        factEvidence:publication.askedFacts.map((quote,factIndex)=>({factIndex,quote})),askedFactIndexes:[0,1],reasons:[]},'factEvidence');
      mock.structured('translate',{content:english,terms:[]},arabic,'title');
      mock.structured('translation-check',{content:english,translation:arabic,language:'ar',terms:[]},faithful,'faithful');
      for(const [language,value] of [['en',english],['ar',arabic]])for(const kind of ['body','question'])mock.speech(`speech.${language}.${kind}`,kind==='body'?value.text:value.question,speechBytes);
      const glossary=await readGlossarySnapshot({query:(sql,args)=>db.query(sql,args)},scope.orgId,scope.siteId);
      const input={source:publication.source,title:english.title,revision:1,languages:['en','ar'],review:null,glossary};
      const preparationAdapter=resolvePreparationAdapter({...env,UNDERSTOOD_PREPARATION_ADAPTER:'gemini-free',
        UNDERSTOOD_SYNTHETIC_PREPARATION_HASHES:JSON.stringify([preparationInputHash(input)])},{fetchImpl:mock.fetchImpl});
      await queuePreparation(pool,owner,draftId,1,options);
      const tasks=pipelineTasks({...config,preparationAdapter});assert.equal(await tasks.preparation(),true);assert.equal(await tasks.preparation(),false);
      assert.equal((await db.query('SELECT state FROM briefings WHERE id=$1',[draftId])).rows[0].state,'ready',JSON.stringify((await db.query('SELECT stage,state,error_code FROM preparation_stage_events ORDER BY step')).rows));assert.equal(mock.requestCount,12);
      const bundle=(await db.query("SELECT * FROM generated_bundles WHERE briefing_id=$1 AND revision=1 AND state='attached'",[draftId])).rows[0];
      const operations=(await preparationBundleOperations(db,bundle)).sort((a,b)=>a.preparation_context_json.step-b.preparation_context_json.step);
      const argumentsByStep=[[publication.source,{review:null,multipleChoice:true}],[publication.source,content],[english,'ar',{terms:[]}],[english,arabic,'ar',{terms:[]}],
        [english.text,'en'],[english.question,'en'],[arabic.text,'ar'],[arabic.question,'ar']];
      assert.equal(operations.length,8);
      preparationEvidence=[];
      for(const [index,operation] of operations.entries()) {
        const context=operation.preparation_context_json;
        assert.equal(context.rootHash,preparationInputHash(input));assert.equal(context.argumentsHash,bundleHash(argumentsByStep[index]));
        const terminal=(await db.query(`SELECT state FROM preparation_stage_events WHERE job_id=$1 AND run_id=$2 AND step=$3 AND state<>'started'`,
          [bundle.job_id,bundle.job_lease,context.step])).rows;
        assert.deepEqual(terminal,[{state:'completed'}]);
        preparationEvidence.push({step:context.step,stage:context.stage,language:context.language,track:context.track,inputHash:operation.input_hash,
          rootHash:context.rootHash,argumentsHash:context.argumentsHash,provenance:operation.provenance_json,stageState:terminal[0].state});
      }
    });
    await check('ordinary_publication_private_assignment_playback',async()=>{
      const input={requestId:randomUUID(),revision:1,nextVersion:1,workerIds:workers.map(worker=>worker.id)};
      pub=await publish(pool,owner,draftId,input,{...options,integrationMode:'synthetic',storage});
      assert.equal((await publish(pool,owner,draftId,input,{...options,integrationMode:'synthetic',storage})).duplicate,true);
      snapshot=(await db.query('SELECT snapshot_json FROM publications WHERE id=$1',[pub.id])).rows[0].snapshot_json;
      assert.deepEqual(snapshot.rubric.askedFacts,publication.askedFacts);assert.equal(snapshot.languages.ar.question,arabic.question);
      for(const worker of workers) {
        worker.assignmentId=(await db.query('SELECT id FROM assignments WHERE worker_id=$1 AND publication_id=$2',[worker.id,pub.id])).rows[0].id;
        for(const kind of ['body','question'])assert.deepEqual(await getAssignmentSpeech(pool,worker.session,worker.assignmentId,kind,storage,options),speechBytes);
      }
      await assert.rejects(getAssignmentSpeech(pool,workers[1].session,workers[0].assignmentId,'question',storage,options),/unavailable|Forbidden/);
      await editDraft(pool,owner,draftId,{revision:1,title:'Later synthetic draft',source:'Put 5 cartons at bay 7.'},options);
      assert.equal(bundleHash((await db.query('SELECT snapshot_json FROM publications WHERE id=$1',[pub.id])).rows[0].snapshot_json),bundleHash(snapshot));
    });
    await check('historical_written_question_fixture',async()=>{
      // The current creation path above exercises checked MCQs. Written answers
      // and recordings below explicitly exercise a retained pre-MCQ publication.
      const title='Historical carton instruction';
      const historical=await createDraft(pool,owner,{requestId:randomUUID(),title,source:publication.source,generationLanguages:['en','ar']},options);
      const {answerChoices:enChoices,...en}=english,{answerChoices:arChoices,...ar}=arabic;
      const prepared={title,source:publication.source,question:publication.question,facts:publication.askedFacts,rubric:{askedFacts:publication.askedFacts},
        languages:{en:{...en,title,speech:'device-synthesis-demo'},ar:{...ar,speech:'device-synthesis-demo'}},provenance:{adapter:'synthetic-local-v1',live:false}};
      await maintenance('historical-written-question-fixture',()=>db.query("UPDATE briefings SET state='ready',prepared_json=$2 WHERE id=$1",[historical.id,JSON.stringify(prepared)]));
      pub=await publish(pool,owner,historical.id,{requestId:randomUUID(),revision:1,nextVersion:1,workerIds:workers.map(worker=>worker.id)},{...options,integrationMode:'synthetic'});
      snapshot=(await db.query('SELECT snapshot_json FROM publications WHERE id=$1',[pub.id])).rows[0].snapshot_json;
      for(const worker of workers)worker.assignmentId=(await db.query('SELECT id FROM assignments WHERE worker_id=$1 AND publication_id=$2',[worker.id,pub.id])).rows[0].id;
    });
    await check('typed_frozen_version_assessments_and_replay',async()=>{
      const inputs=[];
      for(const [index,sample] of PIPELINE_DATASET.samples.entries()) {
        const worker=workers[index],submissionId=randomUUID(),input={...sampleInput(PIPELINE_DATASET,sample),publicationId:pub.id};inputs.push(input);
        const result={outcome:sample.expected,reasons:[sample.expected==='matched'?'asked_facts_present':sample.expected==='clarification'?'missing_asked_fact':'untrusted_instruction'],
          evidence:sample.expected==='matched'?publication.askedFacts.map((_,factIndex)=>({factIndex,quote:sample.answer})):[]};
        mock.structured(`assessment.${sample.id}`,{answer:input.answer,question:input.question,askedFacts:input.askedFacts},result,'outcome');
        const receipt=await submitAnswer(pool,worker.session,worker.assignmentId,submissionId,sample.answer,options);
        assert.equal(receipt.assessmentStatus,'pending');bindings.push({sampleId:sample.id,attemptId:receipt.id});
        assert.equal((await submitAnswer(pool,worker.session,worker.assignmentId,submissionId,sample.answer,options)).duplicate,true);
      }
      const assessmentAdapter=resolveAssessmentAdapter({...env,UNDERSTOOD_ASSESSMENT_ADAPTER:'gemini-free',
        UNDERSTOOD_SYNTHETIC_ASSESSMENT_HASHES:JSON.stringify(inputs.map(assessmentInputHash))},{fetchImpl:mock.fetchImpl});
      const tasks=pipelineTasks({...config,assessmentAdapter});for(const _ of inputs)assert.equal(await tasks.assessment(),true);assert.equal(await tasks.assessment(),false);
      const before=bundleHash((await db.query('SELECT * FROM provider_requests ORDER BY id')).rows);
      const observations=await readEvaluationObservations(pool,PIPELINE_DATASET,{orgId:scope.orgId,siteId:scope.siteId,bindings,confirmedSynthetic:true},options);
      typedEvaluation=await evaluateDataset(PIPELINE_DATASET,{mode:'observed-runtime',provenance:UNKNOWN_EVALUATION_PROVENANCE,evaluate:observedEvaluator(observations)});
      assert.equal(typedEvaluation.metrics.completed,4);assert.equal(typedEvaluation.metrics.outcomeDisagreements,0);
      assert.equal(bundleHash((await db.query('SELECT * FROM provider_requests ORDER BY id')).rows),before);
    });
    await check('private_recorded_answer_exact_publication_and_replay',async()=>{
      const worker=workers[4],submissionId=randomUUID(),answer=PIPELINE_DATASET.samples[2].answer;
      const receipt=await receiveRecording(pool,worker.session,worker.assignmentId,submissionId,answerBytes,storage,options);
      assert.equal((await receiveRecording(pool,worker.session,worker.assignmentId,submissionId,answerBytes,storage,options)).duplicate,true);
      mock.transcription('recording',answerBytes,answer);
      mock.structured('recording.assessment',{answer,question:arabic.question,askedFacts:publication.askedFacts},
        {outcome:'matched',reasons:['asked_facts_present'],evidence:publication.askedFacts.map((_,factIndex)=>({factIndex,quote:answer}))},'outcome');
      const recordingAdapter=resolveRecordingAdapter({...env,UNDERSTOOD_RECORDING_ADAPTER:'gemini-free',
        UNDERSTOOD_SYNTHETIC_AUDIO_HASHES:JSON.stringify([hash(answerBytes)])},{fetchImpl:mock.fetchImpl});
      const tasks=pipelineTasks({...config,recordingAdapter});assert.equal(await tasks.recording(),true);assert.equal(await tasks.recording(),false);
      assert.equal((await db.query('SELECT status FROM recordings WHERE id=$1',[receipt.id])).rows[0].status,'transcribed');
      const attempt=(await db.query('SELECT id,outcome FROM attempts WHERE assignment_id=$1',[worker.assignmentId])).rows[0];assert.equal(attempt.outcome,'matched');
      const row=(await db.query('SELECT * FROM recordings WHERE id=$1',[receipt.id])).rows[0];
      const operation=(await db.query('SELECT * FROM provider_operations WHERE id=$1',[row.transcription_operation_id])).rows[0];
      assert.equal(operation.input_hash,recordingTranscriptionInputHash(row,{language:'ar',publicationId:pub.id,version:1,question:arabic.question,askedFacts:publication.askedFacts}));
      assert.deepEqual(operation.provenance_json,recordingAdapter.transcriptionProvenance);
      for(const column of ['transcription_operation_id','assessment_operation_id'])await assert.rejects(db.query(`UPDATE recordings SET ${column}=NULL WHERE id=$1`,[receipt.id]),/immutable/);
      await assert.rejects(db.query('UPDATE recordings SET bytes=bytes+2 WHERE id=$1',[receipt.id]),/immutable/);
      await assert.rejects(db.query("UPDATE recordings SET transcript='Forged later text' WHERE id=$1",[receipt.id]),/immutable/);
      const observations=await readEvaluationObservations(pool,PIPELINE_DATASET,{orgId:scope.orgId,siteId:scope.siteId,
        bindings:[{sampleId:'pipeline-ar-correct',attemptId:attempt.id}],confirmedSynthetic:true},options);
      recordedEvaluation=await evaluateDataset(PIPELINE_DATASET,{mode:'observed-runtime',provenance:UNKNOWN_EVALUATION_PROVENANCE,evaluate:observedEvaluator(observations)});
      assert.equal(recordedEvaluation.metrics.completed,1);assert.equal(recordedEvaluation.metrics.notRun,3);
      assert.deepEqual(recordedEvaluation.results[2].transcriptionEvidence.provenance,recordingAdapter.transcriptionProvenance);
    });
    await check('independent_help_translated_followup_and_unchanged_answer',async()=>{
      const worker=workers[4],before=await readPublicationReport(pool,owner,{...options,publicationId:pub.id});
      const input={requestId:randomUUID(),text:'Synthetic help request about the exit.'};
      const help=await requestHelp(pool,worker.session,worker.assignmentId,input,options);
      assert.equal((await requestHelp(pool,worker.session,worker.assignmentId,input,options)).duplicate,true);
      const followup={requestId:randomUUID(),text:'Please explain what must stay clear.'};
      const source={title:'Follow-up',text:followup.text,question:'Please reply in your own words.'};
      const target={title:'متابعة',text:'يرجى توضيح ما الذي يجب أن يبقى خالياً.',question:'يرجى الرد بكلماتك الخاصة.'};
      mock.structured('followup.translate',{content:source,terms:[]},target,'title');
      mock.structured('followup.check',{content:source,translation:target,language:'ar',terms:[]},faithful,'faithful');mock.speech('followup.speech',target.text,speechBytes);
      const adapter=resolveCaseFollowup({...env,UNDERSTOOD_CASE_FOLLOWUP_ADAPTER:'gemini'},{fetchImpl:mock.fetchImpl});
      await queueCaseFollowup(pool,owner,help.id,followup,{...options,adapter,dataClass:'synthetic'});
      const tasks=pipelineTasks({...config,caseFollowupAdapter:adapter});assert.equal(await tasks.caseFollowup(),true);assert.equal(await tasks.caseFollowup(),false);
      assert.equal((await followupReceipt(pool,owner,help.id,followup.requestId,options)).status,'delivered');
      assert.equal((await queueCaseFollowup(pool,owner,help.id,followup,{...options,adapter,dataClass:'synthetic'})).status,'delivered');
      assert.deepEqual(await getCaseFollowupAudio(pool,worker.session,help.id,followup.requestId,storage,options),speechBytes);
      await assert.rejects(getCaseFollowupAudio(pool,workers[0].session,help.id,followup.requestId,storage,options),/unavailable|Forbidden/);
      const delivered=(await db.query('SELECT * FROM case_followups WHERE id=$1',[followup.requestId])).rows[0];
      const operation=(await db.query('SELECT * FROM provider_operations WHERE id=$1',[delivered.provider_operation_id])).rows[0];
      assert.equal(operation.input_hash,caseFollowupInputHash(delivered,adapter.provenance));
      assert.equal(delivered.provider_input_hash,operation.input_hash);assert.deepEqual(operation.provenance_json,adapter.provenance);
      assert.deepEqual(delivered.manifest_json.dependencies.provider,operation.provenance_json);
      followupEvidence={inputHash:operation.input_hash,provenance:operation.provenance_json};
      await assert.rejects(db.query('UPDATE case_followups SET provider_operation_id=NULL,provider_input_hash=NULL WHERE id=$1',[followup.requestId]),/immutable/);
      const after=await readPublicationReport(pool,owner,{...options,publicationId:pub.id});assert.deepEqual(after.metrics,before.metrics);metrics=after.metrics;
      assert.deepEqual(metrics,{assigned:5,responses:5,matches:3,clarifications:2,unassessed:0,pending:0,completion:100});
      assert.equal((await db.query('SELECT count(*)::int AS n FROM attempts')).rows[0].n,5);
      assert.equal((await db.query('SELECT count(*)::int AS n FROM clarifications')).rows[0].n,3);
      voice={caseId:help.id,worker,requestId:randomUUID()};
    });
    await check('private_case_voice_reply_receipt_playback_and_scope',async()=>{
      const {worker,caseId,requestId}=voice;
      const received=await receiveCaseVoice(pool,worker.session,worker.assignmentId,'reply',caseId,requestId,voiceBytes,storage,options);
      assert.equal(received.status,'received');assert.equal(received.sha256,hash(voiceBytes));
      assert.equal((await receiveCaseVoice(pool,worker.session,worker.assignmentId,'reply',caseId,requestId,voiceBytes,storage,options)).id,requestId);
      assert.equal((await caseVoiceReceipt(pool,worker.session,worker.assignmentId,'reply',caseId,requestId,options)).id,requestId);
      assert.deepEqual(await getCaseVoiceAudio(pool,worker.session,caseId,requestId,storage,options),voiceBytes);
      assert.deepEqual(await getCaseVoiceAudio(pool,owner,caseId,requestId,storage,options),voiceBytes);
      await assert.rejects(getCaseVoiceAudio(pool,workers[0].session,caseId,requestId,storage,options),/unavailable|Forbidden/);
      await assert.rejects(getCaseVoiceAudio(pool,{...owner,role:'auditor'},caseId,requestId,storage,options),/Forbidden/);
      await assert.rejects(receiveCaseVoice(pool,worker.session,worker.assignmentId,'reply',caseId,requestId,answerBytes,storage,options),/conflict/);
      assert.equal((await db.query('SELECT count(*)::int AS n FROM case_voice')).rows[0].n,1);
      assert.equal((await db.query('SELECT count(*)::int AS n FROM attempts')).rows[0].n,5);
      assert.deepEqual((await readPublicationReport(pool,owner,{...options,publicationId:pub.id})).metrics,metrics);
    });
    await check('exhausted_provider_budget_denies_next_generation',async()=>{
      const draft=(await db.query('SELECT b.title,b.source,b.revision,c.generation_languages_json FROM briefings b JOIN draft_creations c ON c.briefing_id=b.id WHERE b.id=$1',[draftId])).rows[0];
      const glossary=await readGlossarySnapshot({query:(sql,args)=>db.query(sql,args)},scope.orgId,scope.siteId);
      const input={source:draft.source,title:draft.title,revision:draft.revision,languages:draft.generation_languages_json,review:null,glossary};
      const preparationAdapter=resolvePreparationAdapter({...env,UNDERSTOOD_PREPARATION_ADAPTER:'gemini-free',
        UNDERSTOOD_SYNTHETIC_PREPARATION_HASHES:JSON.stringify([preparationInputHash(input)])},{fetchImpl:mock.fetchImpl});
      await queuePreparation(pool,owner,draftId,draft.revision,options);
      assert.equal(await pipelineTasks({...config,preparationAdapter}).preparation(),true);
      assert.equal((await db.query('SELECT state FROM briefings WHERE id=$1',[draftId])).rows[0].state,'failed');
      assert.equal(mock.requestCount,24);
      assert.equal((await db.query('SELECT count(*)::int AS n FROM provider_operations')).rows[0].n,16);
      assert.equal(bundleHash((await db.query('SELECT snapshot_json FROM publications WHERE id=$1',[pub.id])).rows[0].snapshot_json),bundleHash(snapshot));
      assert.deepEqual((await readPublicationReport(pool,owner,{...options,publicationId:pub.id})).metrics,metrics);
    });
    await check('revoked_credentials_private_access_denied',async()=>{
      const worker=workers[0];await revokeWorkerGrant(pool,owner,worker.grantId,options);
      await assert.rejects(session(worker.token),/Sign in required/);
      await assert.rejects(getAssignmentSpeech(pool,worker.session,worker.assignmentId,'body',storage,options),/Sign in required/);
      await revokeWorkerGrant(pool,owner,voice.worker.grantId,options);
      await assert.rejects(getCaseVoiceAudio(pool,voice.worker.session,voice.caseId,voice.requestId,storage,options),/Sign in required/);
    });
    return await inRole(apiRole,async()=>{
    const objects=await domainTransaction(pool,schema,privateObjectInventory);
    assert.equal(objects.length,9);assert.ok(objects.every(row=>row.retained));
    const families=objects.reduce((counts,row)=>({...counts,[row.family]:(counts[row.family]??0)+1}),{});
    assert.deepEqual(families,{'case-followup':1,'case-voice':1,generated:4,recording:1,source:1,'source-original':1});
    await onInventory(objects.map(row=>Object.freeze({...row})));
    const trace=mock.finish(),operations=(await db.query('SELECT kind,model,reserved_requests,input_hash,provenance_json FROM provider_operations ORDER BY created_at,id')).rows;
    const requests=(await db.query('SELECT state,count(*)::int AS count FROM provider_requests GROUP BY state ORDER BY state')).rows;
    assert.equal(trace.length,24);assert.deepEqual(requests,[{state:'accepted',count:24}]);assert.equal(operations.length,16);
    assert.equal(operations.reduce((sum,row)=>sum+row.reserved_requests,0),24);
    const policies=(await db.query('SELECT max_daily_requests FROM provider_policies')).rows;
    assert.ok(policies.length===2 && policies.every(row=>row.max_daily_requests===24));
    return freeze({schemaVersion:'pipeline-rehearsal-report-v1',datasetVersion:PIPELINE_DATASET.version,datasetHash:bundleHash(PIPELINE_DATASET),
      mode:'isolated-pglite-scripted-provider',dataClass:'synthetic',startedAt,finishedAt:new Date().toISOString(),checks,
      workerPermissions:{profile:workerPolicy.profile,verified:workerPolicy.restricted,writableTables:workerPolicy.writableTables,
        readOnlyTables:workerPolicy.readOnlyTables,hiddenTables:workerPolicy.hiddenTables,taskExecutions:workerTaskExecutions,
        stages:[...workerStages].sort(),identity:'embedded-session-authorization',nativeAuthentication:'not-tested',apiIdentity:'embedded-application-role'},
      apiPermissions:{profile:apiPolicy.profile,verified:apiPolicy.restricted,writableTables:apiPolicy.writableTables,
        readOnlyTables:apiPolicy.readOnlyTables,hiddenTables:apiPolicy.hiddenTables,taskExecutions:apiTaskExecutions,
        stages:[...apiStages].sort(),identity:'embedded-session-authorization',nativeAuthentication:'not-tested',
        maintenanceStages:[...maintenanceStages],schemaOwnerUsedForCustomerOperations:false,roleRestoredAfterNestedWork:true},
      metrics,typedEvaluation,recordedEvaluation,sourceEvidence,preparationEvidence,followupEvidence,providerEvidence:{externalRequests:0,scriptedRequests:trace.length,acceptedRequests:24,reservedRequests:24,operations:16,
        byKind:operations.reduce((map,row)=>({...map,[row.kind]:(map[row.kind] ?? 0)+1}),{}),trace},
      privateStorage:{adapter:storageAdapter,objects:objects.length,families,sourceAudioHash:hash(sourceBytes),answerAudioHash:hash(answerBytes),generatedAudioHash:hash(speechBytes),caseVoiceHash:hash(voiceBytes)},
      frozenPublication:{version:pub.version,snapshotHash:bundleHash(snapshot)},
      evidenceLimits:{productionReady:false,liveProviderTransport:'not_verified',semanticAccuracyClaim:false,independentLanguageQa:'not_provided',
        audio:'Synthetic tones, not spoken audio; transcripts and provider outputs scripted',hardwareAudio:'not_tested',browserWorkflow:'not_tested',
        hostedPostgres:'not_tested',privateCloudStorage:storageAdapter==='scoped-in-memory-fixture'?'not_tested':'requires-external-runner-evidence',recordedInputModelPromptProvenance:'verified-synthetic-operation-links',
        sourceInputModelPromptProvenance:'verified-synthetic-operation-link',preparationInputModelPromptProvenance:'verified-synthetic-stage-operation-links',
        followupInputModelPromptProvenance:'verified-synthetic-operation-link',pilotAcceptance:'not_evaluated'}});
    });
  }finally{await db.close();}
}
