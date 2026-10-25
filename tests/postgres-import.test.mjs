import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { openDatabase,transaction } from '../server/db.mjs';
import {linkAccountMembership} from '../server/accounts.mjs';
import {provisionStaffCredential as provisionPgCredential} from '../server/postgres/auth.mjs';
import { seed } from '../server/seed.mjs';
import { submitAnswer,withdrawPublication,publish,syntheticPrepare } from '../server/domain.mjs';
import {createSchedule,cancelSchedule,processOneSchedule} from '../server/schedules.mjs';
import {createSchedule as createPgSchedule,listSchedules as listPgSchedules,processOneSchedule as processPgSchedule} from '../server/postgres/schedules.mjs';
import {processOneReminder} from '../server/reminders.mjs';
import {processOneReminder as processPgReminder} from '../server/postgres/reminders.mjs';
import { reportActivity } from '../server/reports.mjs';
import { ensureRecordingSchema, isCurrentRecording, receiveRecording } from '../server/recordings.mjs';
import { createCrew, moveWorkerToCrew,restoreCrew,reenableWorker,ensurePeopleSchema } from '../server/people.mjs';
import {restoreCrew as restorePgCrew,reenableWorker as reenablePgWorker} from '../server/postgres/people.mjs';
import { createSession, issueWorkerGrant, provisionStaffCredential } from '../server/auth.mjs';
import { requestExport, processOneExport,retryExport } from '../server/exports.mjs';
import { ensureWorkerImportSchema, previewWorkerImport, confirmWorkerImport,expireWorkerImports,importFilenameHash } from '../server/worker-import.mjs';
import { backupLocal } from '../scripts/local-backup.mjs';
import { runMigrations } from '../server/postgres/migrate.mjs';
import { importSqliteBackup } from '../server/postgres/import-sqlite.mjs';
import { readPublicationReport } from '../server/postgres/reports.mjs';
import {requestExport as pgRequestExport,downloadExport as pgDownloadExport,exportReceipt as pgExportReceipt,retryExport as pgRetryExport} from '../server/postgres/exports.mjs';
import { getClarification,resolveClarification,clarificationActionReceipt as pgActionReceipt } from '../server/postgres/clarifications.mjs';
import { ensureClarificationSchema,requestHelp,assignClarification as assignLocalHelp,resolveClarification as resolveLocalHelp } from '../server/clarifications.mjs';
import {copyDraft,editDraft,archiveBriefing} from '../server/preparation.mjs';
import {copyDraft as copyPgDraft,archiveBriefing as archivePgBriefing} from '../server/postgres/preparation.mjs';
import {ensureBillingSchema,createInvoice,recordPayment,voidInvoice} from '../server/billing.mjs';
import {getInvoice as getPgInvoice,recordPayment as recordPgPayment,voidInvoice as voidPgInvoice} from '../server/postgres/billing.mjs';
import {ensureSettingsSchema,updateSettings} from '../server/settings.mjs';
import {getSettings as getPgSettings,updateSettings as updatePgSettings} from '../server/postgres/settings.mjs';
import {createSite,saveSiteAccess,saveSiteLifecycle} from '../server/sites.mjs';
import {createSite as pgCreateSite,siteCreationReceipt as pgSiteReceipt,siteAccessReceipt as pgAccessReceipt,saveSiteAccess as pgSaveAccess,siteLifecycleReceipt as pgLifecycleReceipt,saveSiteLifecycle as pgSaveLifecycle} from '../server/postgres/sites.mjs';
import {saveDraftReview} from '../server/draft-review.mjs';
import {saveDraftReview as savePgReview} from '../server/postgres/draft-review.mjs';
import {createDraft,requestPreparation,getPreparationRequestReceipt} from '../server/preparation.mjs';
import {createDraft as createPgDraft,requestPreparation as requestPgPreparation,getPreparationRequestReceipt as pgPreparationReceipt} from '../server/postgres/preparation.mjs';
import {getProcessingRetryContext,retryProcessing,getProcessingRetryReceipt} from '../server/processing-retry.mjs';
import {retryProcessing as pgRetryProcessing,getProcessingRetryReceipt as pgProcessingReceipt} from '../server/postgres/processing-retry.mjs';
import {draftCreationReceipt as pgDraftReceipt} from '../server/postgres/draft-creations.mjs';
import {CANONICAL_SOURCE} from '../server/domain.mjs';
import {ensureTemplateSchema,changeTemplate} from '../server/templates.mjs';
import {changeTemplate as changePgTemplate,getTemplate as getPgTemplate} from '../server/postgres/templates.mjs';
import {changeGlossary} from '../server/glossary.mjs';
import {changeGlossary as changePgGlossary,getGlossaryTerm as getPgGlossary,readGlossarySnapshot as readPgGlossary} from '../server/postgres/glossary.mjs';
import {readGlossarySnapshot} from '../server/glossary.mjs';
import {changeStaff} from '../server/staff.mjs';
import {changeStaff as changePgStaff,listStaff as listPgStaff} from '../server/postgres/staff.mjs';
import {requestRecovery,processOneRecovery} from '../server/account-recovery.mjs';
import {resolveMailConfig} from '../server/auth-mail.mjs';
import {saveRetention,processOneAudioPurge} from '../server/retention.mjs';
import {retentionReceipt as pgRetentionReceipt,processOneAudioPurge as pgAudioPurge} from '../server/postgres/retention.mjs';
import {requestWorkerDeletion} from '../server/deletions.mjs';
import {processOneDeletionRedaction} from '../server/deletion-redactions.mjs';
import {processOneDeletionRedaction as pgRedact} from '../server/postgres/deletion-redactions.mjs';
import {processOneDeletionPseudonym} from '../server/deletion-pseudonyms.mjs';
import {processOneDeletionPseudonym as pgPseudonym} from '../server/postgres/deletion-pseudonyms.mjs';
import {processOneDeletionCompletion} from '../server/deletion-completions.mjs';
import {processOneDeletionCompletion as pgComplete} from '../server/postgres/deletion-completions.mjs';
import {saveRecordingNotice} from '../server/recording-notices.mjs';
import {getRecordingNotice as pgNotice,recordingNoticeReceipt as pgNoticeReceipt} from '../server/postgres/recording-notices.mjs';
import {ensureCaseMessageSchema,sendCaseMessage} from '../server/case-messages.mjs';
import {createStaffClarification as createLocalClarification} from '../server/clarification-create.mjs';
import {staffClarificationCreationReceipt as pgCreationReceipt} from '../server/postgres/clarification-create.mjs';
import {listCaseMessages as listPgMessages,caseMessageReceiptLookup as pgMessageReceipt} from '../server/postgres/case-messages.mjs';
import {startInstructionSend,completeInstructionSend} from '../server/instructions.mjs';
import {instructionSendStatus} from '../server/postgres/instructions.mjs';
import {processOne} from '../server/worker.mjs';
import {recordWorkerEvent,readWorkerNotification,savePushSubscription} from '../server/notification-events.mjs';

const maya = { principal_type: 'staff', principal_id: 'maya', org_id: 'cedar', site_id: 'beirut', role: 'owner' };
const worker = { principal_type: 'worker', principal_id: 'worker-30', org_id: 'cedar', site_id: 'beirut' };
const schema = 'understood_test_import';
function poolFor(db, fail = () => false, clock = () => null) {
  const client = { async query(sql, values) {
    if (fail(sql)) throw new Error('Injected migration failure');
    if(clock()!==null)sql=sql.replaceAll('clock_timestamp()',`'${new Date(clock()).toISOString()}'::timestamptz`);
    if (values?.length) return db.query(sql, values);
    return (await db.exec(sql)).at(-1) || { rows: [] };
  }, release() {} };
  return { async connect() { return client; } };
}
function wav() {
  const bytes = Buffer.alloc(32044);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length-8,4); bytes.write('WAVEfmt ',8);
  bytes.writeUInt32LE(16,16); bytes.writeUInt16LE(1,20); bytes.writeUInt16LE(1,22);
  bytes.writeUInt32LE(16000,24); bytes.writeUInt32LE(32000,28); bytes.writeUInt16LE(2,32); bytes.writeUInt16LE(16,34);
  bytes.write('data',36); bytes.writeUInt32LE(32000,40); bytes.writeInt16LE(1000,44); return bytes;
}

