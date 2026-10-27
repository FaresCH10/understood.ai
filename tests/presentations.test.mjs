import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {openDatabase} from '../server/db.mjs';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {submitAnswer} from '../server/domain.mjs';
import {submitAnswer as pgSubmitAnswer,domainTransaction as pgDomainTransaction} from '../server/postgres/domain.mjs';
import {createPresentation,listPresentations,checkedPresentationBinding} from '../server/presentations.mjs';
import {createPresentation as pgCreatePresentation,listPresentations as pgListPresentations,
  checkedPresentationBinding as pgCheckedPresentationBinding} from '../server/postgres/presentations.mjs';
import {requestWorkerDeletion} from '../server/deletions.mjs';
import {requestWorkerDeletion as pgRequestWorkerDeletion} from '../server/postgres/deletions.mjs';
import {processOneDeletionRedaction} from '../server/deletion-redactions.mjs';
import {processOneDeletionRedaction as pgProcessOneDeletionRedaction} from '../server/postgres/deletion-redactions.mjs';
import {presentationLanguage,presentationRequest,presentationSourceHash,translatedPresentationContent} from '../server/presentation-input.mjs';
import {WORKER_LANGUAGE_CODES} from '../server/languages.mjs';

const org='org',site='site';
const owner={principal_type:'staff',principal_id:'owner',org_id:org,site_id:site,role:'owner'};
const asWorker=(id)=>({principal_type:'worker',principal_id:id,org_id:org,site_id:site});
const enInstruction={title:'Shelf arrangement',text:'Move finished items to the blue shelf.',question:'Which shelf should finished items go on?'};
const arInstruction={title:'ترتيب الرف',text:'انقل العناصر المكتملة إلى الرف الأزرق.',question:'إلى أي رف توضع العناصر المكتملة؟'};
const urInstruction={title:'شیلف ترتیب',text:'مکمل اشیاء کو نیلے شیلف پر رکھیں۔',question:'مکمل اشیاء کس شیلف پر رکھی جائیں؟'};
const snapshot={question:enInstruction.question,facts:['Finished items on the blue shelf'],
  languages:{en:enInstruction,ar:arInstruction}};
const snapshotWithoutTarget={question:enInstruction.question,facts:['Finished items on the blue shelf'],
  languages:{en:enInstruction}};
const answerText='Finished items go on the blue shelf';

