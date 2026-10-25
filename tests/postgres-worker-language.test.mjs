import test from 'node:test';
import {createSessionContextFetch} from './helpers/session-http.mjs';
const fetch=createSessionContextFetch();
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {createPostgresRehearsalServer} from '../server/postgres/http.mjs';
import {provisionStaffCredential,issueWorkerGrant} from '../server/postgres/auth.mjs';
import {listWorkers,createWorker,updateWorker,disableWorker,workerLanguageState,selectWorkerLanguage,
  requestWorkerLanguage,workerLanguageHistory,staffWorkerLanguageHistory,listLanguageRequests,
  decideWorkerLanguageRequest} from '../server/postgres/people.mjs';

const schema='understood_test_worker_language';
const options={schema};
const origin='http://127.0.0.1:3020';
const owner={principal_type:'staff',principal_id:'owner',org_id:'a',site_id:'a',role:'owner'};
const auditor={...owner,principal_id:'auditor',role:'auditor'};
const harbor={principal_type:'staff',principal_id:'harbor',org_id:'b',site_id:'b',role:'owner'};

async function fixture() {
  const db=new PGlite();
  const client={async query(sql,values){return values?.length ? await db.query(sql,values) : (await db.exec(sql)).at(-1) || {rows:[]};},release(){}};
  const pool={async connect(){return client;}};
  await db.exec(`CREATE SCHEMA ${schema}; SET search_path TO ${schema},pg_catalog`);
  await runMigrations(pool,options);
  await db.query("INSERT INTO organizations(id,name) VALUES ('a','A'),('b','B')");
  await db.query("INSERT INTO sites(id,org_id,name,timezone) VALUES ('a','a','A','UTC'),('c','a','C','UTC'),('b','b','B','UTC')");
  await db.query("INSERT INTO staff(id,org_id,site_id,name,role) VALUES ('owner','a','a','Owner','owner'),('auditor','a','a','Auditor','auditor'),('harbor','b','b','Harbor','owner')");
  await db.query("INSERT INTO workers(id,org_id,site_id,code,language) VALUES ('w1','a','a','001','en'),('w2','a','a','002','ur'),('w3','a','c','003','ar'),('wb','b','b','001','en')");
  await db.query("INSERT INTO briefings(id,org_id,site_id,title,source,state) VALUES ('brief','a','a','Shelf','Source text','ready')");
  return {db,pool};
}

const selfSession=(id)=>({principal_type:'worker',principal_id:id,org_id:'a',site_id:'a'});

function memoryStorage() {
  const objects=new Map();
  return {objects,async save(row,bytes){objects.set(row.id,Buffer.from(bytes));},async read(row){return objects.get(row.id);},async remove(row){objects.delete(row.id);}};
}

