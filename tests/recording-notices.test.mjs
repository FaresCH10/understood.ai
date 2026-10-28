import test from 'node:test';
import assert from 'node:assert/strict';
import {createSessionContextFetch} from './helpers/session-http.mjs';
const fetch=createSessionContextFetch();
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {openDatabase} from '../server/db.mjs';
import {seed} from '../server/seed.mjs';
import {recordingNoticeInput,recordingNoticeLanguage} from '../server/recording-notice-input.mjs';
import {getRecordingNotice,saveRecordingNotice,recordingNoticeReceipt} from '../server/recording-notices.mjs';
import * as pgNotice from '../server/postgres/recording-notices.mjs';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {createAppServer} from '../server/index.mjs';
import {createPostgresRehearsalServer} from '../server/postgres/http.mjs';
import {provisionStaffCredential,issueWorkerGrant,redeemWorkerGrant} from '../server/postgres/auth.mjs';
import {readWorkerRecordingNotice} from '../src/worker-recording-notice.ts';
import {WORKER_LANGUAGE_CODES} from '../server/languages.mjs';
import {loginRoute,principalLoginBody,seedCredentials} from './helpers/sqlite-app.mjs';


const owner={principal_type:'staff',principal_id:'maya',org_id:'cedar',site_id:'beirut',role:'owner'};
const admin={...owner,principal_id:'admin',role:'administrator'};
const worker={principal_type:'worker',principal_id:'worker-14',org_id:'cedar',site_id:'beirut',language:'en'};
const input=()=>({requestId:randomUUID(),revision:0,confirmed:true,scope:JSON.stringify(['cedar','beirut','maya']),notices:{en:'Synthetic site recording information for English.',ar:'معلومات التسجيل في الموقع التجريبي باللغة العربية.',ur:'آزمائشی سائٹ کی ریکارڈنگ کی معلومات اردو میں۔'}});