function sqliteBackend(){
  return {
    name:'SQLite',
    async open(){
      const db=openDatabase(':memory:');
      db.exec(`INSERT INTO organizations(id,name) VALUES('${org}','Org');
        INSERT INTO sites(id,org_id,name,timezone) VALUES('${site}','${org}','Site','UTC');
        INSERT INTO staff(id,org_id,site_id,name,role) VALUES('owner','${org}','${site}','Synthetic Owner','owner');
        INSERT INTO workers(id,org_id,site_id,code,language) VALUES
          ('w-ar','${org}','${site}','Worker 001','ar'),('w-en','${org}','${site}','Worker 002','en'),
          ('w-ur','${org}','${site}','Worker 003','ur'),('w-hi','${org}','${site}','Worker 004','hi');
        INSERT INTO briefings(id,org_id,site_id,title,source,state,created_at,updated_at) VALUES
          ('b-main','${org}','${site}','Shelf','Synthetic source','ready','2026-10-24T00:00:00.000Z','2026-10-24T00:00:00.000Z'),
          ('b-en','${org}','${site}','Shelf','Synthetic source','ready','2026-10-24T00:00:00.000Z','2026-10-24T00:00:00.000Z');`);
      const publication=db.prepare('INSERT INTO publications(id,org_id,site_id,briefing_id,version,snapshot_json,published_at,state) VALUES(?,?,?,?,?,?,?,?)');
      publication.run('p-main',org,site,'b-main',1,JSON.stringify(snapshot),'2026-10-24T00:00:00.000Z','published');
      publication.run('p-en',org,site,'b-en',1,JSON.stringify(snapshotWithoutTarget),'2026-10-24T00:00:00.000Z','published');
      const assignment=db.prepare('INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,due_at,created_at,language) VALUES(?,?,?,?,?,?,?,?)');
      for(const [id,publicationId,workerId] of [['a-main','p-main','w-ar'],['a-en','p-main','w-en'],
        ['a-ur','p-en','w-ur'],['a-hi','p-en','w-hi'],['a-ur-main','p-main','w-ur']])
        assignment.run(id,org,site,publicationId,workerId,null,'2026-10-24T00:00:00.000Z','en');
      return {db};
    },
    async close(ctx){ctx.db.close();},
    create(ctx,session,assignmentId,input,options){return createPresentation(ctx.db,session,assignmentId,input,options);},
    async list(ctx,session,assignmentId){return listPresentations(ctx.db,session,assignmentId);},
    async binding(ctx,session,assignmentId,id){return checkedPresentationBinding(ctx.db,session,assignmentId,id);},
    async submit(ctx,session,assignmentId,submissionId,text,presentationId=null){
      return submitAnswer(ctx.db,session,assignmentId,submissionId,text,presentationId);
    },
    setWorkerLanguage(ctx,id,language){ctx.db.prepare('UPDATE workers SET language=? WHERE id=?').run(language,id);},
    artifact(ctx,id){return ctx.db.prepare('SELECT * FROM presentation_artifacts WHERE id=?').get(id);},
    bindingRow(ctx,attemptId){return ctx.db.prepare('SELECT * FROM answer_presentation_bindings WHERE attempt_id=?').get(attemptId);},
    attempt(ctx,id){return ctx.db.prepare('SELECT id,submission_id,answer_text,outcome FROM attempts WHERE id=?').get(id);},
    snapshot(ctx,id){return ctx.db.prepare('SELECT snapshot_json FROM publications WHERE id=?').get(id).snapshot_json;},
    assignmentLanguage(ctx,id){return ctx.db.prepare('SELECT language FROM assignments WHERE id=?').get(id).language;},
    auditCount(ctx,action){return ctx.db.prepare('SELECT count(*) AS n FROM audit WHERE action=?').get(action).n;},
    artifactCount(ctx){return ctx.db.prepare('SELECT count(*) AS n FROM presentation_artifacts').get().n;},
    async run(ctx,sql,params=[]){return ctx.db.prepare(sql).run(...params);},
    async insertPending(ctx,row){
      ctx.db.prepare(`INSERT INTO presentation_artifacts(id,org_id,site_id,worker_id,assignment_id,publication_id,
        publication_version,source_kind,source_id,original_language,target_language,source_hash,status,title,text,question,
        provider,live,error_code,lease_token,lease_until,created_at,updated_at,ready_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'pending',NULL,NULL,NULL,NULL,NULL,NULL,?,?,?,?,NULL)`)
        .run(row.id,org,site,row.workerId,row.assignmentId,row.publicationId,row.version,row.sourceKind,
          row.sourceId,row.originalLanguage,row.targetLanguage,row.sourceHash??'a'.repeat(64),row.token,
          new Date(Date.now()+120000).toISOString(),new Date().toISOString(),new Date().toISOString());
    },
    setEntitlement(ctx,{state='read_only',endsAt=null,workerLimit=25,plan='trial'}={}){
      const existing=ctx.db.prepare('SELECT revision FROM organization_entitlements WHERE org_id=?').get(org);
      if(existing)ctx.db.prepare(`UPDATE organization_entitlements SET state=?,ends_at=?,worker_limit=?,plan=?,
        revision=revision+1,updated_by='synthetic-test',updated_at=? WHERE org_id=?`)
        .run(state,endsAt,workerLimit,plan,new Date().toISOString(),org);
      else ctx.db.prepare(`INSERT INTO organization_entitlements(org_id,state,started_at,ends_at,worker_limit,plan,
        revision,updated_by,updated_at) VALUES(?,?,?,?,?,?,1,'synthetic-test',?)`)
        .run(org,state,new Date(Date.now()-86400000).toISOString(),endsAt,workerLimit,plan,new Date().toISOString());
    },
    requestDeletion(ctx,session,workerId,input){return requestWorkerDeletion(ctx.db,session,workerId,input);},
    redact(ctx){return processOneDeletionRedaction(ctx.db);}
  };
}