test('synthetic cutover retains original clarification action receipts after case and staff policy changes',async()=>{
  const root=await mkdtemp(join(tmpdir(),'understood-pg-import-')),sqlite=openDatabase(join(root,'source.sqlite'));seed(sqlite);ensureRecordingSchema(sqlite);ensureClarificationSchema(sqlite);
  const pg=new PGlite(),pool=poolFor(pg),options={schema};
  try{
    sqlite.prepare("INSERT INTO staff VALUES('historic-owner','cedar','beirut','Historic supervisor','supervisor',1)").run();
    const caseId=randomUUID();requestHelp(sqlite,worker,'assignment-30',{requestId:caseId,text:'Synthetic historical help'});
    const command={requestId:randomUUID(),ownerId:'historic-owner',expectedOwnerId:null},receipt=assignLocalHelp(sqlite,maya,caseId,command);
    const resolution=resolveLocalHelp(sqlite,maya,caseId,{requestId:randomUUID(),notes:'Synthetic historical private follow-up'});
    const publication=sqlite.prepare('SELECT publication_id FROM assignments WHERE id=?').get('assignment-30');
    const version=sqlite.prepare('SELECT version FROM publications WHERE id=?').get(publication.publication_id).version;
    const creationInput={requestId:randomUUID(),assignmentId:'assignment-30',publicationId:publication.publication_id,version,attemptId:null,reason:'Synthetic historical staff follow-up'};
    const creation=createLocalClarification(sqlite,maya,creationInput);
    sqlite.prepare("UPDATE staff SET active=0,role='auditor' WHERE id='historic-owner'").run();
    sqlite.prepare("UPDATE staff SET role='auditor' WHERE id='maya'").run();
    await backupLocal({database:join(root,'source.sqlite'),audioRoot:join(root,'audio'),destination:join(root,'backup')});
    await pg.exec(`CREATE SCHEMA ${schema}`);await runMigrations(pool,options);
    const imported=await importSqliteBackup(pool,{source:join(root,'backup'),schema,requestId:randomUUID(),dataClass:'synthetic',dryRun:false});assert.equal(imported.counts.clarification_action_receipts,2);assert.equal(imported.counts.clarification_creations,1);
    const rows=(await pg.query(`SELECT * FROM ${schema}.clarification_action_receipts ORDER BY request_id`)).rows;
    assert.equal(rows.find(row=>row.request_id===command.requestId).result_status,'open');assert.equal(rows.find(row=>row.request_id===resolution.requestId).result_status,'resolved');
    assert.equal(JSON.stringify(rows).includes('Synthetic historical private follow-up'),false);
    await assert.rejects(pgActionReceipt(pool,{...maya,role:'auditor'},caseId,command.requestId,options),/receipt unavailable/);
    await pg.exec(`SET search_path TO ${schema},pg_catalog;UPDATE staff SET role='owner' WHERE id='maya'`);
    assert.deepEqual(await pgActionReceipt(pool,maya,caseId,command.requestId,options),receipt);
    assert.deepEqual(await pgActionReceipt(pool,maya,caseId,resolution.requestId,options),resolution);
    assert.deepEqual(await pgCreationReceipt(pool,maya,creation.requestId,options),creation);
    assert.equal((await getClarification(pool,maya,creation.caseId,options)).staffCreation.actorId,'maya');
  }finally{sqlite.close();await pg.close();assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep+'understood-pg-import-'));await rm(root,{recursive:true});}
});

test('synthetic cutover preserves immutable draft creation after source edits',async()=>{
  const root=await mkdtemp(join(tmpdir(),'understood-pg-import-')),sqlite=openDatabase(join(root,'source.sqlite'));seed(sqlite);ensureRecordingSchema(sqlite);
  const pg=new PGlite(),pool=poolFor(pg),options={schema};
  try {
    const input={requestId:randomUUID(),title:'Creation before cutover',source:CANONICAL_SOURCE,generationLanguages:['en','ur']},first=createDraft(sqlite,maya,input);
    sqlite.prepare("INSERT INTO staff VALUES('cutover-contact','cedar','beirut','Imported deputy','supervisor',1)").run();
    ensureSettingsSchema(sqlite);const contactRequest={requestId:randomUUID(),revision:0,name:'Beirut site',timezone:'Asia/Beirut',generationLanguages:['en','ar'],primaryContactId:'maya',deputyContactId:'cutover-contact',confirmed:true};updateSettings(sqlite,maya,'site',contactRequest);
    provisionStaffCredential(sqlite,'maya','cutover-owner@example.test','Synthetic-cutover-password');
    const siteRequest={requestId:randomUUID(),name:'Created before cutover',timezone:'UTC',generationLanguages:['en','ur'],confirmed:true},siteActor={...maya,access_mode:'credential'},createdSite=createSite(sqlite,siteActor,siteRequest);
    const accessRequest={requestId:randomUUID(),siteId:createdSite.id,revision:0,state:'paused',reason:'pilot_review',confirmed:true};saveSiteAccess(sqlite,siteActor,accessRequest);
    const lifecycleRequest={requestId:randomUUID(),siteId:createdSite.id,revision:0,state:'archived',reason:'operational',confirmed:true};saveSiteLifecycle(sqlite,siteActor,lifecycleRequest);
    const processingInput={requestId:randomUUID(),revision:1,jobId:null,generation:0};
    const processingResult=requestPreparation(sqlite,maya,first.id,processingInput),processingReceipt=getPreparationRequestReceipt(sqlite,maya,first.id,processingInput.requestId);
    editDraft(sqlite,maya,first.id,{revision:1,title:'Edited before cutover',source:'A different synthetic instruction after creation.'});
    const evidence=sqlite.prepare('SELECT * FROM draft_creations').all().map(row=>({...row}));
    await backupLocal({database:join(root,'source.sqlite'),audioRoot:join(root,'audio'),destination:join(root,'backup')});
    await pg.exec(`CREATE SCHEMA ${schema}`);await runMigrations(pool,{schema});
    const result=await importSqliteBackup(pool,{source:join(root,'backup'),schema,requestId:randomUUID(),dataClass:'synthetic',dryRun:false});assert.equal(result.counts.draft_creations,1);
    assert.equal(result.counts.site_creations,1);
    assert.equal(result.counts.preparation_requests,1);
    assert.deepEqual(await pgPreparationReceipt(pool,maya,first.id,processingInput.requestId,options),processingReceipt);
    assert.deepEqual(await requestPgPreparation(pool,maya,first.id,processingInput,options),{...processingResult,duplicate:true});
    assert.equal(result.counts.site_access_requests,1);assert.equal(result.counts.site_access_controls,1);
    assert.equal(result.counts.site_lifecycle,1);assert.equal(result.counts.site_lifecycle_requests,1);
    await provisionPgCredential(pool,{staffId:'maya',orgId:'cedar',siteId:'beirut',email:'cutover-owner@example.test',password:'Synthetic-cutover-password'},options);
    assert.equal((await pgSiteReceipt(pool,siteActor,siteRequest.requestId,options)).id,createdSite.id);
    assert.deepEqual(await pgCreateSite(pool,siteActor,siteRequest,options),{...createdSite,duplicate:true});
    assert.equal((await pgAccessReceipt(pool,siteActor,accessRequest.requestId,options)).revision,1);
    assert.equal((await pgLifecycleReceipt(pool,siteActor,lifecycleRequest.requestId,options)).revision,1);
    assert.equal((await pgSaveLifecycle(pool,siteActor,lifecycleRequest,options)).duplicate,true);
    assert.equal((await pgSaveAccess(pool,siteActor,accessRequest,options)).duplicate,true);
    const rows=(await pg.query(`SELECT * FROM ${schema}.draft_creations`)).rows.map(row=>({...row,generation_languages_json:row.generation_languages_json===null?null:JSON.stringify(row.generation_languages_json),occurred_at:row.occurred_at.toISOString()}));assert.deepEqual(rows,evidence);
    assert.deepEqual(await createPgDraft(pool,maya,input,options),{...first,duplicate:true});
    assert.equal((await pgDraftReceipt(pool,maya,input.requestId,options)).result.requestHash,first.requestHash);
    assert.deepEqual((await getPgSettings(pool,maya,options)).site.generationLanguages,['en','ar']);
    assert.equal((await getPgSettings(pool,maya,options)).site.deputyContact.id,'cutover-contact');assert.equal((await updatePgSettings(pool,maya,'site',contactRequest,options)).duplicate,true);
    assert.equal(sqlite.prepare("SELECT deputy_contact_id FROM site_settings WHERE site_id='beirut'").get().deputy_contact_id,'cutover-contact');
    assert.equal((await pg.query(`SELECT revision,title FROM ${schema}.briefings WHERE id=$1`,[first.id])).rows[0].revision,2);
    await assert.rejects(()=>createPgDraft(pool,maya,{...input,title:'Edited before cutover',source:'A different synthetic instruction after creation.'},options),/conflict/);
  }finally {sqlite.close();await pg.close();assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep+'understood-pg-import-'));await rm(root,{recursive:true});}
});

