import {assignWorkerPassword as sqliteAssign} from '../server/worker-credentials.mjs';
import {assignWorkerPassword as pgAssign} from '../server/postgres/worker-credentials.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {openDatabase} from '../server/db.mjs';
import {seed} from '../server/seed.mjs';
import {createAppServer} from '../server/index.mjs';
import * as sqliteAuth from '../server/auth.mjs';
import * as pgAuth from '../server/postgres/auth.mjs';
import {createPostgresRehearsalServer} from '../server/postgres/http.mjs';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {tokenHash} from '../server/auth-crypto.mjs';
import {readWorkerRedemption} from '../server/worker-redemption.mjs';
import {readWorkerRedemption as pgRead} from '../server/postgres/worker-redemption.mjs';
import {workerEntryKey,workerEntryRecoveryText,prepareWorkerEntry,savePendingWorkerEntry,readPendingWorkerEntry,clearPendingWorkerEntry,recoverWorkerEntry} from '../src/worker-entry-recovery.ts';
import {assertWorkerDictionary} from './helpers/worker-locales.mjs';

const origin='http://127.0.0.1:3020',password='Synthetic recovery test password only',owner={principal_type:'staff',principal_id:'maya',org_id:'cedar',site_id:'beirut',role:'owner'};
async function fixture(postgres){
  const schema='understood_test_worker_entry',db=postgres?new PGlite():openDatabase(':memory:');let fail=false;
  const pool=postgres?{async connect(){return {query:async(sql,args)=>{
    if(fail && sql.includes('SELECT se.*,w.language'))throw Error('PRIVATE_DATABASE_DETAIL');
    return args?.length?db.query(sql,args):(await db.exec(sql)).at(-1)||{rows:[]};},release(){}};}}:null;
  if(postgres){await db.exec(`CREATE SCHEMA ${schema};SET search_path TO ${schema},pg_catalog`);await runMigrations(pool,{schema});
    await db.exec(`INSERT INTO organizations VALUES('cedar','Synthetic QA'),('foreign','Foreign QA');
      INSERT INTO sites VALUES('beirut','cedar','Beirut','UTC'),('foreign','foreign','Foreign','UTC');
      INSERT INTO staff(id,org_id,site_id,name,role) VALUES('maya','cedar','beirut','Synthetic Owner','owner'),('foreign','foreign','foreign','Foreign Owner','owner');
      INSERT INTO workers(id,org_id,site_id,code,language,active) VALUES('worker-1','cedar','beirut','Worker 001','en',true),('worker-2','cedar','beirut','Worker 002','ar',true),('foreign','foreign','foreign','Foreign worker','ur',true);`);
    await pgAuth.provisionStaffCredential(pool,{staffId:'maya',orgId:'cedar',siteId:'beirut',email:'owner@entry.example.test',password},{schema});
  }else seed(db);
  const server=postgres?createPostgresRehearsalServer(pool,{schema,dataClass:'synthetic',tier:'local',aiMode:'synthetic',accessMode:'credential',publicOrigin:origin}):createAppServer(db,{tier:'local',aiMode:'synthetic',accessMode:'credential',publicOrigin:origin});
  if(!postgres)sqliteAuth.provisionStaffCredential(db,'maya','owner@entry.example.test',password);
  for(const [id,code] of [['worker-1','Worker 001'],['worker-2','Worker 002']]){const value={expectedCode:code,workerId:code,password,confirmed:true};if(postgres)await pgAssign(pool,owner,id,value,{schema});else sqliteAssign(db,owner,id,value);}
  const grant=id=>postgres?pgAuth.issueWorkerGrant(pool,owner,id,240,{schema}):sqliteAuth.issueWorkerGrant(db,owner,id,240);
  const sql=async(text,args=[])=>postgres?(await db.query(text,args)).rows:db.prepare(text).all(...args);
  const snapshot=async()=>JSON.stringify(await Promise.all(['sessions','worker_grants','audit'].map(table=>sql(`SELECT * FROM ${table} ORDER BY ${table==='sessions'?'token_hash':'id'}`))));
  return {db,pool,schema,server,grant,sql,snapshot,setFail:value=>{fail=value;},close:()=>db.close()};
}
for(const postgres of [false,true])test(`${postgres?'PostgreSQL':'SQLite'} interrupted redemption is recovered by exact current-cookie GETs without another redemption or logout`,async()=>{
  const f=await fixture(postgres),grant=await f.grant('worker-1'),other=await f.grant('worker-2');let redemptions=0,logouts=0,lose=true,beforeCommit=false;
  const handler=f.server.listeners('request')[0];f.server.removeAllListeners('request');
  f.server.on('request',(req,res)=>{
    if(req.url==='/api/logout')logouts++;
    if(req.url==='/api/auth/worker/redeem' && req.method==='POST'){
      redemptions++;
      if(beforeCommit){res.writeHead(503,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({error:'Synthetic interruption before acceptance'}));return;}
      if(lose){const head=res.writeHead.bind(res),end=res.end.bind(res);let committed=false;
        res.writeHead=(status,...args)=>{committed=status===200;if(committed)lose=false;return head(committed?503:status,...args);};
        res.end=(body,...args)=>end(committed?JSON.stringify({error:'Synthetic lost acknowledgement'}):body,...args);}
    }handler(req,res);
  });
  await new Promise(resolve=>f.server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${f.server.address().port}/api`;
  try{
    const accepted=await fetch(base+'/auth/worker/redeem',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({token:grant.token,company:'cedar',workerId:'Worker 001',password})});assert.equal(accepted.status,503);
    const cookie=accepted.headers.get('set-cookie').split(';')[0],pending=await prepareWorkerEntry(grant.token,'ur');
    const before=await f.snapshot(),calls=[];
    const request=async(path,options={})=>{calls.push({path,method:options.method??'GET'});const response=await fetch(base+path,{...options,headers:{cookie,...options.headers}});const body=await response.json();if(!response.ok)throw Object.assign(Error(body.error),{status:response.status});return body;};
    const session=await recoverWorkerEntry(pending,request);assert.equal(session.workerId,'worker-1');assert.equal(session.language,'en');
    assert.ok(calls.every(call=>call.method==='GET'));assert.deepEqual(calls.map(call=>call.path),['/session','/auth/worker/redemption','/session']);
    assert.equal(await f.snapshot(),before);assert.equal(redemptions,1);assert.equal(logouts,0);
    const headers={cookie,'x-client-session-context':session.clientContext,'x-worker-grant-digest':pending.digest};
    const found=await fetch(base+'/auth/worker/redemption',{headers});assert.equal(found.status,200);assert.equal(found.headers.get('cache-control'),'no-store');assert.deepEqual(await found.json(),{matches:true,clientContext:session.clientContext});
    const mismatch=await fetch(base+'/auth/worker/redemption',{headers:{...headers,'x-worker-grant-digest':tokenHash(other.token)}});assert.deepEqual(await mismatch.json(),{matches:false});
    assert.equal((await fetch(base+'/auth/worker/redemption',{headers:{'x-worker-grant-digest':pending.digest}})).status,401);
    assert.equal((await fetch(base+'/auth/worker/redemption',{headers:{...headers,'x-client-session-context':'0'.repeat(64)}})).status,409);
    for(const [suffix,extra] of [['?site_id=foreign',{}],['',{'x-worker-grant-digest':'invalid'}],['',{'x-client-session-context':undefined}]]){
      const invalid={...headers,...extra};for(const key of Object.keys(invalid))if(invalid[key]===undefined)delete invalid[key];
      assert.equal((await fetch(base+'/auth/worker/redemption'+suffix,{headers:invalid})).status,400);
    }
    assert.equal(await f.snapshot(),before);assert.equal(redemptions,1);assert.equal(logouts,0);
    beforeCommit=true;
    const rejected=await fetch(base+'/auth/worker/redeem',{method:'POST',headers:{origin,'content-type':'application/json',cookie},body:JSON.stringify({token:other.token,company:'cedar',workerId:'Worker 002',password})});assert.equal(rejected.status,503);
    assert.equal(await recoverWorkerEntry(await prepareWorkerEntry(other.token,'en'),request),null);
    assert.equal(await f.snapshot(),before);assert.equal(redemptions,2);assert.equal(logouts,0);
    if(postgres){f.setFail(true);const failed=await fetch(base+'/auth/worker/redemption',{headers});assert.equal(failed.status,503);assert.doesNotMatch(JSON.stringify(await failed.json()),/PRIVATE_DATABASE_DETAIL/);f.setFail(false);}
    const direct=postgres?(digest,actor)=>pgRead(f.pool,actor,digest,{schema:f.schema}):(digest,actor)=>readWorkerRedemption(f.db,actor,digest);
    await assert.rejects(async()=>direct(pending.digest,owner),/Forbidden/);
    const current=postgres?await pgAuth.requireSession(f.pool,{headers:{cookie}}, {schema:f.schema,cookieName:'understood_pg_rehearsal'}):sqliteAuth.requireSession(f.db,{headers:{cookie}}, {accessMode:'credential'});
    assert.deepEqual(await direct(pending.digest,{...current,principal_id:'worker-2'}),{matches:false});
    const update=async(sql,args)=>postgres?f.db.query(sql.replaceAll('?',(()=>{let n=0;return()=>`$${++n}`;})()),args):f.db.prepare(sql).run(...args);
    for(const [table,key,value,column,old] of [['sessions','token_hash',current.token_hash,'expires_at',current.expires_at],['worker_grants','id',grant.id,'expires_at',grant.expiresAt]]){
      await update(`UPDATE ${table} SET ${column}=? WHERE ${key}=?`,['1970-01-01T00:00:00.000Z',value]);assert.equal((await fetch(base+'/auth/worker/redemption',{headers})).status,401);
      await update(`UPDATE ${table} SET ${column}=? WHERE ${key}=?`,[old,value]);
    }
    await update("INSERT INTO site_access_controls(site_id,org_id,revision,state,reason,updated_at) VALUES(?,?,1,'paused','Synthetic test pause','2026-10-12T00:00:00.000Z')",['beirut','cedar']);
    assert.equal((await fetch(base+'/auth/worker/redemption',{headers})).status,403);
    await update("UPDATE site_access_controls SET state='active' WHERE site_id=?",['beirut']);
    if(postgres){await f.db.query("INSERT INTO tenant_controls(org_id,state,revision,reason) VALUES('cedar','suspended',1,'maintenance')");assert.equal((await fetch(base+'/auth/worker/redemption',{headers})).status,403);await f.db.query("UPDATE tenant_controls SET state='active' WHERE org_id='cedar'");}
    if(postgres)await f.db.query('UPDATE workers SET active=false WHERE id=$1',['worker-1']);else f.db.prepare('UPDATE workers SET active=0 WHERE id=?').run('worker-1');
    assert.equal((await fetch(base+'/auth/worker/redemption',{headers})).status,401);
  }finally{await new Promise(resolve=>f.server.close(resolve));await f.close();}
});
test('worker entry tab recovery stores no token and rejects altered, expired, ambiguous or unavailable storage',async()=>{
  const rows=new Map(),storage={getItem:key=>rows.get(key)??null,setItem:(key,value)=>rows.set(key,value),removeItem:key=>rows.delete(key)},now=Date.now(),token='x'.repeat(43);
  const pending=await prepareWorkerEntry(token,'ar',now);assert.equal(pending.digest,tokenHash(token));
  savePendingWorkerEntry(storage,pending,now);assert.equal(rows.size,1);assert.doesNotMatch(rows.get(workerEntryKey),new RegExp(token));assert.deepEqual(readPendingWorkerEntry(storage,now),pending);
  assert.throws(()=>savePendingWorkerEntry(storage,{...pending,language:'ur'},now),/Another/);
  assert.throws(()=>readPendingWorkerEntry(storage,now+24*3600_000+1),/unavailable/);
  assert.throws(()=>clearPendingWorkerEntry(storage,{...pending,digest:'0'.repeat(64)}),/changed/);
  clearPendingWorkerEntry(storage,pending);assert.equal(readPendingWorkerEntry(storage),null);
  for(const value of [{...pending,token},{...pending,version:2},{...pending,digest:'bad'},{...pending,createdAt:'not a date'}]){rows.set(workerEntryKey,JSON.stringify(value));assert.throws(()=>readPendingWorkerEntry(storage,now),/unavailable/);}
  await assert.rejects(prepareWorkerEntry('bad','en'),/Invalid/);rows.clear();
  assert.throws(()=>savePendingWorkerEntry({...storage,setItem(){}},pending,now),/could not be saved/);
});
test('client recovery never opens unrelated, missing, expired or changed sessions and uses no writes',async()=>{
  const pending=await prepareWorkerEntry('x'.repeat(43),'en'),session={authenticated:true,role:'worker',clientContext:'a'.repeat(64),workerId:'worker-1',language:'en',mode:'synthetic-credential',expiresAt:new Date(Date.now()+60000).toISOString()};
  for(const initial of [{authenticated:false},{authenticated:true,role:'staff'}])assert.equal(await recoverWorkerEntry(pending,async()=>initial),null);
  for(const proof of [{matches:true,clientContext:'b'.repeat(64)},{matches:true,clientContext:session.clientContext,token:'secret'},null,{matches:'true'}]){
    await assert.rejects(recoverWorkerEntry(pending,async path=>path==='/session'?session:proof));
  }
  let reads=0;await assert.rejects(recoverWorkerEntry(pending,async path=>path==='/session'?(++reads===1?session:{...session,workerId:'other'}):{matches:true,clientContext:session.clientContext}),/changed/);
  assert.equal(await recoverWorkerEntry(pending,async path=>path==='/session'?session:{matches:false}),null);
  await assert.rejects(recoverWorkerEntry(pending,async()=>({...session,expiresAt:new Date(0).toISOString()})),/could not be checked/);
});

test('worker access recovery has complete copy for every worker UI language',()=>{
  assertWorkerDictionary(workerEntryRecoveryText,'workerEntryRecoveryText');
});