function postgresBackend(){
  const q=async(ctx,sql,params=[])=>params.length?await ctx.db.query(sql,params):(await ctx.db.exec(sql)).at(-1)||{rows:[]};
  const placeholders=(sql)=>{let index=0;return sql.replace(/\?/g,()=>`$${++index}`);};
  return {
    name:'PostgreSQL',
    async open(){
      const db=new PGlite();
      const client={async query(sql,values){return values?.length?db.query(sql,values):(await db.exec(sql)).at(-1)||{rows:[]};},release(){}};
      const pool={async connect(){return client;}};
      await runMigrations(pool);
      await db.exec(`INSERT INTO organizations(id,name) VALUES('${org}','Org');
        INSERT INTO sites(id,org_id,name,timezone) VALUES('${site}','${org}','Site','UTC');
        INSERT INTO staff(id,org_id,site_id,name,role) VALUES('owner','${org}','${site}','Synthetic Owner','owner');
        INSERT INTO workers(id,org_id,site_id,code,language) VALUES
          ('w-ar','${org}','${site}','Worker 001','ar'),('w-en','${org}','${site}','Worker 002','en'),
          ('w-ur','${org}','${site}','Worker 003','ur'),('w-hi','${org}','${site}','Worker 004','hi');
        INSERT INTO briefings(id,org_id,site_id,title,source,state) VALUES
          ('b-main','${org}','${site}','Shelf','Synthetic source','ready'),
          ('b-en','${org}','${site}','Shelf','Synthetic source','ready');`);
      await db.query(`INSERT INTO publications(id,org_id,site_id,briefing_id,version,snapshot_json,state)
        VALUES('p-main','${org}','${site}','b-main',1,$1::jsonb,'published'),('p-en','${org}','${site}','b-en',1,$2::jsonb,'published')`,
      [JSON.stringify(snapshot),JSON.stringify(snapshotWithoutTarget)]);
      await db.query(`INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,language) VALUES
        ('a-main','${org}','${site}','p-main','w-ar','en'),('a-en','${org}','${site}','p-main','w-en','en'),
        ('a-ur','${org}','${site}','p-en','w-ur','en'),('a-hi','${org}','${site}','p-en','w-hi','en'),
        ('a-ur-main','${org}','${site}','p-main','w-ur','en')`);
      return {db,pool};
    },
    async close(ctx){await ctx.db.close();},
    create(ctx,session,assignmentId,input,options={}){return pgCreatePresentation(ctx.pool,session,assignmentId,input,{...options,schema:'public'});},
    list(ctx,session,assignmentId){return pgListPresentations(ctx.pool,session,assignmentId,{schema:'public'});},
    binding(ctx,session,assignmentId,id){
      return pgDomainTransaction(ctx.pool,'public',(client)=>pgCheckedPresentationBinding(client,session,assignmentId,id));
    },
    async submit(ctx,session,assignmentId,submissionId,text,presentationId=null){
      return pgSubmitAnswer(ctx.pool,session,assignmentId,submissionId,text,{schema:'public',presentationId});
    },
    async setWorkerLanguage(ctx,id,language){await ctx.db.query('UPDATE workers SET language=$1 WHERE id=$2',[language,id]);},
    async artifact(ctx,id){return (await q(ctx,'SELECT * FROM presentation_artifacts WHERE id=$1',[id])).rows[0];},
    async bindingRow(ctx,attemptId){return (await q(ctx,'SELECT * FROM answer_presentation_bindings WHERE attempt_id=$1',[attemptId])).rows[0];},
    async attempt(ctx,id){return (await q(ctx,'SELECT id,submission_id,answer_text,outcome FROM attempts WHERE id=$1',[id])).rows[0];},
    async snapshot(ctx,id){return JSON.stringify((await q(ctx,'SELECT snapshot_json FROM publications WHERE id=$1',[id])).rows[0].snapshot_json);},
    async assignmentLanguage(ctx,id){return (await q(ctx,'SELECT language FROM assignments WHERE id=$1',[id])).rows[0].language;},
    async auditCount(ctx,action){return (await q(ctx,'SELECT count(*)::int AS n FROM audit WHERE action=$1',[action])).rows[0].n;},
    async artifactCount(ctx){return (await q(ctx,'SELECT count(*)::int AS n FROM presentation_artifacts')).rows[0].n;},
    async run(ctx,sql,params=[]){
      const statement=placeholders(sql);
      const result=await ctx.db.query(statement,params);
      return {changes:result.affectedRows??result.rows.length};
    },
    async insertPending(ctx,row){
      await ctx.db.query(`INSERT INTO presentation_artifacts(id,org_id,site_id,worker_id,assignment_id,publication_id,
        publication_version,source_kind,source_id,original_language,target_language,source_hash,status,title,text,question,
        provider,live,error_code,lease_token,lease_until,created_at,updated_at,ready_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending',NULL,NULL,NULL,NULL,NULL,NULL,$13,
          clock_timestamp()+interval '120 seconds',clock_timestamp(),clock_timestamp(),NULL)`,
      [row.id,org,site,row.workerId,row.assignmentId,row.publicationId,row.version,row.sourceKind,
        row.sourceId,row.originalLanguage,row.targetLanguage,row.sourceHash??'a'.repeat(64),row.token]);
    },
    async setEntitlement(ctx,{state='read_only',endsAt=null,workerLimit=25,plan='trial'}={}){
      const existing=(await ctx.db.query('SELECT revision FROM organization_entitlements WHERE org_id=$1',[org])).rows[0];
      if(existing)await ctx.db.query(`UPDATE organization_entitlements SET state=$1,ends_at=$2,worker_limit=$3,plan=$4,
        revision=revision+1,updated_by='synthetic-test',updated_at=clock_timestamp() WHERE org_id=$5`,
      [state,endsAt,workerLimit,plan,org]);
      else await ctx.db.query(`INSERT INTO organization_entitlements(org_id,state,started_at,ends_at,worker_limit,plan,
        revision,updated_by,updated_at) VALUES($1,$2,clock_timestamp()-interval '1 day',$3,$4,$5,1,'synthetic-test',clock_timestamp())`,
      [org,state,endsAt,workerLimit,plan]);
    },
    requestDeletion(ctx,session,workerId,input){return pgRequestWorkerDeletion(ctx.pool,session,workerId,input,{schema:'public'});},
    redact(ctx){return pgProcessOneDeletionRedaction(ctx.pool,{schema:'public'});}
  };
}

