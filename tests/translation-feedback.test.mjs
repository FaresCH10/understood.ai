import {Readable} from 'node:stream';
import {provisionOperator,authenticateOperator,operatorSession,revokeOperator} from '../server/postgres/operators.mjs';
import {operationsTranslationFeedback,decideOperationsTranslationFeedback} from '../server/postgres/operator-translation-feedback.mjs';
import {configureRuntimePermissions} from '../server/postgres/runtime-permissions.mjs';
import {handleOperationsRoute} from '../server/postgres/operations-http.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {openDatabase,NOW} from '../server/db.mjs';
import {seed} from '../server/seed.mjs';
import {ensureTranslationFeedbackSchema,listTranslationFeedback,reportTranslationFeedback,decideTranslationFeedback} from '../server/translation-feedback.mjs';
import {translationFeedbackInput,translationFeedbackDecisionInput,translationFeedbackFilters} from '../server/translation-feedback-input.mjs';
import {listTranslationFeedback as pgList,reportTranslationFeedback as pgReport,decideTranslationFeedback as pgDecide} from '../server/postgres/translation-feedback.mjs';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {createAppServer} from '../server/index.mjs';
import {createPostgresRehearsalServer} from '../server/postgres/http.mjs';
import {provisionStaffCredential} from '../server/postgres/auth.mjs';
import {createSessionContextFetch} from './helpers/session-http.mjs';
import {principalLoginBody,seedCredentials} from './helpers/sqlite-app.mjs';

const fetch=createSessionContextFetch();
const owner={principal_type:'staff',principal_id:'maya',org_id:'cedar',site_id:'beirut',role:'owner'};
const auditor={...owner,principal_id:'auditor',role:'auditor'};
const briefingId=randomUUID(),publicationId=randomUUID();
const snapshot={languages:{en:{title:'Shelf handover',text:'Put finished items on the blue shelf.',question:'Where do finished items go?'},
  ar:{title:'تسليم الرفوف',text:'ضع المنتجات المكتملة على الرف الأزرق.',question:'أين تضع المنتجات المكتملة؟'}},rubric:{askedFacts:[]}};
const report=patch=>({requestId:randomUUID(),publicationId,language:'ar',field:'text',note:'The word for shelf is wrong.',...patch});

test('translation feedback inputs bound fields, notes and filters',()=>{
  for(const patch of [{requestId:'bad'},{publicationId:'bad'},{language:'AR'},{language:'english'},{field:'source'},{note:'x'},{note:'x'.repeat(1001)},{extra:true}])
    assert.throws(()=>translationFeedbackInput(report(patch)),/Invalid/);
  assert.equal(translationFeedbackInput(report({note:'  Trimmed note  '})).note,'Trimmed note');
  for(const value of [{action:'open'},{action:'resolved',note:'x'.repeat(1001)},{extra:1}]) assert.throws(()=>translationFeedbackDecisionInput(value),/Invalid/);
  for(const value of [{status:'pending'},{language:'AR'},{page:0},{pageSize:101},{extra:true}]) assert.throws(()=>translationFeedbackFilters(value),/Invalid/);
  assert.deepEqual(translationFeedbackFilters({}),{status:'open',language:'',page:1,pageSize:20});
});

