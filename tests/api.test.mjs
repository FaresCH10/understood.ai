import test from 'node:test';
import {createSessionContextFetch} from './helpers/session-http.mjs';
const fetch=createSessionContextFetch();
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../server/db.mjs';
import { createAppServer } from '../server/index.mjs';
import { processOne } from '../server/worker.mjs';
import { publish } from '../server/domain.mjs';
import { briefingFilters } from '../server/briefing-input.mjs';
import {WORKER_LANGUAGE_CODES} from '../server/languages.mjs';
import {checkedWorkerReceipt} from '../src/worker-request.ts';
import {sqliteApp,loginRoute,principalLoginBody,loginPrincipal} from './helpers/sqlite-app.mjs';


test('SQLite publication HTTP requires the confirmed version and returns stale-version conflict without writes',async()=>{
  const db=openDatabase(':memory:'),server=sqliteApp(db);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}/api`;
  const call=(path,cookie,body)=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json',origin:'http://127.0.0.1:3020',...(cookie?{cookie}:{})},body:JSON.stringify(body)});
  try {
    db.prepare("UPDATE briefings SET state='ready',prepared_json=(SELECT snapshot_json FROM publications WHERE id='shelf-v3') WHERE id='shelf'").run();
    const cookie=(await call(loginRoute('maya'),null,principalLoginBody('maya'))).headers.get('set-cookie').split(';')[0];
    const input={requestId:randomUUID(),revision:1,workerIds:['worker-30']};
    const missing=await call('/briefings/shelf/publish',cookie,input);assert.equal(missing.status,400);assert.deepEqual(await missing.json(),{error:'Invalid publication version'});
    const stale=await call('/briefings/shelf/publish',cookie,{...input,nextVersion:3});assert.equal(stale.status,409);assert.deepEqual(await stale.json(),{error:'Draft version changed'});
    assert.equal(db.prepare('SELECT count(*) n FROM publications').get().n,1);assert.equal(db.prepare('SELECT count(*) n FROM assignments').get().n,30);
    const first=await call('/briefings/shelf/publish',cookie,{...input,nextVersion:4});assert.equal(first.status,201);assert.equal((await first.json()).version,4);
    const replay=await call('/briefings/shelf/publish',cookie,{...input,nextVersion:4});assert.equal(replay.status,200);assert.equal((await replay.json()).duplicate,true);
    db.prepare("UPDATE briefings SET state='ready' WHERE id='shelf'").run();
    assert.equal((await call('/briefings/shelf/publish',cookie,{...input,requestId:randomUUID(),nextVersion:4})).status,409);
    assert.equal(db.prepare('SELECT count(*) n FROM assignments').get().n,31);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});

test('SQLite worker answer/help acknowledgements bind request, assignment and original page context',async()=>{
  const db=openDatabase(':memory:'),server=sqliteApp(db);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}/api`;
  try {
    const login=await loginPrincipal(base, 'worker-30');
    const cookie=login.headers.get('set-cookie').split(';')[0];
    const {clientContext}=await (await fetch(base+'/session',{headers:{cookie}})).json();
    const detailResponse=await fetch(base+'/worker/briefings/assignment-30',{headers:{cookie,'x-client-session-context':clientContext}});
    assert.equal(detailResponse.headers.get('cache-control'),'no-store');
    const detail=await detailResponse.json();assert.equal(detail.publicationId,'shelf-v3');assert.equal(detail.version,3);
    for(const hidden of ['rubric','snapshot_json','org_id','site_id'])assert.ok(!Object.hasOwn(detail,hidden));
    for(const kind of ['answer','help']){
      const requestId=randomUUID(),expected={requestId,assignmentId:'assignment-30',clientContext};
      const body=kind==='answer'?{submissionId:requestId,text:'Finished blue; unfinished yellow.'}:{requestId,text:'Synthetic help request'};
      let receiptId;
      for(const duplicate of [false,true]){
        const response=await fetch(`${base}/worker/briefings/assignment-30/${kind==='answer'?'answers':'help'}`,{method:'POST',headers:{cookie,'content-type':'application/json','x-client-session-context':clientContext},body:JSON.stringify(body)});
        assert.equal(response.status,kind==='help' && duplicate?200:201);assert.equal(response.headers.get('cache-control'),'no-store');
        const receipt=checkedWorkerReceipt(await response.json(),kind,expected);assert.equal(receipt.duplicate,duplicate);
        if(receiptId)assert.equal(receipt.id,receiptId);else receiptId=receipt.id;
      }
    }
    assert.equal(db.prepare("SELECT count(*) n FROM attempts WHERE assignment_id='assignment-30'").get().n,1);
    assert.equal(db.prepare("SELECT count(*) n FROM help_requests WHERE assignment_id='assignment-30'").get().n,1);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});

