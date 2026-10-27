import {request as httpRequest} from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {productionFixture} from './helpers/production-runtime.mjs';
import {productionServiceConfig,productionAdmissionBlockers,assertProductionAdmission} from '../server/postgres/production-admission.mjs';
import {createGeminiAdapter,createProductionGeminiAdapter} from '../server/ai/gemini.mjs';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {startInstructionSend,processOneInstructionSend} from '../server/postgres/instructions.mjs';
import {processOnePreparation} from '../server/postgres/preparation.mjs';
import {submitAnswer} from '../server/postgres/domain.mjs';
import {processOneAssessment} from '../server/postgres/assessment-worker.mjs';
import {queueCaseFollowup,processOneCaseFollowup} from '../server/postgres/case-followups.mjs';
import {receiveSourceAudio} from '../server/postgres/source-audio.mjs';
import {processOneSourceAudio} from '../server/postgres/source-audio-worker.mjs';
import {receiveRecording} from '../server/postgres/recordings.mjs';
import {processOneRecording} from '../server/postgres/recording-worker.mjs';
import {createPresentation,listPresentations} from '../server/postgres/presentations.mjs';
import {processOnePresentation} from '../server/postgres/presentation-jobs.mjs';
import {withMultipleChoice} from '../server/multiple-choice.mjs';
import {WORKER_LANGUAGE_CODES,workerLocale} from '../server/languages.mjs';
import {encodeWav} from '../src/audio.ts';
import {pipelineStatus} from '../server/ai/pipeline-status.mjs';
function localRequest(url,options={}){return new Promise((resolve,reject)=>{const req=httpRequest(url,{method:options.method??'GET',headers:options.headers},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>{const headers=new Headers();for(const [name,value] of Object.entries(res.headers))if(value!==undefined)headers.set(name,Array.isArray(value)?value.join(', '):value);resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers}));});});req.on('error',reject);req.end(options.body);});}
const source='Put finished items on the blue shelf. Keep the walkway clear.',facts=['Put finished items on the blue shelf.','Keep the walkway clear.'];
const owner={principal_type:'staff',principal_id:'owner',org_id:'a',site_id:'a',role:'owner'};
const asWorker=id=>({principal_type:'worker',principal_id:id,org_id:'a',site_id:'a'});
const samples={en:'Shelf',ar:'الرف',hi:'शेल्फ',ur:'شیلف',bn:'তাক',ml:'ഷെൽഫ്',ta:'அலமாரி',te:'షెల్ఫ్',ne:'दराज',fil:'Istante',si:'රාක්කය',ru:'Полка','pa-Guru':'ਸ਼ੈਲਫ','pa-Arab':'شیلف',id:'Rak'};
const audio=Buffer.from(encodeWav({duration:1,sampleRate:16000,numberOfChannels:1,getChannelData:()=>new Float32Array(16000).fill(.2)}));
async function fixture(){
  const errors=[],db=new PGlite(),pool={async connect(){return {query:async(sql,args)=>{try{return args?.length?await db.query(sql,args):(await db.exec(sql)).at(-1)||{rows:[]};}catch(error){errors.push({message:error.message,code:error.code,sql:sql.slice(0,120)});throw error;}},release(){}};}};
  const f=productionFixture(),calls=[],objects=new Map();
  const reply=value=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{thought:true,text:'Ignored model thought fixture'},{text:typeof value==='string'?value:JSON.stringify(value)}]}}]});
  const fetchImpl=async(url,options)=>{
    assert.equal(new URL(url).origin,'https://generativelanguage.googleapis.com');assert.equal(options.redirect,'error');calls.push({url,body:JSON.parse(options.body)});
    const body=JSON.parse(options.body),model=new URL(url).pathname.match(/models\/([^:]+):/)[1];
    if(model===f.env.UNDERSTOOD_GEMINI_SPEECH_MODEL)return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{inlineData:{mimeType:'audio/wav',data:audio.toString('base64')}}]}}]});
    if(model===f.env.UNDERSTOOD_GEMINI_TRANSCRIPTION_MODEL){assert.equal(body.contents[0].parts[0].inlineData.mimeType,'audio/wav');return reply(source);}
    const fields=body.generationConfig.responseFormat.text.schema.properties,input=JSON.parse(body.contents[0].parts[0].text),instruction=body.systemInstruction.parts[0].text;
    if(fields.askedFacts)return reply({title:'Generated title',facts,askedFacts:facts,question:'Where should finished items go and what must stay clear?',...(fields.choices?{choices:[source,'Put finished items on the yellow shelf. Keep the walkway clear.','Put finished items on the blue shelf. Block the walkway.','Put finished items on the red shelf. Block the walkway.']}:{})});
    if(fields.factEvidence)return reply({sourceGrounded:true,questionAligned:true,ambiguous:false,factEvidence:facts.map((quote,factIndex)=>({factIndex,quote})),askedFactIndexes:[0,1],reasons:[],...(fields.choicesAligned?{choicesAligned:true}:{})});
    if(fields.faithful)return reply({faithful:true,complete:true,languageCorrect:true,terminologyApplied:true,reasons:[]});
    if(fields.outcome)return reply({outcome:'matched',reasons:['facts_present'],evidence:input.askedFacts.map((_,factIndex)=>({factIndex,quote:input.answer}))});
    const language=WORKER_LANGUAGE_CODES.find(code=>instruction.includes(`into ${workerLocale(code).englishName} using `));assert.ok(language,'Translation target must be explicit');
    return reply({title:samples[language]+' '+input.content.title,text:samples[language]+' '+input.content.text,question:samples[language]+' '+input.content.question,...(fields.answerChoices?{answerChoices:input.content.answerChoices.map(text=>samples[language]+' '+text)}:{})});
  };
  const config=productionServiceConfig(f.env,{service:'worker',approvalManifest:f.approvalManifest},{fetchImpl});
  await db.exec(`CREATE SCHEMA ${config.schema};SET search_path TO ${config.schema},pg_catalog`);await runMigrations(pool,{schema:config.schema});
  await db.exec("INSERT INTO organizations(id,name) VALUES('a','Fixture');INSERT INTO sites(id,org_id,name,timezone) VALUES('a','a','Fixture','UTC');INSERT INTO staff(id,org_id,site_id,name,role) VALUES('owner','a','a','Owner','owner');INSERT INTO provider_policies(scope_key,org_id,revision,enabled,max_daily_requests) VALUES('global',NULL,1,true,1000),('tenant:a','a',1,true,1000)");
  for(const [index,language] of WORKER_LANGUAGE_CODES.entries())await db.query("INSERT INTO workers(id,org_id,site_id,code,language) VALUES($1,'a','a',$1,$2)",['w'+index,language]);
  const storage={async save(row,bytes){assert.ok(!objects.has(row.id));objects.set(row.id,Buffer.from(bytes));},async read(row){assert.ok(objects.has(row.id));return Buffer.from(objects.get(row.id));},async remove(row){objects.delete(row.id);},async exists(row){return objects.has(row.id);},async saveOriginal(row,bytes){objects.set(row.id,Buffer.from(bytes));},async readOriginal(row){return Buffer.from(objects.get(row.id));},async removeOriginal(row){objects.delete(row.id);},async existsOriginal(row){return objects.has(row.id);}};
  return {db,pool,config,calls,objects,storage,errors,options:{schema:config.schema,integrationMode:'live',storage},close:()=>db.close()};
}

