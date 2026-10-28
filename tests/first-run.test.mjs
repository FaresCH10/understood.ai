import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {openDatabase} from '../server/db.mjs';
import {seed} from '../server/seed.mjs';
import {ensureSettingsSchema} from '../server/settings.mjs';
import {getFirstRun,completeFirstRun} from '../server/first-run.mjs';
import {getFirstRun as pgGetFirstRun,completeFirstRun as pgCompleteFirstRun} from '../server/postgres/first-run.mjs';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {firstRunBody,checkedFirstRunState,checkedFirstRunResult,suggestedTimezone,browserTimezone} from '../src/first-run.ts';
import {verificationToken,readRegistrationReceipt,saveRegistrationReceipt,clearRegistrationReceipt,checkedVerification,RegistrationError} from '../src/registration.ts';

const input=(override={})=>({requestId:randomUUID(),siteName:'Main site',timezone:'Asia/Beirut',staffInterfaceLanguage:'ar',confirmed:true,...override});

test('client first-run input trims and rejects unsafe or invalid values',()=>{
  assert.deepEqual(firstRunBody({requestId:'3f2504e0-4f89-41d3-9a0c-0305e82c3301',siteName:'  Main site  ',timezone:'Asia/Beirut',staffInterfaceLanguage:'en'}),
    {requestId:'3f2504e0-4f89-41d3-9a0c-0305e82c3301',siteName:'Main site',timezone:'Asia/Beirut',staffInterfaceLanguage:'en',confirmed:true});
  for(const patch of [{siteName:'x'},{siteName:'bad\nname'},{timezone:'Mars/Base'},{timezone:''},{staffInterfaceLanguage:'ur'},{requestId:'not-a-uuid'}])
    assert.throws(()=>firstRunBody({requestId:'3f2504e0-4f89-41d3-9a0c-0305e82c3301',siteName:'Main site',timezone:'UTC',staffInterfaceLanguage:'en',...patch}),/Check the site name/);
  assert.throws(()=>checkedFirstRunState({completed:false,revision:-1,site:{id:'s',name:'n',timezone:'UTC'},staffInterfaceLanguage:'en'}),/could not be read/);
  assert.throws(()=>checkedFirstRunResult({completed:true,duplicate:false,revision:1}),/could not be confirmed/);
  assert.equal(checkedFirstRunResult({completed:true,duplicate:true,revision:2,staffInterfaceLanguage:'ar'}).duplicate,true);
  assert.match(suggestedTimezone('UTC'),/^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)+$/);assert.equal(suggestedTimezone('Asia/Beirut'),'Asia/Beirut');
  assert.match(browserTimezone(),/\S/);
});

test('client registration receipt and verification response validation',()=>{
  const values=new Map();const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  const receipt={requestId:'3f2504e0-4f89-41d3-9a0c-0305e82c3301',email:'owner@example.test',createdAt:new Date().toISOString(),state:'pending'};
  saveRegistrationReceipt(storage,receipt);assert.deepEqual(readRegistrationReceipt(storage),receipt);
  values.set('understood:registration-receipt','{"requestId":"bad"}');assert.equal(readRegistrationReceipt(storage),null);
  clearRegistrationReceipt(storage);assert.equal(readRegistrationReceipt(storage),null);
  assert.equal(verificationToken(`#verify-registration/${'a'.repeat(43)}`),'a'.repeat(43));
  for(const value of [`#verify-registration/${'a'.repeat(42)}`,`?token=${'a'.repeat(43)}`,`#verify-registration/${'a'.repeat(43)}/x`,'#reset-password/'+'a'.repeat(43)])assert.equal(verificationToken(value),'');
  assert.deepEqual(checkedVerification({completed:true,signInRequired:true,duplicate:false}),{completed:true,signInRequired:true,duplicate:false});
  for(const value of [{completed:true,signInRequired:false,duplicate:false},{completed:true,signInRequired:true},{completed:false,signInRequired:true,duplicate:false},null])assert.throws(()=>checkedVerification(value),RegistrationError);
});

test('SQLite first-run onboarding is owner-only, idempotent and persisted once',()=>{
  const db=openDatabase(':memory:');seed(db);ensureSettingsSchema(db);
  try {
    db.prepare("INSERT INTO sites(id,org_id,name,timezone) VALUES('new-site','cedar','Pending site','UTC')").run();
    db.prepare("INSERT INTO staff(id,org_id,site_id,name,role,active) VALUES('new-owner','cedar','new-site','New Owner','owner',1)").run();
    db.prepare("INSERT INTO staff(id,org_id,site_id,name,role,active) VALUES('new-supervisor','cedar','new-site','New Supervisor','supervisor',1)").run();
    db.prepare("INSERT INTO site_settings(site_id,org_id,revision) VALUES('new-site','cedar',0)").run();
    const session={principal_type:'staff',principal_id:'new-owner',org_id:'cedar',site_id:'new-site',role:'owner'};
    assert.deepEqual(getFirstRun(db,session),{completed:false,revision:0,site:{id:'new-site',name:'Pending site',timezone:'UTC'},staffInterfaceLanguage:'en'});
    const value=input();
    assert.deepEqual(completeFirstRun(db,session,value),{completed:true,duplicate:false,revision:1,site:{id:'new-site',name:'Main site',timezone:'Asia/Beirut'},staffInterfaceLanguage:'ar'});
    assert.deepEqual(getFirstRun(db,session),{completed:true,revision:1,site:{id:'new-site',name:'Main site',timezone:'Asia/Beirut'},staffInterfaceLanguage:'ar'});
    assert.deepEqual(completeFirstRun(db,session,{...value,requestId:randomUUID()}),{completed:true,duplicate:true,revision:1,staffInterfaceLanguage:'ar'});
    assert.throws(()=>completeFirstRun(db,session,{...value,timezone:'Europe/London'}),/Onboarding already completed/);
    assert.equal(db.prepare("SELECT count(*) AS n FROM audit WHERE action='onboarding.first_run_completed'").get().n,1);
    assert.throws(()=>getFirstRun(db,{...session,principal_id:'new-supervisor',role:'supervisor'}),/Forbidden/);
    assert.throws(()=>getFirstRun(db,{...session,site_id:'beirut'}),/Forbidden/);
    for(const patch of [{confirmed:false},{timezone:'Mars/Base'},{staffInterfaceLanguage:'ur'},{siteName:'x'},{extra:true}])
      assert.throws(()=>completeFirstRun(db,session,{...input(),...patch}),/Invalid onboarding input/);
    const seeded={principal_type:'staff',principal_id:'maya',org_id:'cedar',site_id:'beirut',role:'owner'};
    assert.equal(getFirstRun(db,seeded).completed,true);
    assert.throws(()=>completeFirstRun(db,seeded,input()),/Onboarding already completed/);
  }finally {db.close();}
});

