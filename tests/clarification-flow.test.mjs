import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {clarificationFixture} from './helpers/clarification-flow-fixture.mjs';
import {runMigrations,verifyMigrations} from '../server/postgres/migrate.mjs';
import {requestCaseRepeat} from '../server/postgres/case-repeats.mjs';
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
import {ensureClarificationFlowSchema} from '../server/clarification-flow.mjs';

const owner={principal_type:'staff',principal_id:'owner',org_id:'org',site_id:'site',role:'owner'},worker={principal_type:'worker',principal_id:'worker',org_id:'org',site_id:'site'};
const command=text=>({requestId:randomUUID(),text});
const translator={provenance:{dataClass:'synthetic'},async translate(source,target){return {title:target==='ar'?'توضيح':'Clarification',text:target==='ar'?'ضع العناصر المكتملة على الرف الأزرق.':'I do not understand which shelf to use.',question:target==='ar'?'توضيح التعليمات':'Instruction clarification'};},async checkTranslation(){return {faithful:true,complete:true,languageCorrect:true,terminologyApplied:true,reasons:[]};}};
test('clarification is a translated message with further replies, never a generated question or answer retry',async()=>{
 const f=await clarificationFixture();try{
  const {pool,db,caseId}=f,settings={worker:true};
  assert.equal((await readClarificationFlow(pool,worker,'assignment',settings)).needsArea,true);
  assert.throws(()=>saveClarificationExchange(pool,worker,'assignment',command(' '),settings),/Describe/);
  assert.equal((await listClarificationFlow(pool,owner)).rows.length,1);
  const request=command('لم أفهم أي رف أستخدم.');const accepted=await saveClarificationExchange(pool,worker,'assignment',request,settings);
  assert.equal(accepted.state,'queued');assert.equal((await saveClarificationExchange(pool,worker,'assignment',request,settings)).id,accepted.id);
  await assert.rejects(saveClarificationExchange(pool,worker,'assignment',{...request,text:'نص مختلف'},settings),/conflict/);
  assert.equal((await readClarificationFlow(pool,owner,caseId)).items[0].text,null);
  await processOneClarificationExchange(pool,translator);
  const staff=await readClarificationFlow(pool,owner,caseId);assert.equal(staff.answer,'Red shelf');assert.equal(staff.items[0].text,'I do not understand which shelf to use.');assert.equal(staff.items[0].originalText,null);
  const explanation=command('Put finished items on the blue shelf.');await saveClarificationExchange(pool,owner,caseId,explanation);await processOneClarificationExchange(pool,translator);
  let detail=await workerBriefing(pool,worker,'assignment');assert.equal(detail.repeatRequest,undefined);
  const after=await readClarificationFlow(pool,worker,'assignment',settings);assert.equal(after.items[1].text,'ضع العناصر المكتملة على الرف الأزرق.');assert.equal(after.canMessage,true);
  const work=await postgresWorkspace(pool,worker,'work',{assignmentId:'assignment'});assert.equal(work.item.status,'in-progress');
  assert.equal((await listClarificationFlow(pool,owner)).rows.length,0);
  await saveClarificationExchange(pool,worker,'assignment',command('هل تقصد العناصر المكتملة فقط؟'),settings);await processOneClarificationExchange(pool,translator);
  assert.equal((await listClarificationFlow(pool,owner)).rows.length,1);
  const more=await readClarificationFlow(pool,owner,caseId);assert.equal(more.items.length,3);
  await saveClarificationExchange(pool,owner,caseId,command('Yes, only the finished items.'));await processOneClarificationExchange(pool,translator);
  assert.equal((await readClarificationFlow(pool,worker,'assignment',settings)).items.length,4);
  assert.equal((await db.query('SELECT count(*)::int n FROM case_repeats')).rows[0].n,0);
  assert.equal((await db.query('SELECT count(*)::int n FROM attempts')).rows[0].n,1);
  assert.equal((await readClarificationFlow(pool,{...worker,principal_id:'other'},'assignment',settings)).caseId,null);
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
test('SQLite delivers translated clarification messages without creating a retry',async()=>{
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
  sqliteSave(db,owner,flow.caseId,command('Use the blue shelf.'));await sqliteProcess(db,adapter);assert.equal(pendingFlowRepeat(db,'flow-assignment'),null);
  assert.throws(()=>sqliteAnswer(db,worker,'flow-assignment',randomUUID(),snapshot.rubric.correctChoiceId),/approved repeat/);
  assert.equal(pendingFlowRepeat(db,'flow-assignment'),null);assert.equal(db.prepare('SELECT status FROM clarifications WHERE id=?').get(flow.caseId).status,'resolved');
 }finally{server.close();db.close();}
});
test('a worker can request clarification after a correct answer and the supervisor can explain a wrong answer without waiting for more detail',async()=>{
 const f=await clarificationFixture(),correctWorker={...worker,principal_id:'other'};try{
  await f.db.exec("INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,language) VALUES('correct-assignment','org','site','published','other','ar')");
  await submitAnswer(f.pool,correctWorker,'correct-assignment',randomUUID(),'blue');await processOneAssessment(f.pool,{async assess(){throw Error('Unexpected provider assessment');}});
  const before=await readClarificationFlow(f.pool,correctWorker,'correct-assignment',{worker:true});assert.equal(before.canMessage,true);assert.equal(before.needsArea,false);assert.equal(before.caseId,null);
  await saveClarificationExchange(f.pool,correctWorker,'correct-assignment',command('هل يمكنك شرح مكان الرف؟'),{worker:true});await processOneClarificationExchange(f.pool,translator);
  const request=await readClarificationFlow(f.pool,correctWorker,'correct-assignment',{worker:true});assert.ok(request.caseId);
  assert.equal((await listClarificationFlow(f.pool,owner)).rows.length,2);
  await saveClarificationExchange(f.pool,owner,request.caseId,command('The blue shelf is next to the loading area.'));await processOneClarificationExchange(f.pool,translator);
  assert.equal((await workerBriefing(f.pool,correctWorker,'correct-assignment')).outcome,'matched');
  await saveClarificationExchange(f.pool,owner,f.caseId,command('Please use the blue shelf for finished items.'));await processOneClarificationExchange(f.pool,translator);
  assert.equal((await readClarificationFlow(f.pool,worker,'assignment',{worker:true})).items[0].kind,'explanation');
  assert.equal((await f.db.query('SELECT count(*)::int n FROM case_repeats')).rows[0].n,0);
 }finally{await f.db.close();}
});
test('the release upgrade preserves prior messages and cancels their pending automatic quiz retries',async()=>{
 const f=await clarificationFixture();try{
  await saveClarificationExchange(f.pool,worker,'assignment',command('أي رف أستخدم؟'),{worker:true});await processOneClarificationExchange(f.pool,translator);
  const reply=command('Use the blue shelf.');await saveClarificationExchange(f.pool,owner,f.caseId,reply);
  await requestCaseRepeat(f.pool,owner,f.caseId,{requestId:reply.requestId,dueAt:new Date(Date.now()+86400000).toISOString()});
  const before=(await f.db.query('SELECT id,source_text,request_hash FROM clarification_exchanges ORDER BY id')).rows;
  // Recreate the preceding release's uniqueness rule and ledger in this isolated fixture.
  await f.db.exec("DROP INDEX clarification_exchanges_assignment;ALTER TABLE clarification_exchanges ADD CONSTRAINT clarification_exchanges_attempt_id_kind_key UNIQUE(attempt_id,kind);DELETE FROM schema_migrations WHERE version='130_clarification_messages.sql'");
  assert.deepEqual(await runMigrations(f.pool),['130_clarification_messages.sql']);
  assert.equal((await verifyMigrations(f.pool)).migrations,129);
  assert.deepEqual((await f.db.query('SELECT id,source_text,request_hash FROM clarification_exchanges ORDER BY id')).rows,before);
  assert.equal((await f.db.query('SELECT status FROM case_repeats WHERE id=$1',[reply.requestId])).rows[0].status,'cancelled');
  await saveClarificationExchange(f.pool,worker,'assignment',command('هل توضح مكانه؟'),{worker:true});
  assert.equal((await f.db.query('SELECT count(*)::int n FROM clarification_exchanges')).rows[0].n,3);
 }finally{await f.db.close();}
});
test('SQLite upgrades the preceding message table without losing requests or keeping the one-message restriction',()=>{
 const db=openDatabase(':memory:');try{
  const columns=db.prepare('PRAGMA table_info(clarification_exchanges)').all().map(row=>row.name),values=columns.map(name=>name==='kind'?'request':name==='state'?'delivered':name==='created_at'?'2026-11-16T00:00:00.000Z':name==='delivered_at'?null:'synthetic-'+name);
  db.prepare(`INSERT INTO clarification_exchanges(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).run(...values);
  const oldDefinition=db.prepare("SELECT sql FROM sqlite_master WHERE name='clarification_exchanges'").get().sql.replace(') STRICT',',UNIQUE(attempt_id,kind)) STRICT');
  db.exec('ALTER TABLE clarification_exchanges RENAME TO copied_exchanges');db.exec(oldDefinition);
  db.exec('INSERT INTO clarification_exchanges SELECT * FROM copied_exchanges;DROP TABLE copied_exchanges');
  ensureClarificationFlowSchema(db);
  assert.equal(db.prepare('SELECT count(*) AS n FROM clarification_exchanges').get().n,1);
  const next=[...values];next[columns.indexOf('id')]='another-message';
  db.prepare(`INSERT INTO clarification_exchanges(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).run(...next);
  assert.equal(db.prepare('SELECT count(*) AS n FROM clarification_exchanges').get().n,2);
  assert.equal(pendingFlowRepeat(db,'synthetic-assignment_id'),null);
 }finally{db.close();}
});