test('production Gemini admission requires explicit models, paid account, complete language scope and approvals',async()=>{
  const {env,approvalManifest}=productionFixture();let network=0;
  const config=productionServiceConfig(env,{service:'worker',approvalManifest},{fetchImpl:()=>{network++;assert.fail('Unexpected request');}});
  assert.equal(config.integrationMode,'live');assert.equal(config.preparationAdapter.provenance.dataClass,'real');assert.equal(pipelineStatus(config).dataClass,'real');
  for(const patch of [{UNDERSTOOD_GEMINI_PAID_ACCOUNT:'false'},{UNDERSTOOD_GEMINI_SPEECH_MODEL:''},{UNDERSTOOD_GEMINI_SPEECH_LANGUAGES:'["en"]'},{GEMINI_API_KEY:''}])assert.ok(productionAdmissionBlockers({...env,...patch},{service:'worker',approvalManifest}).length);
  assert.throws(()=>createGeminiAdapter({apiKey:'fixture',dataClass:'real'}),/synthetic/);
  await assert.rejects(config.preparationAdapter.prepare(source),/budget/); // async check below proves dispatch cannot bypass its journal
  assert.equal(network,0);
  const api=productionFixture('api'),apiConfig=productionServiceConfig(api.env,{service:'api',approvalManifest:api.approvalManifest});
  assert.equal(typeof apiConfig.preparationAdapter.prepare,'undefined');assert.doesNotMatch(JSON.stringify(apiConfig),/fixture-only-gemini-key/);
  assert.throws(()=>assertProductionAdmission({...config}),/approval/);
});

