import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../server/db.mjs';
import {createSession,requireSession} from '../server/auth.mjs';
import {clientSessionContext} from '../server/session-context.mjs';
import {ensurePeopleSchema,createWorker,updateWorker,listWorkers,disableWorker,
  workerLanguageState,selectWorkerLanguage,requestWorkerLanguage,workerLanguageHistory,
  listLanguageRequests,decideWorkerLanguageRequest} from '../server/people.mjs';
import {instructionAudienceOverview,startInstructionSend} from '../server/instructions.mjs';
import {ensureBriefingSchema} from '../server/preparation.mjs';
import {createAppServer} from '../server/index.mjs';

const owner={principal_type:'staff',principal_id:'maya',org_id:'cedar',site_id:'beirut',role:'owner'};
const auditor={...owner,role:'auditor'};
const harbor={principal_type:'staff',principal_id:'harbor-owner',org_id:'harbor',site_id:'harbor-yard',role:'owner'};

function fixture(){
  const db=openDatabase(':memory:');
  db.exec(`INSERT INTO organizations VALUES('cedar','Cedar Works'),('harbor','Harbor Tools');
    INSERT INTO sites VALUES('beirut','cedar','Beirut site','Asia/Beirut'),('harbor-yard','harbor','Harbor yard','UTC');
    INSERT INTO staff VALUES('maya','cedar','beirut','Maya Haddad','owner',1);
    INSERT INTO staff VALUES('harbor-owner','harbor','harbor-yard','Harbor Owner','owner',1);`);
  ensurePeopleSchema(db);ensureBriefingSchema(db);
  return db;
}

const self=(db,id='worker-1')=>{const worker=db.prepare('SELECT * FROM workers WHERE id=?').get(id);
  return {principal_type:'worker',principal_id:worker.id,org_id:worker.org_id,site_id:worker.site_id};};

test('SQLite worker identity, name search, unset-language filtering and direct staff correction stay scoped',()=>{
  const db=fixture();
  try{
    const pending=createWorker(db,owner,{code:'Worker 040',name:'Nadia Fares'});
    assert.equal(pending.name,'Nadia Fares');
    assert.equal(pending.language_selected,false);
    assert.equal(pending.language_selection_required,true);
    assert.equal(pending.language,'en');
    assert.equal(pending.language_selected_at,null);
    assert.equal(listWorkers(db,owner,{search:'nadia'}).total,1);
    assert.equal(listWorkers(db,owner,{language:'unset'}).total,1);
    assert.equal(listWorkers(db,owner,{language:'en'}).total,0);
    assert.equal(listWorkers(db,harbor,{search:'nadia'}).total,0);
    assert.throws(()=>createWorker(db,owner,{code:'Worker 041',name:'X'}),/Invalid worker name/);
    assert.throws(()=>createWorker(db,owner,{code:'Worker 041',name:'Nadia Fares',language:'fr'}),/Invalid language/);
    assert.throws(()=>createWorker(db,auditor,{code:'Worker 041'}),/Forbidden/);
    const named=updateWorker(db,owner,pending.id,{name:'Nadia F. Haddad'});
    assert.equal(named.name,'Nadia F. Haddad');
    assert.equal(named.language_selected,false);
    const corrected=updateWorker(db,owner,pending.id,{language:'ar'});
    assert.equal(corrected.language,'ar');
    assert.equal(corrected.language_selected,true);
    assert.equal(corrected.language_selected_by,'staff');
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit WHERE action='worker.language_corrected' AND object_id=?").get(pending.id).n,1);
    assert.throws(()=>updateWorker(db,harbor,pending.id,{name:'Foreign'}),/Worker unavailable/);
    assert.throws(()=>db.exec('UPDATE workers SET language_selection_required=1'),/cannot be reopened/);
  }finally{db.close();}
});

