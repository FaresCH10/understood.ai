import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,randomBytes} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {assertGeminiKey} from '../server/ai/gemini-key.mjs';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {bootstrapWorkspace} from '../server/postgres/workspace-bootstrap.mjs';
import {authenticateStaff,requireSession,issueWorkerGrant,redeemWorkerGrant} from '../server/postgres/auth.mjs';
import {createWorker} from '../server/postgres/people.mjs';
import {createDraft,queuePreparation,editDraft} from '../server/postgres/preparation.mjs';
import {readGlossarySnapshot} from '../server/postgres/glossary.mjs';
import {publish,submitAnswer} from '../server/postgres/domain.mjs';
import {getAssignmentSpeech} from '../server/postgres/generated-audio.mjs';
import {receiveRecording} from '../server/postgres/recordings.mjs';
import {readPublicationReport} from '../server/postgres/reports.mjs';
import {rehearsalTasks} from '../server/postgres/runtime.mjs';
import {resolvePreparationAdapter,preparationInputHash} from '../server/ai/preparation-config.mjs';
import {resolveRecordingAdapter} from '../server/ai/recording-config.mjs';
import {resolveAssessmentAdapter,assessmentInputHash} from '../server/ai/assessment-config.mjs';
import {createGeminiAdapter,GEMINI_MODELS} from '../server/ai/gemini.mjs';
import {bundleHash} from '../server/ai/prepared-bundle.mjs';
import {CANONICAL_SOURCE} from '../server/domain.mjs';
import {inspectWav} from '../server/audio.mjs';
import {localAudioStore} from '../server/private-storage.mjs';

export const COMPLETE_ANSWER='I will put finished items on the blue shelf and unfinished items on the yellow shelf. I will leave the walkway clear.';
export const INCOMPLETE_ANSWER='I will put finished items on the blue shelf.';