test('presentation input keeps every UI locale selectable while translation stays capability-bound',()=>{
  assert.equal(WORKER_LANGUAGE_CODES.length,15);
  for(const language of WORKER_LANGUAGE_CODES)assert.equal(presentationLanguage(language,'ui'),true);
  assert.deepEqual(WORKER_LANGUAGE_CODES.filter((language)=>presentationLanguage(language,'translation')),WORKER_LANGUAGE_CODES);
  for(const language of ['fr','pa','EN','','en-US'])assert.equal(presentationLanguage(language,'ui'),false);
  const requestId=randomUUID();
  assert.deepEqual(presentationRequest({requestId,sourceKind:'instruction'}),
    {requestId,sourceKind:'instruction',sourceId:''});
  assert.deepEqual(presentationRequest({requestId,sourceKind:'answer',sourceId:'submission-1'}),
    {requestId,sourceKind:'answer',sourceId:'submission-1'});
  for(const bad of [
    {requestId,sourceKind:'instruction',sourceId:'submission-1'},
    {requestId,sourceKind:'answer'},
    {requestId,sourceKind:'answer',sourceId:'short'},
    {requestId:'not-a-uuid',sourceKind:'instruction'},
    {requestId,sourceKind:'translation'},
    {requestId,sourceKind:'instruction',extra:true},
    {requestId,sourceKind:'instruction',requestId2:requestId}
  ])assert.throws(()=>presentationRequest(bad),/Invalid presentation request/);
  assert.throws(()=>translatedPresentationContent('instruction',{...urInstruction,title:'Latin title'},'ur'),/language mismatch/);
  assert.deepEqual(translatedPresentationContent('instruction',urInstruction,'ur'),urInstruction);
  const source=presentationSourceHash('instruction','en',enInstruction);
  assert.match(source,/^[0-9a-f]{64}$/);
  assert.equal(presentationSourceHash('instruction','en',{...enInstruction,text:'Other'}),presentationSourceHash('instruction','en',{...enInstruction,text:'Other'}));
  assert.notEqual(presentationSourceHash('instruction','en',{...enInstruction,text:'Other'}),source);
  assert.notEqual(presentationSourceHash('instruction','ar',enInstruction),source);
});