test('SQLite first-use language selection is persisted, scoped, audited and idempotent',()=>{
  const db=fixture();
  try{
    const worker=createWorker(db,owner,{code:'Worker 040',name:'Nadia Fares'});
    const session=self(db,worker.id);
    assert.deepEqual(workerLanguageState(db,session),{workerId:worker.id,language:'en',selected:false,
      selectedAt:null,selectedBy:null,pendingRequest:null});
    const requestId=randomUUID();
    for(const bad of [{requestId:'bad',language:'ar'},{requestId,language:'fr'},{requestId,language:'ar',org_id:'harbor'}]) {
      assert.throws(()=>selectWorkerLanguage(db,session,bad),/Invalid/);
    }
    const selected=selectWorkerLanguage(db,session,{requestId,language:'ar'});
    assert.equal(selected.selected,true);assert.equal(selected.language,'ar');assert.equal(selected.duplicate,false);
    assert.equal(selected.selectedBy,'worker');
    assert.equal(selectWorkerLanguage(db,session,{requestId,language:'ar'}).duplicate,true);
    assert.throws(()=>selectWorkerLanguage(db,session,{requestId:randomUUID(),language:'ar'}),/already selected/);
    assert.throws(()=>selectWorkerLanguage(db,self(db,worker.id),{requestId,language:'ur'}),/already selected/);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit WHERE action='worker.language_selected' AND actor_type='worker' AND object_id=?").get(worker.id).n,1);
    assert.throws(()=>db.exec(`UPDATE workers SET language_selection_request_id='${randomUUID()}' WHERE id='${worker.id}'`),/immutable/);
    assert.throws(()=>selectWorkerLanguage(db,{...session,principal_type:'staff'},{requestId:randomUUID(),language:'en'}),/Forbidden/);
    const stored=db.prepare('SELECT language,language_selection_required,language_selected_by FROM workers WHERE id=?').get(worker.id);
    assert.deepEqual({...stored},{language:'ar',language_selection_required:0,language_selected_by:'worker'});
  }finally{db.close();}
});

test('SQLite language-change requests remain pending, reject stale decisions and approve in one audited transaction',()=>{
  const db=fixture();
  try{
    const created=createWorker(db,owner,{code:'Worker 040',name:'Nadia Fares'});
    const session=self(db,created.id);
    selectWorkerLanguage(db,session,{requestId:randomUUID(),language:'en'});
    const requestId=randomUUID();
    const request=requestWorkerLanguage(db,session,{requestId,language:'ar',reason:'Prefers Arabic at the desk'});
    assert.equal(request.state,'pending');assert.equal(request.currentLanguage,'en');assert.equal(request.requestedLanguage,'ar');
    assert.equal(requestWorkerLanguage(db,session,{requestId,language:'ar',reason:'Prefers Arabic at the desk'}).duplicate,true);
    assert.throws(()=>requestWorkerLanguage(db,session,{requestId,language:'ar',reason:'Changed reason'}),/conflict/);
    assert.throws(()=>requestWorkerLanguage(db,session,{requestId:randomUUID(),language:'ur'}),/already pending/);
    assert.throws(()=>requestWorkerLanguage(db,session,{requestId:randomUUID(),language:'en'}),/already selected/);
    assert.equal(workerLanguageHistory(db,session).items.length,1);
    const listed=listLanguageRequests(db,owner,{status:'pending'});
    assert.equal(listed.total,1);assert.equal(listed.items[0].workerName,'Nadia Fares');
    assert.throws(()=>listLanguageRequests(db,auditor),/Forbidden/);
    assert.equal(listLanguageRequests(db,harbor).total,0);
    assert.throws(()=>decideWorkerLanguageRequest(db,harbor,requestId,{action:'approve',expectedRequestedLanguage:'ar'}),/unavailable/);
    assert.throws(()=>decideWorkerLanguageRequest(db,auditor,requestId,{action:'approve',expectedRequestedLanguage:'ar'}),/Forbidden/);
    assert.throws(()=>decideWorkerLanguageRequest(db,owner,requestId,{action:'approve',expectedRequestedLanguage:'ur'}),/changed/);
    assert.throws(()=>decideWorkerLanguageRequest(db,owner,requestId,{action:'maybe',expectedRequestedLanguage:'ar'}),/Invalid/);
    const approved=decideWorkerLanguageRequest(db,owner,requestId,{action:'approve',expectedRequestedLanguage:'ar',note:'Approved by supervisor'});
    assert.equal(approved.state,'approved');assert.equal(approved.duplicate,false);
    assert.equal(db.prepare('SELECT language,language_selected_by FROM workers WHERE id=?').get(created.id).language,'ar');
    assert.equal(db.prepare('SELECT language_selected_by FROM workers WHERE id=?').get(created.id).language_selected_by,'staff');
    assert.equal(decideWorkerLanguageRequest(db,owner,requestId,{action:'approve',expectedRequestedLanguage:'ar',note:'Approved by supervisor'}).duplicate,true);
    assert.throws(()=>decideWorkerLanguageRequest(db,owner,requestId,{action:'reject',expectedRequestedLanguage:'ar'}),/already decided/);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit WHERE action='worker.language_request_approved'").get().n,1);

    const second=randomUUID();
    requestWorkerLanguage(db,session,{requestId:second,language:'ur'});
    updateWorker(db,owner,created.id,{language:'en'});
    assert.equal(db.prepare('SELECT state,decision_note FROM worker_language_requests WHERE id=?').get(second).state,'rejected');
    assert.match(db.prepare('SELECT decision_note FROM worker_language_requests WHERE id=?').get(second).decision_note,/direct supervisor correction/);
    assert.equal(db.prepare('SELECT language FROM workers WHERE id=?').get(created.id).language,'en');

    const third=randomUUID();
    requestWorkerLanguage(db,session,{requestId:third,language:'ur'});
    db.prepare("UPDATE workers SET language='ar' WHERE id=?").run(created.id);
    assert.throws(()=>decideWorkerLanguageRequest(db,owner,third,{action:'approve',expectedRequestedLanguage:'ur'}),/Worker language changed/);
    assert.equal(db.prepare('SELECT state FROM worker_language_requests WHERE id=?').get(third).state,'pending');
    const rejected=decideWorkerLanguageRequest(db,owner,third,{action:'reject',expectedRequestedLanguage:'ur',note:'Keep Arabic'});
    assert.equal(rejected.state,'rejected');
    assert.throws(()=>db.exec('DELETE FROM worker_language_requests'),/immutable/);
    assert.throws(()=>db.exec("UPDATE worker_language_requests SET requested_language='en' WHERE state='rejected'"),/immutable/);
    disableWorker(db,owner,created.id);
    assert.throws(()=>decideWorkerLanguageRequest(db,owner,requestId,{action:'approve',expectedRequestedLanguage:'ar'}),/already decided/);
  }finally{db.close();}
});