// No caller-supplied content, database connection, original app data or worker records.
export async function runGeminiWorkflow({apiKey,root,fetchImpl=fetch,persist=()=>{},onStage=()=>{}}) {
  assertGeminiKey(apiKey);
  if(typeof root!=='string' || !root || typeof persist!=='function')throw Error('Isolated workflow directory required');
  const report={runId:randomUUID(),startedAt:new Date().toISOString(),state:'pending',dataClass:'synthetic',realDataAllowed:false,
    productionReady:false,models:GEMINI_MODELS,maxExternalRequests:15,externalRequests:0,checks:[],fixtureRequests:[]};
  const save=()=>persist(structuredClone(report));
  const check=async(name,fn)=>{report.activeStage=name;save();await onStage(name);await fn();report.checks.push({name,state:'passed'});save();};
  const guardedFetch=async(url,options)=>{
    if(report.externalRequests>=report.maxExternalRequests)throw Error('Synthetic workflow request cap reached');
    const parsed=new URL(url);
    if(parsed.origin!=='https://generativelanguage.googleapis.com' || parsed.username || parsed.password || parsed.hash)throw Error('Synthetic provider destination refused');
    report.externalRequests++;save();
    const response=await fetchImpl(url,options);
    try {
      const body=typeof options.body==='string'?JSON.parse(options.body):null;
      if(response.ok && body?.generationConfig?.responseFormat?.text?.schema?.properties?.sourceGrounded) {
        const value=JSON.parse((await response.clone().json()).candidates[0].content.parts.find(part=>typeof part.text==='string').text);
        const candidate=JSON.parse(body.contents[0].parts[0].text).candidate;
        const allowed=['ungrounded_fact','question_alignment','ambiguous_source','incomplete_translation','wrong_language','terminology_mismatch','unsupported_content','omitted_pairing'];
        report.groundingEnvelope={expectedFacts:candidate.facts.length,expectedAskedFacts:candidate.askedFacts.length,
          evidenceCount:Array.isArray(value.factEvidence)?value.factEvidence.length:null,askedIndexCount:Array.isArray(value.askedFactIndexes)?value.askedFactIndexes.length:null,
          booleansValid:['sourceGrounded','questionAligned','ambiguous'].every(key=>typeof value[key]==='boolean'),
          fieldsValid:Object.keys(value).every(key=>['sourceGrounded','questionAligned','ambiguous','factEvidence','askedFactIndexes','reasons'].includes(key)),
          reasonsRecognized:Array.isArray(value.reasons)&&value.reasons.every(reason=>allowed.includes(reason)),
          sourceGrounded:value.sourceGrounded===true,questionAligned:value.questionAligned===true,ambiguous:value.ambiguous===true};save();
      }
    }catch {/* Local schema diagnostics never replace validation or expose output text. */}
    return response;
  };
  mkdirSync(root,{recursive:true,mode:0o700});save();
  const db=new PGlite(join(root,'database')),storage=localAudioStore(join(root,'audio'));
  const schema='understood_test_gemini_workflow',options={schema};
  const pool={async connect(){return {query:async(sql,args)=>args?.length?db.query(sql,args):(await db.exec(sql)).at(-1)??{rows:[]},release(){}};}};
  const config={...options,tier:'local',aiMode:'synthetic',accessMode:'credential',integrationMode:'synthetic',dataClass:'synthetic'};
  const env={UNDERSTOOD_TIER:'local',UNDERSTOOD_AI_MODE:'synthetic',UNDERSTOOD_ACCESS_MODE:'credential',UNDERSTOOD_DATA_CLASS:'synthetic',GEMINI_API_KEY:apiKey};
  const session=token=>requireSession(pool,{headers:{cookie:`understood_session=${token}`}},options);
  let owner,scope,draft,pub,snapshot,voiceBytes;const workers=[];
  try {
    await db.exec(`CREATE SCHEMA ${schema};SET search_path TO ${schema},pg_catalog`);await runMigrations(pool,options);
    await check('credential_bootstrap_and_private_grants',async()=>{
      const input={requestId:randomUUID(),synthetic:true,confirmed:true,organizationName:'Synthetic Gemini workshop',siteName:'Synthetic Beirut',timezone:'Asia/Beirut',
        generationLanguages:['en','ar'],supportEmail:'support@example.test',owner:{name:'Synthetic owner',email:'owner@example.test',password:'Synthetic-'+randomBytes(20).toString('hex')}};
      scope=await bootstrapWorkspace(pool,input,config);assert.equal((await bootstrapWorkspace(pool,input,config)).duplicate,true);
      const login=await authenticateStaff(pool,input.owner.email,input.owner.password,'synthetic-workflow',options);owner=await session(login.session.token);
      for(const [index,language] of ['en','en','ar'].entries()) {
        const worker=await createWorker(pool,owner,{code:'Synthetic '+(index+1),language},options),grant=await issueWorkerGrant(pool,owner,worker.id,240,options);
        const redeemed=await redeemWorkerGrant(pool,grant.token,options);
        await assert.rejects(redeemWorkerGrant(pool,grant.token,options));workers.push({id:worker.id,session:await session(redeemed.token)});
      }
      // Maintenance policy in this new isolated database, never fabricated customer outcomes.
      await db.query(`INSERT INTO provider_policies(scope_key,org_id,revision,enabled,max_daily_requests) VALUES('global',NULL,1,true,14),($1,$2,1,true,14)`,['tenant:'+scope.orgId,scope.orgId]);
    });
    await check('metered_automatic_preparation_translation_private_speech',async()=>{
      draft=await createDraft(pool,owner,{requestId:randomUUID(),title:'Synthetic shelf handover',source:CANONICAL_SOURCE,generationLanguages:['en','ar']},options);
      const glossary=await readGlossarySnapshot({query:(sql,args)=>db.query(sql,args)},scope.orgId,scope.siteId);
      const input={source:CANONICAL_SOURCE,title:'Synthetic shelf handover',revision:1,languages:['en','ar'],review:null,glossary};
      const preparationAdapter=resolvePreparationAdapter({...env,UNDERSTOOD_PREPARATION_ADAPTER:'gemini-free',UNDERSTOOD_SYNTHETIC_PREPARATION_HASHES:JSON.stringify([preparationInputHash(input)])},{fetchImpl:guardedFetch});
      await queuePreparation(pool,owner,draft.id,1,options);
      assert.equal(await rehearsalTasks(pool,storage,{...config,preparationAdapter}).preparation(),true);
      const row=(await db.query('SELECT state,prepared_json FROM briefings WHERE id=$1',[draft.id])).rows[0];
      assert.equal(row.state,'ready');
      assert.ok(row.prepared_json.rubric.askedFacts.some(fact=>/blue/i.test(fact)));
      assert.ok(row.prepared_json.rubric.askedFacts.some(fact=>/yellow/i.test(fact)));
      const operations=(await db.query('SELECT kind,reserved_requests FROM provider_operations')).rows;
      assert.equal(operations.length,8);assert.ok(operations.every(row=>row.kind==='preparation'&&row.reserved_requests===1));
    });
    await check('publication_frozen_rubric_and_scoped_private_playback',async()=>{
      const input={requestId:randomUUID(),revision:1,nextVersion:1,workerIds:workers.map(row=>row.id)};
      pub=await publish(pool,owner,draft.id,input,{...options,integrationMode:'synthetic',storage});
      assert.equal((await publish(pool,owner,draft.id,input,{...options,integrationMode:'synthetic',storage})).duplicate,true);
      snapshot=(await db.query('SELECT snapshot_json FROM publications WHERE id=$1',[pub.id])).rows[0].snapshot_json;
      for(const worker of workers) {
        worker.assignment=(await db.query('SELECT id,language FROM assignments WHERE worker_id=$1 AND publication_id=$2',[worker.id,pub.id])).rows[0];
        for(const kind of ['body','question'])inspectWav(await getAssignmentSpeech(pool,worker.session,worker.assignment.id,kind,storage,options));
      }
      await assert.rejects(getAssignmentSpeech(pool,workers[1].session,workers[0].assignment.id,'body',storage,options));
      await editDraft(pool,owner,draft.id,{revision:1,title:'New unpublished draft',source:'Keep boxes at the next bay.'},options);
      assert.equal(bundleHash((await db.query('SELECT snapshot_json FROM publications WHERE id=$1',[pub.id])).rows[0].snapshot_json),bundleHash(snapshot));
      report.publication={version:pub.version,assigned:pub.assigned,snapshotHash:bundleHash(snapshot)};
      // New publications use frozen MCQ IDs; historical written/voice assessment is exercised separately.
      for(const [index,worker] of workers.slice(0,2).entries()){
        const answer=index===0?snapshot.rubric.correctChoiceId:snapshot.languages.en.choices.find(choice=>choice.id!==snapshot.rubric.correctChoiceId).id;
        await submitAnswer(pool,worker.session,worker.assignment.id,randomUUID(),answer,options);
      }
      while(await rehearsalTasks(pool,storage,config).assessment()){}
      const legacyId=randomUUID(),legacyPub=randomUUID();
      const legacyLanguages=Object.fromEntries(Object.entries(snapshot.languages).map(([code,item])=>{const {choices,questionType,speech,...content}=item;return [code,content];}));
      const legacy={source:snapshot.source,title:snapshot.title,question:snapshot.question,facts:snapshot.facts,rubric:{askedFacts:snapshot.rubric.askedFacts},languages:legacyLanguages};
      await db.query("INSERT INTO briefings(id,org_id,site_id,title,source,state) VALUES($1,$2,$3,'Historical written check-back',$4,'ready')",[legacyId,owner.org_id,owner.site_id,CANONICAL_SOURCE]);
      await db.query("INSERT INTO publications(id,org_id,site_id,briefing_id,version,snapshot_json,state) VALUES($1,$2,$3,$4,1,$5,'published')",[legacyPub,owner.org_id,owner.site_id,legacyId,JSON.stringify(legacy)]);
      for(const worker of workers.slice(0,2)){worker.legacyAssignment={id:randomUUID(),publicationId:legacyPub};await db.query("INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,language) VALUES($1,$2,$3,$4,$5,'en')",[worker.legacyAssignment.id,owner.org_id,owner.site_id,legacyPub,worker.id]);}

    });
    await check('fixed_synthetic_voice_fixture_generation',async()=>{
      const journal={async beforeRequest(){if(report.fixtureRequests.length)throw Error('Voice fixture budget exhausted');const id=randomUUID();report.fixtureRequests.push({id,state:'started',httpStatus:null});save();return id;},
        async afterRequest(id,{httpStatus}){const row=report.fixtureRequests.find(row=>row.id===id);if(row?.state==='started'){row.httpStatus=httpStatus;row.state=httpStatus===200?'accepted':httpStatus===null?'uncertain':'rejected';save();}}};
      voiceBytes=await createGeminiAdapter({apiKey,dataClass:'synthetic',fetchImpl:guardedFetch,requestJournal:journal}).speech(COMPLETE_ANSWER,'en');
      const info=inspectWav(voiceBytes);report.voiceFixture={sha256:info.sha256,bytes:info.bytes,durationSeconds:info.durationSeconds};
    });
    await check('metered_voice_upload_transcription_exact_version_assessment',async()=>{
      const worker=workers[0],submissionId=randomUUID();
      const receipt=await receiveRecording(pool,worker.session,worker.legacyAssignment.id,submissionId,voiceBytes,storage,options);
      assert.equal((await receiveRecording(pool,worker.session,worker.legacyAssignment.id,submissionId,voiceBytes,storage,options)).duplicate,true);
      const recordingAdapter=resolveRecordingAdapter({...env,UNDERSTOOD_RECORDING_ADAPTER:'gemini-free',UNDERSTOOD_SYNTHETIC_AUDIO_HASHES:JSON.stringify([inspectWav(voiceBytes).sha256])},{fetchImpl:guardedFetch});
      assert.equal(await rehearsalTasks(pool,storage,{...config,recordingAdapter}).recording(),true);
      const recording=(await db.query('SELECT status,transcript,transcription_operation_id,assessment_operation_id FROM recordings WHERE id=$1',[receipt.id])).rows[0];
      assert.equal(recording.status,'transcribed');assert.ok(recording.transcription_operation_id&&recording.assessment_operation_id);
      const attempt=(await db.query('SELECT outcome FROM attempts WHERE assignment_id=$1 AND submission_id=$2',[worker.legacyAssignment.id,submissionId])).rows[0];
      assert.equal(attempt?.outcome,'matched');
      report.voiceResult={state:recording.status,outcome:attempt.outcome,transcriptHash:bundleHash(recording.transcript)};
    });
    await check('metered_incomplete_typed_answer_creates_clarification',async()=>{
      const worker=workers[1],submissionId=randomUUID(),receipt=await submitAnswer(pool,worker.session,worker.legacyAssignment.id,submissionId,INCOMPLETE_ANSWER,options);
      const input={answer:INCOMPLETE_ANSWER,question:snapshot.languages.en.question,askedFacts:snapshot.rubric.askedFacts,language:'en',publicationId:worker.legacyAssignment.publicationId,version:pub.version};
      const assessmentAdapter=resolveAssessmentAdapter({...env,UNDERSTOOD_ASSESSMENT_ADAPTER:'gemini-free',UNDERSTOOD_SYNTHETIC_ASSESSMENT_HASHES:JSON.stringify([assessmentInputHash(input)])},{fetchImpl:guardedFetch});
      assert.equal(await rehearsalTasks(pool,storage,{...config,assessmentAdapter}).assessment(),true);
      const attempt=(await db.query('SELECT outcome,assessment_status FROM attempts WHERE id=$1',[receipt.id])).rows[0];
      assert.deepEqual(attempt,{outcome:'clarification',assessment_status:'complete'});
      assert.equal((await db.query('SELECT count(*)::int n FROM clarifications WHERE attempt_id=$1',[receipt.id])).rows[0].n,1);
      assert.equal((await submitAnswer(pool,worker.session,worker.legacyAssignment.id,submissionId,INCOMPLETE_ANSWER,options)).duplicate,true);
      report.incompleteResult=attempt;
    });
    await check('durable_metering_report_and_no_replay_dispatch',async()=>{
      const before=report.externalRequests;
      assert.equal(await rehearsalTasks(pool,storage,{...config,recordingAdapter:resolveRecordingAdapter({...env,UNDERSTOOD_RECORDING_ADAPTER:'gemini-free',UNDERSTOOD_SYNTHETIC_AUDIO_HASHES:JSON.stringify([inspectWav(voiceBytes).sha256])},{fetchImpl:guardedFetch})}).recording(),false);
      const result=await readPublicationReport(pool,owner,{...options,publicationId:pub.id});report.metrics=result.metrics;
      assert.equal(result.metrics.assigned,3);assert.equal(result.metrics.responses,2);assert.equal(result.metrics.matches,1);assert.equal(result.metrics.clarifications,1);
      assert.equal(report.externalRequests,before);
      const requests=(await db.query('SELECT state,cleanup,http_status FROM provider_requests')).rows;
      assert.equal(requests.length,14);assert.ok(requests.every(row=>row.state==='accepted'));
      assert.equal(requests.filter(row=>row.cleanup).length,1);
      assert.equal((await db.query('SELECT SUM(reserved_requests)::int n FROM provider_operations')).rows[0].n,14);
      report.durableProviderRequests={count:requests.length,accepted:requests.filter(row=>row.state==='accepted').length,cleanupAccepted:requests.filter(row=>row.cleanup&&row.state==='accepted').length};
    });
    report.state='passed';
  }catch {report.state='failed';report.diagnosticCode='workflow_gate_failed';}
  finally {
    try {report.jobStates={preparation:(await db.query('SELECT status FROM jobs')).rows.map(row=>row.status),recording:(await db.query('SELECT status FROM recordings')).rows.map(row=>row.status),assessment:(await db.query('SELECT status FROM assessment_jobs')).rows.map(row=>row.status)};}catch {/* A startup failure may precede table creation. */}
    report.completedAt=new Date().toISOString();save();await db.close();
  }
  return report;
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(process.argv.length!==3 || process.argv[2]!=='--live-synthetic') {console.error('Explicit invocation required: node scripts/gemini-synthetic-workflow.mjs --live-synthetic');process.exitCode=1;}
  else try {
    const apiKey=parseEnv(readFileSync('.env','utf8')).GEMINI_API_KEY,id=randomUUID();
    const root=resolve('data','gemini-workflows',id),evidence=resolve('artifacts','gemini-workflow-'+id+'.json');
    const report=await runGeminiWorkflow({apiKey,root,persist:report=>writeFileSync(evidence,JSON.stringify(report,null,2)+'\n'),onStage:stage=>console.log('Synthetic workflow stage: '+stage)});
    console.log(JSON.stringify({...report,privateFixtureRoot:root,evidencePath:evidence}));if(report.state!=='passed')process.exitCode=1;
  }catch {console.error('Synthetic workflow configuration unavailable; no credential or provider payload was printed.');process.exitCode=1;}
}
