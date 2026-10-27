import {assignWorkerPassword} from '../server/postgres/worker-credentials.mjs';
import test from 'node:test';
import {createSessionContextFetch} from './helpers/session-http.mjs';
const fetch=createSessionContextFetch();
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { runMigrations } from '../server/postgres/migrate.mjs';
import { rehearsalConfig,runWorkerCycle,rehearsalTasks,startRehearsalApi,syntheticAssessmentAdapter } from '../server/postgres/runtime.mjs';
import { createDraft,queuePreparation } from '../server/postgres/preparation.mjs';
import { publish,submitAnswer } from '../server/postgres/domain.mjs';
import { getBriefing,workerBriefings,workerBriefing } from '../server/postgres/read-models.mjs';
import { provisionStaffCredential,issueWorkerGrant } from '../server/postgres/auth.mjs';
import { CANONICAL_SOURCE,syntheticPrepare } from '../server/domain.mjs';
import {encodeWav} from '../src/audio.ts';

const env={UNDERSTOOD_TIER:'local',UNDERSTOOD_AI_MODE:'synthetic',UNDERSTOOD_ACCESS_MODE:'credential',
  UNDERSTOOD_PUBLIC_ORIGIN:'http://127.0.0.1:3030',UNDERSTOOD_DATA_CLASS:'synthetic',
  UNDERSTOOD_POSTGRES_SCHEMA:'understood_test_runtime',UNDERSTOOD_REHEARSAL_AUDIO_ROOT:resolve('data/runtime-test-audio')};

test('rehearsal runtime requires explicit synthetic credentials, isolated schema and nonoverlapping storage',() => {
  const config=rehearsalConfig(env);
  assert.equal(config.port,3031);assert.equal(config.integrationMode,'synthetic');
  assert.equal(config.storageChecks,false);
  assert.equal(rehearsalConfig({...env,UNDERSTOOD_STORAGE_CHECKS:'true'}).storageChecks,true);
  assert.throws(()=>rehearsalConfig({...env,UNDERSTOOD_STORAGE_CHECKS:'yes'}),/Invalid storage health/);
  assert.deepEqual(config.mail,{available:false});
  const enabled=rehearsalConfig({...env,UNDERSTOOD_EMAIL_MODE:'resend',UNDERSTOOD_RESEND_KEY:'re_synthetic_only',
    UNDERSTOOD_EMAIL_FROM:'fixture@example.test',UNDERSTOOD_AUTH_MAIL_KEY:'01'.repeat(32)});
  assert.equal(enabled.mail.available,true);assert.equal(enabled.mail.publicOrigin,env.UNDERSTOOD_PUBLIC_ORIGIN);
  assert.equal(enabled.mail.key.length,32);
  assert.throws(()=>rehearsalConfig({...env,UNDERSTOOD_EMAIL_MODE:'resend',UNDERSTOOD_AUTH_MAIL_KEY:'invalid'}),/Invalid email configuration/);
  for (const patch of [{UNDERSTOOD_TIER:'production'},{UNDERSTOOD_ACCESS_MODE:'demo'},{UNDERSTOOD_DATA_CLASS:'real'},
    {UNDERSTOOD_POSTGRES_SCHEMA:'public'},{UNDERSTOOD_REHEARSAL_PORT:'0'},
    {UNDERSTOOD_REHEARSAL_AUDIO_ROOT:resolve('data/private-audio')},{UNDERSTOOD_REHEARSAL_AUDIO_ROOT:resolve('data')},
    {UNDERSTOOD_REHEARSAL_AUDIO_ROOT:resolve('data/private-audio/child')},{UNDERSTOOD_REHEARSAL_AUDIO_ROOT:'relative-path'}])
    assert.throws(() => rehearsalConfig({...env,...patch}));
});

test('worker cycle awaits each stage, continues after redacted failure and respects shutdown',async () => {
  const calls=[],errors=[];let release;
  const pause=new Promise((done) => {release=done;});
  const cycle=runWorkerCycle({preparation:async () => {calls.push('started');await pause;calls.push('finished');return true;},
    assessment:async () => {calls.push('assessment');throw new Error('secret provider connection');},
    expiry:async () => {calls.push('expiry');return 2;}},{onError:(stage) => errors.push(stage)});
  assert.deepEqual(calls,['started']);release();
  assert.deepEqual(await cycle,{preparation:true,assessment:null,expiry:2});
  assert.deepEqual(calls,['started','finished','assessment','expiry']);assert.deepEqual(errors,['assessment']);
  const stop=new AbortController();
  assert.deepEqual(await runWorkerCycle({first:async () => {stop.abort();return true;},second:async () => assert.fail('Stage ran after shutdown')},{signal:stop.signal}),{first:true});
  const duringObservation=new AbortController();
  assert.deepEqual(await runWorkerCycle({first:()=>assert.fail('Stage started after observer shutdown')},{signal:duringObservation.signal,onStage:()=>duringObservation.abort()}),{});
});

