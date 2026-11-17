import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {clarificationFixture} from './helpers/clarification-flow-fixture.mjs';
import {listClarificationFlow,readClarificationFlow,saveClarificationExchange,processOneClarificationExchange} from '../server/postgres/clarification-flow.mjs';
const owner={principal_type:'staff',principal_id:'owner',org_id:'org',site_id:'site',role:'owner'};
const worker={principal_type:'worker',principal_id:'worker',org_id:'org',site_id:'site'};
const translator={provenance:{dataClass:'synthetic'},async translate(source,target){return {title:'توضيح',text:'استخدم الرف الأزرق.',question:'توضيح التعليمات'};},async checkTranslation(){return {faithful:true,complete:true,languageCorrect:true,terminologyApplied:true,reasons:[]};}};

test('sections paginate oldest first and sidebar counts distinct instructions across all dates',async()=>{
 const f=await clarificationFixture();try{
  for(let i=0;i<=22;i++)await f.db.query(`INSERT INTO clarifications(id,org_id,site_id,assignment_id,reason,status,created_at) VALUES($1,'org','site','assignment','help',$2,$3)`,[`case-${String(i).padStart(2,'0')}`,i===22?'resolved':'open',`2025-01-01T${String(8+Math.floor(i/60)).padStart(2,'0')}:${String(i%60).padStart(2,'0')}:00Z`]);
  const first=await listClarificationFlow(f.pool,owner,1,{day:'2025-01-01',section:'unread'});
  assert.equal(first.total,22);assert.equal(first.unread,22);assert.equal(first.done,1);assert.equal(first.rows.length,20);assert.equal(first.rows[0].id,'case-00');assert.equal(first.rows[1].id,'case-01');assert.equal(first.unreadInstructions,1);
  const second=await listClarificationFlow(f.pool,owner,2,{day:'2025-01-01',section:'unread'});
  assert.deepEqual(second.rows.map(row=>row.id),['case-20','case-21']);
  const empty=await listClarificationFlow(f.pool,owner,3,{day:'2025-01-01',section:'unread'});assert.equal(empty.total,22);assert.equal(empty.rows.length,0);
  const done=await listClarificationFlow(f.pool,owner,1,{day:'2025-01-01',section:'done'});assert.deepEqual(done.rows.map(row=>row.id),['case-22']);
  assert.equal((await listClarificationFlow(f.pool,owner,1,{day:'2025-01-02',section:'unread'})).total,0);
  assert.deepEqual(await listClarificationFlow(f.pool,owner,1,{summaryOnly:true}),{unreadInstructions:1});
  await f.db.exec("UPDATE workers SET active=false");assert.deepEqual(await listClarificationFlow(f.pool,owner,1,{summaryOnly:true}),{unreadInstructions:0});
  await assert.rejects(listClarificationFlow(f.pool,{...owner,site_id:'another'},1,{summaryOnly:true}),/Forbidden/);
  await assert.rejects(async()=>listClarificationFlow(f.pool,owner,1,{section:'anything'}),/Invalid clarification filter/);
 }finally{await f.db.close();}
});

test('opening keeps requests unread; delivery moves to Done; worker follow-up becomes unread again',async()=>{
 const f=await clarificationFixture();try{
  assert.equal((await listClarificationFlow(f.pool,owner,1,{section:'unread'})).total,1);
  await readClarificationFlow(f.pool,owner,f.caseId);
  assert.equal((await listClarificationFlow(f.pool,owner,1,{summaryOnly:true})).unreadInstructions,1);
  await saveClarificationExchange(f.pool,owner,f.caseId,{requestId:randomUUID(),text:'Use the blue shelf.'});
  assert.equal((await listClarificationFlow(f.pool,owner,1,{section:'unread'})).total,1);
  await processOneClarificationExchange(f.pool,translator);
  assert.equal((await listClarificationFlow(f.pool,owner,1,{section:'unread'})).total,0);
  assert.equal((await listClarificationFlow(f.pool,owner,1,{section:'done'})).total,1);
  assert.equal((await listClarificationFlow(f.pool,owner,1,{summaryOnly:true})).unreadInstructions,0);
  await saveClarificationExchange(f.pool,worker,'assignment',{requestId:randomUUID(),text:'أي رف تقصد؟'},{worker:true});
  assert.equal((await listClarificationFlow(f.pool,owner,1,{section:'unread'})).total,1);
  assert.equal((await listClarificationFlow(f.pool,owner,1,{summaryOnly:true})).unreadInstructions,1);
  const history=await listClarificationFlow(f.pool,owner,1,{section:'done',day:new Date().toISOString().slice(0,10)});assert.equal(history.total,1);
 }finally{await f.db.close();}
});