test('SQLite unselected workers are excluded from instruction audiences and cannot receive assignments',()=>{
  const db=fixture();
  try{
    const ready=createWorker(db,owner,{code:'Worker 040',name:'Ready Worker',language:'en'});
    const pending=createWorker(db,owner,{code:'Worker 041',name:'Pending Worker'});
    assert.deepEqual(instructionAudienceOverview(db,owner).workers,{total:1,byLanguage:{en:1,ar:0,ur:0},notSelected:1});
    const requestId=randomUUID();
    const send=startInstructionSend(db,owner,{requestId,title:'Ladder move',source:'Move the red ladder to the north bay before the night shift.',audience:{type:'all'}});
    assert.equal(send.audience.count,1);
    const audience=JSON.parse(db.prepare('SELECT audience_json FROM instruction_sends WHERE request_id=?').get(requestId).audience_json);
    assert.deepEqual(audience.workers.map(worker=>worker.id),[ready.id]);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM briefings').get().n,1);
    const briefingId=db.prepare('SELECT id FROM briefings').get().id,publicationId=randomUUID();
    db.prepare('INSERT INTO publications VALUES(?,?,?,?,?,?,?,?)').run(publicationId,'cedar','beirut',briefingId,99,
      JSON.stringify({languages:{en:{title:'Ladder move',text:'Move it.'}}}),new Date().toISOString(),'published');
    assert.throws(()=>db.prepare(`INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,created_at,language)
      VALUES('direct','cedar','beirut',?,?,'2026-10-23T00:00:00.000Z','en')`).run(publicationId,pending.id),
      /Recipient language not selected/);
  }finally{db.close();}
});

