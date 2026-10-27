import test from 'node:test';
import {createSessionContextFetch} from './helpers/session-http.mjs';
const fetch=createSessionContextFetch();
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {pipelineStatus} from '../server/ai/pipeline-status.mjs';
import {languageReadinessModel} from '../server/language-readiness.mjs';
import {WORKER_LANGUAGE_CODES} from '../server/languages.mjs';
import {rehearsalConfig} from '../server/postgres/runtime.mjs';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {createPostgresRehearsalServer} from '../server/postgres/http.mjs';
import {provisionStaffCredential} from '../server/postgres/auth.mjs';
import {provisionOperator} from '../server/postgres/operators.mjs';
import {resolveProviderVerification} from '../server/ai/provider-verification-config.mjs';
import {CANONICAL_SOURCE,syntheticPrepare} from '../server/domain.mjs';

const secret='private-synthetic-provider-key',hash='ab'.repeat(32);
const env={UNDERSTOOD_TIER:'local',UNDERSTOOD_AI_MODE:'synthetic',UNDERSTOOD_ACCESS_MODE:'credential',
  UNDERSTOOD_DATA_CLASS:'synthetic',UNDERSTOOD_PUBLIC_ORIGIN:'http://127.0.0.1:3030',
  UNDERSTOOD_POSTGRES_SCHEMA:'understood_test_readiness',UNDERSTOOD_REHEARSAL_AUDIO_ROOT:'D:/understod/data/readiness-fixture',
  UNDERSTOOD_OPERATOR_ACCESS:'true',GEMINI_API_KEY:secret,
  UNDERSTOOD_PREPARATION_ADAPTER:'gemini-free',UNDERSTOOD_SYNTHETIC_PREPARATION_HASHES:JSON.stringify([hash]),
  UNDERSTOOD_SOURCE_TRANSCRIPTION:'gemini-free',UNDERSTOOD_RECORDING_ADAPTER:'gemini-free',UNDERSTOOD_SYNTHETIC_AUDIO_HASHES:JSON.stringify([hash]),
  UNDERSTOOD_ASSESSMENT_ADAPTER:'gemini-free',UNDERSTOOD_SYNTHETIC_ASSESSMENT_HASHES:JSON.stringify([hash]),
  UNDERSTOOD_CASE_FOLLOWUP_ADAPTER:'gemini',UNDERSTOOD_PROVIDER_TESTS:'gemini-free'};
const secretFree=value=>assert.doesNotMatch(JSON.stringify(value),new RegExp(`${secret}|${hash}|fingerprint|apiKey|permitsPreparation|withJournal`));

test('runtime stage projection is bounded, immutable, synthetic-only and never calls adapters',()=>{
  const config=rehearsalConfig(env),pipeline=pipelineStatus(config);
  assert.equal(pipeline.stages.length,7);assert.ok(pipeline.stages.every(stage=>stage.configuration==='configured' && stage.verification==='not_tested'));
  assert.deepEqual(pipeline.stages.find(stage=>stage.id==='speech').declaredLanguages,WORKER_LANGUAGE_CODES);
  assert.deepEqual(pipeline.stages.find(stage=>stage.id==='source').declaredLanguages,[]);
  assert.equal(pipeline.realDataAllowed,false);assert.equal(pipeline.productionReady,false);secretFree(pipeline);
  assert.throws(()=>pipeline.stages[0].models.push('forged'));assert.throws(()=>pipeline.stages[0].configuration='verified');
  assert.ok(pipelineStatus({GEMINI_API_KEY:secret}).stages.every(stage=>stage.configuration==='disabled'));
  const partial=pipelineStatus({...config,preparationAdapter:{...config.preparationAdapter,speech:undefined}});
  assert.ok(partial.stages.filter(stage=>['preparation','translation','speech'].includes(stage.id)).every(stage=>stage.configuration==='disabled'));
  const wrong=pipelineStatus({...config,assessmentAdapter:{...config.assessmentAdapter,provenance:{dataClass:'real',adapter:'gemini-typed-assessment-v1'}}});
  assert.equal(wrong.stages.find(stage=>stage.id==='assessment').configuration,'disabled');
});

