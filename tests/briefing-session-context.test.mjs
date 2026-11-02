import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {openDatabase} from '../server/db.mjs';
import {seed} from '../server/seed.mjs';
import {createAppServer} from '../server/index.mjs';
import {provisionStaffCredential} from '../server/auth.mjs';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {createPostgresRehearsalServer} from '../server/postgres/http.mjs';
import {provisionStaffCredential as pgCredential} from '../server/postgres/auth.mjs';
import {checkedBillingReceipt} from '../src/billing-recovery.ts';
import {ensureInvitationSchema} from '../server/invitations.mjs';
import {ensurePeopleSchema} from '../server/people.mjs';
import {ensureWorkerImportSchema} from '../server/worker-import.mjs';
import {preparePendingImport,checkedImportPreview,importRecoveryDecision} from '../src/worker-import-recovery.ts';
import {checkedWorkerGrant,checkedWorkerGrantPage} from '../src/worker-access-state.ts';
import {readDeletionReceipt,verifyDeletionAcceptance} from '../src/deletion-state.ts';
import {verifyRetentionReceipt} from '../src/retention-recovery.ts';
import {verifyNoticeReceipt} from '../src/notice-recovery.ts';
import {verifyTextRetentionReceipt} from '../src/text-retention-recovery.ts';
import {checkedWorkspaceContext,checkedSettingsReceipt} from '../src/workspace-settings-state.ts';

