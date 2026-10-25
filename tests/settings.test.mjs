import test from 'node:test';
import {createSessionContextFetch} from './helpers/session-http.mjs';
const fetch=createSessionContextFetch();
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {openDatabase} from '../server/db.mjs';
import {seed} from '../server/seed.mjs';
import {ensureSettingsSchema,getSettings,updateSettings,settingsReceipt,listSiteContacts} from '../server/settings.mjs';
import {settingsInput} from '../server/settings-input.mjs';
import {ensureBillingSchema,createInvoice,getInvoice} from '../server/billing.mjs';
import {getSettings as pgGet,updateSettings as pgUpdate,settingsReceipt as pgReceipt,listSiteContacts as pgContacts} from '../server/postgres/settings.mjs';
import {createInvoice as pgInvoice,getInvoice as pgInvoiceGet} from '../server/postgres/billing.mjs';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {createAppServer} from '../server/index.mjs';
import {createPostgresRehearsalServer} from '../server/postgres/http.mjs';
import {provisionStaffCredential} from '../server/postgres/auth.mjs';
import {createDraft,queuePreparation} from '../server/preparation.mjs';
import {WORKER_LANGUAGE_CODES} from '../server/languages.mjs';
import {processOne} from '../server/worker.mjs';
import {createDraft as pgDraft,queuePreparation as pgQueue,processOnePreparation as pgProcess} from '../server/postgres/preparation.mjs';
import {CANONICAL_SOURCE} from '../server/domain.mjs';
import {checkedSettingsReceipt} from '../src/workspace-settings-state.ts';
const owner={principal_type:'staff',principal_id:'maya',org_id:'cedar',site_id:'beirut',role:'owner'};
const orgInput=()=>({requestId:randomUUID(),revision:0,name:'Updated Synthetic Organization',supportEmail:'support@example.test',confirmed:true});
const siteInput=()=>({requestId:randomUUID(),revision:0,name:'Updated Synthetic Site',timezone:'UTC',confirmed:true});
test('workspace settings reject forged scope, invalid timezone/email, revision and missing confirmation',()=>{
  for(const patch of [{confirmed:false},{revision:-1},{revision:'0'},{name:'x'},{name:'unsafe\nname'},{org_id:'foreign'},{supportEmail:'bad'}]) assert.throws(()=>settingsInput('organization',{...orgInput(),...patch}),/Invalid/);
  for(const patch of [{timezone:'Mars/Base'},{timezone:''},{siteId:'foreign'},{revision:1.1},...[['ar'],[],['en','en'],['en','xx'],'en',null].map(generationLanguages=>({generationLanguages}))]) assert.throws(()=>settingsInput('site',{...siteInput(),...patch}),/Invalid/);
  assert.equal(settingsInput('organization',{...orgInput(),supportEmail:''}).supportEmail,'');assert.equal(settingsInput('site',siteInput()).timezone,'UTC');
  assert.deepEqual(settingsInput('site',{...siteInput(),generationLanguages:['ur','en','ar']}).generationLanguages,['en','ar','ur']);
  for(const contacts of [{primaryContactId:'maya'},{deputyContactId:'rami'},{primaryContactId:null,deputyContactId:'rami'},{primaryContactId:'maya',deputyContactId:'maya'},{primaryContactId:123,deputyContactId:null},{primaryContactId:'bad\ncontact',deputyContactId:null}])assert.throws(()=>settingsInput('site',{...siteInput(),...contacts}),/Invalid/);
  assert.deepEqual(settingsInput('site',{...siteInput(),primaryContactId:null,deputyContactId:null}),{revision:0,name:'Updated Synthetic Site',timezone:'UTC',primaryContactId:null,deputyContactId:null});
});
test('SQLite generation-default upgrade preserves existing settings and is repeatable',()=>{
  const db=openDatabase(':memory:');seed(db);
  try {
    db.exec('CREATE TABLE site_settings(site_id TEXT PRIMARY KEY REFERENCES sites(id),org_id TEXT NOT NULL REFERENCES organizations(id),revision INTEGER NOT NULL CHECK(revision>=0)) STRICT');
    db.prepare('INSERT INTO site_settings VALUES(?,?,?)').run('beirut','cedar',4);
    ensureSettingsSchema(db);ensureSettingsSchema(db);
    const current=getSettings(db,owner);assert.equal(current.site.revision,4);assert.equal(current.site.name,'Beirut site');assert.deepEqual(current.site.generationLanguages,['en','ar','ur']);
    assert.equal(current.site.primaryContact,null);assert.equal(current.site.deputyContact,null);
  }finally {db.close();}
});
for(const pg of [false,true])test(`${pg?'PostgreSQL':'SQLite'} generation defaults are scoped, receipt-replayable and affect only new preparation`,async()=>{
  const f=await fixture(pg);
  try {
    const original=await f.get(owner);assert.deepEqual(original.site.generationLanguages,['en','ar','ur']);
    const input={...siteInput(),name:original.site.name,timezone:original.site.timezone,generationLanguages:['ar','en']};
    f.fail();await assert.rejects(async()=>f.update(owner,'site',input),/Injected/);f.reset();assert.equal((await f.get(owner)).site.revision,0);
    await f.update(owner,'site',input);assert.deepEqual((await f.get(owner)).site.generationLanguages,['en','ar']);
    assert.equal((await f.update(owner,'site',{...input,generationLanguages:['en','ar']})).duplicate,true);
    await assert.rejects(async()=>f.update(owner,'site',{...input,generationLanguages:['en','ur']}),/conflict/);
    const draftInput={requestId:randomUUID(),title:'Selected generation languages',source:CANONICAL_SOURCE};
    const draft=pg?await pgDraft(f.pool,owner,draftInput,f.options):createDraft(f.db,owner,draftInput);
    if(pg){await pgQueue(f.pool,owner,draft.id,1,f.options);await pgProcess(f.pool,{...f.options,integrationMode:'synthetic'});}
    else {queuePreparation(f.db,owner,draft.id,1);while(processOne(f.db)) {}}
    const sql=pg?'SELECT prepared_json,state FROM briefings WHERE id=$1':'SELECT prepared_json,state FROM briefings WHERE id=?';
    const prepared=async()=>{const row=(await f.raw(sql,[draft.id])).rows[0];assert.equal(row.state,'ready');return pg?row.prepared_json:JSON.parse(row.prepared_json);};
    assert.deepEqual(Object.keys((await prepared()).languages),pg?['ar','en']:['en','ar']);
    await f.update(owner,'site',{...input,requestId:randomUUID(),revision:1,generationLanguages:['en']});
    assert.equal('ar' in (await prepared()).languages,true);
    await f.update(owner,'site',{...siteInput(),requestId:randomUUID(),revision:2,name:'Legacy client name edit'});
    assert.deepEqual((await f.get(owner)).site.generationLanguages,['en']);
    assert.equal((await f.update(owner,'site',input)).duplicate,true);assert.deepEqual((await f.get(owner)).site.generationLanguages,['en']);
    const foreign={...owner,principal_id:'harbor-owner',org_id:'harbor',site_id:'harbor-yard'};assert.deepEqual((await f.get(foreign)).site.generationLanguages,['en','ar','ur']);
    await assert.rejects(f.raw(pg?"UPDATE site_settings SET generation_languages_json='[\"ar\"]'::jsonb":"UPDATE site_settings SET generation_languages_json='[\"ar\"]'"),/constraint|CHECK/i);
  }finally {await f.close();}
});
async function fixture(pg) {
  if(!pg) {
    const db=openDatabase(':memory:');seed(db);ensureSettingsSchema(db);ensureBillingSchema(db);
    db.prepare('INSERT INTO staff VALUES(?,?,?,?,?,1)').run('auditor','cedar','beirut','Synthetic auditor','auditor');
    db.prepare('INSERT INTO staff VALUES(?,?,?,?,?,1)').run('rami','cedar','beirut','Synthetic supervisor','supervisor');
    return {db,get:s=>getSettings(db,s),receipt:(s,k,id)=>settingsReceipt(db,s,k,id),contacts:(s,v)=>listSiteContacts(db,s,v),update:(s,k,v)=>updateSettings(db,s,k,v),invoice:v=>createInvoice(db,owner,v),invoiceGet:id=>getInvoice(db,owner,id),
      raw:async(sql,values=[])=>({rows:db.prepare(sql).all(...values)}),fail(){db.exec("CREATE TRIGGER reject_settings_audit BEFORE INSERT ON audit WHEN NEW.action LIKE 'settings.%' BEGIN SELECT RAISE(ABORT,'Injected failure'); END");},reset(){db.exec('DROP TRIGGER reject_settings_audit');},close:async()=>db.close()};
  }
  const db=new PGlite(),options={schema:'understood_test_settings'};let fail=false,lost=false;
  const pool={async connect(){return {async query(sql,values){if(fail && sql.includes('INSERT INTO audit')) throw new Error('Injected failure');const result=values?.length ? await db.query(sql,values) : (await db.exec(sql)).at(-1) || {rows:[]};if(lost && sql==='COMMIT') {lost=false;throw new Error('Lost commit receipt');}return result;},release(){}};}};
  await db.exec(`CREATE SCHEMA ${options.schema}; SET search_path TO ${options.schema},pg_catalog`);await runMigrations(pool,options);
  await db.query("INSERT INTO organizations VALUES('cedar','Cedar Works'),('harbor','Other Organization')");
  await db.query("INSERT INTO sites VALUES('beirut','cedar','Beirut site','Asia/Beirut'),('harbor-yard','harbor','Other site','UTC')");
  await db.query("INSERT INTO staff(id,org_id,site_id,name,role) VALUES('maya','cedar','beirut','Maya','owner'),('rami','cedar','beirut','Rami','supervisor'),('auditor','cedar','beirut','Auditor','auditor'),('harbor-owner','harbor','harbor-yard','Other','owner')");
  return {db,pool,options,get:s=>pgGet(pool,s,options),receipt:(s,k,id)=>pgReceipt(pool,s,k,id,options),contacts:(s,v)=>pgContacts(pool,s,v,options),update:(s,k,v)=>pgUpdate(pool,s,k,v,options),invoice:v=>pgInvoice(pool,owner,v,options),invoiceGet:id=>pgInvoiceGet(pool,owner,id,{},options),raw:(sql,v)=>db.query(sql,v),fail(){fail=true;},reset(){fail=false;},lose(){lost=true;},close:()=>db.close()};
}
for(const pg of [false,true])test(`${pg?'PostgreSQL':'SQLite'} site contacts are scoped, paged, revalidated and replayable without changing access or cases`,async()=>{
  const f=await fixture(pg);
  try {
    const original=await f.get(owner);assert.equal(original.site.primaryContact,null);assert.equal(original.site.deputyContact,null);
    const before=(await f.raw('SELECT * FROM clarifications ORDER BY id')).rows;
    for(let n=0;n<12;n++)await f.raw(pg?"INSERT INTO staff(id,org_id,site_id,name,role) VALUES($1,'cedar','beirut',$2,'supervisor')":"INSERT INTO staff VALUES(?,'cedar','beirut',?,'supervisor',1)",[`contact-${n}`,`Contact ${String(n).padStart(2,'0')}`]);
    const first=await f.contacts(owner,{pageSize:5}),last=await f.contacts(owner,{pageSize:5,page:3});assert.equal(first.total,14);assert.equal(first.items.length,5);assert.equal(last.items.length,4);assert.ok(first.items.every(row=>row.available && !('email' in row)));
    assert.equal((await f.contacts(owner,{search:'CONTACT-11'})).items[0].id,'contact-11');assert.equal((await f.contacts(owner,{search:'%'})).total,0);
    for(const s of [{...owner,principal_type:'worker'},{...owner,site_id:'harbor-yard'},{...owner,principal_id:'rami',role:'supervisor'},{...owner,principal_id:'auditor',role:'auditor'}])await assert.rejects(async()=>f.contacts(s),/Forbidden/);
    for(const input of [null,[],{orgId:'harbor'},{role:'owner'},{page:0},{pageSize:51},{search:'x'.repeat(121)}])await assert.rejects(async()=>f.contacts(owner,input),/Invalid/);
    const input={...siteInput(),name:original.site.name,timezone:original.site.timezone,primaryContactId:'maya',deputyContactId:'rami'};
    f.fail();await assert.rejects(async()=>f.update(owner,'site',input),/Injected/);f.reset();assert.equal((await f.get(owner)).site.primaryContact,null);
    if(pg){f.lose();await assert.rejects(f.update(owner,'site',input),/Lost commit/);}else await f.update(owner,'site',input);
    assert.equal((await f.update(owner,'site',input)).duplicate,true);
    assert.deepEqual((await f.get(owner)).site.deputyContact,{id:'rami',name:pg?'Rami':'Synthetic supervisor',role:'supervisor',available:true});
    await assert.rejects(async()=>f.update(owner,'site',{...input,deputyContactId:'contact-0'}),/conflict/);
    for(const id of ['auditor','harbor-owner','missing'])await assert.rejects(async()=>f.update(owner,'site',{...input,requestId:randomUUID(),revision:1,deputyContactId:id}),/Invalid site contact/);
    await f.update(owner,'site',{...siteInput(),requestId:randomUUID(),revision:1,name:'Legacy contact-preserving edit'});
    assert.equal((await f.get(owner)).site.deputyContact.id,'rami');assert.equal((await f.update(owner,'site',input)).duplicate,true);
    await f.raw(pg?"UPDATE staff SET active=false WHERE id='rami'":"UPDATE staff SET active=0 WHERE id='rami'");
    assert.equal((await f.get(owner)).site.deputyContact.available,false);assert.equal((await f.contacts(owner,{search:'rami'})).total,0);
    await assert.rejects(async()=>f.update(owner,'site',{...input,requestId:randomUUID(),revision:2,name:'Current contact revalidation'}),/Invalid site contact/);
    assert.equal((await f.update(owner,'site',input)).duplicate,true);
    await f.update(owner,'site',{...input,requestId:randomUUID(),revision:2,primaryContactId:null,deputyContactId:null});assert.equal((await f.get(owner)).site.primaryContact,null);
    await assert.rejects(f.raw("UPDATE site_settings SET primary_contact_id='harbor-owner'"),/scope|foreign key/i);
    await assert.rejects(f.raw("UPDATE site_settings SET deputy_contact_id='maya'"),/scope|check/i);
    assert.deepEqual((await f.raw('SELECT * FROM clarifications ORDER BY id')).rows,before);
    assert.equal((await f.raw("SELECT active FROM staff WHERE id='maya'")).rows[0].active,pg?true:1);
  }finally{await f.close();}
});
for(const pg of [false,true]) test(`${pg ? 'PostgreSQL' : 'SQLite'} workspace edits are scoped, revision-checked, audit-atomic, replayable and preserve frozen invoices`,async()=>{
  const f=await fixture(pg);
  try {
    const original=await f.get(owner);assert.equal(original.organization.revision,0);assert.equal(original.site.revision,0);assert.equal(original.canWrite,true);
    const issued=await f.invoice({requestId:randomUUID(),number:'SETTINGS-FROZEN',description:'Synthetic service',issueDate:'2026-10-01',dueDate:'2026-10-10',amount:'25',confirmed:true});
    const input=orgInput();f.fail();await assert.rejects(async()=>f.update(owner,'organization',input),/Injected/);f.reset();assert.equal((await f.get(owner)).organization.name,'Cedar Works');
    if(pg) {f.lose();await assert.rejects(f.update(owner,'organization',input),/Lost commit/);}else await f.update(owner,'organization',input);
    assert.equal((await f.update(owner,'organization',input)).duplicate,true);
    checkedSettingsReceipt(await f.receipt(owner,'organization',input.requestId),'organization',input);
    assert.equal(await f.receipt(owner,'site',input.requestId),null);
    await f.raw("INSERT INTO staff(id,org_id,site_id,name,role) VALUES('other-owner','cedar','beirut','Other synthetic owner','owner')");
    const otherOwner={...owner,principal_id:'other-owner'};
    assert.equal(await f.receipt(otherOwner,'organization',input.requestId),null);
    await assert.rejects(async()=>f.update(otherOwner,'organization',input),/conflict/);
    await assert.rejects(async()=>f.update(owner,'organization',{...input,name:'Changed payload'}),/conflict/);
    await assert.rejects(async()=>f.update(owner,'organization',orgInput()),/revision changed/);
    const site=siteInput();await f.update(owner,'site',site);const current=await f.get(owner);assert.equal(current.organization.revision,1);assert.equal(current.site.revision,1);assert.equal(current.site.timezone,'UTC');
    await f.update(owner,'site',{...site,requestId:randomUUID(),revision:1,name:'Later Synthetic Site'});
    assert.equal((await f.update(owner,'site',site)).duplicate,true);assert.equal((await f.get(owner)).site.name,'Later Synthetic Site');
    await assert.rejects(async()=>f.update(owner,'site',{...site,requestId:randomUUID(),revision:2,name:'Later Synthetic Site'}),/unchanged/);
    const frozen=await f.invoiceGet(issued.id);assert.equal(frozen.issuerName,'Cedar Works');assert.equal(frozen.siteName,original.site.name);
    for(const session of [{...owner,principal_id:'rami',role:'supervisor'},{...owner,principal_id:'auditor',role:'auditor'}]) {assert.equal((await f.get(session)).canWrite,false);await assert.rejects(async()=>f.update(session,'site',siteInput()),/Forbidden/);}
    for(const session of [{...owner,principal_type:'worker'},{...owner,principal_id:'missing'},{...owner,site_id:'harbor-yard'}]) await assert.rejects(async()=>f.get(session),/Forbidden/);
    const foreign={...owner,principal_id:'harbor-owner',org_id:'harbor',site_id:'harbor-yard'};assert.equal((await f.get(foreign)).organization.name,pg ? 'Other Organization' : 'Harbor Tools');
    assert.ok(!JSON.stringify(current).includes('created_by'));assert.equal((await f.raw("SELECT COUNT(*) AS n FROM settings_requests")).rows[0].n,3);
    await assert.rejects(f.raw("UPDATE settings_requests SET kind='site'"),/immutable/);await assert.rejects(f.raw('DELETE FROM settings_requests'),/immutable/);
    const config={tier:'local',aiMode:'synthetic',accessMode:pg ? 'credential' : 'demo',dataClass:'synthetic',publicOrigin:'http://127.0.0.1:3020',...(pg ? {schema:f.options.schema} : {})};
    if(pg) await provisionStaffCredential(f.pool,{staffId:'maya',orgId:'cedar',siteId:'beirut',email:'synthetic@example.test',password:'Synthetic-only-password-123'},f.options);
    const server=pg ? createPostgresRehearsalServer(f.pool,config) : createAppServer(f.db,config);
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}/api`;
    const call=(path,cookie,body)=>fetch(base+path,{method:body ? 'POST' : 'GET',headers:{origin:config.publicOrigin,'content-type':'application/json',...(cookie ? {cookie} : {})},body:body ? JSON.stringify(body) : undefined});
    try {
      const login=await call(pg ? '/auth/staff/login' : '/demo/session',null,pg ? {email:'synthetic@example.test',password:'Synthetic-only-password-123'} : {principal:'maya'}),cookie=login.headers.get('set-cookie').split(';')[0];
      const response=await call('/settings',cookie);assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);assert.equal((await response.json()).site.revision,2);
      assert.equal((await call('/settings',null)).status,401);assert.equal((await call('/settings?org=harbor',cookie)).status,400);
      const contacts=await call('/settings/contacts?pageSize=1',cookie);assert.equal(contacts.status,200);assert.match(contacts.headers.get('cache-control'),/no-store/);assert.equal((await contacts.json()).items.length,1);
      assert.equal((await call('/settings/contacts?org=harbor',cookie)).status,400);assert.equal((await call('/settings/contacts',null)).status,401);
      assert.equal((await call('/settings/site',cookie,{...siteInput(),revision:0})).status,409);
      assert.equal((await call('/settings/site',cookie,{...siteInput(),revision:2,timezone:'bad'})).status,400);
      assert.equal((await call('/settings/site',cookie,{...siteInput(),revision:2,primaryContactId:'maya',deputyContactId:'harbor-owner'})).status,400);
      const change={...siteInput(),revision:2,name:'HTTP Synthetic Site',primaryContactId:'maya',deputyContactId:'rami'};assert.equal((await call('/settings/site',cookie,change)).status,200);assert.equal((await (await call('/settings/site',cookie,change)).json()).duplicate,true);
      const receipt=await call(`/settings/site/receipts/${change.requestId}`,cookie);assert.equal(receipt.status,200);assert.match(receipt.headers.get('cache-control'),/no-store/);checkedSettingsReceipt(await receipt.json(),'site',change);
      const current=(await (await call('/settings',cookie)).json()).site;
      const selection={...siteInput(),revision:3,name:current.name,timezone:current.timezone,generationLanguages:['en'],confirmed:true};
      assert.equal((await call('/settings/site',cookie,selection)).status,200);
      assert.equal((await (await call('/settings',cookie)).json()).site.deputyContact.id,'rami');
      const readiness=await call('/language-readiness',cookie);assert.equal(readiness.status,200);assert.match(readiness.headers.get('cache-control'),/no-store/);
      const model=await readiness.json();assert.deepEqual(model.languages.map(item=>[item.code,item.generationDefault]),WORKER_LANGUAGE_CODES.map(code=>[code,code==='en']));assert.ok(model.languages.every(item=>item.ui.state==='ready'));assert.equal(model.provider.connection.state,'not_tested');assert.equal(model.realDataAllowed,false);
    } finally {await new Promise(resolve=>server.close(resolve));}
    await f.raw(pg ? "UPDATE staff SET active=false WHERE id='maya'" : "UPDATE staff SET active=0 WHERE id='maya'");await assert.rejects(async()=>f.get(owner),/Forbidden/);
  } finally {await f.close();}
});