async function runPresentationContract(backend){
  const ctx=await backend.open();
  const session=asWorker('w-ar');
  try{
    const initialSnapshot=await backend.snapshot(ctx,'p-main');
    const initial=await backend.list(ctx,session,'a-main');
    assert.deepEqual({...initial,items:initial.items.length},
      {assignmentId:'a-main',originalLanguage:'en',approvedLanguage:'ar',items:0});

    const firstRequest=randomUUID();
    const first=await backend.create(ctx,session,'a-main',{requestId:firstRequest,sourceKind:'instruction'});
    assert.equal(first.status,'ready');
    assert.equal(first.originalLanguage,'en');assert.equal(first.targetLanguage,'ar');
    assert.equal(first.presentation.provider,'publication-snapshot-v1');
    assert.equal(first.presentation.live,false);
    assert.equal(first.presentation.publicationVersion,1);
    assert.deepEqual(first.presentation.content,arInstruction);
    assert.equal(first.presentation.sourceHash,presentationSourceHash('instruction','en',enInstruction));
    const readyId=first.presentation.id;

    const replay=await backend.create(ctx,session,'a-main',{requestId:randomUUID(),sourceKind:'instruction'});
    assert.equal(replay.status,'ready');assert.equal(replay.presentation.id,readyId);
    assert.equal(await backend.artifactCount(ctx),1);
    const history=await backend.list(ctx,session,'a-main');
    assert.equal(history.originalLanguage,'en');assert.equal(history.approvedLanguage,'ar');
    assert.equal(history.items.length,1);assert.equal(history.items[0].id,readyId);

    await assert.rejects(backend.list(ctx,asWorker('w-ur'),'a-main'),/Presentation unavailable/);
    await assert.rejects(backend.binding(ctx,asWorker('w-ur'),'a-main',readyId),/Presentation unavailable/);
    await assert.rejects(backend.create(ctx,asWorker('w-ur'),'a-main',{requestId:randomUUID(),sourceKind:'instruction'}),/Presentation unavailable/);
    assert.equal(await backend.snapshot(ctx,'p-main'),initialSnapshot);
    assert.equal(await backend.assignmentLanguage(ctx,'a-main'),'en');

    const notRequired=await backend.create(ctx,asWorker('w-en'),'a-en',{requestId:randomUUID(),sourceKind:'instruction'});
    assert.equal(notRequired.status,'not_required');assert.equal(notRequired.presentation,null);
    assert.equal(notRequired.originalLanguage,'en');assert.equal(notRequired.targetLanguage,'en');
    assert.equal(notRequired.reason,null);
    assert.equal(await backend.binding(ctx,asWorker('w-en'),'a-en',null),null);

    const unsupported=await backend.create(ctx,asWorker('w-hi'),'a-hi',{requestId:randomUUID(),sourceKind:'instruction'});
    assert.equal(unsupported.status,'unavailable');assert.equal(unsupported.reason,'translation_not_enabled');
    assert.equal(unsupported.targetLanguage,'hi');assert.equal(unsupported.presentation,null);

    const noTranslator=await backend.create(ctx,asWorker('w-ur'),'a-ur',{requestId:randomUUID(),sourceKind:'instruction'});
    assert.equal(noTranslator.status,'unavailable');assert.equal(noTranslator.reason,'translation_not_enabled');
    assert.equal(noTranslator.presentation,null);

    const paused=await backend.create(ctx,asWorker('w-ur'),'a-ur',{requestId:randomUUID(),sourceKind:'instruction'},
      {translator:{translate:async()=>assert.fail('Paused generation must not call the translator')},generationAllowed:false});
    assert.equal(paused.status,'deferred');assert.equal(paused.reason,'generation_paused');
    assert.equal(paused.presentation,null);

    const failedRequest=randomUUID();
    const failed=await backend.create(ctx,asWorker('w-ur'),'a-ur',{requestId:failedRequest,sourceKind:'instruction'},
      {translator:{translate:async()=>{throw new Error('Synthetic provider outage');}}});
    assert.equal(failed.status,'failed');assert.equal(failed.reason,'translation_failed');
    assert.equal(failed.presentation.status,'failed');assert.equal(failed.presentation.errorCode,'translation_failed');
    assert.equal(failed.presentation.provider,null);assert.equal(failed.presentation.content,null);
    const failedRow=await backend.artifact(ctx,failed.presentation.id);
    assert.equal(failedRow.status,'failed');assert.equal(failedRow.text,null);assert.equal(failedRow.error_code,'translation_failed');
    await assert.rejects(backend.binding(ctx,asWorker('w-ur'),'a-ur',failed.presentation.id),/Presentation unavailable/);

    const translatedInstruction=await backend.create(ctx,asWorker('w-ur'),'a-ur-main',{requestId:randomUUID(),sourceKind:'instruction'},
      {translator:{translate:async({targetLanguage})=>{
        assert.equal(targetLanguage,'ur');
        return {content:urInstruction,provider:'synthetic-test-v1',live:false};
      }}});
    assert.equal(translatedInstruction.status,'ready');
    assert.equal(translatedInstruction.presentation.provider,'synthetic-test-v1');
    assert.equal(translatedInstruction.presentation.live,false);
    assert.deepEqual(translatedInstruction.presentation.content,urInstruction);
    assert.equal(translatedInstruction.originalLanguage,'en');assert.equal(translatedInstruction.targetLanguage,'ur');
    const urReadyId=translatedInstruction.presentation.id;
    assert.match((await backend.binding(ctx,asWorker('w-ur'),'a-ur-main',urReadyId)).question,/./);

    const typed=await backend.submit(ctx,session,'a-main','submission-bound-0001',answerText,readyId);
    assert.equal(typed.duplicate,false);
    const binding=await backend.bindingRow(ctx,typed.id);
    assert.equal(binding.presentation_id,readyId);
    assert.equal(binding.presentation_language,'ar');
    assert.equal(binding.presented_question,arInstruction.question);
    assert.equal((await backend.attempt(ctx,typed.id)).answer_text,answerText);
    const duplicate=await backend.submit(ctx,session,'a-main','submission-bound-0001',answerText,readyId);
    assert.equal(duplicate.duplicate,true);assert.equal(duplicate.id,typed.id);
    await assert.rejects(backend.submit(ctx,session,'a-main','submission-bound-0001','Different text',readyId),/Submission ID conflict/);
    await assert.rejects(backend.submit(ctx,session,'a-main','submission-bound-0002','Any text',failed.presentation.id),/Presentation unavailable/);

    await backend.setWorkerLanguage(ctx,'w-ar','ur');
    await assert.rejects(backend.binding(ctx,session,'a-main',readyId),/Presentation language changed/);
    await assert.rejects(backend.submit(ctx,session,'a-main','submission-bound-0003','New answer',readyId),/Presentation language changed/);

    const translatedAnswerRequest=randomUUID();
    const translatedAnswer=await backend.create(ctx,session,'a-main',
      {requestId:translatedAnswerRequest,sourceKind:'answer',sourceId:'submission-bound-0001'},
      {translator:{translate:async({sourceLanguage,targetLanguage})=>{
        assert.equal(sourceLanguage,'ar');assert.equal(targetLanguage,'ur');
        return {content:{text:'مکمل اشیاء نیلے شیلف پر رکھیں۔'},provider:'synthetic-test-v1',live:false};
      }}});
    assert.equal(translatedAnswer.status,'ready');
    assert.equal(translatedAnswer.originalLanguage,'ar');assert.equal(translatedAnswer.targetLanguage,'ur');
    assert.equal(translatedAnswer.presentation.provider,'synthetic-test-v1');
    assert.deepEqual(translatedAnswer.presentation.content,{text:'مکمل اشیاء نیلے شیلف پر رکھیں۔'});
    assert.equal(translatedAnswer.presentation.sourceHash,presentationSourceHash('answer','ar',{text:answerText}));
    const answerPresentationId=translatedAnswer.presentation.id;

    const cachedAnswer=await backend.create(ctx,session,'a-main',
      {requestId:randomUUID(),sourceKind:'answer',sourceId:'submission-bound-0001'},
      {translator:{translate:async()=>assert.fail('Cached presentation must not regenerate')}});
    assert.equal(cachedAnswer.status,'ready');assert.equal(cachedAnswer.presentation.id,answerPresentationId);

    const other=await backend.submit(ctx,session,'a-main','submission-answer-other','Unbound answer');
    await assert.rejects(backend.create(ctx,session,'a-main',
      {requestId:answerPresentationId,sourceKind:'answer',sourceId:'submission-answer-other'}),
    /Presentation request conflict/);

    const answerFailed=await backend.create(ctx,session,'a-main',
      {requestId:randomUUID(),sourceKind:'answer',sourceId:'submission-answer-other'},
      {translator:{translate:async()=>{throw new Error('Synthetic provider outage');}}});
    assert.equal(answerFailed.status,'failed');assert.equal(answerFailed.reason,'translation_failed');

    const invalidAttempt=await backend.submit(ctx,session,'a-main','submission-answer-invalid','Another answer');
    assert.ok(invalidAttempt.id);
    const answerInvalid=await backend.create(ctx,session,'a-main',
      {requestId:randomUUID(),sourceKind:'answer',sourceId:'submission-answer-invalid'},
      {translator:{translate:async()=>({content:{text:'Latin text for an Urdu target'},provider:'synthetic-test-v1'})}});
    assert.equal(answerInvalid.status,'failed');assert.equal(answerInvalid.reason,'translation_invalid');

    await backend.setWorkerLanguage(ctx,'w-ar','ar');
    assert.equal((await backend.binding(ctx,session,'a-main',readyId)).id,readyId);
    const answerNotRequired=await backend.create(ctx,session,'a-main',
      {requestId:randomUUID(),sourceKind:'answer',sourceId:'submission-bound-0001'},
      {translator:{translate:async()=>assert.fail('A same-language answer must not call the translator')}});
    assert.equal(answerNotRequired.status,'not_required');assert.equal(answerNotRequired.presentation,null);
    assert.equal(answerNotRequired.originalLanguage,'ar');assert.equal(answerNotRequired.targetLanguage,'ar');
    assert.equal(answerNotRequired.reason,null);
    assert.equal(await backend.snapshot(ctx,'p-main'),initialSnapshot);
    assert.equal(await backend.assignmentLanguage(ctx,'a-main'),'en');
    assert.ok(await backend.auditCount(ctx,'presentation.ready')>=2);
    assert.ok(await backend.auditCount(ctx,'presentation.failed')>=2);

    await assert.rejects(backend.run(ctx,"UPDATE presentation_artifacts SET text='tampered' WHERE id=?",[readyId]),/immutable/);
    await assert.rejects(backend.run(ctx,"UPDATE presentation_artifacts SET original_language='ar' WHERE id=?",[readyId]),/immutable/);
    await assert.rejects(backend.run(ctx,'DELETE FROM presentation_artifacts WHERE id=?',[readyId]),/immutable/);
    await assert.rejects(backend.run(ctx,"UPDATE answer_presentation_bindings SET presented_question='tampered' WHERE attempt_id=?",[typed.id]),/immutable/);
    await assert.rejects(backend.run(ctx,'DELETE FROM answer_presentation_bindings WHERE attempt_id=?',[typed.id]),/immutable/);

    const pendingId=randomUUID();
    await backend.insertPending(ctx,{id:pendingId,workerId:'w-ar',assignmentId:'a-main',publicationId:'p-main',
      version:1,sourceKind:'answer',sourceId:'submission-pending-delete',originalLanguage:'en',targetLanguage:'ur',token:randomUUID()});
    const attemptBefore=await backend.attempt(ctx,typed.id);
    const urReadyBefore=await backend.artifact(ctx,urReadyId);
    const deletion=await backend.requestDeletion(ctx,owner,'w-ar',{requestId:randomUUID(),expectedCode:'Worker 001',
      reason:'worker_request',confirmed:true});
    assert.equal(deletion.status,'queued');
    assert.equal(await backend.redact(ctx),true);

    const redactedReady=await backend.artifact(ctx,readyId);
    assert.equal(redactedReady.status,'ready');assert.equal(redactedReady.text,'[Deleted]');
    assert.equal(redactedReady.title,'[Deleted]');assert.equal(redactedReady.question,'[Deleted]');
    assert.equal(redactedReady.provider,'publication-snapshot-v1');assert.equal(redactedReady.source_hash,first.presentation.sourceHash);
    const redactedPending=await backend.artifact(ctx,pendingId);
    assert.equal(redactedPending.status,'failed');assert.equal(redactedPending.error_code,'Worker deletion pending');
    assert.equal(redactedPending.text,null);assert.equal(redactedPending.provider,null);
    assert.equal(redactedPending.lease_token,null);assert.equal(redactedPending.lease_until,null);
    assert.equal((await backend.bindingRow(ctx,typed.id)).presented_question,'[Deleted]');
    const attemptAfter=await backend.attempt(ctx,typed.id);
    assert.equal(attemptAfter.answer_text,'[Deleted]');
    assert.equal(attemptAfter.submission_id,attemptBefore.submission_id);
    assert.equal(attemptAfter.outcome,attemptBefore.outcome);
    const urReadyAfter=await backend.artifact(ctx,urReadyId);
    assert.equal(urReadyAfter.status,'ready');assert.equal(urReadyAfter.text,urReadyBefore.text);
    await assert.rejects(backend.list(ctx,session,'a-main'),/Forbidden/);
    await assert.rejects(backend.create(ctx,session,'a-main',{requestId:randomUUID(),sourceKind:'instruction'}),/Forbidden/);
  }finally{
    await backend.close(ctx);
  }
}