test('PostgreSQL first-run onboarding matches SQLite and rejects forged scope',async()=>{
  const schema='understood_test_first_run';let queue=Promise.resolve();
  const db=new PGlite();
  const pool={async connect(){const previous=queue;let release;queue=new Promise(done=>{release=done;});await previous;
    return {release,async query(sql,values){return values?.length ? db.query(sql,values) : (await db.exec(sql)).at(-1) || {rows:[]};}};}};
  try {
    await db.exec(`CREATE SCHEMA ${schema};SET search_path TO ${schema},pg_catalog`);await runMigrations(pool,{schema});
    const orgId=randomUUID(),siteId=randomUUID(),ownerId=randomUUID(),supervisorId=randomUUID();
    await db.query('INSERT INTO organizations(id,name) VALUES($1,$2)',[orgId,'First-run company']);
    await db.query('INSERT INTO sites(id,org_id,name,timezone) VALUES($1,$2,$3,$4)',[siteId,orgId,'Pending site','UTC']);
    await db.query("INSERT INTO staff(id,org_id,site_id,name,role) VALUES($1,$2,$3,$4,'owner')",[ownerId,orgId,siteId,'New Owner']);
    await db.query("INSERT INTO staff(id,org_id,site_id,name,role) VALUES($1,$2,$3,$4,'supervisor')",[supervisorId,orgId,siteId,'New Supervisor']);
    await db.query('INSERT INTO site_settings(site_id,org_id,revision) VALUES($1,$2,0)',[siteId,orgId]);
    const session={principal_type:'staff',principal_id:ownerId,org_id:orgId,site_id:siteId,role:'owner'};
    assert.deepEqual(await pgGetFirstRun(pool,session,{schema}),{completed:false,revision:0,site:{id:siteId,name:'Pending site',timezone:'UTC'},staffInterfaceLanguage:'en'});
    const value=input();
    assert.deepEqual(await pgCompleteFirstRun(pool,session,value,{schema}),{completed:true,duplicate:false,revision:1,site:{id:siteId,name:'Main site',timezone:'Asia/Beirut'},staffInterfaceLanguage:'ar'});
    assert.deepEqual(await pgGetFirstRun(pool,session,{schema}),{completed:true,revision:1,site:{id:siteId,name:'Main site',timezone:'Asia/Beirut'},staffInterfaceLanguage:'ar'});
    assert.deepEqual(await pgCompleteFirstRun(pool,session,{...value,requestId:randomUUID()},{schema}),{completed:true,duplicate:true,revision:1,staffInterfaceLanguage:'ar'});
    await assert.rejects(()=>pgCompleteFirstRun(pool,session,{...value,timezone:'Europe/London'},{schema}),/Onboarding already completed/);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM audit WHERE action='onboarding.first_run_completed'")).rows[0].n,1);
    await assert.rejects(()=>pgGetFirstRun(pool,{...session,principal_id:supervisorId,role:'supervisor'},{schema}),/Forbidden/);
    for(const patch of [{confirmed:false},{timezone:'Mars/Base'},{staffInterfaceLanguage:'ur'},{siteName:'x'},{extra:true}])
      await assert.rejects(async()=>pgCompleteFirstRun(pool,{...session,site_id:randomUUID()},{...input(),...patch},{schema}),/Invalid onboarding input/);
  }finally {await db.close();}
});

test('Neon receipts retain verification method and codes accept Arabic digits with leading zeroes',async()=>{
 const {normalizeVerificationCode,readRegistrationReceipt}=await import('../src/registration.ts');
 assert.equal(normalizeVerificationCode('٠٠١٢٣٤'),'001234');assert.equal(normalizeVerificationCode('۰۰۱۲۳۴'),'001234');
 const receipt={requestId:'11111111-1111-4111-8111-111111111111',email:'test@example.test',createdAt:new Date().toISOString(),state:'accepted',verification:'neon-code'};
 assert.deepEqual(readRegistrationReceipt({getItem:()=>JSON.stringify(receipt)}),receipt);
 assert.equal(readRegistrationReceipt({getItem:()=>JSON.stringify({...receipt,verification:'skip'})}),null);
});