async function fixture(pg) {
  if(!pg) {
    const db=openDatabase(':memory:');seed(db);ensureTranslationFeedbackSchema(db);
    db.prepare('INSERT INTO staff VALUES(?,?,?,?,?,1)').run('auditor','cedar','beirut','Auditor','auditor');
    const now=NOW();
    db.prepare('INSERT INTO briefings(id,org_id,site_id,title,source,revision,next_version,state,prepared_json,created_at,updated_at) VALUES(?,?,?,?,?,1,1,?,NULL,?,?)').run(briefingId,'cedar','beirut','Shelf handover','Put finished items on the blue shelf.','ready',now,now);
    db.prepare('INSERT INTO publications VALUES(?,?,?,?,?,?,?,?)').run(publicationId,'cedar','beirut',briefingId,1,JSON.stringify(snapshot),now,'published');
    return {db,report:(s,v)=>reportTranslationFeedback(db,s,v),list:(s,v)=>listTranslationFeedback(db,s,v),decide:(s,id,v)=>decideTranslationFeedback(db,s,id,v),raw:async(sql,v=[])=>({rows:db.prepare(sql).all(...v)}),close:async()=>db.close()};
  }
  const db=new PGlite(),options={schema:'understood_test_translation_feedback'};
  const pool={async connect(){return {async query(sql,v){return v?.length ? db.query(sql,v) : (await db.exec(sql)).at(-1) || {rows:[]};},release(){}};}};
  await db.exec(`CREATE SCHEMA ${options.schema};SET search_path TO ${options.schema},pg_catalog`);await runMigrations(pool,options);
  await db.query("INSERT INTO organizations VALUES('cedar','Cedar Works'),('foreign','Foreign')");
  await db.query("INSERT INTO sites VALUES('beirut','cedar','Beirut','Asia/Beirut'),('foreign','foreign','Foreign','UTC')");
  await db.query("INSERT INTO staff(id,org_id,site_id,name,role) VALUES('maya','cedar','beirut','Maya Haddad','owner'),('auditor','cedar','beirut','Auditor','auditor'),('foreign','foreign','foreign','Foreign','owner')");
  await db.query("INSERT INTO briefings(id,org_id,site_id,title,source,state) VALUES($1,'cedar','beirut','Shelf handover','Put finished items on the blue shelf.','ready')",[briefingId]);
  await db.query("INSERT INTO publications(id,org_id,site_id,briefing_id,version,snapshot_json,state) VALUES($1,'cedar','beirut',$2,1,$3,'published')",[publicationId,briefingId,JSON.stringify(snapshot)]);
  return {db,pool,options,report:(s,v)=>pgReport(pool,s,v,options),list:(s,v)=>pgList(pool,s,v,options),decide:(s,id,v)=>pgDecide(pool,s,id,v,options),raw:(sql,v)=>db.query(sql,v),close:()=>db.close()};
}

