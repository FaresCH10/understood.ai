import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {clarificationFixture} from './helpers/clarification-flow-fixture.mjs';
import {createPostgresRehearsalServer} from '../server/postgres/http.mjs';
import {provisionStaffCredential} from '../server/postgres/auth.mjs';
import {saveClarificationExchange,readClarificationFlow,processOneClarificationExchange} from '../server/postgres/clarification-flow.mjs';
const owner={principal_type:'staff',principal_id:'owner',org_id:'org',site_id:'site',role:'owner'},worker={principal_type:'worker',principal_id:'worker',org_id:'org',site_id:'site'};
const command=text=>({requestId:randomUUID(),text});
test('serverless clarification send and refresh deliver both directions and recover preceding queued messages within the authorized scope',async()=>{
 const f=await clarificationFixture(),schema='understood_test_inline_clarification',origin='http://127.0.0.1:3020',password='Synthetic clarification password only';let calls=0,server;
 const adapter={provenance:{dataClass:'synthetic'},async translate(source,target){calls++;return target==='en'?{title:'Clarification',text:'Which shelf should I use?',question:'Clarification message'}:{title:'توضيح',text:'استخدم الرف الأزرق.',question:'رسالة توضيح'};},async checkTranslation(){return {faithful:true,complete:true,languageCorrect:true,terminologyApplied:true,reasons:[]};}};
 try{
  const backlog=command('أي رف أستخدم؟');await saveClarificationExchange(f.pool,worker,'assignment',backlog,{worker:true});
  assert.equal(await processOneClarificationExchange(f.pool,adapter,{exchangeId:backlog.requestId,orgId:'another-org',siteId:'site'}),false);assert.equal(calls,0);
  await f.db.exec(`ALTER SCHEMA public RENAME TO ${schema};SET search_path TO ${schema},pg_catalog`);
  await provisionStaffCredential(f.pool,{staffId:'owner',orgId:'org',siteId:'site',email:'owner@example.test',password},{schema});
  server=createPostgresRehearsalServer(f.pool,{schema,dataClass:'synthetic',tier:'local',aiMode:'synthetic',accessMode:'credential',publicOrigin:origin,inlineJobs:true,clarificationTranslationAdapter:adapter});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}/api`,path='/clarifications/'+f.caseId+'/clarification-flow';
  assert.equal((await fetch(base+path)).status,401);assert.equal(calls,0);
  const login=await fetch(base+'/auth/staff/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({email:'owner@example.test',password})});assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie').split(';')[0],session=await(await fetch(base+'/session',{headers:{cookie}})).json(),headers={cookie,'x-client-session-context':session.clientContext};
  const previousDay=await fetch(base+'/clarification-flow?day=2000-01-01',{headers});assert.equal(previousDay.status,200);assert.equal((await previousDay.json()).total,0);
  assert.equal((await fetch(base+'/clarification-flow?day=2026-02-30',{headers})).status,400);
  const recovered=await fetch(base+path,{headers});assert.equal(recovered.status,200);assert.equal((await recovered.json()).items[0].text,'Which shelf should I use?');assert.equal(calls,1);
  const result=await fetch(base+path,{method:'POST',headers:{...headers,origin,'content-type':'application/json'},body:JSON.stringify(command('Use the blue shelf.'))});assert.equal(result.status,202);assert.equal((await result.json()).state,'delivered');
  assert.equal((await readClarificationFlow(f.pool,worker,'assignment',{schema,worker:true})).items[1].text,'استخدم الرف الأزرق.');assert.equal(calls,2);
  assert.equal((await f.db.query('SELECT count(*)::int n FROM case_repeats')).rows[0].n,0);
 }finally{if(server)await new Promise(resolve=>server.close(resolve));await f.db.close();}
});