test('notice language query allows one explicit worker read language, never staff or write selection',()=>{
  assert.equal(recordingNoticeLanguage(new URLSearchParams(),owner,'GET'),undefined);
  for(const language of ['en','ar','ur'])assert.equal(recordingNoticeLanguage(new URLSearchParams({language}),worker,'GET'),language);
  for(const query of ['language=fr','language=','language=en&language=ar','site=other','language=en&site=other'])assert.throws(()=>recordingNoticeLanguage(new URLSearchParams(query),worker,'GET'),/Invalid recording notice/);
  for(const [principal,method] of [[owner,'GET'],[worker,'POST'],[worker,'HEAD']])assert.throws(()=>recordingNoticeLanguage(new URLSearchParams({language:'ar'}),principal,method),/Invalid recording notice/);
});
test('site notice input bounds all languages, explicit confirmation and immutable revision intent',()=>{
  const value=input();assert.equal(recordingNoticeInput(value).notices.ar,value.notices.ar);
  for(const patch of [{confirmed:false},{revision:'0'},{revision:-1},{requestId:'bad'},{site_id:'foreign'},{scope:'[]'},{scope:undefined},
    {notices:{...value.notices,en:'short'}},{notices:{...value.notices,ur:'a'.repeat(2001)}},
    {notices:{...value.notices,en:'Unsafe\u202e direction override content'}},{notices:{en:value.notices.en}},{notices:[]}])assert.throws(()=>recordingNoticeInput({...value,...patch}));
  assert.equal(recordingNoticeInput({...value,notices:{...value.notices,ar:''}}).notices.ar,'');
  assert.deepEqual(recordingNoticeInput({...value,notices:{en:'',ar:'',ur:''}}).notices,{en:'',ar:'',ur:''});
});
async function fixture(pg){
  if(!pg){
    const db=openDatabase(':memory:');seedCredentials(db);db.prepare("INSERT INTO staff VALUES('admin','cedar','beirut','Synthetic admin','administrator',1)").run();
    return {db,get:(s,options)=>getRecordingNotice(db,s,options),save:(s,v)=>saveRecordingNotice(db,s,v),receipt:(s,id)=>recordingNoticeReceipt(db,s,id),
      raw:async(sql,values=[])=>({rows:db.prepare(sql).all(...values)}),fail(){db.exec("CREATE TRIGGER reject_notice_audit BEFORE INSERT ON audit WHEN NEW.action='recording.notice.updated' BEGIN SELECT RAISE(ABORT,'Injected audit'); END");},
      reset(){db.exec('DROP TRIGGER reject_notice_audit');},close:async()=>db.close()};
  }
  const db=new PGlite(),options={schema:'understood_test_notices'};let fail=false,lost=false;
  const pool={async connect(){return {async query(sql,values){if(fail && sql.includes('INSERT INTO audit'))throw Error('Injected audit');const result=values?.length?await db.query(sql,values):(await db.exec(sql)).at(-1)||{rows:[]};if(lost&&sql==='COMMIT'){lost=false;throw Error('Lost commit acknowledgement');}return result;},release(){}};}};
  await db.exec(`CREATE SCHEMA ${options.schema}; SET search_path TO ${options.schema},pg_catalog`);await runMigrations(pool,options);
  await db.query("INSERT INTO organizations VALUES('cedar','Synthetic Cedar'),('harbor','Synthetic Harbor')");
  await db.query("INSERT INTO sites VALUES('beirut','cedar','Beirut','UTC'),('harbor-yard','harbor','Harbor','UTC')");
  await db.query("INSERT INTO staff(id,org_id,site_id,name,role) VALUES('maya','cedar','beirut','Maya','owner'),('admin','cedar','beirut','Admin','administrator'),('harbor-owner','harbor','harbor-yard','Other','owner')");
  await db.query("INSERT INTO workers(id,org_id,site_id,code,language) VALUES('worker-14','cedar','beirut','Worker 014','ar')");
  return {db,pool,options,get:(s,overrides)=>pgNotice.getRecordingNotice(pool,s,{...options,...overrides}),save:(s,v)=>pgNotice.saveRecordingNotice(pool,s,v,options),receipt:(s,id)=>pgNotice.recordingNoticeReceipt(pool,s,id,options),
    raw:(sql,v)=>db.query(sql,v),fail(){fail=true;},reset(){fail=false;},lose(){lost=true;},close:()=>db.close()};
}
for(const pg of [false,true])test(`${pg?'PostgreSQL':'SQLite'} worker notice language is explicit without changing profile or assignments`,async()=>{
  const f=await fixture(pg);try{
    const change=input();await f.save(owner,change);
    const before=(await f.raw("SELECT * FROM workers WHERE id='worker-14'")).rows;
    for(const language of ['en','ar','ur'])assert.deepEqual(await f.get(worker,{language}),{revision:1,configured:true,language,notice:change.notices[language]});
    assert.equal((await f.get(worker)).language,'ar');assert.deepEqual((await f.raw("SELECT * FROM workers WHERE id='worker-14'")).rows,before);
    await assert.rejects(async()=>f.get(worker,{language:'fr'}),/Invalid recording notice/);
    await assert.rejects(async()=>f.get(owner,{language:'ar'}),/Invalid recording notice/);
  }finally{await f.close();}
});
for(const pg of [false,true])test(`${pg?'PostgreSQL':'SQLite'} site notices are scoped, language-minimized, confirmed, audit-atomic and recoverable`,async()=>{
  const f=await fixture(pg);let server;
  try{
    assert.equal((await f.get(owner)).revision,0);assert.deepEqual(await f.get(worker),{revision:0,configured:false,language:'ar',notice:null});
    const change=input();f.fail();await assert.rejects(async()=>f.save(owner,change),/Injected/);f.reset();assert.equal((await f.get(owner)).revision,0);
    if(pg){f.lose();await assert.rejects(f.save(owner,change),/Lost commit/);}else await f.save(owner,change);
    assert.equal((await f.save(owner,change)).duplicate,true);assert.equal((await f.receipt(owner,change.requestId)).request.notices.ar,change.notices.ar);
    assert.equal(await f.receipt(admin,change.requestId),null);await assert.rejects(async()=>f.save(admin,change),/conflict/);
    await assert.rejects(async()=>f.save(owner,{...change,notices:{...change.notices,en:'A different synthetic notice for English.'}}),/conflict/);
    await assert.rejects(async()=>f.save(owner,input()),/revision changed/);
    const dto=await f.get(worker);assert.deepEqual(dto,{revision:1,configured:true,language:'ar',notice:change.notices.ar});
    assert.ok(!JSON.stringify(dto).includes(change.notices.en));assert.ok(!JSON.stringify(dto).includes('actor_id'));
    for(const s of [null,{...owner,principal_id:'missing'},{...owner,org_id:'harbor'},{...worker,site_id:'harbor-yard'}])await assert.rejects(async()=>f.get(s),/Forbidden/);
    await assert.rejects(async()=>f.save(worker,change),/Forbidden/);await assert.rejects(async()=>f.receipt(worker,change.requestId),/Forbidden/);
    const foreign={...owner,principal_id:'harbor-owner',org_id:'harbor',site_id:'harbor-yard'};assert.equal((await f.get(foreign)).configured,false);assert.equal(await f.receipt(foreign,change.requestId),null);
    await assert.rejects(async()=>f.save(foreign,input()),/conflict/);assert.equal((await f.get(foreign)).revision,0);
    await assert.rejects(f.raw('UPDATE recording_notice_requests SET revision=99'),/immutable/);await assert.rejects(f.raw('DELETE FROM recording_notice_requests'),/immutable/);
    const clear={...input(),revision:1,scope:JSON.stringify(['cedar','beirut','admin']),notices:{en:'',ar:'',ur:''}};await f.save(admin,clear);assert.equal((await f.get(worker)).configured,false);
    assert.equal((await f.save(owner,change)).duplicate,true);assert.equal((await f.get(owner)).revision,2);
    const config={tier:'local',aiMode:'synthetic',accessMode:'credential',dataClass:'synthetic',publicOrigin:'http://127.0.0.1:3020',...(pg?{schema:f.options.schema}:{})};
    if(pg)await provisionStaffCredential(f.pool,{staffId:'maya',orgId:'cedar',siteId:'beirut',email:'synthetic@example.test',password:'Synthetic-only-password-123'},f.options);
    server=pg?createPostgresRehearsalServer(f.pool,config):createAppServer(f.db,config);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const base=`http://127.0.0.1:${server.address().port}/api`,call=(path,cookie,body,origin=config.publicOrigin)=>fetch(base+path,{method:body?'POST':'GET',headers:{origin,'content-type':'application/json',...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined});
    const login=await call('/auth/staff/login',null,pg?{email:'synthetic@example.test',password:'Synthetic-only-password-123'}:principalLoginBody('maya')),cookie=login.headers.get('set-cookie').split(';')[0];
    const read=await call('/privacy/recording-notice',cookie);assert.equal(read.status,200);assert.match(read.headers.get('cache-control'),/no-store/);assert.equal((await read.json()).revision,2);
    assert.equal((await call('/privacy/recording-notice',null)).status,401);assert.equal((await call('/privacy/recording-notice?site=harbor',cookie)).status,400);
    assert.equal((await call('/privacy/recording-notice',cookie,{...input(),revision:2},'http://foreign.test')).status,403);
    assert.equal((await call('/privacy/recording-notice',cookie,{...input(),revision:2,confirmed:false})).status,400);
    assert.equal((await call('/privacy/recording-notice',cookie,input())).status,409);
    assert.equal((await call('/privacy/recording-notice',cookie,{...input(),revision:2,scope:JSON.stringify(['harbor','harbor-yard','harbor-owner'])})).status,409);
    assert.equal((await f.get(owner)).revision,2);
    const httpChange={...input(),revision:2,notices:Object.fromEntries(WORKER_LANGUAGE_CODES.map(code=>[code,`${code}: ${'Site recording information. '.repeat(65)}`.trim()]))};
    assert.ok(Buffer.byteLength(JSON.stringify(httpChange))>16384);
    assert.equal((await call('/privacy/recording-notice',cookie,httpChange)).status,200);
    assert.equal((await (await call(`/privacy/recording-notice/requests/${httpChange.requestId}`,cookie)).json()).revision,3);
    let workerCookie;
    if(pg){const grant=await issueWorkerGrant(f.pool,owner,'worker-14',30,f.options),identity=await redeemWorkerGrant(f.pool,grant.token,f.options);workerCookie=`understood_pg_rehearsal=${identity.token}`;}
    else workerCookie=(await call(loginRoute('worker-14'),null,principalLoginBody('worker-14'))).headers.get('set-cookie').split(';')[0];
    const workerSession=await (await globalThis.fetch(base+'/session',{headers:{cookie:workerCookie}})).json();
    const workerRead=(query='',context=workerSession.clientContext)=>globalThis.fetch(base+'/privacy/recording-notice'+query,{headers:{cookie:workerCookie,origin:config.publicOrigin,...(context===null?{}:{'x-client-session-context':context})}});
    assert.equal((await workerRead('',null)).status,409);assert.equal((await workerRead('?language=en','0'.repeat(64))).status,409);
    for(const query of ['?language=fr','?language=en&language=ar','?site=other'])assert.equal((await workerRead(query)).status,400);
    assert.equal((await call('/privacy/recording-notice?language=en',cookie)).status,400);
    const transport=(path,options)=>globalThis.fetch(base.replace(/\/api$/,'')+path,{...options,headers:{...options.headers,cookie:workerCookie,origin:config.publicOrigin}});
    for(const language of WORKER_LANGUAGE_CODES)assert.equal(await readWorkerRecordingNotice(transport,workerSession,language,new AbortController().signal,()=>true),httpChange.notices[language]);
    assert.equal((await f.get(worker)).language,'ar');
    await f.raw(pg?"UPDATE staff SET active=false WHERE id='maya'":"UPDATE staff SET active=0 WHERE id='maya'");await assert.rejects(async()=>f.save(owner,httpChange),/Forbidden/);
  }finally{if(server)await new Promise(resolve=>server.close(resolve));await f.close();}
});