async function runReadOnlyPresentationContract(backend){
  const ctx=await backend.open();
  try{
    const worker=asWorker('w-ur');
    const ready=await backend.create(ctx,worker,'a-ur',{requestId:randomUUID(),sourceKind:'instruction'},
      {translator:{translate:async({targetLanguage})=>{
        assert.equal(targetLanguage,'ur');
        return {content:urInstruction,provider:'synthetic-test-v1',live:false};
      }}});
    assert.equal(ready.status,'ready');

    const answer1=await backend.submit(ctx,worker,'a-ur','submission-readonly-0001',answerText);
    const answer2=await backend.submit(ctx,worker,'a-ur','submission-readonly-0002','Second synthetic answer');
    assert.ok(answer1.id);assert.ok(answer2.id);
    const pendingRow={id:randomUUID(),workerId:'w-ur',assignmentId:'a-ur',publicationId:'p-en',version:1,
      sourceKind:'answer',sourceId:'submission-readonly-0001',originalLanguage:'en',targetLanguage:'ur',
      sourceHash:presentationSourceHash('answer','en',{text:answerText}),token:randomUUID()};
    await backend.insertPending(ctx,pendingRow);
    await backend.run(ctx,'UPDATE presentation_artifacts SET lease_until=? WHERE id=?',
      ['2026-01-01T00:00:00.000Z',pendingRow.id]);

    await backend.setEntitlement(ctx);
    const cached=await backend.create(ctx,worker,'a-ur',{requestId:randomUUID(),sourceKind:'instruction'},
      {translator:{translate:async()=>assert.fail('Read-only cached content must not regenerate')}});
    assert.equal(cached.status,'ready');assert.equal(cached.presentation.id,ready.presentation.id);

    const fromSnapshot=await backend.create(ctx,asWorker('w-ar'),'a-main',{requestId:randomUUID(),sourceKind:'instruction'},
      {translator:{translate:async()=>assert.fail('Read-only snapshot content must not call the translator')}});
    assert.equal(fromSnapshot.status,'ready');assert.equal(fromSnapshot.targetLanguage,'ar');
    assert.equal(fromSnapshot.presentation.provider,'publication-snapshot-v1');
    assert.deepEqual(fromSnapshot.presentation.content,arInstruction);

    const pendingBefore=await backend.artifact(ctx,pendingRow.id);
    const reclaim=await backend.create(ctx,worker,'a-ur',
      {requestId:randomUUID(),sourceKind:'answer',sourceId:'submission-readonly-0001'},
      {translator:{translate:async()=>assert.fail('Read-only reclaim must not call the translator')}});
    assert.equal(reclaim.status,'deferred');assert.equal(reclaim.reason,'generation_paused');
    assert.equal(reclaim.presentation,null);
    const pendingAfter=await backend.artifact(ctx,pendingRow.id);
    assert.equal(pendingAfter.status,'pending');assert.equal(pendingAfter.lease_token,pendingBefore.lease_token);
    assert.equal(String(pendingAfter.lease_until),String(pendingBefore.lease_until));

    const count=await backend.artifactCount(ctx);
    const fresh=await backend.create(ctx,worker,'a-ur',
      {requestId:randomUUID(),sourceKind:'answer',sourceId:'submission-readonly-0002'},
      {translator:{translate:async()=>assert.fail('Read-only generation must not call the translator')}});
    assert.equal(fresh.status,'deferred');assert.equal(fresh.reason,'generation_paused');
    assert.equal(fresh.presentation,null);
    assert.equal(await backend.artifactCount(ctx),count);

    await backend.setEntitlement(ctx,{state:'active'});
    const translate=async()=>({content:{text:'مکمل اشیاء نیلے شیلف پر رکھیں۔'},provider:'synthetic-test-v1',live:false});
    const reclaimed=await backend.create(ctx,worker,'a-ur',
      {requestId:randomUUID(),sourceKind:'answer',sourceId:'submission-readonly-0001'},{translator:{translate}});
    assert.equal(reclaimed.status,'ready');assert.equal(reclaimed.presentation.id,pendingRow.id);
    const generated=await backend.create(ctx,worker,'a-ur',
      {requestId:randomUUID(),sourceKind:'answer',sourceId:'submission-readonly-0002'},{translator:{translate}});
    assert.equal(generated.status,'ready');
    assert.equal((await backend.list(ctx,worker,'a-ur')).items.length,3);
  }finally{
    await backend.close(ctx);
  }
}