test('inspection separates stored content, declared capabilities and unperformed verification',()=>{
  const pipeline=pipelineStatus(rehearsalConfig(env)),model=languageReadinessModel({pipeline,testedAt:'2026-10-10T00:00:00Z',
    publication:{id:'p',version:1,state:'published',snapshot:{title:'Synthetic',source:'Synthetic source',question:'Question?',languages:{ar:{title:'Synthetic',text:'Synthetic',question:'Synthetic?'}}}}});
  assert.deepEqual(model.languages.map(row=>row.code),WORKER_LANGUAGE_CODES);
  assert.ok(model.languages.every(row=>row.ui.state==='ready'));
  assert.match(model.languages.find(row=>row.code==='hi').ui.evidence,/native-speaker review/);
  assert.equal(model.languages.find(row=>row.code==='ar').content.state,'ready');
  assert.equal(model.languages.find(row=>row.code==='ar').translation.state,'not_tested');
  assert.equal(model.languages.find(row=>row.code==='ar').speech.state,'not_tested');
  assert.equal(model.languages.find(row=>row.code==='ur').speech.state,'not_tested');
  assert.equal(model.languages.find(row=>row.code==='hi').translation.state,'not_tested');
  assert.equal(model.languages.find(row=>row.code==='hi').speech.state,'not_tested');
  assert.equal(model.languages.find(row=>row.code==='hi').content.state,'missing');
  assert.ok(Object.values(model.tests).every(row=>row.state==='not_tested'));secretFree(model);
  assert.equal(model.provider.adapter,'gemini-synthetic-runtime');assert.equal(model.realDataAllowed,false);
  assert.ok(languageReadinessModel().pipeline.stages.every(stage=>stage.configuration==='disabled'));
});