for(const postgres of [false,true])test(`${postgres?'PostgreSQL':'SQLite'} briefing-family JSON requests require exact captured cookie context before side effects`,async()=>{
  const db=postgres?new PGlite():openDatabase(':memory:'),schema='understood_test_briefing_context';
  const pool={async connect(){return {release(){},async query(sql,values){return values?.length?db.query(sql,values):(await db.exec(sql)).at(-1) || {rows:[]};}};}};
  const config={tier:'local',aiMode:'synthetic',dataClass:'synthetic',accessMode:'credential',publicOrigin:'http://127.0.0.1:3031',...(postgres?{schema}:{})};
  let server;
  try {
    if(postgres){await db.exec(`CREATE SCHEMA ${schema};SET search_path TO ${schema},pg_catalog`);await runMigrations(pool,{schema});await db.exec("INSERT INTO organizations VALUES('cedar','Synthetic organization');INSERT INTO sites VALUES('beirut','cedar','Synthetic site','UTC');INSERT INTO staff(id,org_id,site_id,name,role) VALUES('maya','cedar','beirut','Synthetic owner','owner')");await pgCredential(pool,{staffId:'maya',orgId:'cedar',siteId:'beirut',email:'maya@context.example.test',password:'Synthetic-briefing-context-password'},{schema});}
    else {seed(db);provisionStaffCredential(db,'maya','maya@context.example.test','Synthetic-briefing-context-password');ensureInvitationSchema(db);ensurePeopleSchema(db);ensureWorkerImportSchema(db);}
    server=postgres?createPostgresRehearsalServer(pool,config):createAppServer(db,config);
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const base=`http://127.0.0.1:${server.address().port}/api`;
    const call=(path,cookie,context,method='GET',body)=>fetch(base+path,{method,headers:{origin:config.publicOrigin,...(cookie?{cookie}:{}),...(context!==undefined?{'x-client-session-context':context}:{}),...(body!==undefined?{'content-type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body)});
    const login=async()=>{const response=await call('/auth/staff/login',null,undefined,'POST',{email:'maya@context.example.test',password:'Synthetic-briefing-context-password'});assert.equal(response.status,200);const cookie=response.headers.get('set-cookie').split(';')[0];const session=await (await call('/session',cookie)).json();return {cookie,context:session.clientContext};};
    const first=await login(),second=await login();assert.notEqual(second.context,first.context);
    const snapshot=async()=>{const result={};for(const table of ['briefings','publications','assignments','jobs','audit','invoices','invoice_payments','invoice_voids','staff_invitations','staff_invitation_requests','staff_invitation_mail','staff_invitation_tokens','workers','crews','crew_memberships','directory_reactivations','worker_imports','worker_grants','sessions','worker_deletion_requests','organization_settings','site_settings','settings_requests','site_creations','site_access_controls','site_access_requests','site_lifecycle','site_lifecycle_requests','templates','template_versions','template_requests','glossary_terms','glossary_versions','glossary_requests','site_onboarding','onboarding_requests'])result[table]=postgres?(await db.query('SELECT * FROM '+table+' ORDER BY 1')).rows:db.prepare('SELECT * FROM '+table+' ORDER BY 1').all();return result;};
    const before=await snapshot(),id=randomUUID();
    for(const context of [undefined,'invalid','b'.repeat(64)]){
      for(const path of ['/clarifications',`/clarifications/${id}`,`/clarifications/${id}/actions/${id}`,...(postgres?[`/clarifications/${id}/repeats?page=1&pageSize=10`,`/clarifications/${id}/repeats/${id}`,`/clarifications/${id}/reviews?page=1&pageSize=10`,`/clarifications/${id}/reviews/${id}`]:[])])assert.equal((await call(path,first.cookie,context)).status,409,path);
      for(const action of ['assign','resolve'])assert.equal((await call(`/clarifications/${id}/${action}`,first.cookie,context,'POST',{})).status,409,action);
      for(const path of ['/overview','/processing',`/processing/${id}`,'/audit',`/audit/${id}`,'/language-readiness'])assert.equal((await call(path,first.cookie,context)).status,409,path);
      for(const path of [`/briefings/${id}/preparation-requests`,`/briefings/${id}/preparation-requests/${id}`])assert.equal((await call(path,first.cookie,context)).status,409,path);
      assert.equal((await call(`/briefings/${id}/preparation-requests`,first.cookie,context,'POST',{})).status,409);
      assert.equal((await call('/language-readiness/test',first.cookie,context,'POST',{})).status,409);
    }
    assert.equal((await call('/clarifications',second.cookie,first.context)).status,409);
    assert.equal((await call('/clarifications',second.cookie,second.context)).status,200);
    assert.equal((await call(`/briefings/${id}/preparation-requests`,second.cookie,first.context,'POST',{})).status,409);
    assert.equal((await call('/language-readiness/test',second.cookie,first.context,'POST',{})).status,409);
    for(const path of ['/overview','/processing','/language-readiness'])assert.equal((await call(path,second.cookie,second.context)).status,200,path);
    for(const path of ['/audit',`/audit/${id}`])assert.equal((await call(path,second.cookie,second.context)).status,404,path);
    const usageBefore=postgres?(await db.query('SELECT * FROM usage_change_requests ORDER BY id')).rows:null;
    for(const context of [undefined,'invalid','b'.repeat(64)]) {
      for(const path of ['/usage','/usage/requests',`/usage/requests/${id}`])assert.equal((await call(path,first.cookie,context)).status,409,path);
      assert.equal((await call('/usage/requests',first.cookie,context,'POST',{})).status,409);
    }
    assert.equal((await call('/usage/requests',second.cookie,first.context,'POST',{})).status,409);
    assert.equal((await call('/usage',second.cookie,second.context)).status,200);
    if(postgres)assert.deepEqual((await db.query('SELECT * FROM usage_change_requests ORDER BY id')).rows,usageBefore);
    for(const context of [undefined,'invalid','b'.repeat(64)]) {
      for(const path of ['/settings/onboarding',`/settings/onboarding/receipts/${id}`])assert.equal((await call(path,first.cookie,context)).status,409,path);
      assert.equal((await call('/settings/onboarding',first.cookie,context,'POST',{})).status,409);
    }
    assert.equal((await call('/settings/onboarding',second.cookie,first.context,'POST',{})).status,409);
    assert.equal((await call('/settings/onboarding',second.cookie,second.context)).status,200);
    const readMarks=async()=>postgres?(await db.query('SELECT * FROM notification_reads ORDER BY event_id,staff_id')).rows:db.prepare('SELECT * FROM notification_reads ORDER BY event_id,staff_id').all(),marksBefore=await readMarks();
    for(const context of [undefined,'invalid','b'.repeat(64)]) {
      for(const path of ['/notifications',`/notifications/${id}/receipt`])assert.equal((await call(path,first.cookie,context)).status,409,path);
      assert.equal((await call(`/notifications/${id}/read`,first.cookie,context,'POST',{})).status,409);
    }
    assert.equal((await call(`/notifications/${id}/read`,second.cookie,first.context,'POST',{})).status,409);
    assert.deepEqual(await readMarks(),marksBefore);
    const reportSnapshot=async()=>{
      const rows={};for(const table of ['report_exports','report_export_retries'])rows[table]=postgres?(await db.query('SELECT * FROM '+table+' ORDER BY 1')).rows:db.prepare('SELECT * FROM '+table+' ORDER BY 1').all();return rows;
    },reportBefore=await reportSnapshot();
    for(const context of [undefined,'invalid','b'.repeat(64)]) {
      for(const path of ['/reports','/reports/publications','/reports/exports',`/reports/exports/receipts/create/${id}`,`/reports/exports/receipts/retry/${id}`])assert.equal((await call(path,first.cookie,context)).status,409,path);
      for(const path of ['/reports/exports',`/reports/exports/${id}/retry`])assert.equal((await call(path,first.cookie,context,'POST',{})).status,409,path);
    }
    assert.equal((await call('/reports/exports',second.cookie,first.context,'POST',{})).status,409);
    assert.deepEqual(await reportSnapshot(),reportBefore);
    const artifactReads=['/templates',`/templates/${id}`,`/templates/receipts/${id}`,'/glossary',`/glossary/${id}`,`/glossary/receipts/${id}`];
    const artifactWrites=['/templates',...['edit','archive','restore','duplicate','use'].map(action=>`/templates/${id}/${action}`),'/glossary',...['edit','remove','restore','regenerate'].map(action=>`/glossary/${id}/${action}`)];
    for(const context of [undefined,'invalid','b'.repeat(64)]) {
      for(const path of artifactReads)assert.equal((await call(path,first.cookie,context)).status,409,path);
      for(const path of artifactWrites)assert.equal((await call(path,first.cookie,context,'POST',{})).status,409,path);
    }
    for(const path of artifactWrites)assert.equal((await call(path,second.cookie,first.context,'POST',{})).status,409,path);
    for(const context of [undefined,'invalid','b'.repeat(64)]){
      for(const path of ['/settings','/settings/contacts','/settings/sites',`/settings/site/receipts/${id}`,`/settings/organization/receipts/${id}`,`/settings/sites/receipts/${id}`,`/settings/sites/access/receipts/${id}`,`/settings/sites/lifecycle/receipts/${id}`,`/settings/sites/${id}/lifecycle`])assert.equal((await call(path,first.cookie,context)).status,409,path);
      for(const path of ['/settings/site','/settings/organization','/settings/sites','/settings/sites/access','/settings/sites/lifecycle'])assert.equal((await call(path,first.cookie,context,'POST',{})).status,409,path);
    }
    const policies=['/retention','/privacy/recording-notice',...['text','cases','generated','activity','briefings'].map(name=>`/retention/${name}`)];
    for(const context of [undefined,'invalid','b'.repeat(64)])for(const path of policies){
      assert.equal((await call(path,first.cookie,context)).status,409,path);
      assert.equal((await call(`${path}/requests/${id}`,first.cookie,context)).status,409,path);
      assert.equal((await call(path,first.cookie,context,'POST',{})).status,409,path);
    }
    assert.equal((await call('/retention',second.cookie,first.context,'POST',{})).status,409);
    for(const context of [undefined,'invalid','b'.repeat(64)]) {
      for(const path of ['/privacy/workers',`/people/workers/${id}/access`,`/people/workers/${id}/deletion`,`/people/workers/${id}/assignments`,`/publications/${id}/responses`,`/publications/${id}/responses/${id}`])assert.equal((await call(path,first.cookie,context)).status,409,path);
      for(const path of ['/worker-grants',`/worker-grants/${id}/revoke`,`/people/workers/${id}/deletion`])assert.equal((await call(path,first.cookie,context,'POST',{})).status,409,path);
    }
    for(const context of [undefined,'invalid','b'.repeat(64)]) {
      assert.equal((await call(`/people/imports/${id}`,first.cookie,context)).status,409);
      for(const path of ['/people/imports/preview',`/people/imports/${id}/confirm`])assert.equal((await call(path,first.cookie,context,'POST',{})).status,409,path);
    }
    for(const context of [undefined,'invalid','b'.repeat(64)]) {
      for(const path of ['/people/workers','/people/crews',`/people/crews/${id}`])assert.equal((await call(path,first.cookie,context)).status,409,path);
      for(const path of ['/people/workers','/people/crews',`/people/workers/${id}/disable`,`/people/workers/${id}/reenable`,`/people/workers/${id}/crew`,`/people/crews/${id}/archive`,`/people/crews/${id}/restore`])assert.equal((await call(path,first.cookie,context,'POST',{})).status,409,path);
      for(const path of [`/people/workers/${id}`,`/people/crews/${id}`])assert.equal((await call(path,first.cookie,context,'PATCH',{})).status,409,path);
    }
    const reads=['/briefings','/briefings/shelf','/briefings/shelf/schedules',`/draft-creation-receipts/${id}`,`/briefings/shelf/publication-receipts/publish/${id}`,`/briefing-review/receipts/${id}`,`/briefing-regeneration/receipts/${id}`,'/invoices',`/invoices/${id}`,`/invoices/requests/payment/${id}`,'/settings/invitations',`/settings/invitations/receipts/${id}`];
    const writes=['/briefings',...['copy','archive','withdraw','publish','schedules','process','review','regenerate'].map(action=>`/briefings/shelf/${action}`),`/briefings/shelf/schedules/${id}/cancel`,`/briefing-review/receipts/${id}/verify`,'/invoices',`/invoices/${id}/payments`,`/invoices/${id}/void`,'/settings/invitations',`/settings/invitations/${id}/resend`,`/settings/invitations/${id}/cancel`];
    for(const context of [undefined,'invalid','b'.repeat(64)]) {
      for(const path of reads){const response=await call(path,first.cookie,context);assert.equal(response.status,409,path);assert.deepEqual(await response.json(),{error:'Session context changed'});}
      for(const path of writes)assert.equal((await call(path,first.cookie,context,'POST',{})).status,409,path);
      assert.equal((await call('/briefings/shelf',first.cookie,context,'PATCH',{})).status,409);
    }
    assert.equal((await call('/briefings',second.cookie,first.context,'POST',{})).status,409);
    assert.equal((await call('/settings/invitations',second.cookie,first.context,'POST',{})).status,409);
    assert.equal((await call('/people/workers',second.cookie,first.context,'POST',{})).status,409);
    assert.equal((await call(`/people/imports/${id}`,second.cookie,first.context)).status,409);
    assert.deepEqual(await snapshot(),before);
    checkedWorkspaceContext(await (await call('/settings',second.cookie,second.context)).json(),JSON.stringify(['cedar','beirut','maya']));
    for(const kind of ['organization','site']){
      const input={requestId:randomUUID(),revision:0,name:`Captured synthetic ${kind}`,confirmed:true,...(kind==='organization'?{supportEmail:''}:{timezone:'UTC',generationLanguages:['en'],primaryContactId:null,deputyContactId:null})};
      assert.equal((await call(`/settings/${kind}`,second.cookie,second.context,'POST',input)).status,200);
      checkedSettingsReceipt(await (await call(`/settings/${kind}/receipts/${input.requestId}`,second.cookie,second.context)).json(),kind,input);
    }
    const audio={requestId:randomUUID(),revision:0,audioDays:30,confirmed:true};
    assert.equal((await call('/retention',second.cookie,second.context,'POST',audio)).status,200);
    verifyRetentionReceipt(await (await call(`/retention/requests/${audio.requestId}`,second.cookie,second.context)).json(),audio);
    const notice={requestId:randomUUID(),revision:0,notices:{en:'',ar:'',ur:''},confirmed:true,scope:JSON.stringify(['cedar','beirut','maya'])};
    assert.equal((await call('/privacy/recording-notice',second.cookie,second.context,'POST',notice)).status,200);
    verifyNoticeReceipt(await (await call(`/privacy/recording-notice/requests/${notice.requestId}`,second.cookie,second.context)).json(),notice);
    if(postgres)for(const name of ['text','cases','generated','activity','briefings']){
      const endpoint=`/retention/${name}`,change={requestId:randomUUID(),revision:0,days:null,confirmed:true};
      assert.equal((await call(endpoint,second.cookie,second.context,'POST',change)).status,200,endpoint);
      verifyTextRetentionReceipt(await (await call(`${endpoint}/requests/${change.requestId}`,second.cookie,second.context)).json(),change);
      assert.equal((await (await call(endpoint,second.cookie,second.context,'POST',change)).json()).duplicate,true);
    }
    const createdWorker=await call('/people/workers',second.cookie,second.context,'POST',{code:'Captured synthetic worker',name:'Captured synthetic worker',language:'en',password:'Captured synthetic password'});assert.equal(createdWorker.status,201);const workerRow=await createdWorker.json();
    const input={requestId:randomUUID(),title:'Captured synthetic draft',source:'Put finished items on the blue shelf. Put unfinished items on the yellow shelf.'};
    const created=await call('/briefings',second.cookie,second.context,'POST',input);assert.equal(created.status,201);
    const result=await created.json();assert.equal(typeof result.id,'string');
    const receipt=await call(`/draft-creation-receipts/${input.requestId}`,second.cookie,second.context);assert.equal(receipt.status,200);assert.equal((await receipt.json()).accepted,true);
    assert.equal((await call(`/briefings/${result.id}`,second.cookie,second.context,'PATCH',{revision:1,title:input.title,source:input.source+' Leave the walkway clear.'})).status,200);
    const bill={requestId:randomUUID(),kind:'invoice',invoiceId:null,body:{number:'CAPTURED-001',description:'Synthetic manual billing',issueDate:'2026-10-01',dueDate:'2026-10-20',amount:'25',confirmed:true}};
    assert.equal((await call('/invoices',second.cookie,second.context,'POST',{...bill.body,requestId:bill.requestId})).status,201);
    const billingReceipt=await (await call(`/invoices/requests/invoice/${bill.requestId}`,second.cookie,second.context)).json();assert.equal(await checkedBillingReceipt(billingReceipt,bill),bill.requestId);
    assert.equal((await call(`/invoices/${bill.requestId}/download`,second.cookie)).status,200,'Native invoice downloads still use cookies without a custom header');
    const file=new File(['worker_id,language\nCaptured CSV worker,en\n'],'crew.csv'),pending=await preparePendingImport(file,randomUUID());
    const upload=await fetch(base+`/people/imports/preview?${new URLSearchParams({requestId:pending.requestId,filename:file.name})}`,{method:'POST',headers:{cookie:second.cookie,origin:config.publicOrigin,'x-client-session-context':second.context,'content-type':'text/csv'},body:file});
    assert.equal(upload.status,200);checkedImportPreview(await upload.json(),pending.requestId,pending);
    assert.equal((await call(`/people/imports/${pending.requestId}/errors.csv`,second.cookie)).status,200,'Native CSV error download remains cookie-authenticated without custom headers');
    assert.equal((await call(`/people/imports/${pending.requestId}/confirm`,second.cookie,second.context,'POST',{})).status,200);
    const accepted=checkedImportPreview(await (await call(`/people/imports/${pending.requestId}`,second.cookie,second.context)).json(),pending.requestId,pending);
    assert.equal(importRecoveryDecision(accepted,{...pending,phase:'confirm',bytes:null}),'imported');
    assert.equal((await (await call(`/people/imports/${pending.requestId}/confirm`,second.cookie,second.context,'POST',{})).json()).duplicate,true);
    const issue=await call('/worker-grants',second.cookie,second.context,'POST',{workerId:workerRow.id,expiresInMinutes:30});assert.equal(issue.status,201);
    const grant=checkedWorkerGrant(await issue.json(),workerRow.id);
    checkedWorkerGrantPage(await (await call(`/people/workers/${workerRow.id}/access?page=1&pageSize=5`,second.cookie,second.context)).json(),workerRow.id,1);
    const revoke=await call(`/worker-grants/${grant.id}/revoke`,second.cookie,second.context,'POST',{});assert.equal(revoke.status,200);assert.deepEqual(await revoke.json(),{ok:true});
    assert.equal((await call(`/people/workers/${workerRow.id}/assignments`,second.cookie,second.context)).status,200);
    assert.equal((await call('/privacy/workers',second.cookie,second.context)).status,200);
    const deletion={requestId:randomUUID(),expectedCode:workerRow.code,reason:'worker_request',confirmed:true};
    const acceptedDeletion=await call(`/people/workers/${workerRow.id}/deletion`,second.cookie,second.context,'POST',deletion);assert.equal(acceptedDeletion.status,200);verifyDeletionAcceptance(await acceptedDeletion.json(),deletion.requestId);
    assert.equal(readDeletionReceipt(await (await call(`/people/workers/${workerRow.id}/deletion`,second.cookie,second.context)).json(),workerRow.id,deletion).id,deletion.requestId);
  }finally{if(server?.listening)await new Promise(resolve=>server.close(resolve));await db.close();}
});