test('SQLite presentation history is snapshot-first, provenance-bound and deletion-safe',async()=>{
  await runPresentationContract(sqliteBackend());
});

test('PostgreSQL presentation history matches the SQLite contract and enforces evidence guards',async()=>{
  await runPresentationContract(postgresBackend());
});

test('SQLite read-only entitlements pause new presentation generation while cached and snapshot content stays readable',async()=>{
  await runReadOnlyPresentationContract(sqliteBackend());
});

test('PostgreSQL read-only entitlements pause new presentation generation while cached and snapshot content stays readable',async()=>{
  await runReadOnlyPresentationContract(postgresBackend());
});

for(const backend of [sqliteBackend(),postgresBackend()])test(`${backend.name} approved-language presentations retain MCQ options and upgrade old caches`,async()=>{
  const ctx=await backend.open();try{
    const {withMultipleChoice}=await import('../server/multiple-choice.mjs');
    const frozen=withMultipleChoice({source:enInstruction.text,title:enInstruction.title,question:enInstruction.question,rubric:{askedFacts:[enInstruction.text]},languages:{en:enInstruction}});
    const original=JSON.stringify(frozen),session=asWorker('w-hi'),now=new Date().toISOString();
    await backend.run(ctx,"INSERT INTO briefings(id,org_id,site_id,title,source,state,created_at,updated_at) VALUES('b-choice','org','site','Choice','Synthetic','ready',?,?)",[now,now]);
    await backend.run(ctx,"INSERT INTO publications(id,org_id,site_id,briefing_id,version,snapshot_json,published_at,state) VALUES('p-choice','org','site','b-choice',1,?,?,'published')",[original,now]);
    await backend.run(ctx,"INSERT INTO publications(id,org_id,site_id,briefing_id,version,snapshot_json,published_at,state) VALUES('p-cache','org','site','b-choice',2,?,?,'published')",[original,now]);
    for(const id of ['a-choice','a-cache'])await backend.run(ctx,"INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,language,created_at) VALUES(?,'org','site',?,'w-hi','en',?)",[id,id==='a-cache'?'p-cache':'p-choice',now]);
    let calls=0;const translator={capabilities:{textLanguages:['en','hi']},async translate({content}){calls++;return {provider:'synthetic-hi-v1',live:false,content:{title:'निर्देश',text:'अनुवाद '+content.text,question:'आपको क्या करना है?'}};}};
    const ready=await backend.create(ctx,session,'a-choice',{requestId:randomUUID(),sourceKind:'instruction'},{translator});
    assert.equal(ready.status,'ready');assert.equal(calls,4);assert.equal(ready.presentation.content.questionType,'multiple-choice');
    const translated=ready.presentation.content.choices;
    assert.deepEqual(translated.map(x=>x.id),frozen.languages.en.choices.map(x=>x.id));assert.ok(translated.every(x=>x.text.startsWith('अनुवाद ')));
    assert.equal((await backend.list(ctx,session,'a-choice')).items[0].content.choices.length,4);
    const cached=await backend.create(ctx,session,'a-choice',{requestId:randomUUID(),sourceKind:'instruction'},{translator});assert.equal(cached.presentation.id,ready.presentation.id);assert.equal(calls,4);
    const id=randomUUID();await backend.run(ctx,`INSERT INTO presentation_artifacts(id,org_id,site_id,worker_id,assignment_id,publication_id,publication_version,
      source_kind,source_id,original_language,target_language,source_hash,status,title,text,question,provider,live,created_at,updated_at,ready_at)
      VALUES(?,'org','site','w-hi','a-cache','p-cache',2,'instruction','','en','hi',?,'ready','निर्देश','पुराना पाठ','पुराना प्रश्न','synthetic-hi-v1',false,?,?,?)`,
      [id,presentationSourceHash('instruction','en',frozen.languages.en),now,now,now]);
    const upgraded=await backend.create(ctx,session,'a-cache',{requestId:randomUUID(),sourceKind:'instruction'},{translator});
    assert.equal(upgraded.status,'ready');assert.equal(upgraded.presentation.id,id);assert.equal(upgraded.presentation.content.text,'पुराना पाठ');assert.equal(upgraded.presentation.content.choices.length,4);
    await assert.rejects(async()=>backend.run(ctx,'UPDATE presentation_artifacts SET choices_json=? WHERE id=?',[JSON.stringify([...translated].reverse()),id]),/immutable/);
    assert.deepEqual(JSON.parse(await backend.snapshot(ctx,'p-choice')),JSON.parse(original));
    const selected=frozen.rubric.correctChoiceId;
    const receipt=await backend.submit(ctx,session,'a-choice',randomUUID(),selected,ready.presentation.id);
    assert.equal((await backend.attempt(ctx,receipt.id)).answer_text,selected);
    const answer=await backend.create(ctx,session,'a-choice',{requestId:randomUUID(),sourceKind:'answer',sourceId:receipt.submissionId??(await backend.attempt(ctx,receipt.id)).submission_id},{translator});
    assert.equal(answer.status,'ready');assert.ok(answer.presentation.content.text.includes(enInstruction.text));
    await backend.requestDeletion(ctx,owner,'w-hi',{requestId:randomUUID(),expectedCode:'Worker 004',reason:'worker_request',confirmed:true});
    assert.equal(await backend.redact(ctx),true);
    for(const artifactId of [ready.presentation.id,id]){const row=await backend.artifact(ctx,artifactId);assert.equal(row.text,'[Deleted]');assert.equal(row.choices_json,null);}
  }finally{await backend.close(ctx);}
});