test('cutover rejects retained evidence in new or unusually named target tables, without importing or modifying it',async()=>{
  const root=await mkdtemp(join(tmpdir(),'understood-pg-import-')),sqlite=openDatabase(join(root,'source.sqlite'));seed(sqlite);ensureRecordingSchema(sqlite);
  const pg=new PGlite(),pool=poolFor(pg);
  try {
    await backupLocal({database:join(root,'source.sqlite'),audioRoot:join(root,'audio'),destination:join(root,'backup')});
    await pg.exec(`CREATE SCHEMA ${schema}`);await runMigrations(pool,{schema});
    const input={source:join(root,'backup'),schema,requestId:randomUUID(),dataClass:'synthetic',dryRun:false};
    for(const table of ['future_restore_evidence','retained"restore']) {
      const identifier='"'+table.replaceAll('"','""')+'"';
      await pg.exec(`CREATE TABLE ${schema}.${identifier}(evidence text);INSERT INTO ${schema}.${identifier} VALUES('Preserved');`);
      await assert.rejects(importSqliteBackup(pool,input),/Target schema must be empty/);
      assert.deepEqual((await pg.query(`SELECT * FROM ${schema}.${identifier}`)).rows,[{evidence:'Preserved'}]);
      assert.equal((await pg.query(`SELECT count(*)::int n FROM ${schema}.organizations`)).rows[0].n,0);
      assert.equal((await pg.query(`SELECT count(*)::int n FROM ${schema}.sqlite_import_runs`)).rows[0].n,0);
      await pg.exec(`DROP TABLE ${schema}.${identifier}`);
    }
    assert.equal((await importSqliteBackup(pool,{...input,dryRun:true})).duplicate,false);
    assert.equal((await pg.query(`SELECT count(*)::int n FROM ${schema}.organizations`)).rows[0].n,0);
  }finally{sqlite.close();await pg.close();assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep+'understood-pg-import-'));await rm(root,{recursive:true});}
});

test('synthetic cutover preserves populated schedules and reminders and resumes queued intent exactly once',async context=>{
  const now=Date.now();context.mock.timers.enable({apis:['Date'],now});let clock=now;
  const root=await mkdtemp(join(tmpdir(),'understood-pg-import-')),sqlite=openDatabase(join(root,'source.sqlite'));seed(sqlite);
  const pg=new PGlite(),pool=poolFor(pg,()=>false,()=>clock),options={schema,integrationMode:'synthetic'};
  const ready=title=>{const draft=createDraft(sqlite,maya,{requestId:randomUUID(),title,source:CANONICAL_SOURCE});sqlite.prepare("UPDATE briefings SET state='ready',prepared_json=? WHERE id=?").run(JSON.stringify(syntheticPrepare(CANONICAL_SOURCE)),draft.id);return draft.id;};
  const request=(publishAt=now+1000)=>({requestId:randomUUID(),revision:1,nextVersion:1,workerIds:['worker-29'],publishAt:new Date(publishAt).toISOString(),dueAt:new Date(now+1800000).toISOString(),reminderMinutes:60});
  try {
    const pendingBrief=ready('Pending schedule cutover'),pending=request(now+60000);createSchedule(sqlite,maya,pendingBrief,pending);
    const cancelledBrief=ready('Cancelled schedule cutover'),cancelled=request();createSchedule(sqlite,maya,cancelledBrief,cancelled);cancelSchedule(sqlite,maya,cancelledBrief,cancelled.requestId,{confirmed:true});
    const failedBrief=ready('Failed schedule cutover');createSchedule(sqlite,maya,failedBrief,request());sqlite.prepare('UPDATE briefings SET revision=2 WHERE id=?').run(failedBrief);
    const publishedBrief=ready('Published schedule cutover');createSchedule(sqlite,maya,publishedBrief,request());
    clock=now+2000;context.mock.timers.setTime(clock);while(processOneSchedule(sqlite)) {}
    const visibleBrief=ready('Visible reminder cutover'),publication=publish(sqlite,maya,visibleBrief,{requestId:randomUUID(),revision:1,nextVersion:1,workerIds:['worker-28','worker-29','worker-30'],dueAt:new Date(now+1800000).toISOString(),reminderMinutes:60});
    const assignment=sqlite.prepare("SELECT id FROM assignments WHERE publication_id=? AND worker_id='worker-30'").get(publication.id).id;
    submitAnswer(sqlite,worker,assignment,randomUUID(),'Finished on blue; unfinished on yellow.');while(processOneReminder(sqlite)) {}
    const futureBrief=ready('Future reminder cutover');publish(sqlite,maya,futureBrief,{requestId:randomUUID(),revision:1,nextVersion:1,workerIds:['worker-29'],dueAt:new Date(now+7200000).toISOString(),reminderMinutes:60});
    const beforeSchedules=sqlite.prepare('SELECT * FROM publication_schedules ORDER BY id').all(),beforeReminders=sqlite.prepare('SELECT * FROM assignment_reminders ORDER BY assignment_id').all();
    assert.deepEqual(beforeSchedules.map(row=>row.state).sort(),['cancelled','failed','published','queued']);
    assert.deepEqual(beforeReminders.map(row=>row.state).sort(),['queued','skipped','visible','visible','visible']);
    await backupLocal({database:join(root,'source.sqlite'),audioRoot:join(root,'audio'),destination:join(root,'backup')});
    await pg.exec(`CREATE SCHEMA ${schema}`);await runMigrations(pool,{schema});
    const importOptions={source:join(root,'backup'),schema,requestId:randomUUID(),dataClass:'synthetic',dryRun:false};
    const result=await importSqliteBackup(pool,importOptions);assert.equal(result.counts.publication_schedules,4);assert.equal(result.counts.assignment_reminders,5);
    const compare=(table,source,keys)=>pg.query(`SELECT * FROM ${schema}.${table} ORDER BY ${keys}`).then(result=>{assert.equal(result.rows.length,source.length);for(let index=0;index<source.length;index++)for(const [key,value] of Object.entries(source[index])){const actual=result.rows[index][key];assert.deepEqual(actual instanceof Date?actual.toISOString():actual,key.endsWith('_json')?JSON.parse(value):value,`${table}.${key}`);}});
    await compare('publication_schedules',beforeSchedules,'id');await compare('assignment_reminders',beforeReminders,'assignment_id');
    assert.equal((await importSqliteBackup(pool,importOptions)).duplicate,true);
    assert.equal((await createPgSchedule(pool,maya,pendingBrief,pending,options)).duplicate,true);
    assert.equal(await processPgSchedule(pool,options),false);assert.equal(await processPgReminder(pool,options),false);
    clock=now+61000;context.mock.timers.setTime(clock);
    assert.equal(await processPgSchedule(pool,options),true);assert.equal(await processPgSchedule(pool,options),false);
    const completed=(await listPgSchedules(pool,maya,pendingBrief,{},options)).items[0];assert.equal(completed.state,'published');assert.equal(completed.attempts,1);
    assert.equal((await pg.query(`SELECT count(*)::int n FROM ${schema}.assignments WHERE publication_id=$1`,[completed.publicationId])).rows[0].n,1);
    assert.equal(await processPgReminder(pool,options),true);assert.equal(await processPgReminder(pool,options),false);
    assert.equal((await createPgSchedule(pool,maya,pendingBrief,pending,options)).state,'published');
    assert.equal((await pg.query(`SELECT count(*)::int n FROM ${schema}.assignment_reminders`)).rows[0].n,6);
    await assert.rejects(pg.exec(`UPDATE ${schema}.assignment_reminders SET state='queued' WHERE state='visible'`),/immutable/);
    await assert.rejects(pg.exec(`DELETE FROM ${schema}.publication_schedules`),/immutable/);
  }finally {sqlite.close();await pg.close();assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep+'understood-pg-import-'));await rm(root,{recursive:true});}
});