for(const pg of [false,true]) test(`${pg ? 'PostgreSQL' : 'SQLite'} translation feedback queue preserves scope, decisions and immutable evidence`,async()=>{
  const f=await fixture(pg);
  try {
    const foreign={...owner,principal_id:pg ? 'foreign' : 'harbor-owner',org_id:pg ? 'foreign' : 'harbor',site_id:pg ? 'foreign' : 'harbor-yard'};
    const first=report({requestId:randomUUID()});
    for(const s of [{...owner,principal_type:'worker'},{...owner,site_id:'foreign'},{...owner,principal_id:'missing'}]) await assert.rejects(async()=>f.report(s,first),/Forbidden/);
    await assert.rejects(async()=>f.report(foreign,first),/Publication unavailable/);
    for(const actor of [owner,foreign,auditor])await assert.rejects(async()=>f.list(actor),/Forbidden/);
    const created=await f.report(owner,first);assert.equal(created.duplicate,false);assert.equal(created.status,'open');assert.equal(created.briefingTitle,'Shelf handover');
    assert.equal(created.translation,snapshot.languages.ar.text);assert.equal(created.reporter,'Maya Haddad');
    assert.equal((await f.report(owner,first)).duplicate,true);
    await assert.rejects(async()=>f.report(owner,{...first,note:'A different note'}),/conflict/);
    await assert.rejects(async()=>f.report(owner,report()),/already open/);
    assert.equal((await f.report(auditor,report({field:'title'}))).field,'title');
    await assert.rejects(async()=>f.report(owner,report({publicationId:randomUUID()})),/Publication unavailable/);
    await assert.rejects(async()=>f.report(owner,report({language:'ur'})),/language unavailable/);
    for(const actor of [owner,auditor,foreign,{...owner,role:'supervisor'},{...owner,role:'administrator'}]){
      await assert.rejects(async()=>f.list(actor),/Forbidden/);
      await assert.rejects(async()=>f.decide(actor,created.id,{action:'resolved'}),/Forbidden/);
    }
    await assert.rejects(f.raw("UPDATE translation_feedback SET note='changed'"),/immutable/);
    await assert.rejects(f.raw('DELETE FROM translation_feedback'),/immutable/);
    const config={tier:'local',aiMode:'synthetic',accessMode:'credential',dataClass:'synthetic',publicOrigin:'http://127.0.0.1:3021',...(pg ? f.options : {})};
    if(pg) await provisionStaffCredential(f.pool,{staffId:'maya',orgId:'cedar',siteId:'beirut',email:'feedback@example.test',password:'Synthetic-feedback-password-123'},f.options);
    else seedCredentials(f.db);
    const server=pg ? createPostgresRehearsalServer(f.pool,config) : createAppServer(f.db,config);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}/api`;
    const call=(path,cookie,body)=>fetch(base+path,{method:body ? 'POST' : 'GET',headers:{origin:config.publicOrigin,'content-type':'application/json',...(cookie ? {cookie} : {})},body:body ? JSON.stringify(body) : undefined});
    try {
      assert.equal((await call('/translation-feedback')).status,401);
      const login=await call('/auth/staff/login',null,pg ? {email:'feedback@example.test',password:'Synthetic-feedback-password-123'} :principalLoginBody('maya')),cookie=login.headers.get('set-cookie').split(';')[0];
      assert.equal((await call('/translation-feedback?status=pending',cookie)).status,403);
      assert.equal((await call('/translation-feedback',cookie,report({field:'source'}))).status,400);
      const acceptedInput=report({field:'question'}),accepted=await call('/translation-feedback',cookie,acceptedInput);assert.equal(accepted.status,201);const acceptedBody=await accepted.json();
      assert.equal((await call('/translation-feedback',cookie,acceptedInput)).status,200);
      assert.equal((await call('/translation-feedback',cookie,report({field:'question'}))).status,409);
      const queue=await call('/translation-feedback?status=open',cookie);assert.equal(queue.status,403);
      assert.equal((await call(`/translation-feedback/${acceptedBody.id}/decision`,cookie,{action:'resolved'})).status,403);
      assert.equal((await call(`/translation-feedback/${randomUUID()}/decision`,cookie,{action:'resolved'})).status,403);
      assert.equal((await call(`/translation-feedback/${acceptedBody.id}/decision`,cookie,{action:'open'})).status,403);
    } finally {await new Promise(resolve=>server.close(resolve));}
  } finally {await f.close();}
});

test('platform feedback review spans workspaces, requires operator identity, preserves audit and works with narrow runtime grants',async()=>{
 const f=await fixture(true);
 try{
  const first=await f.report(owner,report());
  const second=await f.report(owner,report({field:'title'}));
  const foreignBriefing=randomUUID(),foreignPublication=randomUUID();
  await f.db.query("INSERT INTO briefings(id,org_id,site_id,title,source,state) VALUES($1,'foreign','foreign','Private foreign instruction','Private foreign source','ready')",[foreignBriefing]);
  await f.db.query("INSERT INTO publications(id,org_id,site_id,briefing_id,version,snapshot_json,state) VALUES($1,'foreign','foreign',$2,1,$3,'published')",[foreignPublication,foreignBriefing,JSON.stringify(snapshot)]);
  await f.report({...owner,principal_id:'foreign',org_id:'foreign',site_id:'foreign'},report({publicationId:foreignPublication}));
  const password='Synthetic feedback operator password';
  await provisionOperator(f.pool,{id:randomUUID(),email:'feedback-admin@example.test',name:'Feedback Admin',password},f.options);
  const login=await authenticateOperator(f.pool,{email:'feedback-admin@example.test',password},'local',f.options),actor=login.session;
  await assert.rejects(operationsTranslationFeedback(f.pool,owner,{},f.options),/Operator sign in required/);
  const route=async(path,body,headers={})=>{
    const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);req.method=body===undefined?'GET':'POST';req.headers={'content-type':'application/json',...headers};req.socket={remoteAddress:'127.0.0.1'};
    let status,value;const res={writeHead(code){status=code;},end(data){value=data;}};
    await handleOperationsRoute(f.pool,req,res,new URL('http://127.0.0.1:3020/api/ops/'+path),{...f.options,enabled:true});return {status,body:JSON.parse(value)};
  };
  const headers={cookie:`understood_operator=${login.token}`,'x-operator-context':operatorSession(actor).clientContext};
  assert.equal((await route('translation-feedback')).status,401);
  assert.equal((await route('translation-feedback',undefined,{cookie:headers.cookie})).status,409);
  assert.equal((await route('translation-feedback?status=bad',undefined,headers)).status,400);
  assert.equal((await route('translation-feedback?status=open&status=all',undefined,headers)).status,400);
  assert.equal((await route('translation-feedback',undefined,headers)).body.total,3);
  await f.db.exec('CREATE ROLE feedback_operator_runtime LOGIN');
  await configureRuntimePermissions(f.pool,{...f.options,role:'feedback_operator_runtime',profile:'operator',dedicatedDatabase:true,writersStopped:true});
  await f.db.exec(`SET SESSION AUTHORIZATION feedback_operator_runtime;SET search_path TO ${f.options.schema},pg_catalog`);
  const queue=await operationsTranslationFeedback(f.pool,actor,{},f.options);assert.equal(queue.total,3);assert.ok(queue.items.some(item=>item.workspace==='Cedar Works'));assert.ok(queue.items.some(item=>item.workspace==='Foreign'));
  assert.doesNotMatch(JSON.stringify(queue),/snapshot_json|reportedBy|Shelf handover/);
  const command={requestId:randomUUID(),action:'resolved',note:'Checked with the language reviewer.'};
  const accepted=await route(`translation-feedback/${first.id}/decision`,command,headers);assert.equal(accepted.status,200);assert.equal(accepted.body.status,'resolved');
  assert.equal((await route(`translation-feedback/${first.id}/decision`,command,headers)).body.duplicate,true);
  assert.equal((await route(`translation-feedback/${second.id}/decision`,command,headers)).status,409);
  assert.equal((await route(`translation-feedback/${first.id}/decision`,{...command,requestId:randomUUID(),action:'dismissed'},headers)).status,409);
  await decideOperationsTranslationFeedback(f.pool,actor,second.id,{requestId:randomUUID(),action:'dismissed',note:''},f.options);
  assert.equal((await operationsTranslationFeedback(f.pool,actor,{status:'open'},f.options)).total,1);
  assert.equal((await operationsTranslationFeedback(f.pool,actor,{status:'resolved'},f.options)).total,1);
  await assert.rejects(f.db.query('SELECT snapshot_json FROM publications'),error=>error.code==='42501');
  await assert.rejects(f.db.query("UPDATE translation_feedback SET note='changed'"),error=>error.code==='42501');
  await assert.rejects(f.db.query("UPDATE translation_feedback SET resolution_note='changed'"),/final/);
  const rows=(await f.db.query("SELECT * FROM operator_audit WHERE action LIKE 'translation.feedback_%'")).rows;assert.equal(rows.length,2);
  const review=(await f.db.query('SELECT resolved_by_operator FROM translation_feedback WHERE id=$1',[first.id])).rows[0];assert.equal(review.resolved_by_operator,actor.operator_id);
  await revokeOperator(f.pool,actor,f.options);await assert.rejects(operationsTranslationFeedback(f.pool,actor,{},f.options),/Operator sign in required/);
 }finally{await f.close();}
});