test('production preparation publishes checked private speech and grades MCQs across all 15 locales',async()=>{
  const f=await fixture();try{
    const input={requestId:randomUUID(),title:'Supervisor title',source,audience:{type:'all'},responseMode:'question',deliveryMode:'both'};
    await startInstructionSend(f.pool,owner,input,f.options);
    assert.equal(await processOnePreparation(f.pool,{...f.options,adapter:f.config.preparationAdapter}),true);
    const draft=(await f.db.query('SELECT briefings.state,jobs.error,prepared_json FROM briefings LEFT JOIN jobs ON jobs.briefing_id=briefings.id WHERE briefings.id=$1',[input.requestId])).rows[0];
    assert.equal(draft.state,'ready',JSON.stringify(draft));
    assert.equal(await processOneInstructionSend(f.pool,f.options),true);
    const pub=(await f.db.query('SELECT * FROM publications WHERE briefing_id=$1',[input.requestId])).rows[0],snapshot=pub.snapshot_json;
    assert.equal(snapshot.provenance.dataClass,'real');assert.equal(snapshot.languages.en.title,input.title);assert.equal(Object.keys(snapshot.languages).length,15);
    const assignments=(await f.db.query('SELECT * FROM assignments WHERE publication_id=$1 ORDER BY worker_id',[pub.id])).rows;
    for(const assignment of assignments){const answer=assignment.worker_id==='w1'?snapshot.languages[assignment.language].choices.find(choice=>choice.id!==snapshot.rubric.correctChoiceId).id:snapshot.rubric.correctChoiceId;await submitAnswer(f.pool,asWorker(assignment.worker_id),assignment.id,randomUUID(),answer,f.options);}
    const before=f.calls.length;while(await processOneAssessment(f.pool,f.config.assessmentAdapter,f.options)){}assert.equal(f.calls.length,before);
    assert.equal((await f.db.query("SELECT count(*)::int n FROM attempts WHERE outcome='matched'")).rows[0].n,14);
    const caseId=(await f.db.query('SELECT id FROM clarifications')).rows[0].id;
    await queueCaseFollowup(f.pool,owner,caseId,{requestId:randomUUID(),text:'Please explain where the finished items go.'},{...f.options,adapter:f.config.caseFollowupAdapter,dataClass:'real'});
    assert.equal(await processOneCaseFollowup(f.pool,f.config.caseFollowupAdapter,f.storage,{...f.options,dataClass:'real'}),true);
    assert.equal((await f.db.query('SELECT status FROM case_followups')).rows[0].status,'delivered');
    assert.ok((await f.db.query('SELECT data_class,provenance_json FROM provider_operations')).rows.every(row=>row.data_class==='real'&&row.provenance_json.dataClass==='real'));
    assert.equal((await f.db.query("SELECT count(*)::int n FROM provider_requests WHERE state<>'accepted'")).rows[0].n,0);
  }finally{await f.close();}
});