test('synthetic cutover preserves redacted answers and their immutable stage receipt',async()=>{
  const root=await mkdtemp(join(tmpdir(),'understood-pg-import-'));
  const sqlite=openDatabase(join(root,'source.sqlite'));seed(sqlite);ensureCaseMessageSchema(sqlite);
  const pg=new PGlite(),pool=poolFor(pg);
  try{
    const retained=sqlite.prepare('SELECT id,answer_text FROM attempts ORDER BY id LIMIT 1').get();
    const retainedEvidence=[{factIndex:0,quote:retained.answer_text.slice(0,20)}];
    sqlite.prepare('UPDATE attempts SET reasons_json=? WHERE id=?').run(JSON.stringify({reasons:['Retained synthetic reason'],evidence:retainedEvidence}),retained.id);
    submitAnswer(sqlite,worker,'assignment-30',randomUUID(),'Finished on blue; unfinished on yellow.');
    const caseId=randomUUID();requestHelp(sqlite,worker,'assignment-30',{requestId:caseId,text:'Synthetic help before deletion'});
    const message={requestId:randomUUID(),text:'Synthetic conversation before deletion'};
    const originalMessage=sendCaseMessage(sqlite,worker,caseId,message);
    ensurePeopleSchema(sqlite);
    sqlite.prepare('INSERT INTO directory_reactivations VALUES(?,?,?,?,?,?,?,?)')
      .run('deleted-legacy','cedar','beirut','worker-30',null,'Worker 030','maya',new Date().toISOString());
    const deletedImport=previewWorkerImport(sqlite,maya,{requestId:randomUUID(),filename:'Worker 030.csv',bytes:Buffer.from('worker_id,language\nWorker 030,en\n')});
    const change={requestId:randomUUID(),expectedCode:'Worker 030',reason:'worker_request',confirmed:true};
    requestWorkerDeletion(sqlite,maya,'worker-30',change);
    expireWorkerImports(sqlite);
    assert.equal(processOneDeletionRedaction(sqlite),true);
    assert.equal(processOneDeletionRedaction(sqlite),true);
    assert.equal(processOneDeletionPseudonym(sqlite),true);
    assert.equal(await processOneDeletionCompletion(sqlite,{}),true);
    const noticeChange={requestId:randomUUID(),revision:0,confirmed:true,scope:JSON.stringify(['cedar','beirut','maya']),notices:{en:'Synthetic English site notice for cutover.',ar:'معلومات التسجيل التجريبية المحفوظة للموقع.',ur:'سائٹ کی آزمائشی ریکارڈنگ کی محفوظ معلومات۔'}};
    saveRecordingNotice(sqlite,maya,noticeChange);
    await backupLocal({database:join(root,'source.sqlite'),audioRoot:join(root,'audio'),destination:join(root,'backup')});
    await pg.exec(`CREATE SCHEMA ${schema}`);await runMigrations(pool,{schema});
    const result=await importSqliteBackup(pool,{source:join(root,'backup'),schema,requestId:randomUUID(),dataClass:'synthetic',dryRun:false});
    assert.equal(result.counts.worker_deletion_redactions,1);
    assert.equal(result.counts.worker_deletion_pseudonyms,1);
    assert.equal(result.counts.worker_deletion_completions,1);
    assert.equal(result.counts.case_messages,1);
    assert.equal((await listPgMessages(pool,maya,caseId,{}, {schema})).items[0].text,'[Deleted]');
    const migratedMessage=(await pg.query(`SELECT id,request_hash,created_at FROM ${schema}.case_messages`)).rows[0];
    assert.equal(migratedMessage.id,message.requestId);assert.equal(migratedMessage.created_at.toISOString(),originalMessage.createdAt);
    assert.equal(result.counts.recording_notices,1);assert.equal(result.counts.recording_notice_requests,1);
    assert.deepEqual((await pgNotice(pool,maya,{schema})).notices,noticeChange.notices);
    assert.deepEqual((await pgNoticeReceipt(pool,maya,noticeChange.requestId,{schema})).request.notices,noticeChange.notices);
    assert.match((await pg.query(`SELECT code FROM ${schema}.workers WHERE id='worker-30'`)).rows[0].code,/^Deleted /);
    assert.equal((await pg.query(`SELECT expected_label FROM ${schema}.directory_reactivations WHERE request_id='deleted-legacy'`)).rows[0].expected_label,'[Deleted]');
    const minimizedImport=(await pg.query(`SELECT filename,filename_hash FROM ${schema}.worker_imports WHERE id=$1`,[deletedImport.id])).rows[0];
    assert.equal(minimizedImport.filename,'[Deleted].csv');assert.equal(minimizedImport.filename_hash,importFilenameHash('Worker 030.csv'));
    assert.equal((await pg.query(`SELECT answer_text FROM ${schema}.attempts WHERE assignment_id='assignment-30'`)).rows[0].answer_text,'[Deleted]');
    const preserved=(await pg.query(`SELECT reasons_json,evidence_json FROM ${schema}.attempts WHERE id=$1`,[retained.id])).rows[0];
    assert.deepEqual(preserved.reasons_json,['Retained synthetic reason']);assert.deepEqual(preserved.evidence_json,retainedEvidence);
    assert.equal(await pgRedact(pool,{schema}),false);
    assert.equal(await pgPseudonym(pool,{schema}),false);
    assert.equal(await pgComplete(pool,{}, {schema}),false);
  }finally{
    sqlite.close();await pg.close();
    assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep+'understood-pg-import-'));
    await rm(root,{recursive:true});
  }
});

test('retention cutover preserves receipts and tombstones without restoring purged audio or stale leases',async(context)=>{
  context.mock.timers.enable({apis:['Date'],now:Date.now()});
  const root=await mkdtemp(join(tmpdir(),'understood-pg-import-'));
  const sqlite=openDatabase(join(root,'source.sqlite'));seed(sqlite);
  const pg=new PGlite(),pool=poolFor(pg);
  try{
    const first=await receiveRecording(sqlite,worker,'assignment-30',randomUUID(),wav(),join(root,'audio'));
    const second=await receiveRecording(sqlite,worker,'assignment-30',randomUUID(),wav(),join(root,'audio'));
    const policy={requestId:randomUUID(),revision:0,audioDays:30,confirmed:true};
    saveRetention(sqlite,maya,policy);
    context.mock.timers.tick(40*86400000);
    await processOneAudioPurge(sqlite,join(root,'audio'));
    await processOneAudioPurge(sqlite,{async remove(){throw new Error('Synthetic interrupted cleanup');}});
    const complete=sqlite.prepare("SELECT recording_id FROM recording_purges WHERE status='complete'").get().recording_id;
    const interrupted=complete===first.id?second.id:first.id;
    sqlite.prepare("UPDATE recording_purges SET status='processing',lease_token='old-runtime',lease_until=? WHERE recording_id=?")
      .run(new Date(Date.now()+90000).toISOString(),interrupted);
    const deletion={requestId:randomUUID(),expectedCode:'Worker 030',reason:'worker_request',confirmed:true};
    requestWorkerDeletion(sqlite,maya,'worker-30',deletion);
    const backup=await backupLocal({database:join(root,'source.sqlite'),audioRoot:join(root,'audio'),destination:join(root,'backup')});
    assert.equal(backup.recordings,0);
    await pg.exec(`CREATE SCHEMA ${schema}`);await runMigrations(pool,{schema});
    const result=await importSqliteBackup(pool,{source:join(root,'backup'),schema,requestId:randomUUID(),dataClass:'synthetic',dryRun:false});
    assert.equal(result.counts.retention_policies,1);assert.equal(result.counts.retention_requests,1);assert.equal(result.counts.recording_purges,2);
    assert.equal(result.counts.worker_deletion_requests,1);
    await pg.exec(`SET search_path TO ${schema},pg_catalog`);
    await assert.rejects(pg.exec(`UPDATE ${schema}.workers SET active=true WHERE id='worker-30'`),/pending/);
    assert.equal((await pgRetentionReceipt(pool,maya,policy.requestId,{schema})).revision,1);
    const rows=(await pg.query(`SELECT * FROM ${schema}.recording_purges ORDER BY recording_id`)).rows;
    assert.equal(rows.find(row=>row.recording_id===complete).status,'complete');
    const pending=rows.find(row=>row.recording_id===interrupted);
    assert.equal(pending.status,'queued');assert.equal(pending.lease_token,null);assert.equal(pending.lease_until,null);
    let removed;
    await pgAudioPurge(pool,{async remove(row){removed=row.id;},async exists(){return false;}},{schema});
    assert.equal(removed,interrupted);
    assert.equal((await pg.query(`SELECT count(*)::int AS count FROM ${schema}.recording_purges WHERE status='complete'`)).rows[0].count,2);
  }finally{
    sqlite.close();await pg.close();
    assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep+'understood-pg-import-'));
    await rm(root,{recursive:true});
  }
});

