import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {PGlite} from '@electric-sql/pglite';
import {openDatabase} from '../server/db.mjs';
import {seed} from '../server/seed.mjs';
import {listStaff,changeStaff,staffReceipt} from '../server/staff.mjs';
import {staffFilters,staffChangeInput} from '../server/staff-input.mjs';
import {getSettings,updateSettings,ensureSettingsSchema} from '../server/settings.mjs';
import {createSession,requireSession,provisionStaffCredential as sqliteCredential} from '../server/auth.mjs';
import {upgradeStaffRoles} from '../server/staff-schema.mjs';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {listStaff as pgList,changeStaff as pgChange,staffReceipt as pgReceipt} from '../server/postgres/staff.mjs';
import {getSettings as pgSettings,updateSettings as pgUpdateSettings} from '../server/postgres/settings.mjs';
import {provisionStaffCredential,authenticateStaff,requireSession as pgSession} from '../server/postgres/auth.mjs';
import {createAppServer} from '../server/index.mjs';
import {createPostgresRehearsalServer} from '../server/postgres/http.mjs';
const owner={principal_type:'staff',principal_id:'maya',org_id:'cedar',site_id:'beirut',role:'owner'};
const admin={...owner,principal_id:'admin',role:'administrator'},reader={...owner,principal_id:'reader',role:'auditor'};
const input=(revision=1,role)=>({requestId:randomUUID(),revision,confirmed:true,...(role ? {role} : {})});
async function fixture(pg) {
  if(!pg) {
    const db=openDatabase(':memory:');seed(db);ensureSettingsSchema(db);
    for(const [id,role] of [['admin','administrator'],['reader','auditor'],['rami','supervisor']]) db.prepare('INSERT INTO staff VALUES(?,?,?,?,?,1)').run(id,'cedar','beirut',id,role);
    db.prepare("INSERT INTO sites VALUES('tripoli','cedar','Tripoli','UTC')").run();db.prepare("INSERT INTO staff VALUES('other-site','cedar','tripoli','Other site owner','owner',1)").run();
    return {db,list:(s,f)=>listStaff(db,s,f),change:(s,id,a,v)=>changeStaff(db,s,id,a,v),receipt:(s,id)=>staffReceipt(db,s,id),settings:s=>getSettings(db,s),site:(s,k,v)=>updateSettings(db,s,k,v),
      sql:async(sql,v=[])=>({rows:db.prepare(sql).all(...v)}),fail(){db.exec("CREATE TRIGGER staff_test_fail BEFORE INSERT ON audit WHEN NEW.action LIKE 'staff.%' BEGIN SELECT RAISE(ABORT,'Injected failure'); END");},reset(){db.exec('DROP TRIGGER staff_test_fail');},close:async()=>db.close()};
  }
  const db=new PGlite(),options={schema:'understood_test_staff'};let fail=false,lost=false;
  const pool={async connect(){return {async query(sql,v){if(fail && sql.includes('INSERT INTO audit')) throw new Error('Injected failure');const result=v?.length ? await db.query(sql,v) : (await db.exec(sql)).at(-1) || {rows:[]};if(lost && sql==='COMMIT'){lost=false;throw new Error('Lost commit receipt');}return result;},release(){}};}};
  await db.exec(`CREATE SCHEMA ${options.schema}; SET search_path TO ${options.schema},pg_catalog`);await runMigrations(pool,options);
  await db.exec("INSERT INTO organizations VALUES('cedar','Cedar Works'),('harbor','Harbor'); INSERT INTO sites VALUES('beirut','cedar','Beirut','Asia/Beirut'),('tripoli','cedar','Tripoli','UTC'),('harbor-yard','harbor','Harbor','UTC'); INSERT INTO staff(id,org_id,site_id,name,role) VALUES('maya','cedar','beirut','Maya','owner'),('admin','cedar','beirut','admin','administrator'),('reader','cedar','beirut','reader','auditor'),('rami','cedar','beirut','rami','supervisor'),('other-site','cedar','tripoli','Other site owner','owner'),('harbor-owner','harbor','harbor-yard','Foreign owner','owner')");
  return {db,pool,options,list:(s,f)=>pgList(pool,s,f,options),change:(s,id,a,v)=>pgChange(pool,s,id,a,v,options),receipt:(s,id)=>pgReceipt(pool,s,id,options),settings:s=>pgSettings(pool,s,options),site:(s,k,v)=>pgUpdateSettings(pool,s,k,v,options),sql:(sql,v)=>db.query(sql,v),fail(){fail=true;},reset(){fail=false;},lose(){lost=true;},close:()=>db.close()};
}
test('staff input rejects forged fields, unsupported roles, confirmation omissions and unbounded filters',()=>{
  for(const patch of [{confirmed:false},{org_id:'foreign'},{revision:0},{revision:'1'},{role:'translator'},{requestId:'bad'},{requestId:[randomUUID()]}]) assert.throws(()=>staffChangeInput('role',{...input(1,'auditor'),...patch}),/Invalid/);
  assert.throws(()=>staffChangeInput('revoke',input(1,'owner')),/Invalid/);
  for(const f of [{page:0},{pageSize:51},{status:'disabled'},{role:'translator'},{search:'a\n'},{site:'foreign'}]) assert.throws(()=>staffFilters(f),/Invalid/);
});
for(const pg of [false,true]) test(`${pg ? 'PostgreSQL' : 'SQLite'} staff permissions, last owner, revocation, replay and audit rollback`,async()=>{
  const f=await fixture(pg);
  try {
    const initial=await f.list(owner);assert.equal(initial.total,4);assert.equal(initial.activeOwners,1);assert.equal((await f.list(reader)).canWrite,false);
    for(const s of [{...owner,principal_type:'worker'},{...owner,principal_id:'rami',role:'supervisor'},{...owner,site_id:'tripoli'},{...owner,role:'administrator'}]) await assert.rejects(async()=>f.list(s),/Forbidden/);
    await assert.rejects(async()=>f.change(owner,'other-site','revoke',input()),/unavailable/);await assert.rejects(async()=>f.change(owner,'harbor-owner','role',input(1,'auditor')),/unavailable/);
    for(const [id,action,v] of [['maya','role',input(1,'auditor')],['maya','revoke',input()]]) await assert.rejects(async()=>f.change(owner,id,action,v),/Last active site owner/);
    for(const [id,role] of [['maya','auditor'],['admin','auditor'],['rami','owner'],['rami','administrator']]) await assert.rejects(async()=>f.change(admin,id,'role',input(1,role)),/Forbidden/);
    await assert.rejects(async()=>f.change(reader,'rami','revoke',input()),/Forbidden/);
    const value=input(1,'auditor');f.fail();await assert.rejects(async()=>f.change(owner,'rami','role',value),/Injected/);f.reset();assert.equal((await f.list(owner,{search:'rami'})).items[0].revision,1);assert.equal((await f.receipt(owner,value.requestId)).accepted,false);
    if(pg) {f.lose();await assert.rejects(f.change(owner,'rami','role',value),/Lost commit/);}else await f.change(owner,'rami','role',value);
    assert.equal((await f.change(owner,'rami','role',value)).duplicate,true);assert.equal((await f.receipt(owner,value.requestId)).result.role,'auditor');assert.equal((await f.receipt(admin,value.requestId)).accepted,false);
    await assert.rejects(async()=>f.change(owner,'rami','role',{...value,role:'supervisor'}),/conflict/);await assert.rejects(async()=>f.change(owner,'rami','role',input(1,'supervisor')),/revision changed/);
    await f.change(admin,'rami','revoke',input(2));assert.equal((await f.list(owner,{status:'revoked'})).items[0].revision,3);
    await assert.rejects(async()=>f.change(owner,'rami','role',input(3,'owner')),/revoked/);
    await f.change(admin,'rami','restore',input(3));await f.change(owner,'rami','role',input(4,'owner'));
    await f.change(owner,'rami','role',input(5,'supervisor'));assert.equal((await f.change(owner,'rami','role',value)).revision,2,'Replay reports the accepted result, not later state');
    assert.equal((await f.sql("SELECT COUNT(*) n FROM staff_access_requests")).rows[0].n,5);
    await assert.rejects(f.sql("UPDATE staff_access_requests SET action='role'"),/immutable/);await assert.rejects(f.sql('DELETE FROM staff_access_requests'),/immutable/);
    await assert.rejects(f.sql("UPDATE staff SET site_id='tripoli' WHERE id='rami'"),/immutable/);
    const settings=await f.settings(admin);assert.equal(settings.canWrite,false);assert.equal(settings.canWriteSite,true);
    await assert.rejects(async()=>f.site(admin,'organization',{requestId:randomUUID(),revision:0,name:'Forbidden organization',supportEmail:'',confirmed:true}),/Forbidden/);
    await f.site(admin,'site',{requestId:randomUUID(),revision:0,name:'Updated assigned site',timezone:'UTC',confirmed:true});assert.equal((await f.settings(owner)).site.name,'Updated assigned site');
    const rami={...owner,principal_id:'rami',role:'supervisor'};
    let token;
    if(pg) {await provisionStaffCredential(f.pool,{staffId:'rami',orgId:'cedar',siteId:'beirut',email:'rami@example.test',password:'Synthetic-staff-password'},f.options);token=(await authenticateStaff(f.pool,'rami@example.test','Synthetic-staff-password','qa',f.options)).session.token;await pgSession(f.pool,{headers:{cookie:`understood_session=${token}`}},f.options);}
    else {sqliteCredential(f.db,'rami','rami@example.test','Synthetic-staff-password');token=createSession(f.db,{id:'rami',org_id:'cedar',site_id:'beirut'},'staff','credential').token;requireSession(f.db,{headers:{cookie:`understood_session=${token}`}},{accessMode:'credential'});}
    await f.change(owner,'rami','revoke',input(6));await f.change(owner,'rami','restore',input(7));
    if(pg) await assert.rejects(pgSession(f.pool,{headers:{cookie:`understood_session=${token}`}},f.options),/Sign in required/);
    else assert.throws(()=>requireSession(f.db,{headers:{cookie:`understood_session=${token}`}},{accessMode:'credential'}),/Sign in required/);
    await f.change(owner,'rami','role',input(8,'owner'));await f.change(owner,'maya','revoke',input());
    await assert.rejects(async()=>f.list(owner),/Forbidden/);await assert.rejects(async()=>f.change({...rami,role:'owner'},'rami','revoke',input(9)),/Last active site owner/);
    assert.ok(!JSON.stringify(initial).match(/password|token_hash|email|request_json|org_id|site_id/));
  } finally {await f.close();}
});
for(const pg of [false,true]) test(`${pg ? 'PostgreSQL' : 'SQLite'} credential HTTP protects staff scope and administrator content boundaries`,async()=>{
  const f=await fixture(pg),config={tier:'local',aiMode:'synthetic',accessMode:'credential',dataClass:'synthetic',publicOrigin:'http://127.0.0.1:3020',...(pg ? {schema:f.options.schema} : {})};
  for(const id of ['maya','admin','reader','rami']) {const email=`${id}@example.test`,password='Synthetic-staff-password';if(pg) await provisionStaffCredential(f.pool,{staffId:id,orgId:'cedar',siteId:'beirut',email,password},f.options);else sqliteCredential(f.db,id,email,password);}
  const server=pg ? createPostgresRehearsalServer(f.pool,config) : createAppServer(f.db,config);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const contexts=new Map();
  const call=(path,cookie,body,origin=config.publicOrigin,context=contexts.get(cookie))=>fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{method:body ? 'POST' : 'GET',headers:{origin,'content-type':'application/json',...(cookie ? {cookie} : {}),...(context ? {'x-client-session-context':context} : {})},body:body ? JSON.stringify(body) : undefined});
  const login=async id=>{const cookie=(await call('/auth/staff/login',null,{email:`${id}@example.test`,password:'Synthetic-staff-password'})).headers.get('set-cookie').split(';')[0];contexts.set(cookie,(await (await call('/session',cookie)).json()).clientContext);return cookie;};
  try {
    const a=await login('admin'),o=await login('maya'),s=await login('rami'),r=await login('reader');
    const before=(await f.sql('SELECT COUNT(*) n FROM staff_access_requests')).rows[0].n;
    for(const context of [null,'bad',contexts.get(o)]) {
      assert.equal((await call('/settings/staff',a,undefined,config.publicOrigin,context)).status,409);
      assert.equal((await call('/settings/staff/rami/revoke',a,input(),config.publicOrigin,context)).status,409);
      assert.equal((await call('/settings/staff/receipts/'+randomUUID(),a,undefined,config.publicOrigin,context)).status,409);
    }
    const rotated=await login('admin');
    assert.equal((await call('/settings/staff/rami/revoke',rotated,input(),config.publicOrigin,contexts.get(a))).status,409);
    assert.equal((await f.sql('SELECT COUNT(*) n FROM staff_access_requests')).rows[0].n,before);
    assert.equal((await call('/settings/staff')).status,401);assert.equal((await call('/settings/staff',s)).status,403);assert.equal((await call('/settings/staff',r)).status,200);
    assert.equal((await (await call('/session',a)).json()).staffRole,'administrator');
    assert.equal((await call('/recordings/missing/audio',a)).status,403);assert.equal((await call('/recordings/missing/audio',r)).status,403);
    assert.equal((await call('/audit',a)).status,404);
    for(const path of ['/overview','/briefings','/processing','/reports','/invoices','/people/workers','/glossary','/templates']) assert.equal((await call(path,a)).status,403,path);
    assert.equal((await call('/settings/staff/maya/revoke',a,input())).status,403);assert.equal((await call('/settings/staff/maya/revoke',o,input())).status,409);
    assert.equal((await call('/settings/staff/other-site/revoke',o,input())).status,404);assert.equal((await call('/settings/staff/rami/revoke',o,input(),'https://foreign.test')).status,403);
    const request=input();assert.equal((await call('/settings/staff/rami/revoke',a,request)).status,200);assert.equal((await (await call('/settings/staff/receipts/'+request.requestId,a)).json()).accepted,true);
    assert.equal((await call('/settings/staff/rami/revoke',a,request)).status,200);assert.equal((await (await call('/session',s)).json()).authenticated,false);
    assert.equal((await call('/settings/staff?org_id=foreign',o)).status,400);assert.equal((await call('/settings/staff/rami/restore?site=foreign',o,input(2))).status,400);
  } finally {await new Promise(resolve=>server.close(resolve));await f.close();}
});
test('legacy SQLite staff-role upgrade preserves dependent rows, triggers, indexes, views and native backup',()=>{
  const dir=mkdtempSync(join(tmpdir(),'understood-staff-upgrade-')),path=join(dir,'legacy.sqlite');const db=new DatabaseSync(path);
  try {
    db.exec("PRAGMA foreign_keys=ON; CREATE TABLE organizations(id TEXT PRIMARY KEY) STRICT; CREATE TABLE sites(id TEXT PRIMARY KEY,org_id TEXT REFERENCES organizations(id)) STRICT; CREATE TABLE staff(id TEXT PRIMARY KEY,org_id TEXT NOT NULL REFERENCES organizations(id),site_id TEXT NOT NULL REFERENCES sites(id),name TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('owner','supervisor','auditor')),active INTEGER NOT NULL DEFAULT 1) STRICT; CREATE TABLE evidence(id TEXT PRIMARY KEY,staff_id TEXT REFERENCES staff(id),payload TEXT) STRICT; CREATE TRIGGER freeze_evidence BEFORE DELETE ON evidence BEGIN SELECT RAISE(ABORT,'immutable'); END; CREATE VIEW staff_names AS SELECT id,name FROM staff; CREATE INDEX staff_names_index ON staff(name); INSERT INTO organizations VALUES('a'); INSERT INTO sites VALUES('a','a'); INSERT INTO staff VALUES('a','a','a','Saved owner','owner',1); INSERT INTO evidence VALUES('e','a','saved evidence');");
    const before=db.prepare('SELECT * FROM staff').all();upgradeStaffRoles(db,path);assert.deepEqual(db.prepare('SELECT * FROM staff').all(),before);assert.equal(db.prepare('SELECT * FROM staff_names').get().name,'Saved owner');assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys,1);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
    assert.throws(()=>db.exec('DELETE FROM evidence'),/immutable/);db.exec("INSERT INTO staff VALUES('admin','a','a','Admin','administrator',1)");
    const backups=readdirSync(dir).filter(name=>name.includes('.staff-roles-'));assert.equal(backups.length,1);const snapshot=new DatabaseSync(join(dir,backups[0]),{readOnly:true});try {assert.deepEqual(snapshot.prepare('SELECT * FROM staff').all(),before);assert.equal(snapshot.prepare('SELECT payload FROM evidence').get().payload,'saved evidence');}finally {snapshot.close();}
    upgradeStaffRoles(db,path);assert.equal(readdirSync(dir).filter(name=>name.includes('.staff-roles-')).length,1);
  } finally {db.close();if(resolve(dir).startsWith(resolve(tmpdir())+'\\understood-staff-upgrade-')) rmSync(dir,{recursive:true,force:true});}
});
for(const pg of [false,true]) test(`${pg ? 'PostgreSQL' : 'SQLite'} staff directory paging and literal filters are bounded`,async()=>{
  const f=await fixture(pg);
  try {
    for(let n=0;n<14;n++) {const id=`paged-${n}`,name=n===0 ? 'Literal %_ staff' : `Paged ${String(n).padStart(2,'0')}`;await f.sql(pg ? "INSERT INTO staff(id,org_id,site_id,name,role) VALUES($1,'cedar','beirut',$2,'supervisor')" : "INSERT INTO staff VALUES(?,'cedar','beirut',?,'supervisor',1)",[id,name]);}
    const all=await f.list(owner,{page:4,pageSize:5});assert.equal(all.total,18);assert.equal(all.items.length,3);assert.equal((await f.list(owner,{search:'%_'})).total,1);assert.equal((await f.list(owner,{role:'owner'})).total,1);
    assert.equal((await f.list(owner,{page:5,pageSize:5})).items.length,0);
  } finally {await f.close();}
});
test('failed SQLite role upgrade rolls back dependent schema and restores foreign-key enforcement',()=>{
  const db=new DatabaseSync(':memory:');
  try {
    db.exec("PRAGMA foreign_keys=ON; CREATE TABLE organizations(id TEXT PRIMARY KEY); CREATE TABLE sites(id TEXT PRIMARY KEY,org_id TEXT REFERENCES organizations(id)); CREATE TABLE staff(id TEXT PRIMARY KEY,org_id TEXT NOT NULL REFERENCES organizations(id),site_id TEXT NOT NULL REFERENCES sites(id),name TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('owner','supervisor','auditor')),active INTEGER NOT NULL DEFAULT 1); CREATE TRIGGER protect_staff_delete BEFORE DELETE ON staff BEGIN SELECT RAISE(ABORT,'retained trigger'); END; INSERT INTO organizations VALUES('a'); INSERT INTO sites VALUES('a','a'); PRAGMA ignore_check_constraints=ON; INSERT INTO staff VALUES('a','a','a','Bad legacy role','legacy',1); PRAGMA ignore_check_constraints=OFF;");
    assert.throws(()=>upgradeStaffRoles(db,':memory:'),/CHECK constraint failed/);assert.equal(db.prepare('SELECT role FROM staff').get().role,'legacy');assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys,1);assert.throws(()=>db.exec('DELETE FROM staff'),/retained trigger/);assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name='staff_role_upgrade'").get(),undefined);
  } finally {db.close();}
});