async function withHttp(f,run) {
  const server=createPostgresRehearsalServer(f.pool,{...options,tier:'local',aiMode:'synthetic',accessMode:'credential',
    publicOrigin:origin,dataClass:'synthetic',storage:memoryStorage()});
  await new Promise((resolve)=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const request=async(path,cookie,init={})=>{
    const headers={origin,'content-type':'application/json',...(cookie ? {cookie} : {}),...init.headers};
    if(cookie && (init.method==='POST' && path.startsWith('/worker/') || path.startsWith('/clarifications')) && !Object.hasOwn(headers,'x-client-session-context')) {
      const session=await (await fetch(`${base}/api/session`,{headers:{cookie}})).json();
      headers['x-client-session-context']=session.clientContext || '';
    }
    return fetch(`${base}/api${path}`,{...init,headers});
  };
  try {await run({request,base});} finally {await new Promise((resolve)=>server.close(resolve));}
}
const cookieOf=(response)=>response.headers.get('set-cookie').split(';')[0];
const post=(body)=>({method:'POST',body:JSON.stringify(body)});

test('PostgreSQL worker identity persists names and first-use language without leaking scope',async()=>{
  const f=await fixture(),{db,pool}=f;
  try {
    const pending=await createWorker(pool,owner,{code:'Worker 040',name:'Nadia Fares'},options);
    assert.equal(pending.name,'Nadia Fares');
    assert.equal(pending.language,'en');
    assert.equal(pending.language_selection_required,true);
    assert.equal(pending.language_selected,false);
    assert.equal(pending.language_selected_at,null);
    assert.equal(pending.language_selected_by,null);
    assert.equal(pending.pending_language_request,null);
    assert.equal((await listWorkers(pool,owner,{search:'nadia'},options)).total,1);
    assert.equal((await listWorkers(pool,owner,{language:'unset'},options)).total,1);
    assert.equal((await listWorkers(pool,owner,{language:'en'},options)).total,1);
    assert.equal((await listWorkers(pool,harbor,{search:'nadia'},options)).total,0);
    await assert.rejects(createWorker(pool,owner,{code:'Worker 041',name:'X'},options),/Invalid worker name/);
    await assert.rejects(createWorker(pool,owner,{code:'Worker 041',name:'Nadia Fares',language:'fr'},options),/Invalid language/);
    await assert.rejects(createWorker(pool,auditor,{code:'Worker 041'},options),/Forbidden/);
    const named=await updateWorker(pool,owner,pending.id,{name:'Nadia F. Haddad'},options);
    assert.equal(named.name,'Nadia F. Haddad');
    assert.equal(named.language_selected,false);
    const session=selfSession(pending.id);
    assert.deepEqual(await workerLanguageState(pool,session,options),
      {workerId:pending.id,language:'en',selected:false,selectedAt:null,selectedBy:null,pendingRequest:null});
    const requestId=randomUUID();
    for(const bad of [{requestId:'bad',language:'ar'},{requestId,language:'fr'},{requestId,language:'ar',org_id:'harbor'}])
      await assert.rejects(selectWorkerLanguage(pool,session,bad,options),/Invalid/);
    const selected=await selectWorkerLanguage(pool,session,{requestId,language:'ar'},options);
    assert.equal(selected.language,'ar');assert.equal(selected.selected,true);assert.equal(selected.selectedBy,'worker');
    assert.equal(selected.duplicate,false);assert.equal(selected.pendingRequest,null);
    assert.equal((await selectWorkerLanguage(pool,session,{requestId,language:'ar'},options)).duplicate,true);
    await assert.rejects(selectWorkerLanguage(pool,session,{requestId:randomUUID(),language:'ar'},options),/already selected/);
    await assert.rejects(selectWorkerLanguage(pool,{...session,principal_type:'staff'},{requestId:randomUUID(),language:'ar'},options),/Forbidden/);
    await assert.rejects(workerLanguageState(pool,{...session,site_id:'c'},options),/Forbidden/);
    await assert.rejects(db.query('UPDATE workers SET language_selection_request_id=$1 WHERE id=$2',[randomUUID(),pending.id]),/immutable/);
    await assert.rejects(db.query('UPDATE workers SET language_selection_required=true WHERE id=$1',[pending.id]),/cannot be reopened/);
    assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM audit WHERE action='worker.language_selected' AND object_id=$1",[pending.id])).rows[0].n,1);
    assert.deepEqual((await db.query('SELECT language,language_selection_required,language_selected_by,language_selection_request_id FROM workers WHERE id=$1',[pending.id])).rows[0],
      {language:'ar',language_selection_required:false,language_selected_by:'worker',language_selection_request_id:requestId});
    const correctedWorker=await createWorker(pool,owner,{code:'Worker 042',name:'Rana'},options);
    const corrected=await updateWorker(pool,owner,correctedWorker.id,{language:'ur'},options);
    assert.equal(corrected.language,'ur');assert.equal(corrected.language_selected,true);assert.equal(corrected.language_selected_by,'staff');
    assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM audit WHERE action='worker.language_corrected' AND object_id=$1",[correctedWorker.id])).rows[0].n,1);
    await assert.rejects(updateWorker(pool,harbor,correctedWorker.id,{name:'Foreign'},options),/Worker unavailable/);
    const blocked=await createWorker(pool,owner,{code:'Worker 043',name:'Blocked'},options);
    await db.query("INSERT INTO publications(id,org_id,site_id,briefing_id,version,snapshot_json,state) VALUES ('p1','a','a','brief',1,'{}','published')");
    await assert.rejects(db.query("INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,language) VALUES ('a1','a','a','p1',$1,'en')",[blocked.id]),/Recipient language not selected/);
    await assert.rejects(db.query("INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,language) VALUES ('a2','a','a','p1','w3','ar')"),/foreign key/i);
    await db.query("INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,language) VALUES ('a3','a','a','p1','w1','en')");
  } finally {await db.close();}
});

test('PostgreSQL language-change requests replay, reject stale decisions and stay immutable',async()=>{
  const f=await fixture(),{db,pool}=f;
  try {
    const created=await createWorker(pool,owner,{code:'Worker 040',name:'Nadia Fares'},options);
    const session=selfSession(created.id);
    await selectWorkerLanguage(pool,session,{requestId:randomUUID(),language:'en'},options);
    const requestId=randomUUID();
    const request=await requestWorkerLanguage(pool,session,{requestId,language:'ar',reason:'Prefers Arabic at the desk'},options);
    assert.equal(request.state,'pending');assert.equal(request.currentLanguage,'en');assert.equal(request.requestedLanguage,'ar');
    assert.equal(request.reason,'Prefers Arabic at the desk');assert.equal(request.duplicate,false);
    assert.equal((await requestWorkerLanguage(pool,session,{requestId,language:'ar',reason:'Prefers Arabic at the desk'},options)).duplicate,true);
    await assert.rejects(requestWorkerLanguage(pool,session,{requestId,language:'ar',reason:'Changed reason'},options),/conflict/);
    await assert.rejects(requestWorkerLanguage(pool,session,{requestId:randomUUID(),language:'ur'},options),/already pending/);
    await assert.rejects(requestWorkerLanguage(pool,session,{requestId:randomUUID(),language:'en'},options),/already selected/);
    await assert.rejects(requestWorkerLanguage(pool,session,{requestId:randomUUID(),language:'ar',reason:'x'.repeat(501)},options),/Invalid language request reason/);
    const unselected=await createWorker(pool,owner,{code:'Worker 045',name:'Unselected'},options);
    await assert.rejects(requestWorkerLanguage(pool,selfSession(unselected.id),{requestId:randomUUID(),language:'ar'},options),/Select your language first/);
    assert.equal((await workerLanguageHistory(pool,session,options)).items.length,1);
    const listed=await listLanguageRequests(pool,owner,{},options);
    assert.equal(listed.total,1);assert.equal(listed.items[0].workerName,'Nadia Fares');assert.equal(listed.items[0].workerCode,'Worker 040');
    assert.equal(listed.items[0].workerActive,true);
    await assert.rejects(listLanguageRequests(pool,auditor,{},options),/Forbidden/);
    await assert.rejects(listLanguageRequests(pool,selfSession(unselected.id),{},options),/Forbidden/);
    assert.equal((await listLanguageRequests(pool,harbor,{},options)).total,0);
    await assert.rejects(listLanguageRequests(pool,owner,{status:'queued'},options),/Invalid language request filter/);
    await assert.rejects(decideWorkerLanguageRequest(pool,harbor,requestId,{action:'approve',expectedRequestedLanguage:'ar'},options),/unavailable/);
    await assert.rejects(decideWorkerLanguageRequest(pool,auditor,requestId,{action:'approve',expectedRequestedLanguage:'ar'},options),/Forbidden/);
    await assert.rejects(decideWorkerLanguageRequest(pool,owner,requestId,{action:'approve',expectedRequestedLanguage:'ur'},options),/changed/);
    await assert.rejects(decideWorkerLanguageRequest(pool,owner,requestId,{action:'maybe',expectedRequestedLanguage:'ar'},options),/Invalid language decision/);
    await assert.rejects(decideWorkerLanguageRequest(pool,owner,'missing',{action:'approve',expectedRequestedLanguage:'ar'},options),/Invalid language request/);
    await assert.rejects(decideWorkerLanguageRequest(pool,owner,randomUUID(),{action:'approve',expectedRequestedLanguage:'ar'},options),/unavailable/);
    const approved=await decideWorkerLanguageRequest(pool,owner,requestId,{action:'approve',expectedRequestedLanguage:'ar',note:'Approved by supervisor'},options);
    assert.equal(approved.state,'approved');assert.equal(approved.duplicate,false);assert.equal(approved.decisionNote,'Approved by supervisor');
    assert.equal(approved.workerId,created.id);assert.equal(approved.currentLanguage,'en');assert.equal(approved.requestedLanguage,'ar');
    assert.equal((await db.query('SELECT language,language_selected_by FROM workers WHERE id=$1',[created.id])).rows[0].language,'ar');
    assert.equal((await db.query('SELECT language_selected_by FROM workers WHERE id=$1',[created.id])).rows[0].language_selected_by,'staff');
    assert.equal((await decideWorkerLanguageRequest(pool,owner,requestId,{action:'approve',expectedRequestedLanguage:'ar',note:'Approved by supervisor'},options)).duplicate,true);
    await assert.rejects(decideWorkerLanguageRequest(pool,owner,requestId,{action:'reject',expectedRequestedLanguage:'ar'},options),/already decided/);
    assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM audit WHERE action='worker.language_request_approved'")).rows[0].n,1);
    const second=randomUUID();
    await requestWorkerLanguage(pool,session,{requestId:second,language:'ur'},options);
    await updateWorker(pool,owner,created.id,{language:'en'},options);
    assert.equal((await db.query('SELECT state FROM worker_language_requests WHERE id=$1',[second])).rows[0].state,'rejected');
    assert.match((await db.query('SELECT decision_note FROM worker_language_requests WHERE id=$1',[second])).rows[0].decision_note,/direct supervisor correction/);
    assert.equal((await db.query('SELECT language FROM workers WHERE id=$1',[created.id])).rows[0].language,'en');
    const third=randomUUID();
    await requestWorkerLanguage(pool,session,{requestId:third,language:'ur'},options);
    await db.query("UPDATE workers SET language='ar' WHERE id=$1",[created.id]);
    await assert.rejects(decideWorkerLanguageRequest(pool,owner,third,{action:'approve',expectedRequestedLanguage:'ur'},options),/Worker language changed/);
    assert.equal((await db.query('SELECT state FROM worker_language_requests WHERE id=$1',[third])).rows[0].state,'pending');
    assert.equal((await decideWorkerLanguageRequest(pool,owner,third,{action:'reject',expectedRequestedLanguage:'ur',note:'Keep Arabic'},options)).state,'rejected');
    const disabled=await createWorker(pool,owner,{code:'Worker 046',name:'Disabled',language:'en'},options);
    const disabledRequest=randomUUID();
    await requestWorkerLanguage(pool,selfSession(disabled.id),{requestId:disabledRequest,language:'ar'},options);
    await disableWorker(pool,owner,disabled.id,options);
    await assert.rejects(decideWorkerLanguageRequest(pool,owner,disabledRequest,{action:'approve',expectedRequestedLanguage:'ar'},options),/Worker unavailable/);
    assert.equal((await db.query('SELECT state FROM worker_language_requests WHERE id=$1',[disabledRequest])).rows[0].state,'pending');
    await assert.rejects(db.query('DELETE FROM worker_language_requests'),/immutable/);
    await assert.rejects(db.query('UPDATE worker_language_requests SET reason=$1 WHERE id=$2',['Changed',requestId]),/reason is immutable/);
    await assert.rejects(db.query('UPDATE worker_language_requests SET requested_language=$1 WHERE id=$2',['en',requestId]),/immutable/);
    await assert.rejects(db.query("UPDATE worker_language_requests SET state='rejected',decided_at=now(),decided_by='owner' WHERE id=$1",[requestId]),/decision conflict/);
    await assert.rejects(db.query(`INSERT INTO worker_language_requests(id,org_id,site_id,worker_id,current_language,requested_language,state,requested_at)
      VALUES ('foreign','b','a','w1','en','ar','pending',now())`),/Scope mismatch/);
    assert.equal((await staffWorkerLanguageHistory(pool,owner,created.id,options)).worker.name,'Nadia Fares');
    assert.equal((await staffWorkerLanguageHistory(pool,owner,created.id,options)).items.length,3);
  } finally {await db.close();}
});

test('PostgreSQL worker language HTTP routes persist selection, fence stale contexts and authorize decisions',async()=>{
  const f=await fixture(),{pool}=f;
  try {
    const password='Synthetic language HTTP password';
    await provisionStaffCredential(pool,{staffId:'owner',orgId:'a',siteId:'a',email:'owner@example.test',password},options);
    const created=await createWorker(pool,owner,{code:'HTTP 500',name:'Nadia Fares'},options);
    const grant=await issueWorkerGrant(pool,owner,created.id,30,options);
    await withHttp(f,async({request,base})=>{
      const staff=cookieOf(await request('/auth/staff/login',null,post({email:'owner@example.test',password})));
      const workerCookie=cookieOf(await request('/auth/worker/redeem',null,post({token:grant.token})));
      const before=await (await request('/session',workerCookie)).json();
      assert.equal(before.name,'Nadia Fares');
      assert.equal(before.role,'worker');
      assert.equal(before.languageSelectionRequired,true);
      assert.equal(before.languageSelectedAt,null);
      const page=await (await request('/people/workers?language=unset',staff)).json();
      assert.equal(page.total,1);assert.equal(page.items[0].name,'Nadia Fares');
      assert.equal((await request('/people/workers',workerCookie)).status,403);
      const missing=await globalThis.fetch(`${base}/api/worker/language/selection`,{method:'POST',
        headers:{origin,'content-type':'application/json',cookie:workerCookie},
        body:JSON.stringify({requestId:randomUUID(),language:'ar'})});
      assert.equal(missing.status,409);
      const selectionId=randomUUID();
      const selected=await request('/worker/language/selection',workerCookie,post({requestId:selectionId,language:'ar'}));
      assert.equal(selected.status,200);
      const selection=await selected.json();
      assert.equal(selection.language,'ar');assert.equal(selection.selectedBy,'worker');assert.equal(selection.duplicate,false);
      const replayed=await request('/worker/language/selection',workerCookie,post({requestId:selectionId,language:'ar'}));
      assert.equal(replayed.status,200);assert.equal((await replayed.json()).duplicate,true);
      assert.equal((await request('/worker/language/selection',workerCookie,post({requestId:randomUUID(),language:'ar'}))).status,409);
      const stale=await request('/worker/language/requests',workerCookie,{method:'POST',
        body:JSON.stringify({requestId:randomUUID(),language:'ur'}),
        headers:{'x-client-session-context':before.clientContext}});
      assert.equal(stale.status,409);
      const changeId=randomUUID();
      const change=await request('/worker/language/requests',workerCookie,post({requestId:changeId,language:'ur',reason:'Team uses Urdu'}));
      assert.equal(change.status,200);assert.equal((await change.json()).state,'pending');
      const stateResponse=await request('/worker/language',workerCookie);
      const stateText=await stateResponse.text();
      assert.equal(stateResponse.status,200,stateText);
      const state=JSON.parse(stateText);
      assert.equal(state.language,'ar');assert.equal(state.selected,true);
      assert.equal(state.pendingRequest.id,changeId);assert.equal(state.items.length,1);
      assert.equal((await request('/worker/language',staff)).status,403);
      assert.equal((await request('/people/language-requests',workerCookie)).status,403);
      const queue=await (await request('/people/language-requests?status=pending',staff)).json();
      assert.equal(queue.total,1);assert.equal(queue.items[0].workerName,'Nadia Fares');assert.equal(queue.items[0].workerActive,true);
      const historyResponse=await request(`/people/workers/${created.id}/language-requests`,staff);
      const historyText=await historyResponse.text();
      assert.equal(historyResponse.status,200,historyText);
      const history=JSON.parse(historyText);
      assert.equal(history.worker.name,'Nadia Fares');assert.equal(history.worker.languageSelected,true);
      assert.equal(history.items.length,1);
      const beforeDecision=await (await request('/session',workerCookie)).json();
      const wrongLanguage=await request(`/people/language-requests/${changeId}/decision`,staff,post({action:'approve',expectedRequestedLanguage:'en'}));
      assert.equal(wrongLanguage.status,409);
      assert.deepEqual(await wrongLanguage.json(),{error:'Language request changed'});
      assert.equal((await request(`/people/language-requests/${changeId}/decision`,staff,post({action:'approve',expectedRequestedLanguage:'ur'}))).status,200);
      const approvedSession=await (await request('/session',workerCookie)).json();
      assert.equal(approvedSession.language,'ur');assert.equal(approvedSession.languageSelectionRequired,false);
      assert.equal(approvedSession.languageSelectedBy,'staff');
      assert.notEqual(approvedSession.clientContext,beforeDecision.clientContext);
      const afterState=await (await request('/worker/language',workerCookie)).json();
      assert.equal(afterState.language,'ur');assert.equal(afterState.pendingRequest,null);
      assert.equal(afterState.items[0].state,'approved');assert.equal(afterState.items[0].requestedLanguage,'ur');
      const approvedQueue=await (await request('/people/language-requests?status=approved',staff)).json();
      assert.equal(approvedQueue.total,1);
      const replayedDecision=await request(`/people/language-requests/${changeId}/decision`,staff,post({action:'approve',expectedRequestedLanguage:'ur'}));
      assert.equal(replayedDecision.status,200);assert.equal((await replayedDecision.json()).duplicate,true);
      assert.equal((await request(`/people/language-requests/${randomUUID()}/decision`,staff,post({action:'reject',expectedRequestedLanguage:'ur'}))).status,404);
      const staleAfterApproval=await request('/worker/language/requests',workerCookie,{method:'POST',
        body:JSON.stringify({requestId:randomUUID(),language:'en'}),
        headers:{'x-client-session-context':beforeDecision.clientContext}});
      assert.equal(staleAfterApproval.status,409);
      assert.equal((await request('/worker/language/requests',workerCookie,post({requestId:randomUUID(),language:'en'}))).status,200);
      const createdByStaff=await request('/people/workers',staff,post({code:'HTTP 502',name:'No Language'}));
      assert.equal(createdByStaff.status,201);
      const createdBody=await createdByStaff.json();
      assert.equal(createdBody.language_selection_required,true);assert.equal(createdBody.language_selected,false);
      assert.equal((await (await request('/people/workers?search=No Language',staff)).json()).total,1);
    });
  } finally {await f.db.close();}
});