test('cutover preserves publication crew provenance and filtered export request/output without inferring current membership',async()=>{
  const root=await mkdtemp(join(tmpdir(),'understood-pg-import-')),sqlite=openDatabase(join(root,'source.sqlite')),pg=new PGlite(),pool=poolFor(pg);
  try{
    seed(sqlite);ensurePeopleSchema(sqlite);const crew=createCrew(sqlite,maya,{name:'Publication crew'});moveWorkerToCrew(sqlite,maya,'worker-30',crew.id);
    sqlite.prepare("UPDATE briefings SET state='ready',prepared_json=? WHERE id='shelf'").run(JSON.stringify(syntheticPrepare(CANONICAL_SOURCE)));
    const draft=sqlite.prepare("SELECT * FROM briefings WHERE id='shelf'").get();
    const publication=publish(sqlite,maya,'shelf',{requestId:randomUUID(),revision:draft.revision,nextVersion:draft.next_version,workerIds:['worker-29','worker-30']});
    const body={requestId:randomUUID(),publicationId:publication.id,filters:{crewId:crew.id,responseFrom:'',responseThrough:''}};
    requestExport(sqlite,maya,body);
    sqlite.prepare("UPDATE report_exports SET status='failed',attempts=1 WHERE id=?").run(body.requestId);
    const retry={requestId:randomUUID(),attempts:1};retryExport(sqlite,maya,body.requestId,retry);processOneExport(sqlite);
    sqlite.prepare("UPDATE crews SET name='Later crew name' WHERE id=?").run(crew.id);sqlite.prepare("DELETE FROM crew_memberships WHERE worker_id='worker-30'").run();
    const frozen=JSON.parse(sqlite.prepare('SELECT snapshot_json FROM report_exports WHERE id=?').get(body.requestId).snapshot_json);
    await backupLocal({database:join(root,'source.sqlite'),audioRoot:join(root,'audio'),destination:join(root,'backup')});
    await pg.exec(`CREATE SCHEMA ${schema}`);await runMigrations(pool,{schema});
    const result=await importSqliteBackup(pool,{source:join(root,'backup'),schema,requestId:randomUUID(),dataClass:'synthetic',dryRun:false});
    assert.equal(result.counts.publication_report_audience,2);
    assert.equal(result.counts.report_export_retries,1);
    const retryReceipt=await pgExportReceipt(pool,maya,'retry',retry.requestId,{schema});assert.equal(retryReceipt.found,true);assert.equal(retryReceipt.result.attempts,1);
    assert.equal((await pgRetryExport(pool,maya,body.requestId,retry,{schema})).duplicate,true);
    const report=await readPublicationReport(pool,maya,{schema,publicationId:publication.id,filters:body.filters});
    assert.equal(report.metrics.assigned,1);assert.equal(report.availableCrews[0].name,'Publication crew');
    const replay=await pgRequestExport(pool,maya,body,{schema});assert.equal(replay.duplicate,true);assert.equal(replay.filters.crewId,crew.id);assert.equal(replay.filters.timezone,'Asia/Beirut');
    const output=await pgDownloadExport(pool,maya,body.requestId,{schema});assert.equal(output.csv.split('\r\n').filter(Boolean).length,2);
    assert.deepEqual((await pg.query(`SELECT snapshot_json FROM ${schema}.report_exports WHERE id=$1`,[body.requestId])).rows[0].snapshot_json,frozen);
  }finally{sqlite.close();await pg.close();assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep+'understood-pg-import-'));await rm(root,{recursive:true});}
});

test('synthetic cutover preserves the automatic Send ledger, deliveries and retry receipts',async(context)=>{
  context.mock.timers.enable({apis:['Date'],now:Date.now()});
  const root=await mkdtemp(join(tmpdir(),'understood-pg-import-')),sqlite=openDatabase(join(root,'source.sqlite'));
  const pg=new PGlite(),pool=poolFor(pg);
  try{
    seed(sqlite);
    ensureRecordingSchema(sqlite);
    const sendRequest={requestId:randomUUID(),title:'Cutover shelf instruction',source:CANONICAL_SOURCE,audience:{type:'all'},responseMode:'question',deliveryMode:'both'};
    startInstructionSend(sqlite,maya,sendRequest);
    while(processOne(sqlite)) {}
    const sent=completeInstructionSend(sqlite,maya,sendRequest.requestId);
    assert.equal(sent.state,'published');assert.equal(sent.delivered,30);assert.equal(sent.undelivered,0);
    const retryId=randomUUID();
    const retryAt=new Date().toISOString();
    sqlite.prepare('INSERT INTO instruction_retries VALUES(?,?,?,?,?,?,?,?)')
      .run(retryId,sendRequest.requestId,'cedar','beirut','maya',1,JSON.stringify({requestId:retryId}),retryAt);
    const deliveries=sqlite.prepare('SELECT worker_id,language,state,assignment_id,content_hash FROM instruction_deliveries WHERE request_id=? ORDER BY worker_id').all(sendRequest.requestId).map(row=>({...row}));
    assert.equal(deliveries.length,30);
    await backupLocal({database:join(root,'source.sqlite'),audioRoot:join(root,'audio'),destination:join(root,'backup')});
    await pg.exec(`CREATE SCHEMA ${schema}`);await runMigrations(pool,{schema});
    const result=await importSqliteBackup(pool,{source:join(root,'backup'),schema,requestId:randomUUID(),dataClass:'synthetic',dryRun:false});
    assert.equal(result.counts.instruction_sends,1);assert.equal(result.counts.instruction_deliveries,30);assert.equal(result.counts.instruction_retries,1);
    const status=await instructionSendStatus(pool,maya,sendRequest.requestId,{schema});
    assert.equal(status.state,'published');assert.equal(status.delivered,30);assert.equal(status.undelivered,0);
    assert.equal(status.responseMode,'question');assert.equal(status.deliveryMode,'both');assert.equal(status.publicationId,sent.publicationId);
    assert.deepEqual(status.deliveryStates,{preparing:0,available:30,blocked:0,failed:0,withdrawn:0});
    assert.deepEqual((await pg.query(`SELECT worker_id,language,state,assignment_id,content_hash FROM ${schema}.instruction_deliveries ORDER BY worker_id`)).rows.map(row=>({...row})),deliveries);
    const retry=(await pg.query(`SELECT * FROM ${schema}.instruction_retries WHERE request_id=$1`,[retryId])).rows[0];
    assert.equal(retry.send_request_id,sendRequest.requestId);assert.equal(retry.generation,1);assert.equal(retry.created_at.toISOString(),retryAt);
    await assert.rejects(pg.exec(`UPDATE ${schema}.instruction_retries SET generation=2 WHERE request_id='${retryId}'`),/immutable/);
    await assert.rejects(pg.exec(`DELETE FROM ${schema}.instruction_deliveries WHERE request_id='${sendRequest.requestId}'`),/immutable/);
  }finally{sqlite.close();await pg.close();assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep+'understood-pg-import-'));await rm(root,{recursive:true});}
});