test('production source audio and legacy recorded answers use metered inline transcription and frozen facts',async()=>{
  const f=await fixture();try{
    const sourceId=randomUUID();await receiveSourceAudio(f.pool,owner,{requestId:sourceId,title:'Recorded instruction',originalType:'audio/wav',generationLanguages:['en']},audio,audio,f.storage,f.options);
    assert.equal(await processOneSourceAudio(f.pool,f.config.sourceAdapter,f.storage,f.options),true);
    const saved=(await f.db.query('SELECT status,transcription_operation_id FROM source_audio_requests WHERE request_id=$1',[sourceId])).rows[0];assert.equal(saved.status,'transcribed',JSON.stringify(saved));assert.ok(saved.transcription_operation_id);
    const snapshot={source,title:'Historical instruction',question:'What must you do?',facts,rubric:{askedFacts:facts},languages:{en:{title:'Historical instruction',text:source,question:'What must you do?'}}};
    await f.db.query("INSERT INTO publications(id,org_id,site_id,briefing_id,version,snapshot_json,state) VALUES('legacy','a','a',$1,1,$2,'published')",[sourceId,JSON.stringify(snapshot)]);
    await f.db.query("INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,language) VALUES('legacy-answer','a','a','legacy','w0','en')");
    const receipt=await receiveRecording(f.pool,asWorker('w0'),'legacy-answer',randomUUID(),audio,f.storage,f.options);
    assert.equal(await processOneRecording(f.pool,f.config.recordingAdapter,f.storage,f.options),true);
    const recording=(await f.db.query('SELECT status,error,transcription_operation_id,assessment_operation_id FROM recordings WHERE id=$1',[receipt.id])).rows[0];assert.equal(recording.status,'transcribed',JSON.stringify(recording));assert.ok(recording.transcription_operation_id&&recording.assessment_operation_id);
    assert.equal((await f.db.query('SELECT outcome FROM attempts')).rows[0].outcome,'matched');
    const transcriptOps=(await f.db.query("SELECT reserved_requests FROM provider_operations WHERE kind IN ('source-transcription','recording-transcription')")).rows;assert.equal(transcriptOps.length,2);assert.ok(transcriptOps.every(row=>row.reserved_requests===1));
  }finally{await f.close();}
});

test('approved language changes queue private presentation translation in the worker and retain grading IDs',async()=>{
  const f=await fixture();try{
    await f.db.query("INSERT INTO briefings(id,org_id,site_id,title,source,state) VALUES('presentation','a','a','Title',$1,'ready')",[source]);
    const frozen=withMultipleChoice({source,title:'Title',question:'What must you do?',facts,rubric:{askedFacts:facts},languages:{en:{title:'Title',text:source,question:'What must you do?'}}});
    await f.db.query("INSERT INTO publications(id,org_id,site_id,briefing_id,version,snapshot_json,state) VALUES('presentation','a','a','presentation',1,$1,'published')",[JSON.stringify(frozen)]);
    await f.db.query("INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,language) VALUES('presentation','a','a','presentation','w0','en')");
    await f.db.query("UPDATE workers SET language='hi' WHERE id='w0'");
    const pending=await createPresentation(f.pool,asWorker('w0'),'presentation',{requestId:randomUUID(),sourceKind:'instruction'},{...f.options,queueGeneration:true});
    assert.equal(pending.status,'pending');assert.equal(f.calls.length,0);
    assert.equal(await processOnePresentation(f.pool,f.config.preparationAdapter,f.options),true);
    const list=await listPresentations(f.pool,asWorker('w0'),'presentation',f.options),ready=list.items[0];assert.equal(ready.status,'ready',JSON.stringify(list));
    assert.equal(ready.content.choices.length,4);assert.deepEqual(ready.content.choices.map(choice=>choice.id),frozen.languages.en.choices.map(choice=>choice.id));
    assert.ok(ready.content.choices.every(choice=>choice.text.startsWith(samples.hi)));
    assert.equal((await f.db.query('SELECT state,error_code FROM presentation_translation_jobs')).rows[0].state,'complete');
    assert.equal(f.calls.length,8);
  }finally{await f.close();}
});