test('authenticated HTTP inspection is read-only and only an explicitly budgeted operator command can run a fixed stage test',async()=>{
  let providerCalls=0;
  const verification=resolveProviderVerification(env,{fetchImpl:async(url,options)=>{
    providerCalls++;const schema=JSON.parse(options.body).generationConfig.responseFormat.text.schema;
    const {title,text,question}=syntheticPrepare(CANONICAL_SOURCE).languages.ar;
    const output=schema.properties.faithful?{faithful:true,complete:true,languageCorrect:true,terminologyApplied:true,reasons:[]}:{title,text,question};
    return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(output)}]}}]});
  }});
  const db=new PGlite(),config={...rehearsalConfig(env),providerVerification:verification};let server;
  const pool={async connect(){return {query:async(sql,values)=>values?.length?db.query(sql,values):(await db.exec(sql)).at(-1)??{rows:[]},release(){}};}};
  const password='Synthetic-readiness-password-2026';
  try {
    await db.exec(`CREATE SCHEMA ${config.schema};SET search_path TO ${config.schema},pg_catalog`);await runMigrations(pool,config);
    await db.exec("INSERT INTO organizations VALUES('cedar','Synthetic Cedar');INSERT INTO sites VALUES('beirut','cedar','Synthetic Beirut','Asia/Beirut');INSERT INTO staff(id,org_id,site_id,name,role) VALUES('owner','cedar','beirut','Synthetic Owner','owner'),('auditor','cedar','beirut','Synthetic Auditor','auditor')");
    await provisionStaffCredential(pool,{staffId:'owner',orgId:'cedar',siteId:'beirut',email:'owner@example.test',password},config);
    await provisionStaffCredential(pool,{staffId:'auditor',orgId:'cedar',siteId:'beirut',email:'auditor@example.test',password},config);
    await provisionOperator(pool,{id:randomUUID(),name:'Synthetic operator',email:'operator@example.test',password},config);
    server=createPostgresRehearsalServer(pool,{...config,storage:null});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const base=`http://127.0.0.1:${server.address().port}`;
    const call=(path,cookie='',body)=>fetch(`${base}/api${path}`,{headers:{cookie,origin:config.publicOrigin,'content-type':'application/json'},...(body!==undefined?{method:'POST',body:JSON.stringify(body)}:{})});
    const login=async(email,path='/auth/staff/login')=>{const response=await call(path,'',{email,password});assert.equal(response.status,200);return response.headers.get('set-cookie').split(';')[0];};
    assert.equal((await call('/language-readiness')).status,401);
    const owner=await login('owner@example.test'),response=await call('/language-readiness',owner);
    assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);const report=await response.json();
    assert.deepEqual(report.pipeline,pipelineStatus(config));assert.equal(report.languages.find(row=>row.code==='ur').speech.state,'not_tested');secretFree(report);
    const inspected=await call('/language-readiness/test',owner,{});assert.equal(inspected.status,200);
    assert.deepEqual((await inspected.json()).pipeline,report.pipeline);
    assert.equal((await call('/language-readiness/test',owner,{pipeline:{productionReady:true}})).status,400);
    const auditor=await login('auditor@example.test');assert.equal((await call('/language-readiness',auditor)).status,200);
    assert.equal((await call('/language-readiness/test',auditor,{})).status,403);
    assert.equal((await call('/ops/providers',owner)).status,401);
    const operator=await login('operator@example.test','/ops/login'),operatorSession=await (await call('/ops/session',operator)).json();
    const operatorReport=await fetch(`${base}/api/ops/providers`,{headers:{cookie:operator,'x-operator-context':operatorSession.clientContext}});
    assert.equal(operatorReport.status,200);const ops=await operatorReport.json();assert.deepEqual(ops.pipeline,report.pipeline);
    assert.equal(ops.connection.state,'untested');assert.equal(ops.productionReady,false);secretFree(ops);
    assert.equal(Number((await db.query('SELECT COUNT(*) AS count FROM provider_operations')).rows[0].count),0);
    assert.equal(Number((await db.query('SELECT COUNT(*) AS count FROM provider_verifications')).rows[0].count),0);
    assert.equal(providerCalls,0);
    const op=(path,body)=>fetch(`${base}/api/ops/${path}`,{headers:{cookie:operator,origin:config.publicOrigin,'x-operator-context':operatorSession.clientContext,'content-type':'application/json'},...(body!==undefined?{method:'POST',body:JSON.stringify(body)}:{})});
    const command={requestId:randomUUID(),kind:'provider-stage-verification',stage:'translation',language:'ar',maxRequests:2,confirmed:true};
    assert.equal((await call('/ops/providers/verify',owner,command)).status,401);
    assert.equal((await call('/ops/providers/verify',operator,command)).status,409);
    assert.equal((await op('providers/verify',{...command,text:'Must not send worker content'})).status,400);
    assert.equal((await op('providers/verify',{...command,stage:'speech',language:'ur',maxRequests:1})).status,400);
    assert.equal((await op('providers/verify',command)).status,409);assert.equal(providerCalls,0);
    assert.equal((await op('providers/policy',{requestId:randomUUID(),kind:'provider-policy',orgId:null,revision:0,enabled:true,maxDailyRequests:2,confirmed:true})).status,200);
    const result=await op('providers/verify',command);assert.equal(result.status,200);assert.equal((await result.json()).state,'verified');assert.equal(providerCalls,2);
    const receipt=await (await op(`receipts/${command.requestId}`)).json();assert.equal(receipt.result.language,'ar');assert.equal(receipt.result.evidence.requestCount,2);
    assert.equal((await (await op('providers/verify',command)).json()).duplicate,true);assert.equal(providerCalls,2);
    const staff=await (await call('/language-readiness',owner)).json();assert.equal(staff.languages.find(row=>row.code==='ar').translation.state,'technical_test_passed');secretFree(staff);
    assert.equal((await (await call('/language-readiness/test',owner,{})).json()).stageTests[0].state,'verified');assert.equal(providerCalls,2);
    assert.equal(Number((await db.query('SELECT COUNT(*) AS count FROM provider_operations')).rows[0].count),1);
  }finally{if(server)await new Promise(resolve=>server.close(resolve));await db.close();}
});