test('SQLite language readiness is scoped and separates stored content from untested provider evidence', async () => {
  const db=openDatabase(':memory:'),server=sqliteApp(db);
  await new Promise((resolve)=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const request=(path,cookie,body,method=body?'POST':'GET')=>fetch(`${base}/api${path}`,{method,headers:{'content-type':'application/json',...(cookie?{cookie}:{}),...(method!=='GET'?{origin:'http://127.0.0.1:3020'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const login=async principal=>(await request(loginRoute(principal),null,principalLoginBody(principal))).headers.get('set-cookie').split(';')[0];
  try {
    assert.equal((await request('/language-readiness')).status,401);
    const maya=await login('maya'),worker=await login('worker-30'),foreign=await login('harbor-owner');
    assert.equal((await request('/language-readiness',worker)).status,403);
    const foreignResult=await request('/language-readiness',foreign);assert.equal(foreignResult.status,200);assert.equal((await foreignResult.json()).publication,null);
    const result=await (await request('/language-readiness',maya)).json();
    assert.equal(result.realDataAllowed,false);assert.deepEqual(result.languages.map(language=>language.code),WORKER_LANGUAGE_CODES);
    assert.ok(result.languages.every(language=>language.ui.state==='ready'));
    assert.ok(result.languages.some(language=>language.code==='ar' && language.content.state==='ready'));
    assert.ok(result.languages.filter(language=>['en','ar','ur'].includes(language.code)).every(language=>language.translation.state==='not_tested'));
    assert.ok(result.languages.filter(language=>!['en','ar','ur'].includes(language.code)).every(language=>language.translation.state==='unavailable'));
    assert.equal((await request('/language-readiness/test',maya,{unexpected:true})).status,400);
    const tested=await (await request('/language-readiness/test',maya,{})).json();
    assert.equal(tested.tests.speech.state,'not_tested');assert.match(tested.provider.evidence,/Synthetic-only/);
    const usage=await (await request('/usage',maya)).json();
    assert.equal(usage.spend.estimated.state,'unknown');assert.equal(usage.spend.actual.state,'unknown');
    assert.equal((await request('/usage',worker)).status,403);
    assert.equal((await request('/retention',worker)).status,403);
    assert.equal((await request('/retention',maya,{requestId:randomUUID(),revision:0,audioDays:7,confirmed:false})).status,400);
    const policy={requestId:randomUUID(),revision:0,audioDays:30,confirmed:true};
    assert.equal((await request('/retention',maya,policy)).status,200);
    assert.equal((await request('/retention',maya,{...policy,requestId:randomUUID()})).status,409);
    assert.equal((await (await request('/retention',maya)).json()).audioDays,30);
    db.prepare("UPDATE staff SET role='administrator' WHERE id='maya'").run();
    const administrator=await login('maya');
    assert.equal((await request('/usage',administrator)).status,200);
    assert.equal((await request('/language-readiness',administrator)).status,200);
    assert.equal((await request('/language-readiness/test',administrator,{})).status,200);
    db.prepare("UPDATE staff SET active=0 WHERE id='maya'").run();
    assert.ok([401,403].includes((await request('/usage',administrator)).status));
    assert.ok([401,403].includes((await request('/language-readiness/test',administrator,{})).status));
  } finally {await new Promise(resolve=>server.close(resolve));db.close();}
});

test('briefing filters reject unknown fields, unsafe bounds and unsupported lifecycle/sort values',() => {
  assert.deepEqual(briefingFilters(),{search:'',status:'all',publicationStatus:'all',scheduleStatus:'all',archiveStatus:'active',sort:'updated',page:1,pageSize:20});
  for (const value of [null,[],{page:0},{page:5001},{pageSize:101},{pageSize:0},{search:'a'.repeat(81)},{status:'published'},
    {publicationStatus:'scheduled'},{scheduleStatus:'processing'},{scheduleStatus:null},{archiveStatus:'withdrawn'},{archiveStatus:null},{sort:'updated; DROP TABLE briefings'},{org_id:'other'}]) assert.throws(() => briefingFilters(value),/Invalid briefing filter/);
});

test('SQLite HTTP crew lifecycle requires scoped staff, current name and explicit archive confirmation',async () => {
  const db=openDatabase(':memory:'),server=sqliteApp(db);
  await new Promise((resolve) => server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const request=(path,cookie,body,method='POST') => fetch(`${base}/api${path}`,{method,headers:{'content-type':'application/json',...(cookie ? {cookie} : {})},...(body ? {body:JSON.stringify(body)} : {})});
  const login=async (principal) => (await request(loginRoute(principal),null,principalLoginBody(principal))).headers.get('set-cookie').split(';')[0];
  try {
    const staff=await login('maya'),worker=await login('worker-30'),foreign=await login('harbor-owner');
    const crew=await (await request('/people/crews',staff,{name:'HTTP Morning'})).json();
    const path=`/people/crews/${crew.id}`,rename={name:'HTTP New name',expectedName:crew.name};
    assert.equal((await request(path,null,rename,'PATCH')).status,401);
    assert.equal((await request(path,worker,rename,'PATCH')).status,403);
    assert.equal((await request(path,foreign,rename,'PATCH')).status,404);
    assert.equal((await request(path,staff,rename,'PATCH')).status,200);
    assert.equal((await request(path,staff,rename,'PATCH')).status,200);
    assert.equal((await request(path,staff,{...rename,name:'Stale edit'},'PATCH')).status,409);
    const archive={expectedName:rename.name,confirmed:true};
    assert.equal((await request(`${path}/archive`,staff,{expectedName:rename.name})).status,400);
    assert.equal((await request(`${path}/archive`,foreign,archive)).status,404);
    assert.equal((await request(`${path}/archive`,worker,archive)).status,403);
    assert.equal((await request(`${path}/archive`,staff,archive)).status,200);
    assert.equal((await request(`${path}/archive`,staff,archive)).status,200);
    assert.equal((await request(path,staff,{name:'Another name',expectedName:rename.name},'PATCH')).status,409);
    assert.equal((await request('/people/workers/worker-30/crew',staff,{crewId:crew.id})).status,404);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit WHERE action='crew.renamed'").get().n,1);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit WHERE action='crew.archived'").get().n,1);
  } finally {await new Promise((resolve) => server.close(resolve));db.close();}
});

test('SQLite library pages past 100 rows with literal search, stable sorting and separate draft/publication states',async () => {
  const db=openDatabase(':memory:'),server=sqliteApp(db);
  await new Promise((resolve) => server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    const login=await loginPrincipal(base, 'maya');
    const cookie=login.headers.get('set-cookie').split(';')[0];
    const get=(query='') => fetch(`${base}/api/briefings${query}`,{headers:{cookie}});
    const insert=db.prepare('INSERT INTO briefings VALUES(?,?,?,?,?,?,?,?,?,?,?)');
    for(let i=0;i<125;i++) insert.run(`library-${i}`,'cedar','beirut',`Synthetic library ${String(i).padStart(3,'0')}`,'A scoped synthetic source',1,1,'draft',null,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
    insert.run('percent-title','cedar','beirut','100% readiness','A scoped synthetic source',1,1,'draft',null,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
    db.prepare("UPDATE briefings SET state='ready' WHERE id='shelf'").run();
    let result=await (await get('?search=SYNTHETIC%20library&sort=title&page=2&pageSize=20')).json();
    assert.equal(result.total,125);assert.equal(result.items.length,20);assert.equal(result.items[0].title,'Synthetic library 020');assert.equal(result.items.at(-1).title,'Synthetic library 039');
    assert.ok(!JSON.stringify(result).includes('source'));assert.ok(!JSON.stringify(result).includes('prepared_json'));
    result=await (await get('?search=Synthetic%20library&sort=title&page=7')).json();assert.equal(result.items.length,5);assert.equal(result.total,125);
    result=await (await get('?search=Synthetic%20library&page=5000')).json();assert.equal(result.items.length,0);assert.equal(result.total,125);
    assert.equal((await (await get('?search=%25')).json()).total,1);
    assert.equal((await (await get('?publicationStatus=unpublished')).json()).total,126);
    result=await (await get('?status=ready&publicationStatus=published')).json();assert.equal(result.total,1);assert.equal(result.items[0].id,'shelf');assert.equal(result.items[0].publication_state,'published');
    const withdrawal=await fetch(`${base}/api/briefings/shelf/withdraw`,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({requestId:randomUUID(),publicationId:'shelf-v3',version:3,reason:'Library state test'})});assert.equal(withdrawal.status,200);
    assert.equal((await (await get('?status=ready&publicationStatus=withdrawn')).json()).total,1);
    assert.equal((await (await get('?publicationStatus=published')).json()).total,0);
    for(const query of ['?pageSize=101','?page=0','?sort=invalid','?org_id=harbor']) assert.equal((await get(query)).status,400);
  } finally {await new Promise((resolve) => server.close(resolve));db.close();}
});

test('SQLite HTTP withdraws only a scoped exact version and leaves history and reports readable',async () => {
  const db=openDatabase(':memory:'),server=sqliteApp(db);
  await new Promise((resolve) => server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const request=async(path,cookie,body) => {
    const headers={'content-type':'application/json',...(cookie ? {cookie} : {})};
    if(body && path.startsWith('/worker/'))headers['x-client-session-context']=(await (await fetch(`${base}/api/session`,{headers:{cookie}})).json()).clientContext || '';
    return fetch(`${base}/api${path}`,{method:body ? 'POST' : 'GET',headers,...(body ? {body:JSON.stringify(body)} : {})});
  };
  const login=async (principal) => (await request(loginRoute(principal),null,principalLoginBody(principal))).headers.get('set-cookie').split(';')[0];
  try {
    const staff=await login('maya'),worker=await login('worker-30'),foreign=await login('harbor-owner');
    const input={requestId:randomUUID(),publicationId:'shelf-v3',version:3,reason:'Source replaced'};
    assert.equal((await request('/briefings/shelf/withdraw',null,input)).status,401);
    assert.equal((await request('/briefings/shelf/withdraw',worker,input)).status,403);
    assert.equal((await request('/briefings/shelf/withdraw',foreign,input)).status,404);
    assert.equal((await request('/briefings/shelf/withdraw',staff,{...input,version:4})).status,409);
    assert.equal((await request('/briefings/shelf/withdraw',staff,{...input,reason:''})).status,400);
    assert.equal((await request('/briefings/shelf/withdraw',staff,input)).status,200);
    assert.equal((await (await request('/briefings/shelf/withdraw',staff,input)).json()).duplicate,true);
    assert.equal((await request('/briefings/shelf/withdraw',staff,{...input,reason:'Different reason'})).status,409);
    const detail=await (await request('/briefings/shelf',staff)).json();assert.equal(detail.publications[0].withdrawal.reason,input.reason);
    const history=await (await request('/worker/history',worker)).json();assert.equal(history.items[0].state,'withdrawn');
    assert.equal((await (await request('/worker/briefings',worker)).json()).items.length,0);
    assert.equal((await request('/worker/briefings/assignment-30/answers',worker,{submissionId:randomUUID(),text:'Finished blue; unfinished yellow.'})).status,409);
    const own=await (await request('/worker/briefings/assignment-30',worker)).json();assert.equal(own.state,'withdrawn');assert.ok(!JSON.stringify(own).includes(input.reason));
    const report=await (await request('/reports?publicationId=shelf-v3',staff)).json();assert.equal(report.metrics.responses,24);
  } finally {await new Promise((resolve) => server.close(resolve));db.close();}
});

test('session-scoped API denies anonymous, worker, and cross-tenant briefing reads', async () => {
  const db = openDatabase(':memory:');
  const server = sqliteApp(db);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, cookie, options = {}) => fetch(`${base}/api${path}`, {
    ...options,
    headers: { ...(cookie ? { cookie } : {}), 'content-type': 'application/json' },
  });
  async function signIn(principal) {
    const response = await request(loginRoute(principal), null, { method: 'POST', body: JSON.stringify(principalLoginBody(principal)) });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie').split(';')[0];
  }
  try {
    assert.equal((await request('/overview')).status, 401);
    const maya = await signIn('maya');
    const session=await (await request('/session',maya)).json();assert.equal(session.staffRole,'owner');assert.equal(session.timezone,'Asia/Beirut');
    const harbor = await signIn('harbor-owner');
    const worker = await signIn('worker-30');
    const overview = await (await request('/overview', maya)).json();
    assert.equal(overview.metrics.completion, 80);
    assert.equal((await request('/briefings/shelf', harbor)).status, 404);
    assert.equal((await request('/overview', worker)).status, 403);
    assert.equal((await request('/worker/history', maya)).status, 403);
    assert.equal((await request('/worker/history')).status, 401);
    assert.deepEqual((await (await request('/worker/history', worker)).json()).items.map((item) => item.id), ['assignment-30']);
    assert.equal((await request('/worker/briefings/assignment-14', worker)).status, 404);
    const own = await (await request('/worker/briefings/assignment-30', worker)).json();
    assert.equal(own.id, 'assignment-30');
    assert.equal(own.assessmentStatus, null);
    assert.equal(own.dueAt, null);
    assert.equal(JSON.stringify(own).includes('rubric'), false);
    assert.equal((await request('/briefings/shelf', maya)).status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});

test('queued synthetic job prepares draft through database and leaves publication unchanged', () => {
  const db = openDatabase(':memory:');
  sqliteApp(db).close();
  const before = db.prepare('SELECT snapshot_json FROM publications WHERE id=?').get('shelf-v3').snapshot_json;
  db.prepare('UPDATE briefings SET state=? WHERE id=?').run('processing', 'shelf');
  db.prepare('INSERT INTO jobs VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run('job-test', 'cedar', 'beirut', 'shelf', 1, 'prepare', 'queued', 0, new Date(0).toISOString(), null, null, new Date(0).toISOString());
  assert.equal(processOne(db), true);
  assert.equal(db.prepare('SELECT state FROM briefings WHERE id=?').get('shelf').state, 'ready');
  assert.equal(db.prepare('SELECT status FROM jobs WHERE id=?').get('job-test').status, 'ready');
  assert.equal(db.prepare('SELECT snapshot_json FROM publications WHERE id=?').get('shelf-v3').snapshot_json, before);
  db.close();
});

test('help retries are idempotent and superseded assignments reject new help', async () => {
  const db = openDatabase(':memory:');
  const server = sqliteApp(db);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const login = await loginPrincipal(base, 'worker-30');
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const body = JSON.stringify({ requestId: '2b5ab86c-0a15-4da0-947b-15b93fa1bd3b', text: 'I need help with the shelves.' });
    const clientContext=(await (await fetch(`${base}/api/session`,{headers:{cookie}})).json()).clientContext;
    const sendHelp = () => fetch(`${base}/api/worker/briefings/assignment-30/help`, { method: 'POST', headers: { cookie, 'content-type': 'application/json','x-client-session-context':clientContext }, body });
    assert.equal((await sendHelp()).status, 201);
    const duplicate = await sendHelp();
    assert.equal(duplicate.status, 200);
    assert.equal((await duplicate.json()).duplicate, true);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM clarifications WHERE assignment_id=? AND reason=?').get('assignment-30', 'Help requested').n, 1);
    const original = db.prepare('SELECT snapshot_json FROM publications WHERE id=?').get('shelf-v3').snapshot_json;
    const prepared = JSON.parse(original);
    prepared.languages.ur.supervisorNotes = 'private-check';
    prepared.languages.ur.rubric = { askedFacts: ['private-check'] };
    db.prepare('UPDATE briefings SET prepared_json=?,state=? WHERE id=?').run(JSON.stringify(prepared), 'ready', 'shelf');
    publish(db, { principal_type: 'staff', principal_id: 'maya', org_id: 'cedar', site_id: 'beirut', role: 'owner' }, 'shelf',{requestId:randomUUID(),revision:1,nextVersion:4,workerIds:['worker-30']});
    assert.equal((await sendHelp()).status, 200);
    const newHelp = await fetch(`${base}/api/worker/briefings/assignment-30/help`, { method: 'POST', headers: { cookie, 'content-type': 'application/json','x-client-session-context':clientContext }, body: JSON.stringify({ requestId:'f1bb08b5-0a15-4da0-947b-15b93fa1bd3b',text:'New help after supersession' }) });
    assert.equal(newHelp.status,409);
    const inbox = (await (await fetch(`${base}/api/worker/briefings`, { headers: { cookie } })).json()).items;
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0].version, 4);
    const current = await (await fetch(`${base}/api/worker/briefings/${inbox[0].id}`, { headers: { cookie } })).json();
    assert.deepEqual(Object.keys(current.content).sort(), ['question','speech','text','title']);
    assert.equal(JSON.stringify(current).includes('private-check'), false);
    const history = (await (await fetch(`${base}/api/worker/history`, { headers: { cookie } })).json()).items;
    assert.equal(history.length, 2);
    assert.equal(history.every((item) => item.id === 'assignment-30' || item.id === inbox[0].id), true);
    assert.equal(history.find((item) => item.id === 'assignment-30').state, 'superseded');
    assert.equal(JSON.stringify(history).includes('private-check'), false);
    const previous = await fetch(`${base}/api/worker/briefings/assignment-30`, { headers: { cookie } });
    assert.equal(previous.status, 200);
    const previousContent = await previous.json();
    assert.equal(previousContent.state, 'superseded');
    assert.equal(previousContent.version, 3);
    assert.equal(JSON.stringify(previousContent).includes('rubric'), false);
    assert.equal((await (await fetch(`${base}/api/worker/briefings/assignment-30/help`, { headers: { cookie } })).json())[0].helpText, 'I need help with the shelves.');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});