test('quota pauses leave queued translations retryable without dispatching or exhausting attempts',async()=>{
  const f=await fixture();try{
    await f.db.query("INSERT INTO briefings(id,org_id,site_id,title,source,state) VALUES('quota','a','a','Title',$1,'ready')",[source]);
    const frozen=withMultipleChoice({source,title:'Title',question:'What must you do?',facts,rubric:{askedFacts:facts},languages:{en:{title:'Title',text:source,question:'What must you do?'}}});
    await f.db.query("INSERT INTO publications(id,org_id,site_id,briefing_id,version,snapshot_json,state) VALUES('quota','a','a','quota',1,$1,'published')",[JSON.stringify(frozen)]);
    await f.db.exec("INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,language) VALUES('quota','a','a','quota','w0','en');UPDATE workers SET language='hi' WHERE id='w0'");
    const pending=await createPresentation(f.pool,asWorker('w0'),'quota',{requestId:randomUUID(),sourceKind:'instruction'},{...f.options,queueGeneration:true});
    await f.db.exec("UPDATE provider_policies SET enabled=false");
    assert.equal(await processOnePresentation(f.pool,f.config.preparationAdapter,f.options),true);assert.equal(f.calls.length,0);
    const job=(await f.db.query('SELECT state,attempts,error_code FROM presentation_translation_jobs')).rows[0];assert.deepEqual(job,{state:'queued',attempts:0,error_code:'generation_paused'});
    assert.equal((await f.db.query('SELECT status FROM presentation_artifacts WHERE id=$1',[pending.presentation.id])).rows[0].status,'pending');
    await f.db.exec("UPDATE provider_policies SET enabled=true;UPDATE presentation_translation_jobs SET retry_at=clock_timestamp()");
    assert.equal(await processOnePresentation(f.pool,f.config.preparationAdapter,f.options),true);
    assert.equal((await listPresentations(f.pool,asWorker('w0'),'quota',f.options)).items[0].status,'ready');
    assert.equal((await f.db.query("SELECT count(*)::int n FROM provider_requests WHERE state='accepted'")).rows[0].n,8);
  }finally{await f.close();}
});

test('production approval expiry blocks new provider requests even on an already constructed handle',async t=>{
  const {env,approvalManifest}=productionFixture();let requests=0;
  const config=productionServiceConfig(env,{service:'worker',approvalManifest},{fetchImpl:async()=>{requests++;throw Error('Must not send');}});
  t.mock.timers.enable({apis:['Date'],now:Date.parse(approvalManifest.validUntil)+1});
  await assert.rejects(async()=>config.preparationAdapter.withJournal({beforeRequest:()=>randomUUID(),afterRequest:()=>{}}).prepare(source),/approval/);
  assert.equal(requests,0);
});