test('PostgreSQL synthetic migration dry-runs, preserves evidence and scopes reports, then replays exactly once', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const root = await mkdtemp(join(tmpdir(),'understood-pg-import-'));
  const sqlite = openDatabase(join(root,'source.sqlite')); seed(sqlite); ensureRecordingSchema(sqlite); ensureWorkerImportSchema(sqlite);ensureCaseMessageSchema(sqlite);
  const pg = new PGlite(); const pool = poolFor(pg);
  try {
    const crew = createCrew(sqlite, maya, { name: 'Morning Crew' });
    moveWorkerToCrew(sqlite, maya, 'worker-30', crew.id);
    provisionStaffCredential(sqlite, 'maya', 'synthetic@example.test', 'Synthetic-only-test-password-123');
    sqlite.prepare("INSERT INTO staff VALUES('linked-cutover','harbor','harbor-yard','Synthetic linked staff','auditor',1)").run();
    transaction(sqlite,()=>linkAccountMembership(sqlite,'maya','linked-cutover'));
    const accountBefore=sqlite.prepare('SELECT * FROM staff_accounts ORDER BY id').all();
    const membershipsBefore=sqlite.prepare('SELECT * FROM staff_account_memberships ORDER BY staff_id').all();
    const recoveryConfig=resolveMailConfig({mode:'resend',apiKey:'re_synthetic_only',from:'fixture@example.test',key:'01'.repeat(32),publicOrigin:'http://127.0.0.1:3020',allowLocal:true});
    requestRecovery(sqlite,{email:'synthetic@example.test'},'fixture',recoveryConfig);
    await processOneRecovery(sqlite,recoveryConfig,{send:async()=>({providerId:'synthetic-only'})});
    requestRecovery(sqlite,{email:'synthetic@example.test'},'fixture',recoveryConfig);
    const recoveryBefore=JSON.stringify({mail:sqlite.prepare('SELECT * FROM staff_recovery_mail ORDER BY id').all(),tokens:sqlite.prepare('SELECT * FROM staff_recovery_tokens ORDER BY token_hash').all()});
    createSession(sqlite, sqlite.prepare("SELECT * FROM staff WHERE id='maya'").get(), 'staff', 'demo');
    issueWorkerGrant(sqlite, maya, 'worker-30');
    const audio = await receiveRecording(sqlite,worker,'assignment-30',randomUUID(),wav(),join(root,'audio'));
    sqlite.prepare("UPDATE recordings SET status='failed',attempts=3 WHERE id=?").run(audio.id);
    const retryContext=getProcessingRetryContext(sqlite,maya,`response_transcription:${audio.id}`),processingRetry={requestId:randomUUID(),jobId:retryContext.jobId,publicationId:retryContext.publicationId,assignmentId:retryContext.assignmentId,generation:retryContext.generation,confirmed:true};
    retryProcessing(sqlite,maya,retryContext.jobId,processingRetry);
    const processingRetryReceipt=getProcessingRetryReceipt(sqlite,maya,retryContext.jobId,processingRetry.requestId);
    submitAnswer(sqlite,worker,'assignment-30',randomUUID(),'Finished on blue; unfinished on yellow.');
    const exported = requestExport(sqlite,maya,{ requestId:randomUUID(),publicationId:'shelf-v3' }); processOneExport(sqlite);
    const notificationEvent=sqlite.prepare("SELECT id FROM audit WHERE action='export.ready'").get().id;
    const notificationReadAt=new Date().toISOString();
    sqlite.prepare('INSERT INTO notification_reads VALUES(?,?,?,?,?)').run(notificationEvent,'maya','cedar','beirut',notificationReadAt);
    const preview = previewWorkerImport(sqlite,maya,{ requestId:randomUUID(),filename:'crew.csv',bytes:Buffer.from('worker_id,language,crew\nNew Synthetic,ar,Morning Crew\n') });
    confirmWorkerImport(sqlite,maya,preview.id);
    const restore={requestId:randomUUID(),expectedName:crew.name,confirmed:true},enable={requestId:randomUUID(),expectedCode:'Worker 030',confirmed:true};
    restoreCrew(sqlite,maya,crew.id,restore);reenableWorker(sqlite,maya,'worker-30',enable);
    const copy={requestId:randomUUID(),revision:1,title:'Copied imported shelf',confirmed:true};
    copyDraft(sqlite,maya,'shelf',copy);editDraft(sqlite,maya,copy.requestId,{revision:1,title:'Edited imported copy',source:'Changed text after the original copy request.'});
    const archive={requestId:randomUUID(),revision:2,nextVersion:1,reason:'Retire the imported copy',confirmed:true};
    archiveBriefing(sqlite,maya,copy.requestId,archive);
    ensureBillingSchema(sqlite);const invoiceRequest={requestId:randomUUID(),number:'CUTOVER-001',description:'Synthetic invoice',issueDate:'2026-10-01',dueDate:'2026-10-10',amount:'25',confirmed:true};
    createInvoice(sqlite,maya,invoiceRequest);const paymentRequest={requestId:randomUUID(),amount:'10.10',date:'2026-10-01',reference:'Synthetic received payment',note:'',confirmed:true};recordPayment(sqlite,maya,invoiceRequest.requestId,paymentRequest);
    const voidInvoiceRequest={...invoiceRequest,requestId:randomUUID(),number:'CUTOVER-VOID'};createInvoice(sqlite,maya,voidInvoiceRequest);
    const voidRequest={requestId:randomUUID(),number:'CUTOVER-VOID',amount:'25.00',reason:'Synthetic invoice error',confirmed:true};voidInvoice(sqlite,maya,voidInvoiceRequest.requestId,voidRequest);
    ensureSettingsSchema(sqlite);const settingsRequest={requestId:randomUUID(),revision:0,name:'Imported Synthetic Organization',supportEmail:'support@example.test',confirmed:true};updateSettings(sqlite,maya,'organization',settingsRequest);
    const reviewDraft=createDraft(sqlite,maya,{requestId:randomUUID(),title:'Imported review draft',source:CANONICAL_SOURCE});
    const reviewRequest={requestId:randomUUID(),revision:1,question:'',facts:[],askedFacts:[],translations:{ar:{title:'تعليمات الرفوف',text:'ضع المكتمل على الأزرق وغير المكتمل على الأصفر.',question:'أين ستضع كل نوع؟'}},confirmed:true};saveDraftReview(sqlite,maya,reviewDraft.id,reviewRequest);
    ensureTemplateSchema(sqlite);const templateRequest={requestId:randomUUID(),title:'Imported template',description:'',source:CANONICAL_SOURCE,question:'',facts:[],askedFacts:[],confirmed:true};
    changeTemplate(sqlite,maya,'create',null,templateRequest);
    const templateUse={requestId:randomUUID(),title:'Imported template briefing',revision:1,confirmed:true};changeTemplate(sqlite,maya,'use',templateRequest.requestId,templateUse);
    const helpId=randomUUID(),helpText='Not sure about the second shelf';
    sqlite.prepare('INSERT INTO clarifications VALUES(?,?,?,?,?,?,?,?,?)').run(helpId,'cedar','assignment-30',null,'Help requested',null,'open',helpText,new Date().toISOString());
    ensureClarificationSchema(sqlite);
    const modernHelpId=randomUUID();requestHelp(sqlite,worker,'assignment-30',{requestId:modernHelpId,text:'Modern original help text'});
    const conversationInput={requestId:randomUUID(),text:'Synthetic original conversation for cutover'};
    const conversationReceipt=sendCaseMessage(sqlite,worker,modernHelpId,conversationInput);
    const routingBefore=sqlite.prepare('SELECT due_at,manual,routed_owner_id FROM case_routing WHERE case_id=?').get(modernHelpId);
    resolveLocalHelp(sqlite,maya,modernHelpId,{notes:'Resolved before migration; original text stays saved.'});
    sqlite.prepare("UPDATE workers SET language='en' WHERE id='worker-30'").run();
    const beforeReport = reportActivity(sqlite,maya,sqlite.prepare("SELECT * FROM publications WHERE id='shelf-v3'").get());
    const before = beforeReport.metrics, beforeRows = beforeReport.rows;
    const withdrawal={requestId:randomUUID(),publicationId:'shelf-v3',version:3,reason:'Preserve withdrawn history during cutover'};
    withdrawPublication(sqlite,maya,'shelf',withdrawal);
    const glossaryRequest={requestId:randomUUID(),term:'blue shelf',sourceLanguage:'en',targetLanguage:'ar',override:'',confirmed:true};changeGlossary(sqlite,maya,'create',null,glossaryRequest);
    sqlite.prepare("INSERT INTO staff VALUES('access-test','cedar','beirut','Synthetic staff cutover','supervisor',1)").run();
    const staffRequest={requestId:randomUUID(),revision:1,role:'administrator',confirmed:true};changeStaff(sqlite,maya,'access-test','role',staffRequest);
    await backupLocal({ database:join(root,'source.sqlite'),audioRoot:join(root,'audio'),destination:join(root,'backup') });
    await pg.exec(`CREATE SCHEMA ${schema}`); await runMigrations(pool,{ schema });
    const options = { source:join(root,'backup'),schema,requestId:randomUUID(),dataClass:'synthetic' };
    const existingMail=randomUUID();
    await pg.query(`INSERT INTO ${schema}.staff_recovery_mail(id,purpose,email_hash,expires_at,state)
      VALUES($1,'notice',$2,clock_timestamp()+interval '1 hour','queued')`,[existingMail,'a'.repeat(64)]);
    await assert.rejects(importSqliteBackup(pool,options),/must be empty/);
    await pg.query(`DELETE FROM ${schema}.staff_recovery_mail WHERE id=$1`,[existingMail]);
    assert.equal((await importSqliteBackup(pool,options)).dryRun,true);
    assert.equal((await pg.query(`SELECT COUNT(*)::int AS n FROM ${schema}.organizations`)).rows[0].n,0);
    assert.equal((await pg.query(`SELECT COUNT(*)::int AS n FROM ${schema}.sqlite_import_runs`)).rows[0].n,0);
    const rolledBackSequence = (await pg.query(`SELECT last_value,is_called FROM ${schema}.submission_receipts_sequence_seq`)).rows[0];
    assert.equal(BigInt(rolledBackSequence.last_value),1n); assert.equal(rolledBackSequence.is_called,false);
    const result = await importSqliteBackup(pool,{ ...options,dryRun:false });
    assert.equal((await listPgStaff(pool,maya,{role:'administrator'},{schema})).items[0].revision,2);
    assert.equal((await changePgStaff(pool,maya,'access-test','role',staffRequest,{schema})).duplicate,true);
    assert.equal(result.counts.attempts,25); assert.equal(result.credentialsImported,false);
    assert.equal(result.counts.notification_reads,1);
    const notificationRead=(await pg.query(`SELECT * FROM ${schema}.notification_reads`)).rows[0];
    assert.equal(notificationRead.event_id,notificationEvent);assert.equal(notificationRead.staff_id,'maya');assert.equal(notificationRead.read_at.toISOString(),notificationReadAt);
    assert.equal(result.counts.staff_accounts,1);assert.equal(result.counts.staff_account_memberships,2);
    assert.deepEqual((await pg.query(`SELECT * FROM ${schema}.staff_accounts ORDER BY id`)).rows.map(row=>({...row,active:Number(row.active)})),accountBefore.map(row=>({...row})));
    assert.deepEqual((await pg.query(`SELECT * FROM ${schema}.staff_account_memberships ORDER BY staff_id`)).rows,membershipsBefore.map(row=>({...row})));
    assert.deepEqual(sqlite.prepare('SELECT * FROM staff_accounts ORDER BY id').all(),accountBefore);
    assert.deepEqual(sqlite.prepare('SELECT * FROM staff_account_memberships ORDER BY staff_id').all(),membershipsBefore);
    assert.equal('staff_recovery_mail' in result.counts,false);assert.equal('staff_recovery_tokens' in result.counts,false);
    for(const table of ['staff_recovery_mail','staff_recovery_tokens'])
      assert.equal((await pg.query(`SELECT COUNT(*)::int n FROM ${schema}.${table}`)).rows[0].n,0);
    assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM staff_recovery_tokens').get().n,1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM staff_recovery_mail WHERE state='queued'").get().n,1);
    assert.equal(JSON.stringify({mail:sqlite.prepare('SELECT * FROM staff_recovery_mail ORDER BY id').all(),tokens:sqlite.prepare('SELECT * FROM staff_recovery_tokens ORDER BY token_hash').all()}),recoveryBefore);
    assert.equal(result.counts.publication_withdrawals,1);
    assert.equal(result.counts.directory_reactivations,2);
    assert.equal(result.counts.briefing_copies,1);
    assert.equal(result.counts.briefing_archives,1);
    assert.equal(result.counts.invoices,2);assert.equal(result.counts.invoice_payments,1);assert.equal(result.counts.invoice_voids,1);
    assert.equal((await getPgInvoice(pool,maya,voidInvoiceRequest.requestId,{}, {schema})).status,'void');
    assert.equal((await voidPgInvoice(pool,maya,voidInvoiceRequest.requestId,voidRequest,{schema})).duplicate,true);
    assert.equal(result.counts.organization_settings,1);assert.equal(result.counts.settings_requests,1);
    assert.equal((await getPgSettings(pool,maya,{schema})).organization.name,'Imported Synthetic Organization');
    assert.equal((await updatePgSettings(pool,maya,'organization',settingsRequest,{schema})).duplicate,true);
    assert.equal(result.counts.draft_reviews,2);assert.equal(result.counts.briefing_review_requests,1);
    assert.equal(result.counts.templates,1);assert.equal(result.counts.template_versions,1);assert.equal(result.counts.template_requests,2);
    assert.equal((await changePgTemplate(pool,maya,'create',null,templateRequest,{schema})).duplicate,true);
    assert.equal((await changePgTemplate(pool,maya,'use',templateRequest.requestId,templateUse,{schema})).duplicate,true);
    assert.equal((await getPgTemplate(pool,maya,templateRequest.requestId,{}, {schema})).selected.content.source,CANONICAL_SOURCE);
    assert.equal((await savePgReview(pool,maya,reviewDraft.id,reviewRequest,{schema})).duplicate,true);
    assert.equal((await pg.query(`SELECT content_json FROM ${schema}.draft_reviews WHERE briefing_id=$1`,[reviewDraft.id])).rows[0].content_json.revision,3);
    assert.deepEqual((await pg.query(`SELECT content_json FROM ${schema}.draft_reviews WHERE briefing_id=$1`,[reviewDraft.id])).rows[0].content_json.translations,reviewRequest.translations);
    assert.deepEqual((await pg.query(`SELECT request_json FROM ${schema}.briefing_review_requests WHERE request_id=$1`,[reviewRequest.requestId])).rows[0].request_json.translations,reviewRequest.translations);
    assert.equal(result.counts.glossary_terms,1);assert.equal(result.counts.glossary_versions,1);assert.equal(result.counts.glossary_requests,1);
    assert.equal((await changePgGlossary(pool,maya,'create',null,glossaryRequest,{schema})).duplicate,true);
    assert.equal((await getPgGlossary(pool,maya,glossaryRequest.requestId,{}, {schema})).selected.content.suggestion,'الرف الأزرق');
    await pg.exec(`SET search_path TO ${schema},pg_catalog`);const glossaryClient=await pool.connect();try {assert.deepEqual(await readPgGlossary(glossaryClient,'cedar','beirut'),readGlossarySnapshot(sqlite,'cedar','beirut'));}finally {glossaryClient.release();}
    assert.equal((await getPgInvoice(pool,maya,invoiceRequest.requestId,{}, {schema})).balanceCents,1490);
    assert.equal((await recordPgPayment(pool,maya,invoiceRequest.requestId,paymentRequest,{schema})).duplicate,true);
    assert.equal((await archivePgBriefing(pool,maya,copy.requestId,archive,{schema})).duplicate,true);
    assert.deepEqual(await copyPgDraft(pool,maya,'shelf',copy,{schema}),{id:copy.requestId,state:'draft',revision:2,duplicate:true});
    assert.equal((await restorePgCrew(pool,maya,crew.id,restore,{schema})).duplicate,true);
    assert.equal((await reenablePgWorker(pool,maya,'worker-30',enable,{schema})).duplicate,true);
    assert.equal((await pg.query(`SELECT reason,version FROM ${schema}.publication_withdrawals`)).rows[0].reason,withdrawal.reason);
    assert.equal((await pg.query(`SELECT state FROM ${schema}.publications WHERE id='shelf-v3'`)).rows[0].state,'withdrawn');
    const after = await readPublicationReport(pool,maya,{ schema,publicationId:'shelf-v3' });
    assert.deepEqual(after.metrics,before); assert.deepEqual(after.rows,beforeRows); assert.equal(after.timezone,'Asia/Beirut');
    assert.equal(after.availablePublications.length,1);
    assert.equal((await pg.query(`SELECT language FROM ${schema}.assignments WHERE id='assignment-30'`)).rows[0].language,'ur');
    assert.equal((await pg.query(`SELECT language FROM ${schema}.workers WHERE id='worker-30'`)).rows[0].language,'en');
    const pgPublication = (await pg.query(`SELECT snapshot_json FROM ${schema}.publications WHERE id='shelf-v3'`)).rows[0];
    assert.deepEqual(pgPublication.snapshot_json,JSON.parse(sqlite.prepare("SELECT snapshot_json FROM publications WHERE id='shelf-v3'").get().snapshot_json));
    assert.equal((await pg.query(`SELECT status FROM ${schema}.recordings WHERE id=$1`,[audio.id])).rows[0].status,'received');
    assert.equal(result.counts.processing_retries,1);
    assert.deepEqual(await pgProcessingReceipt(pool,maya,processingRetry.jobId,processingRetry.requestId,{schema}),processingRetryReceipt);
    assert.deepEqual(await pgRetryProcessing(pool,maya,processingRetry.jobId,processingRetry,{schema}),processingRetryReceipt.result);
    assert.equal((await pg.query(`SELECT count(*)::int AS n FROM ${schema}.processing_retries`)).rows[0].n,1);
    assert.equal((await pg.query(`SELECT COUNT(*)::int AS n FROM ${schema}.sessions WHERE revoked_at IS NULL`)).rows[0].n,0);
    assert.equal((await pg.query(`SELECT COUNT(*)::int AS n FROM ${schema}.worker_grants WHERE revoked_at IS NULL`)).rows[0].n,0);
    assert.equal((await pg.query(`SELECT COUNT(*)::int AS n FROM ${schema}.staff_credentials`)).rows[0].n,0);
    await provisionPgCredential(pool,{staffId:'linked-cutover',orgId:'harbor',siteId:'harbor-yard',email:'new-synthetic@example.test',password:'Replacement-synthetic-password-123'},{schema});
    assert.equal((await pg.query(`SELECT staff_id FROM ${schema}.staff_credentials`)).rows[0].staff_id,'maya');
    assert.deepEqual((await pg.query(`SELECT * FROM ${schema}.staff_account_memberships ORDER BY staff_id`)).rows,membershipsBefore.map(row=>({...row})));
    assert.equal((await pg.query(`SELECT status FROM ${schema}.report_exports WHERE id=$1`,[exported.id])).rows[0].status,'ready');
    assert.equal((await pg.query(`SELECT imported_count FROM ${schema}.worker_imports WHERE id=$1`,[preview.id])).rows[0].imported_count,1);
    assert.equal((await pg.query(`SELECT COUNT(*)::int AS n FROM ${schema}.crew_memberships`)).rows[0].n,2);
    assert.equal((await getClarification(pool,maya,helpId,{schema})).helpRequest.text,helpText);
    assert.equal((await getClarification(pool,maya,helpId,{schema})).case_due_at,null);
    const migratedModern=await getClarification(pool,maya,modernHelpId,{schema});
    assert.equal(migratedModern.helpRequest.text,'Modern original help text');assert.equal(migratedModern.status,'resolved');
    assert.equal(migratedModern.case_due_at,routingBefore.due_at);assert.equal(migratedModern.escalated_at,null);
    const migratedRouting=(await pg.query(`SELECT manual,routed_owner_id FROM ${schema}.case_routing WHERE case_id=$1`,[modernHelpId])).rows[0];
    assert.deepEqual(await pgMessageReceipt(pool,worker,modernHelpId,conversationInput.requestId,{schema}),conversationReceipt);
    assert.equal(migratedRouting.manual,Boolean(routingBefore.manual));assert.equal(migratedRouting.routed_owner_id,routingBefore.routed_owner_id);
    await resolveClarification(pool,maya,helpId,{notes:'Reviewed in person; original answer preserved.'},{schema});
    assert.equal((await getClarification(pool,maya,helpId,{schema})).helpRequest.text,helpText);
    const receipts = (await pg.query(`SELECT sequence,kind,received_at FROM ${schema}.submission_receipts WHERE assignment_id='assignment-30' ORDER BY sequence`)).rows;
    assert.equal(receipts[0].received_at.getTime(),receipts[1].received_at.getTime());
    assert.deepEqual(receipts.map((row) => row.kind),['audio','typed']);
    const next = await pg.query(`INSERT INTO ${schema}.submission_receipts(org_id,assignment_id,submission_id,kind,received_at)
      VALUES ('cedar','assignment-30','next-receipt','typed',now()) RETURNING sequence`);
    assert.ok(BigInt(next.rows[0].sequence)>BigInt(receipts[1].sequence));
    const replay = await importSqliteBackup(pool,{ ...options,dryRun:false }); assert.equal(replay.duplicate,true);
    assert.equal((await pg.query(`SELECT COUNT(*)::int AS n FROM ${schema}.audit WHERE action='sqlite.imported'`)).rows[0].n,2);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM sessions WHERE revoked_at IS NULL').get().n,1);
    await assert.rejects(readPublicationReport(pool,worker,{ schema }),/Forbidden/);
    await assert.rejects(readPublicationReport(pool,{ ...maya,org_id:'harbor',site_id:'harbor-yard',principal_id:'harbor-owner' },{ schema,publicationId:'shelf-v3' }),/unavailable/);
    await assert.rejects(readPublicationReport(pool,{ ...maya,site_id:'harbor-yard' },{ schema }),/Forbidden/);
    await pg.query(`UPDATE ${schema}.staff SET active=false WHERE id='maya'`);
    await assert.rejects(readPublicationReport(pool,maya,{ schema }),/Forbidden/);
    await assert.rejects(importSqliteBackup(pool,{ ...options,requestId:randomUUID(),dryRun:false }),/must be empty/);
    await assert.rejects(importSqliteBackup(pool,{ ...options,schema:'public' }),/isolated/);
    await assert.rejects(importSqliteBackup(pool,{ ...options,dataClass:'real_worker' }),/Synthetic migration/);
  } finally {
    sqlite.close(); await pg.close();
    assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep+'understood-pg-import-'));
    await rm(root,{ recursive:true });
  }
});

