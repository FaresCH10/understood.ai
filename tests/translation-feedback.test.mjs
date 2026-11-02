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
    assert.equal((await f.list(owner)).total,0);assert.equal((await f.list(foreign)).total,0);
    const created=await f.report(owner,first);assert.equal(created.duplicate,false);assert.equal(created.status,'open');assert.equal(created.briefingTitle,'Shelf handover');
    assert.equal(created.translation,snapshot.languages.ar.text);assert.equal(created.reporter,'Maya Haddad');
    assert.equal((await f.report(owner,first)).duplicate,true);
    await assert.rejects(async()=>f.report(owner,{...first,note:'A different note'}),/conflict/);
    await assert.rejects(async()=>f.report(owner,report()),/already open/);
    assert.equal((await f.report(auditor,report({field:'title'}))).field,'title');
    assert.equal((await f.list(owner)).total,2);assert.equal((await f.list(owner,{status:'all'})).total,2);
    assert.equal((await f.list(owner,{language:'ar'})).total,2);assert.equal((await f.list(owner,{language:'en'})).total,0);
    await assert.rejects(async()=>f.list({...owner,principal_type:'worker'}),/Forbidden/);
    await assert.rejects(async()=>f.report(owner,report({publicationId:randomUUID()})),/Publication unavailable/);
    await assert.rejects(async()=>f.report(owner,report({language:'ur'})),/language unavailable/);
    const id=created.id;
    for(const s of [auditor,{...owner,principal_type:'worker'}]) await assert.rejects(async()=>f.decide(s,id,{action:'resolved'}),/Forbidden/);
    await assert.rejects(async()=>f.decide(foreign,id,{action:'resolved'}),/Translation feedback unavailable/);
    await assert.rejects(async()=>f.decide(owner,randomUUID(),{action:'resolved'}),/unavailable/);
    const resolved=await f.decide(owner,id,{action:'resolved',note:'Corrected with the reviewer.'});
    assert.equal(resolved.status,'resolved');assert.equal(resolved.resolutionNote,'Corrected with the reviewer.');assert.equal(resolved.resolvedBy,'Maya Haddad');
    assert.equal((await f.decide(owner,id,{action:'resolved',note:'Corrected with the reviewer.'})).duplicate,true);
    await assert.rejects(async()=>f.decide(owner,id,{action:'resolved',note:'Different'}),/already decided/);
    await assert.rejects(async()=>f.decide(owner,id,{action:'dismissed'}),/already decided/);
    assert.equal((await f.list(owner,{status:'resolved'})).total,1);assert.equal((await f.list(owner,{status:'open'})).total,1);
    const second=(await f.list(owner,{status:'open'})).items[0];await f.decide(owner,second.id,{action:'dismissed'});
    assert.equal((await f.list(owner,{status:'dismissed'})).total,1);assert.equal((await f.list(owner,{status:'all'})).total,2);
    await assert.rejects(f.raw(pg ? "UPDATE translation_feedback SET note='changed'" : "UPDATE translation_feedback SET note='changed'"),/immutable/);
    await assert.rejects(f.raw('DELETE FROM translation_feedback'),/immutable/);
    await assert.rejects(f.raw("UPDATE translation_feedback SET resolution_note='again' WHERE status='resolved'"),/final/);
    const config={tier:'local',aiMode:'synthetic',accessMode:'credential',dataClass:'synthetic',publicOrigin:'http://127.0.0.1:3021',...(pg ? f.options : {})};
    if(pg) await provisionStaffCredential(f.pool,{staffId:'maya',orgId:'cedar',siteId:'beirut',email:'feedback@example.test',password:'Synthetic-feedback-password-123'},f.options);
    else seedCredentials(f.db);
    const server=pg ? createPostgresRehearsalServer(f.pool,config) : createAppServer(f.db,config);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}/api`;
    const call=(path,cookie,body)=>fetch(base+path,{method:body ? 'POST' : 'GET',headers:{origin:config.publicOrigin,'content-type':'application/json',...(cookie ? {cookie} : {})},body:body ? JSON.stringify(body) : undefined});
    try {
      assert.equal((await call('/translation-feedback')).status,401);
      const login=await call('/auth/staff/login',null,pg ? {email:'feedback@example.test',password:'Synthetic-feedback-password-123'} :principalLoginBody('maya')),cookie=login.headers.get('set-cookie').split(';')[0];
      assert.equal((await call('/translation-feedback?status=pending',cookie)).status,400);
      assert.equal((await call('/translation-feedback',cookie,report({field:'source'}))).status,400);
      const acceptedInput=report({field:'question'}),accepted=await call('/translation-feedback',cookie,acceptedInput);assert.equal(accepted.status,201);const acceptedBody=await accepted.json();
      assert.equal((await call('/translation-feedback',cookie,acceptedInput)).status,200);
      assert.equal((await call('/translation-feedback',cookie,report({field:'question'}))).status,409);
      const queue=await call('/translation-feedback?status=open',cookie);assert.equal(queue.status,200);assert.equal((await queue.json()).total,1);
      assert.equal((await call(`/translation-feedback/${acceptedBody.id}/decision`,cookie,{action:'resolved'})).status,200);
      assert.equal((await call(`/translation-feedback/${randomUUID()}/decision`,cookie,{action:'resolved'})).status,404);
      assert.equal((await call(`/translation-feedback/${acceptedBody.id}/decision`,cookie,{action:'open'})).status,400);
    } finally {await new Promise(resolve=>server.close(resolve));}
  } finally {await f.close();}
});
