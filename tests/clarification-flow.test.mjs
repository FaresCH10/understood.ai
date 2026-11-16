import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {clarificationFixture} from './helpers/clarification-flow-fixture.mjs';
import {submitAnswer} from '../server/postgres/domain.mjs';
import {processOneAssessment} from '../server/postgres/assessment-worker.mjs';
import {readClarificationFlow,saveClarificationExchange,processOneClarificationExchange,listClarificationFlow} from '../server/postgres/clarification-flow.mjs';
import {workerBriefing} from '../server/postgres/read-models.mjs';
import {postgresWorkspace} from '../server/postgres/workspace.mjs';
import {clarificationFlowInput} from '../server/clarification-flow-input.mjs';
import {openDatabase,NOW} from '../server/db.mjs';
import {sqliteApp} from './helpers/sqlite-app.mjs';
import {syntheticPrepare,CANONICAL_SOURCE,submitAnswer as sqliteAnswer} from '../server/domain.mjs';
import {withMultipleChoice} from '../server/multiple-choice.mjs';
import {saveClarificationExchange as sqliteSave,readClarificationFlow as sqliteRead,processOneClarificationExchange as sqliteProcess,pendingFlowRepeat} from '../server/clarification-flow.mjs';

const owner={principal_type:'staff',principal_id:'owner',org_id:'org',site_id:'site',role:'owner'},worker={principal_type:'worker',principal_id:'worker',org_id:'org',site_id:'site'};
const command=text=>({requestId:randomUUID(),text});
test('a wrong choice requires an area, translates it to the supervisor, and delivers the explanation and retry together',async()=>{
 const f=await clarificationFixture();try{
  const {pool,db,caseId}=f,settings={worker:true};
  assert.equal((await readClarificationFlow(pool,worker,'assignment',settings)).needsArea,true);
  assert.throws(()=>saveClarificationExchange(pool,worker,'assignment',command(' '),settings),/Describe/);
  await assert.rejects(submitAnswer(pool,worker,'assignment',randomUUID(),'blue'),/approved repeat/);
  await assert.rejects(saveClarificationExchange(pool,owner,caseId,command('Put finished items on blue.')),/Wait for/);
  assert.equal((await listClarificationFlow(pool,owner)).rows.length,1);
  const request=command('لم أفهم أي رف أستخدم.');const accepted=await saveClarificationExchange(pool,worker,'assignment',request,settings);
  assert.equal(accepted.state,'queued');assert.equal((await saveClarificationExchange(pool,worker,'assignment',request,settings)).id,accepted.id);
  await assert.rejects(saveClarificationExchange(pool,worker,'assignment',{...request,text:'نص مختلف'},settings),/conflict/);
  assert.equal((await readClarificationFlow(pool,owner,caseId)).items[0].text,null);
  const calls=[],adapter={provenance:{dataClass:'synthetic'},async translate(source,target){calls.push({source:source.text,target});return {title:target==='ar'?'توضيح':'Clarification',text:target==='ar'?'ضع العناصر المكتملة على الرف الأزرق.':'I did not understand which shelf to use.',question:target==='ar'?'أي رف؟':'Which shelf?'};},async checkTranslation(){return {faithful:true,complete:true,languageCorrect:true,terminologyApplied:true,reasons:[]};}};
  assert.equal(await processOneClarificationExchange(pool,adapter),true);
  const staff=await readClarificationFlow(pool,owner,caseId);assert.equal(staff.answer,'Red shelf');assert.equal(staff.items[0].text,'I did not understand which shelf to use.');assert.equal(staff.items[0].originalText,null);
  const explanation=command('Put finished items on the blue shelf.');await saveClarificationExchange(pool,owner,caseId,explanation);
  assert.equal((await db.query('SELECT count(*)::int n FROM case_repeats')).rows[0].n,0);
  await processOneClarificationExchange(pool,adapter);
  const detail=await workerBriefing(pool,worker,'assignment');assert.equal(detail.repeatRequest.id,explanation.requestId);assert.equal(detail.repeatRequest.message,'ضع العناصر المكتملة على الرف الأزرق.');
  assert.equal((await readClarificationFlow(pool,worker,'assignment',settings)).items[1].originalText,null);
  assert.deepEqual(calls.map(call=>call.target),['en','ar']);
  assert.equal((await readClarificationFlow(pool,{...worker,principal_id:'other'},'assignment',settings)).caseId,null);
  await submitAnswer(pool,worker,'assignment',randomUUID(),'blue');await processOneAssessment(pool,{async assess(){throw Error("Multiple choice must be assessed deterministically");}});
  assert.equal((await db.query('SELECT status FROM clarifications WHERE id=$1',[caseId])).rows[0].status,'resolved');
  assert.equal((await listClarificationFlow(pool,owner)).rows.length,0);
  const work=await postgresWorkspace(pool,worker,'work',{assignmentId:'assignment'});assert.equal(work.item.status,'in-progress');assert.equal(work.item.canComplete,true);
 }finally{await f.db.close();}
});
test('a rejected translation never unlocks another attempt or exposes untranslated content',async()=>{
 const f=await clarificationFixture();try{
  await saveClarificationExchange(f.pool,worker,'assignment',command('أي رف أستخدم؟'),{worker:true});
  await processOneClarificationExchange(f.pool,{provenance:{dataClass:'synthetic'},async translate(){return {title:'Clarification',text:'A changed meaning.',question:'Which shelf?'};},async checkTranslation(){return {faithful:false,complete:true,languageCorrect:true,terminologyApplied:true,reasons:['changed']};}});
  const flow=await readClarificationFlow(f.pool,owner,f.caseId);assert.equal(flow.items[0].text,null);
  assert.equal((await f.db.query('SELECT count(*)::int n FROM case_repeats')).rows[0].n,0);
  await assert.rejects(submitAnswer(f.pool,worker,'assignment',randomUUID(),'blue'),/approved repeat/);
 }finally{await f.db.close();}
});
test('area and explanation input retain a stable request hash and reject extra client authority',()=>{
 const input=command('  Explain the shelf colour.  ');assert.equal(clarificationFlowInput(input).text,'Explain the shelf colour.');
 assert.throws(()=>clarificationFlowInput({...input,targetLanguage:'ar'}));assert.throws(()=>clarificationFlowInput({...input,text:'a'}));
});
test('live clarification translations require quota, journal both calls and retain accepted delivery proof',async()=>{
 const f=await clarificationFixture();try{
  await f.db.exec("INSERT INTO provider_policies(scope_key,org_id,revision,enabled,max_daily_requests) VALUES('global',NULL,1,true,10),('tenant:org','org',1,true,10)");
  const request=command('أي رف أستخدم؟');await saveClarificationExchange(f.pool,worker,'assignment',request,{worker:true,integrationMode:'live'});
  await assert.rejects(f.db.query("UPDATE clarification_exchanges SET state='delivered',translated_text='Forged translation' WHERE id=$1",[request.requestId]),/claim unavailable/);
  const adapter={provenance:{adapter:'gemini-approved-v1',dataClass:'real',textModel:'gemini-test'},translate(){},checkTranslation(){},
   withJournal(journal){return {async translate(){const id=await journal.beforeRequest();await journal.afterRequest(id,{httpStatus:200});return {title:'Clarification',text:'Which shelf should I use?',question:'Which shelf?'};},async checkTranslation(){const id=await journal.beforeRequest();await journal.afterRequest(id,{httpStatus:200});return {faithful:true,complete:true,languageCorrect:true,terminologyApplied:true,reasons:[]};}};}};
  await processOneClarificationExchange(f.pool,adapter,{dataClass:'real'});
  assert.equal((await readClarificationFlow(f.pool,owner,f.caseId)).items[0].state,'delivered');
  assert.equal((await f.db.query("SELECT count(*)::int n FROM provider_operations WHERE kind='clarification-translation' AND data_class='real'")).rows[0].n,2);
  assert.equal((await f.db.query("SELECT count(*)::int n FROM provider_requests WHERE state='accepted'")).rows[0].n,2);
  await assert.rejects(f.db.query("UPDATE clarification_exchanges SET translated_text='Changed translation' WHERE id=$1",[request.requestId]),/immutable/);
 }finally{await f.db.close();}
});
test('SQLite keeps the same required-area, translated explanation and one-retry behavior',async()=>{
 const db=openDatabase(':memory:'),server=sqliteApp(db);try{
  const snapshot=withMultipleChoice(syntheticPrepare(CANONICAL_SOURCE));
  db.prepare('INSERT INTO publications VALUES(?,?,?,?,?,?,?,?)').run('flow-publication','cedar','beirut','shelf',4,JSON.stringify(snapshot),NOW(),'published');
  db.prepare('INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,language,created_at) VALUES(?,?,?,?,?,?,?)').run('flow-assignment','cedar','beirut','flow-publication','worker-14','ar',NOW());
  const worker={principal_type:'worker',principal_id:'worker-14',org_id:'cedar',site_id:'beirut'},owner={principal_type:'staff',principal_id:'maya',org_id:'cedar',site_id:'beirut',role:'owner'};
  const wrong=snapshot.languages.ar.choices.find(choice=>choice.id!==snapshot.rubric.correctChoiceId).id;
  assert.equal(sqliteAnswer(db,worker,'flow-assignment',randomUUID(),wrong).outcome,'clarification');
  const flow=sqliteRead(db,worker,'flow-assignment',{worker:true});assert.equal(flow.needsArea,true);
  sqliteSave(db,worker,'flow-assignment',command('أي رف أستخدم؟'),{worker:true});
  const adapter={async translate(source,target){return {title:target==='ar'?'توضيح':'Clarification',text:target==='ar'?'استخدم الرف الأزرق.':'Which shelf should I use?',question:target==='ar'?'أي رف؟':'Which shelf?'};},async checkTranslation(){return {faithful:true,complete:true,languageCorrect:true,terminologyApplied:true,reasons:[]};}};
  await sqliteProcess(db,adapter);assert.equal(sqliteRead(db,owner,flow.caseId).items[0].text,'Which shelf should I use?');
  sqliteSave(db,owner,flow.caseId,command('Use the blue shelf.'));await sqliteProcess(db,adapter);assert.equal(pendingFlowRepeat(db,'flow-assignment').message,'استخدم الرف الأزرق.');
  assert.equal(sqliteAnswer(db,worker,'flow-assignment',randomUUID(),snapshot.rubric.correctChoiceId).outcome,'matched');
  assert.equal(pendingFlowRepeat(db,'flow-assignment'),null);assert.equal(db.prepare('SELECT status FROM clarifications WHERE id=?').get(flow.caseId).status,'resolved');
 }finally{server.close();db.close();}
});
test('another wrong answer asks for a new unclear area on the same supervisor case',async()=>{
 const f=await clarificationFixture();try{
  const adapter={provenance:{dataClass:'synthetic'},async translate(source,language){return {title:language==='ar'?'توضيح':'Clarification',text:language==='ar'?'ضع العناصر على الرف الأزرق.':'Which shelf should I use?',question:language==='ar'?'أي رف؟':'Which shelf?'};},async checkTranslation(){return {faithful:true,complete:true,languageCorrect:true,terminologyApplied:true,reasons:[]};}};
  await saveClarificationExchange(f.pool,worker,'assignment',command('أي رف أستخدم؟'),{worker:true});await processOneClarificationExchange(f.pool,adapter);
  await saveClarificationExchange(f.pool,owner,f.caseId,command('Use the blue shelf.'));await processOneClarificationExchange(f.pool,adapter);
  await submitAnswer(f.pool,worker,'assignment',randomUUID(),'green');await processOneAssessment(f.pool,{async assess(){throw Error('Unexpected provider assessment');}});
  const current=await readClarificationFlow(f.pool,worker,'assignment',{worker:true});assert.equal(current.caseId,f.caseId);assert.equal(current.needsArea,true);
  assert.equal(current.items.filter(item=>item.attemptId===current.attemptId).length,0);assert.equal((await listClarificationFlow(f.pool,owner)).rows.length,1);
  await assert.rejects(submitAnswer(f.pool,worker,'assignment',randomUUID(),'blue'),/approved repeat/);
  await saveClarificationExchange(f.pool,worker,'assignment',command('لم أفهم لون الرف.'),{worker:true});
  assert.equal((await readClarificationFlow(f.pool,worker,'assignment',{worker:true})).needsArea,false);
 }finally{await f.db.close();}
});