test('production API keeps provider keys out and queues work without running the synthetic processor',async()=>{
  const f=await fixture();let server;try{
    const {createPostgresHostedServer}=await import('../server/postgres/http.mjs');
    const {provisionStaffCredential}=await import('../server/postgres/auth.mjs');
    const settings=productionFixture('api');settings.env.UNDERSTOOD_TRUSTED_PROXY_NETWORKS='["127.0.0.1/32"]';
    const config=productionServiceConfig(settings.env,{service:'api',approvalManifest:settings.approvalManifest});
    await provisionStaffCredential(f.pool,{staffId:'owner',orgId:'a',siteId:'a',email:'owner@understood.co',password:'Fixture assigned password 123'},f.options);
    server=createPostgresHostedServer(f.pool,{config,storage:f.storage,publicBuild:()=>{throw Error('No static request expected');}});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}/api`;
    const headers={host:'app.understood.co','x-forwarded-proto':'https','x-forwarded-for':'198.51.100.20',origin:'https://app.understood.co'};
    const login=await localRequest(base+'/auth/staff/login',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({email:'owner@understood.co',password:'Fixture assigned password 123'})});
    assert.equal(login.status,200,await login.clone().text());const cookie=login.headers.get('set-cookie').split(';')[0];
    const session=await(await localRequest(base+'/session',{headers:{...headers,cookie}})).json();assert.equal(session.mode,'live-credential');
    const sent=await localRequest(base+'/instructions/send',{method:'POST',headers:{...headers,cookie,'content-type':'application/json','x-client-session-context':session.clientContext},body:JSON.stringify({requestId:randomUUID(),title:'Hosted instruction',source,audience:{type:'all'},responseMode:'question',deliveryMode:'both'})});
    assert.equal(sent.status,201,await sent.clone().text());const result=await sent.json();assert.equal(result.state,'preparing');assert.equal(f.calls.length,0);
    assert.equal((await f.db.query('SELECT state,prepared_json FROM briefings WHERE id=$1',[result.briefingId])).rows[0].prepared_json,null);
    const policies=await f.db.query("SELECT enabled FROM provider_policies WHERE scope_key='global'");assert.equal(policies.rows[0].enabled,true);
  }finally{if(server)await new Promise(resolve=>server.close(resolve));await f.close();}
});

test('password-session presentation jobs run under restricted worker grants and refuse revoked sessions',async()=>{
  const f=await fixture();let acting=false;try{
    const {assignWorkerPassword,authenticateWorker}=await import('../server/postgres/worker-credentials.mjs');
    const {requireSession}=await import('../server/postgres/auth.mjs');
    const {configureRuntimePermissions}=await import('../server/postgres/runtime-permissions.mjs');
    await assignWorkerPassword(f.pool,owner,'w0',{expectedCode:'w0',workerId:'WORKER-0',password:'Fixture assigned worker password 123',confirmed:true},f.options);
    const login=await authenticateWorker(f.pool,{company:'a',workerId:'WORKER-0',password:'Fixture assigned worker password 123'},'',f.options);
    const session=await requireSession(f.pool,{headers:{cookie:'understood_session='+login.token}},f.options);
    const frozen=withMultipleChoice({source,title:'Title',question:'What must you do?',facts,rubric:{askedFacts:facts},languages:{en:{title:'Title',text:source,question:'What must you do?'}}});
    await f.db.query("INSERT INTO briefings(id,org_id,site_id,title,source,state) VALUES('session','a','a','Title',$1,'ready')",[source]);
    await f.db.query("INSERT INTO publications(id,org_id,site_id,briefing_id,version,snapshot_json,state) VALUES('session','a','a','session',1,$1,'published')",[JSON.stringify(frozen)]);
    await f.db.exec("INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,language) VALUES('session','a','a','session','w0','en');UPDATE workers SET language='hi' WHERE id='w0'");
    await createPresentation(f.pool,session,'session',{requestId:randomUUID(),sourceKind:'instruction'},{...f.options,queueGeneration:true});
    await f.db.exec('CREATE ROLE prod_worker_fixture LOGIN');await configureRuntimePermissions(f.pool,{schema:f.config.schema,role:'prod_worker_fixture',profile:'worker',dedicatedDatabase:true,writersStopped:true});
    await f.db.exec(`SET SESSION AUTHORIZATION prod_worker_fixture;SET search_path TO ${f.config.schema},pg_catalog`);acting=true;
    await assert.rejects(f.db.exec('SELECT * FROM worker_credentials'),error=>error.code==='42501');
    assert.equal(await processOnePresentation(f.pool,f.config.preparationAdapter,f.options),true);
    await f.db.exec('SET SESSION AUTHORIZATION postgres;RESET ROLE');acting=false;
    assert.equal((await listPresentations(f.pool,asWorker('w0'),'session',f.options)).items[0].status,'ready',JSON.stringify({errors:f.errors.slice(-5),job:(await f.db.query('SELECT * FROM presentation_translation_jobs')).rows,calls:f.calls.length}));
    // A later request cannot continue under the revoked password session.
    await f.db.query("INSERT INTO publications(id,org_id,site_id,briefing_id,version,snapshot_json,state) VALUES('session-next','a','a','session',2,$1,'published')",[JSON.stringify(frozen)]);
    await f.db.query("INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,language) VALUES('session-next','a','a','session-next','w0','en')");
    await createPresentation(f.pool,session,'session-next',{requestId:randomUUID(),sourceKind:'instruction'},{...f.options,queueGeneration:true});
    const job=(await f.db.query('SELECT authority_json FROM presentation_translation_jobs')).rows[0];assert.equal(job.authority_json.token_hash,session.token_hash);
    await f.db.query('UPDATE sessions SET revoked_at=clock_timestamp() WHERE token_hash=$1',[session.token_hash]);
    const before=f.calls.length;assert.equal(await processOnePresentation(f.pool,f.config.preparationAdapter,f.options),true);assert.equal(f.calls.length,before);
    assert.ok((await f.db.query('SELECT state FROM presentation_translation_jobs')).rows.some(row=>row.state==='failed'));
    await assert.rejects(createPresentation(f.pool,session,'session',{requestId:randomUUID(),sourceKind:'instruction'},{...f.options,queueGeneration:true}),/Sign in/);
  }finally{if(acting)await f.db.exec('SET SESSION AUTHORIZATION postgres;RESET ROLE');await f.close();}
});