test('PostgreSQL import failure rolls back all rows and a new backup conflicts with the old request ID', async () => {
  const root = await mkdtemp(join(tmpdir(),'understood-pg-import-'));
  const sqlite = openDatabase(join(root,'source.sqlite')); seed(sqlite); ensureRecordingSchema(sqlite);
  const pg = new PGlite(); let fail = true;
  const pool = poolFor(pg,(sql) => fail && sql.startsWith('INSERT INTO "clarifications"'));
  try {
    await backupLocal({ database:join(root,'source.sqlite'),audioRoot:join(root,'audio'),destination:join(root,'backup') });
    await pg.exec(`CREATE SCHEMA ${schema}`); await runMigrations(pool,{ schema });
    const options = { source:join(root,'backup'),schema,requestId:randomUUID(),dataClass:'synthetic',dryRun:false };
    await assert.rejects(importSqliteBackup(pool,options),/Injected/);
    assert.equal((await pg.query(`SELECT COUNT(*)::int AS n FROM ${schema}.organizations`)).rows[0].n,0);
    assert.equal((await pg.query(`SELECT COUNT(*)::int AS n FROM ${schema}.attempts`)).rows[0].n,0);
    fail=false; await importSqliteBackup(pool,options);
    await backupLocal({ database:join(root,'source.sqlite'),audioRoot:join(root,'audio'),destination:join(root,'second-backup') });
    await assert.rejects(importSqliteBackup(pool,{ ...options,source:join(root,'second-backup') }),/request ID conflict/);
  } finally {
    sqlite.close(); await pg.close();
    assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep+'understood-pg-import-'));
    await rm(root,{ recursive:true });
  }
});