test('worker language HTTP routes persist first selection, fence stale contexts and serialize staff decisions',async()=>{
  const db=fixture(),server=createAppServer(db,{tier:'local',aiMode:'synthetic',accessMode:'demo'});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}/api`,origin='http://127.0.0.1:3020',contexts=new Map();
  const call=(path,cookie,body,method=body?'POST':'GET',context=contexts.get(cookie))=>fetch(base+path,{method,
    headers:{...(cookie?{cookie}:{}),...(body?{'content-type':'application/json'}:{}),...(method!=='GET'?{origin}:{}),
      ...(context?{'x-client-session-context':context}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const login=async row=>{const cookie=`understood_session=${createSession(db,row,row.role?'staff':'worker','demo').token}`;
    const session=await (await call('/session',cookie)).json();contexts.set(cookie,session.clientContext);return {cookie,session};};
  try{
    const ownerLogin=await login(db.prepare("SELECT * FROM staff WHERE id='maya'").get());
    const createdResponse=await call('/people/workers',ownerLogin.cookie,{code:'Worker 500',name:'Nadia Fares'});
    assert.equal(createdResponse.status,201);
    const created=await createdResponse.json();
    assert.equal(created.name,'Nadia Fares');assert.equal(created.language_selected,false);
    const worker=db.prepare('SELECT * FROM workers WHERE id=?').get(created.id);
    const workerOne=await login(worker);
    assert.equal(workerOne.session.languageSelectionRequired,true);
    assert.equal(workerOne.session.name,'Nadia Fares');
    const selectionId=randomUUID();
    assert.equal((await call('/worker/language/selection',workerOne.cookie,{requestId:selectionId,language:'ar'},'POST',null)).status,409);
    const selected=await call('/worker/language/selection',workerOne.cookie,{requestId:selectionId,language:'ar'});
    assert.equal(selected.status,200);assert.equal((await selected.json()).language,'ar');
    assert.equal((await call('/worker/language/selection',workerOne.cookie,{requestId:randomUUID(),language:'en'})).status,409);
    const refreshed=await (await call('/session',workerOne.cookie)).json();
    assert.equal(refreshed.languageSelectionRequired,false);assert.equal(refreshed.language,'ar');
    assert.notEqual(refreshed.clientContext,workerOne.session.clientContext);
    assert.equal((await call('/worker/language/requests',workerOne.cookie,{requestId:randomUUID(),language:'ur'},'POST',workerOne.session.clientContext)).status,409);
    contexts.set(workerOne.cookie,refreshed.clientContext);
    const changeId=randomUUID();
    const change=await call('/worker/language/requests',workerOne.cookie,{requestId:changeId,language:'ur',reason:'Team uses Urdu'});
    assert.equal(change.status,200);assert.equal((await change.json()).state,'pending');
    const queue=await (await call('/people/language-requests?status=pending',ownerLogin.cookie)).json();
    assert.equal(queue.total,1);assert.equal(queue.items[0].workerName,'Nadia Fares');
    const historyResponse=await call(`/people/workers/${created.id}/language-requests`,ownerLogin.cookie);
    const historyText=await historyResponse.text();
    assert.equal(historyResponse.status,200,historyText);
    assert.equal(JSON.parse(historyText).items.length,1);
    const decided=await call(`/people/language-requests/${changeId}/decision`,ownerLogin.cookie,
      {action:'approve',expectedRequestedLanguage:'ur',note:'Approved'});
    assert.equal(decided.status,200);assert.equal((await decided.json()).state,'approved');
    const approvedSession=await (await call('/session',workerOne.cookie)).json();
    assert.equal(approvedSession.language,'ur');
    contexts.set(workerOne.cookie,approvedSession.clientContext);
    const stateResponse=await call('/worker/language',workerOne.cookie);
    const stateText=await stateResponse.text();
    assert.equal(stateResponse.status,200,stateText);
    const state=JSON.parse(stateText);
    assert.equal(state.language,'ur');assert.equal(state.selected,true);assert.equal(state.items[0].state,'approved');
    assert.equal((await call('/people/language-requests',workerOne.cookie)).status,403);
    assert.equal((await call('/worker/language',ownerLogin.cookie)).status,403);
    const replayed=await call(`/people/language-requests/${changeId}/decision`,ownerLogin.cookie,
      {action:'approve',expectedRequestedLanguage:'ur',note:'Approved'});
    assert.equal(replayed.status,200);assert.equal((await replayed.json()).duplicate,true);
    assert.equal((await call(`/people/language-requests/${randomUUID()}/decision`,ownerLogin.cookie,
      {action:'reject',expectedRequestedLanguage:'ur'})).status,404);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});

test('SQLite worker session payload and context fence expose language selection state',()=>{
  const db=fixture();
  try{
    const created=createWorker(db,owner,{code:'Worker 040',name:'Nadia Fares'});
    const raw=db.prepare('SELECT * FROM workers WHERE id=?').get(created.id);
    const before=createSession(db,raw,'worker','demo');
    const beforeSession=requireSession(db,{headers:{cookie:`understood_session=${before.token}`}},{accessMode:'demo'});
    assert.equal(beforeSession.language_selection_required,1);
    assert.equal(beforeSession.name,'Nadia Fares');
    const beforeContext=clientSessionContext(beforeSession).clientContext;
    selectWorkerLanguage(db,self(db,created.id),{requestId:randomUUID(),language:'ar'});
    const afterSession=requireSession(db,{headers:{cookie:`understood_session=${before.token}`}},{accessMode:'demo'});
    assert.equal(afterSession.language_selection_required,0);
    assert.notEqual(clientSessionContext(afterSession).clientContext,beforeContext);
    assert.equal(afterSession.language_selected_by,'worker');
  }finally{db.close();}
});