test('synthetic assessment cannot certify unsupported facts, swapped shelves or oversized evidence',async () => {
  const facts=['finished -> blue shelf','unfinished -> yellow shelf'];
  assert.equal((await syntheticAssessmentAdapter.assess('Finished blue; unfinished yellow.','Where?',facts)).outcome,'matched');
  assert.notEqual((await syntheticAssessmentAdapter.assess('Finished yellow; unfinished blue.','Where?',facts)).outcome,'matched');
  assert.equal((await syntheticAssessmentAdapter.assess('Finished blue; unfinished yellow.','Where?',['different fact'])).outcome,'unassessable');
  assert.equal((await syntheticAssessmentAdapter.assess('Finished blue; unfinished yellow.'+' '.repeat(301),'Where?',facts)).outcome,'unassessable');
});

test('standalone rehearsal API verifies schema and scheduled stages prepare and assess persisted evidence',async () => {
  const db=new PGlite(),commands=[];
  const client={async query(sql,values) {commands.push(sql);return values?.length ? db.query(sql,values) : (await db.exec(sql)).at(-1) || {rows:[]};},release() {}};
  const pool={async connect() {return client;}};
  const config={...rehearsalConfig(env),port:0};
  const owner={principal_type:'staff',principal_id:'owner',org_id:'a',site_id:'a',role:'owner'};
  let server;
  try {
    await db.exec(`CREATE SCHEMA ${config.schema};SET search_path TO ${config.schema},pg_catalog`);
    await runMigrations(pool,config);
    await db.exec("INSERT INTO organizations(id,name) VALUES ('a','A');INSERT INTO sites(id,org_id,name,timezone) VALUES ('a','a','A','UTC');INSERT INTO staff(id,org_id,site_id,name,role) VALUES ('owner','a','a','Owner','owner');INSERT INTO workers(id,org_id,site_id,code,language) VALUES ('w','a','a','001','en')");
    await provisionStaffCredential(pool,{staffId:'owner',orgId:'a',siteId:'a',email:'owner@example.test',password:'long-synthetic-password'},config);
    commands.length=0;
    const objects=new Map(),storage={async save(row,bytes) {objects.set(row.id,Buffer.from(bytes));},async read(row) {if(!objects.has(row.id))throw Error('No audio');return objects.get(row.id);},async exists(row){return objects.has(row.id);},async remove(row) {objects.delete(row.id);}};
    server=await startRehearsalApi(pool,storage,config);
    assert.ok(!commands.some((sql) => /CREATE|ALTER|INSERT/.test(sql)));
    const base=`http://127.0.0.1:${server.address().port}`;
    const health=await (await fetch(`${base}/api/health`)).json();assert.equal(health.backend,'postgres-rehearsal');
    assert.equal((await fetch(`${base}/api/demo/session`,{method:'POST',headers:{origin:config.publicOrigin}})).status,404);
    const login=await fetch(`${base}/api/auth/staff/login`,{method:'POST',headers:{origin:config.publicOrigin,'content-type':'application/json'},body:JSON.stringify({email:'owner@example.test',password:'long-synthetic-password'})});
    assert.equal(login.status,200);
    const cookie=login.headers.get('set-cookie').split(';')[0];
    assert.match(cookie,/^understood_pg_rehearsal=/);
    assert.equal((await fetch(`${base}/api/overview`,{headers:{cookie}})).status,200);
    assert.equal((await fetch(`${base}/api/retention/text`)).status,401);
    assert.equal((await fetch(`${base}/api/retention/text?site=forged`,{headers:{cookie}})).status,400);
    const textPolicy=await (await fetch(`${base}/api/retention/text`,{headers:{cookie}})).json();
    assert.equal(textPolicy.revision,0);assert.equal(textPolicy.days,null);
    const textChange={requestId:randomUUID(),revision:0,days:90,confirmed:true};
    const textHeaders={cookie,origin:config.publicOrigin,'content-type':'application/json'};
    const textSave=()=>fetch(`${base}/api/retention/text`,{method:'POST',headers:textHeaders,body:JSON.stringify(textChange)});
    assert.deepEqual(await (await textSave()).json(),{revision:1,duplicate:false});
    assert.deepEqual(await (await textSave()).json(),{revision:1,duplicate:true});
    const textReceipt=await (await fetch(`${base}/api/retention/text/requests/${textChange.requestId}`,{headers:{cookie}})).json();
    assert.equal(textReceipt.request.days,90);assert.equal(textReceipt.revision,1);
    assert.equal((await fetch(`${base}/api/retention/cases`)).status,401);
    assert.equal((await fetch(`${base}/api/retention/cases?site=forged`,{headers:{cookie}})).status,400);
    const caseChange={requestId:randomUUID(),revision:0,days:90,confirmed:true};
    const caseSave=()=>fetch(`${base}/api/retention/cases`,{method:'POST',headers:textHeaders,body:JSON.stringify(caseChange)});
    assert.deepEqual(await (await caseSave()).json(),{revision:1,duplicate:false});
    assert.deepEqual(await (await caseSave()).json(),{revision:1,duplicate:true});
    const caseReceipt=await (await fetch(`${base}/api/retention/cases/requests/${caseChange.requestId}`,{headers:{cookie}})).json();
    assert.equal(caseReceipt.request.days,90);assert.equal(caseReceipt.revision,1);
    assert.equal((await fetch(`${base}/api/retention/generated`)).status,401);
    assert.equal((await fetch(`${base}/api/retention/generated?site=forged`,{headers:{cookie}})).status,400);
    const generatedChange={requestId:randomUUID(),revision:0,days:90,confirmed:true};
    const generatedSave=()=>fetch(`${base}/api/retention/generated`,{method:'POST',headers:textHeaders,body:JSON.stringify(generatedChange)});
    assert.deepEqual(await (await generatedSave()).json(),{revision:1,duplicate:false});
    assert.deepEqual(await (await generatedSave()).json(),{revision:1,duplicate:true});
    const generatedReceipt=await (await fetch(`${base}/api/retention/generated/requests/${generatedChange.requestId}`,{headers:{cookie}})).json();
    assert.equal(generatedReceipt.request.days,90);assert.equal(generatedReceipt.revision,1);
    const token=cookie.split('=')[1];
    assert.equal((await fetch(`${base}/api/overview`,{headers:{cookie:`understood_session=${token}`}})).status,401);
    assert.equal((await fetch(`${base}/api/overview`,{headers:{cookie:`understood_session=unrelated-sqlite-session; ${cookie}`}})).status,200);
    const draft=await createDraft(pool,owner,{requestId:randomUUID(),title:'Runtime shelf handover',source:CANONICAL_SOURCE},config);
    await queuePreparation(pool,owner,draft.id,1,config);
    const first=await runWorkerCycle(rehearsalTasks(pool,storage,config));assert.equal(first.preparation,true);
    assert.equal((await getBriefing(pool,owner,draft.id,config)).state,'ready');
    const pub=await publish(pool,owner,draft.id,{requestId:randomUUID(),revision:1,nextVersion:1,workerIds:['w']},config);
    const assignment=(await db.query('SELECT id FROM assignments WHERE publication_id=$1',[pub.id])).rows[0].id;
    const receipt=await submitAnswer(pool,{principal_type:'worker',principal_id:'w',org_id:'a',site_id:'a'},assignment,randomUUID(),(await db.query('SELECT snapshot_json FROM publications WHERE id=$1',[pub.id])).rows[0].snapshot_json.rubric.correctChoiceId,config);
    assert.equal(receipt.assessmentStatus,'pending');
    const worker={principal_type:'worker',principal_id:'w',org_id:'a',site_id:'a'};
    assert.equal((await workerBriefings(pool,worker,config)).items[0].assessmentStatus,'pending');
    await assignWorkerPassword(pool,owner,'w',{expectedCode:(await db.query("SELECT code FROM workers WHERE id='w'")).rows[0].code,workerId:'WORKER-001',password:'Assigned synthetic worker password',confirmed:true},config);
    const grant=await issueWorkerGrant(pool,owner,'w',60,config);
    const redemption=await fetch(`${base}/api/auth/worker/redeem`,{method:'POST',headers:{origin:config.publicOrigin,'content-type':'application/json'},body:JSON.stringify({token:grant.token,company:'a',workerId:'WORKER-001',password:'Assigned synthetic worker password'})});
    assert.equal(redemption.status,200);
    const workerCookie=redemption.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(`${base}/api/retention/text`,{headers:{cookie:workerCookie}})).status,403);
    assert.equal((await fetch(`${base}/api/retention/cases`,{headers:{cookie:workerCookie}})).status,403);
    assert.equal((await fetch(`${base}/api/retention/generated`,{headers:{cookie:workerCookie}})).status,403);
    assert.equal((await fetch(`${base}/api/retention/generated`,{method:'POST',headers:{...textHeaders,cookie:workerCookie},body:JSON.stringify({...generatedChange,requestId:randomUUID(),revision:1})})).status,403);
    assert.equal((await fetch(`${base}/api/retention/cases`,{method:'POST',headers:{...textHeaders,cookie:workerCookie},body:JSON.stringify({...caseChange,requestId:randomUUID(),revision:1})})).status,403);
    assert.equal((await fetch(`${base}/api/retention/text`,{method:'POST',headers:{...textHeaders,cookie:workerCookie},body:JSON.stringify({...textChange,requestId:randomUUID(),revision:1})})).status,403);
    const pendingDetail=await (await fetch(`${base}/api/worker/briefings/${assignment}`,{headers:{cookie:workerCookie}})).json();
    assert.equal(pendingDetail.assessmentStatus,'pending'); assert.equal(pendingDetail.outcome,null);
    assert.equal(JSON.stringify(pendingDetail).includes('rubric'),false);
    assert.equal((await fetch(`${base}/api/worker/history`,{headers:{cookie}})).status,403);
    const second=await runWorkerCycle(rehearsalTasks(pool,storage,config));assert.equal(second.assessment,true);
    const attempt=(await db.query('SELECT outcome,assessment_status FROM attempts WHERE id=$1',[receipt.id])).rows[0];
    assert.equal(attempt.outcome,'matched');assert.equal(attempt.assessment_status,'complete');
    assert.equal((await getBriefing(pool,owner,draft.id,config)).publications[0].metrics.matches,1);
    // Keep historical free-text voice coverage alongside the new MCQ draft path.
    await db.query("INSERT INTO briefings(id,org_id,site_id,title,source,state,prepared_json) VALUES('legacy-voice','a','a','Historical voice',$1,'ready',$2)",[CANONICAL_SOURCE,JSON.stringify(syntheticPrepare(CANONICAL_SOURCE))]);
    const voicePub=await publish(pool,owner,'legacy-voice',{requestId:randomUUID(),revision:1,nextVersion:1,workerIds:['w']},config);
    const voiceAssignment=(await db.query('SELECT id FROM assignments WHERE publication_id=$1',[voicePub.id])).rows[0].id;
    const audio=Buffer.from(encodeWav({duration:1,sampleRate:16000,numberOfChannels:1,getChannelData:()=>new Float32Array(16000).fill(0.2)})),submissionId=randomUUID();
    const session=await (await fetch(`${base}/api/session`,{headers:{cookie:workerCookie}})).json();
    const headers={cookie:workerCookie,origin:config.publicOrigin,'content-type':'audio/wav','x-submission-id':submissionId,'x-client-session-context':session.clientContext};
    const voiceResponse=await fetch(`${base}/api/worker/briefings/${voiceAssignment}/audio`,{method:'POST',headers,body:audio});assert.equal(voiceResponse.status,201);
    const voice=await voiceResponse.json();assert.equal(voice.status,'received');
    const status=()=>fetch(`${base}/api/recordings/${voice.id}`,{headers:{cookie:workerCookie}}).then(response=>response.json());
    assert.equal((await status()).aiStatus,'pending');
    const disabled=await runWorkerCycle(rehearsalTasks(pool,storage,config));assert.equal(disabled.recording,false);assert.equal((await status()).aiStatus,'pending');
    const recordingAdapter={permitsRecording:()=>true,async transcribe(bytes){assert.deepEqual(bytes,audio);return {text:'Finished blue; unfinished yellow.'};},assess:syntheticAssessmentAdapter.assess};
    const processed=await runWorkerCycle(rehearsalTasks(pool,storage,{...config,recordingAdapter}));assert.equal(processed.recording,true);
    assert.equal((await status()).aiStatus,'transcribed');
    const replay=await fetch(`${base}/api/worker/briefings/${voiceAssignment}/audio`,{method:'POST',headers,body:audio});assert.equal(replay.status,200);assert.equal((await replay.json()).id,voice.id);
    assert.equal((await db.query('SELECT count(*)::int n FROM recordings')).rows[0].n,1);
    assert.equal((await db.query('SELECT count(*)::int n FROM attempts')).rows[0].n,2);
    assert.equal((await getBriefing(pool,owner,draft.id,config)).publications[0].metrics.matches,1);
    await db.query("UPDATE publications SET state='withdrawn' WHERE id=ANY($1::text[])",[[pub.id,voicePub.id]]);
    assert.equal((await workerBriefings(pool,worker,config)).items.length,0);
    assert.equal((await workerBriefing(pool,worker,assignment,config)).state,'withdrawn');
    const history=await (await fetch(`${base}/api/worker/history`,{headers:{cookie:workerCookie}})).json();
    assert.deepEqual(history.items.filter(item=>item.id===assignment).map((item) => [item.id,item.state,item.outcome]),[[assignment,'withdrawn','matched']]);
    const logout=await fetch(`${base}/api/logout`,{method:'POST',headers:{cookie,origin:config.publicOrigin}});
    assert.match(logout.headers.get('set-cookie'),/^understood_pg_rehearsal=;.*Max-Age=0/);
    assert.equal((await fetch(`${base}/api/overview`,{headers:{cookie}})).status,401);
  } finally {if(server) await new Promise((done) => server.close(done));await db.close();}
});