test('legacy synthetic backup without captured language imports current preference explicitly',async () => {
  const root=await mkdtemp(join(tmpdir(),'understood-pg-import-'));
  const sqlite=openDatabase(join(root,'source.sqlite')); seed(sqlite); ensureRecordingSchema(sqlite);
  const pg=new PGlite(),pool=poolFor(pg);
  try {
    sqlite.exec('DROP TRIGGER assignment_language_frozen; DROP TRIGGER assignment_language_available; ALTER TABLE assignments DROP COLUMN language;');
    sqlite.prepare("UPDATE workers SET language='en' WHERE id='worker-30'").run();
    await backupLocal({database:join(root,'source.sqlite'),audioRoot:join(root,'audio'),destination:join(root,'backup')});
    await pg.exec(`CREATE SCHEMA ${schema}`); await runMigrations(pool,{schema});
    await importSqliteBackup(pool,{source:join(root,'backup'),schema,requestId:randomUUID(),dataClass:'synthetic',dryRun:false});
    assert.equal((await pg.query(`SELECT language FROM ${schema}.assignments WHERE id='assignment-30'`)).rows[0].language,'en');
    assert.equal((await pg.query(`SELECT COUNT(*)::int AS n FROM ${schema}.attempts`)).rows[0].n,24);
  } finally {
    sqlite.close(); await pg.close();
    assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep+'understood-pg-import-'));
    await rm(root,{recursive:true});
  }
});

test('synthetic cutover retains notification events and read receipts but never revives push bindings or deliveries', async () => {
  const root=await mkdtemp(join(tmpdir(),'understood-pg-import-'));
  const sqlite=openDatabase(join(root,'source.sqlite')); seed(sqlite); ensureRecordingSchema(sqlite);
  const pg=new PGlite(),pool=poolFor(pg);
  try {
    const token='a'.repeat(64),expires=new Date(Date.now()+86400000).toISOString();
    sqlite.prepare(`INSERT INTO sessions(token_hash,org_id,site_id,principal_type,principal_id,expires_at,revoked_at,grant_id,access_mode)
      VALUES(?,?,?,?,?,?,NULL,NULL,?)`).run(token,'cedar','beirut','worker','worker-30',expires,'demo');
    const session={principal_type:'worker',principal_id:'worker-30',org_id:'cedar',site_id:'beirut',token_hash:token,access_mode:'demo'};
    const saved=savePushSubscription(sqlite,session,{endpoint:'https://fcm.googleapis.com/fcm/send/import-notify',
      keys:{p256dh:Buffer.alloc(65,7).toString('base64url'),auth:Buffer.alloc(16,9).toString('base64url')},expirationTime:null});
    recordWorkerEvent(sqlite,{orgId:'cedar',siteId:'beirut',workerId:'worker-30',kind:'instruction.available',
      objectType:'assignment',objectId:'assignment-30',dedupeKey:'import:notification'});
    const event=sqlite.prepare("SELECT id FROM notification_events WHERE dedupe_key='import:notification'").get();
    readWorkerNotification(sqlite,session,event.id);
    assert.equal(sqlite.prepare('SELECT state FROM push_deliveries WHERE subscription_id=?').get(saved.id).state,'queued');
    await backupLocal({database:join(root,'source.sqlite'),audioRoot:join(root,'audio'),destination:join(root,'backup')});
    await pg.exec(`CREATE SCHEMA ${schema}`); await runMigrations(pool,{schema});
    await importSqliteBackup(pool,{source:join(root,'backup'),schema,requestId:randomUUID(),dataClass:'synthetic',dryRun:false});
    assert.equal((await pg.query(`SELECT COUNT(*)::int AS n FROM ${schema}.notification_events WHERE dedupe_key='import:notification'`)).rows[0].n,1);
    assert.equal((await pg.query(`SELECT COUNT(*)::int AS n FROM ${schema}.notification_event_reads`)).rows[0].n,1);
    assert.equal((await pg.query(`SELECT COUNT(*)::int AS n FROM ${schema}.push_subscriptions`)).rows[0].n,0);
    assert.equal((await pg.query(`SELECT COUNT(*)::int AS n FROM ${schema}.push_deliveries`)).rows[0].n,0);
  } finally {
    sqlite.close(); await pg.close();
    assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep+'understood-pg-import-'));
    await rm(root,{recursive:true});
  }
});

test('receipt comparison handles PostgreSQL bigint strings without lexicographic or precision errors', () => {
  const row = { audio_status:'received',audio_submission:'audio',attempt_submission:'typed',audio_order:'9',attempt_order:'10' };
  assert.equal(isCurrentRecording(row),false);
  assert.equal(isCurrentRecording({ ...row,audio_order:'9007199254740993',attempt_order:'9007199254740992' }),true);
});
