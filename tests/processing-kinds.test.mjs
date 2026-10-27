import test from 'node:test';
import assert from 'node:assert/strict';
import {processingFilters,processingJob} from '../server/processing.mjs';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {PGlite} from '@electric-sql/pglite';
import {openDatabase} from '../server/db.mjs';
import {seed} from '../server/seed.mjs';
import {CANONICAL_SOURCE,publish as publishSqlite,submitAnswer as submitSqlite} from '../server/domain.mjs';
import {createDraft as draftSqlite,queuePreparation as queueSqlite,editDraft as editSqlite} from '../server/preparation.mjs';
import {receiveSourceAudio as sourceSqlite,sourceAudioJournal as journalSqlite} from '../server/source-audio.mjs';
import {receiveRecording as recordingSqlite} from '../server/recordings.mjs';
import {listProcessing as listSqlite,getProcessing as getSqlite} from '../server/processing.mjs';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {createDraft as draftPg,queuePreparation as queuePg,editDraft as editPg,processOnePreparation} from '../server/postgres/preparation.mjs';
import {publish as publishPg,submitAnswer as submitPg} from '../server/postgres/domain.mjs';
import {legacyWrittenQuestion} from './helpers/legacy-written-question.mjs';
import {receiveSourceAudio as sourcePg,sourceAudioJournal as journalPg} from '../server/postgres/source-audio.mjs';
import {receiveRecording as recordingPg} from '../server/postgres/recordings.mjs';
import {listProcessing as listPg,getProcessing as getPg} from '../server/postgres/read-models.mjs';
import {sourceAudioInput} from '../server/source-audio-input.mjs';
import {encodeWav} from '../src/audio.ts';
import {checkedProcessingJob,checkedProcessingPage} from '../src/processing-state.ts';

test('processing filters distinguish job kind and completed checks from ready briefing artifacts',()=>{
  for(const kind of ['all','prepare','source_transcription','response_transcription','answer_check'])assert.equal(processingFilters({kind}).kind,kind);
  for(const status of ['complete','blocked'])assert.equal(processingFilters({status}).status,status);
  for(const input of [{kind:'operator_jobs'},{kind:['prepare']},{status:'matched'},{kind:'answer_check',workerId:'other'}])assert.throws(()=>processingFilters(input),/Invalid processing filter/);
});

const owner={principal_type:'staff',principal_id:'maya',org_id:'cedar',site_id:'beirut',role:'owner'};
const wav=()=>Buffer.from(encodeWav({duration:1,sampleRate:16000,numberOfChannels:1,getChannelData:()=>Float32Array.from({length:16000},(_,index)=>Math.sin(index/10)*0.2)}));
async function mixedFixture(pg,t) {
  const db=pg?new PGlite():openDatabase(':memory:');
  const pool={async connect(){return {query:async(sql,args)=>args?.length?db.query(sql,args):(await db.exec(sql)).at(-1)??{rows:[]},release(){}};}};
  const objects=new Map(),storage={async save(row,bytes){objects.set(row.id,Buffer.from(bytes));},async read(row){return objects.get(row.id);},async saveOriginal(row,bytes){objects.set(row.id,Buffer.from(bytes));},async readOriginal(row){return objects.get(row.id);},async remove(row){objects.delete(row.id);}};
  let root,briefingId;
  t.after(async()=>{await db.close();if(root){assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep+'understood-processing-kinds-'));rmSync(root,{recursive:true});}});
  const query=async(sql,args=[])=>pg?(await db.query(sql,args)).rows:db.prepare(sql.replace(/\$\d+/g,'?')).all(...args);
  if(pg) {
    await runMigrations(pool);await db.exec(`INSERT INTO organizations VALUES('cedar','Synthetic'),('foreign','Foreign');
      INSERT INTO sites VALUES('beirut','cedar','Synthetic','UTC'),('remote','foreign','Remote','UTC');
      INSERT INTO staff(id,org_id,site_id,name,role) VALUES('maya','cedar','beirut','Owner','owner'),('auditor','cedar','beirut','Auditor','auditor'),('foreign-owner','foreign','remote','Foreign','owner');
      INSERT INTO workers(id,org_id,site_id,code,language) VALUES('w1','cedar','beirut','001','en'),('w2','cedar','beirut','002','en');`);
    const draft=await draftPg(pool,owner,{requestId:randomUUID(),title:'Published source title',source:CANONICAL_SOURCE});briefingId=draft.id;
    await queuePg(pool,owner,draft.id,1);await processOnePreparation(pool,{integrationMode:'synthetic'});
    await legacyWrittenQuestion(pool,draft.id);
    await publishPg(pool,owner,draft.id,{requestId:randomUUID(),revision:1,nextVersion:1,workerIds:['w1','w2']},{integrationMode:'synthetic'});
  }else {
    seed(db);db.prepare("INSERT INTO staff VALUES('auditor','cedar','beirut','Auditor','auditor',1)").run();
    root=mkdtempSync(join(tmpdir(),'understood-processing-kinds-'));briefingId='shelf';
    const draft=draftSqlite(db,owner,{requestId:randomUUID(),title:'Queued preparation',source:CANONICAL_SOURCE});queueSqlite(db,owner,draft.id,1);
  }
  const sourceId=randomUUID(),input={requestId:sourceId,title:'Accepted source transcription',originalType:'audio/wav'},bytes=wav();
  const source=pg?await sourcePg(pool,owner,input,bytes,bytes,storage):await sourceSqlite(db,owner,input,bytes,bytes,storage);
  const journal=pg?journalPg(pool):journalSqlite(db);
  await journal.reserve(owner,sourceAudioInput({...input,requestId:randomUUID(),title:'Unaccepted upload'},bytes,bytes));
  const voiceWorker=pg?'w1':'worker-30',typedWorker=pg?'w2':'worker-1';
  const assignments=await query('SELECT id,worker_id FROM assignments WHERE org_id=$1',['cedar']);
  const voiceAssignment=assignments.find(row=>row.worker_id===voiceWorker),typedAssignment=assignments.find(row=>row.worker_id===typedWorker);
  const worker=id=>({...owner,principal_type:'worker',principal_id:id});
  const voice=pg?await recordingPg(pool,worker(voiceWorker),voiceAssignment.id,randomUUID(),bytes,storage):await recordingSqlite(db,worker(voiceWorker),voiceAssignment.id,randomUUID(),bytes,root);
  const answer='Finished items on the blue shelf, unfinished items on the yellow shelf. PRIVATE_QUEUE_ANSWER.';
  if(pg)await submitPg(pool,worker(typedWorker),typedAssignment.id,randomUUID(),answer);else submitSqlite(db,worker(typedWorker),typedAssignment.id,randomUUID(),answer);
  const original=(await query('SELECT revision FROM briefings WHERE id=$1',[briefingId]))[0].revision;
  const edit={revision:original,title:'New unpublished draft title',source:CANONICAL_SOURCE};
  if(pg)await editPg(pool,owner,briefingId,edit);else editSqlite(db,owner,briefingId,edit);
  return {db,pool,query,source,voice,voiceAssignment,typedAssignment,list:(session,input)=>pg?listPg(pool,session,input):listSqlite(db,session,input),get:(session,id)=>pg?getPg(pool,session,id):getSqlite(db,session,id)};
}
for(const pg of [false,true])test(`${pg?'PostgreSQL':'SQLite'} mixed queue is bounded, exact-publication, received-only and metadata-private`,async t=>{
  const f=await mixedFixture(pg,t);
  const all=await f.list(owner,{pageSize:100}),source=await f.list(owner,{kind:'source_transcription'}),voice=await f.list(owner,{kind:'response_transcription'}),checks=await f.list(owner,{kind:'answer_check',pageSize:100});
  assert.equal(source.total,1);assert.equal(voice.total,1);assert.equal(checks.total,pg?1:25);
  assert.equal(all.total,pg?4:28);assert.equal(new Set(all.items.map(row=>row.id)).size,all.total);
  assert.equal(source.items[0].status,'queued');assert.equal(source.items[0].source_request_id,f.source.requestId);assert.equal(source.items[0].own_source,true);
  assert.equal(voice.items[0].status,'queued');assert.equal(voice.items[0].assignment_id,f.voiceAssignment.id);assert.equal(voice.items[0].publication_version,pg?1:3);
  assert.equal(checks.items.find(row=>row.assignment_id===f.typedAssignment.id).status,pg?'queued':'complete');
  for(const row of [...voice.items,...checks.items])assert.notEqual(row.title,'New unpublished draft title');
  assert.doesNotMatch(JSON.stringify(all),/PRIVATE_QUEUE_ANSWER|"(?:answer_text|transcript|rubric|snapshot_json|request_hash|sha256|lease_token|authority_json)"\s*:/);
  const pages=[];for(let page=1;page<=Math.ceil(all.total/2);page++){const result=await f.list(owner,{page,pageSize:2});assert.equal(result.total,all.total);pages.push(...result.items.map(row=>row.id));}
  assert.deepEqual(pages,all.items.map(row=>row.id));
  for(const row of all.items)assert.equal(checkedProcessingJob(await f.get(owner,row.id),row.id).id,row.id);
  checkedProcessingPage(await f.list(owner,{page:1}),1);
  const audit={...owner,principal_id:'auditor',role:'auditor'};
  assert.equal((await f.list(audit,{kind:'source_transcription'})).items[0].own_source,false);
  const foreign=pg?{...owner,org_id:'foreign',site_id:'remote',principal_id:'foreign-owner'}:{...owner,org_id:'harbor',site_id:'harbor-yard',principal_id:(await f.query("SELECT id FROM staff WHERE org_id='harbor'"))[0].id};
  assert.equal((await f.list(foreign)).total,0);
  await assert.rejects(async()=>f.get(foreign,source.items[0].id),/unavailable/);
  await assert.rejects(async()=>f.list({...owner,principal_type:'worker'}),/Forbidden/);
  await f.query("UPDATE source_audio_requests SET status='blocked',error='PRIVATE PROVIDER ERROR' WHERE request_id=$1",[f.source.requestId]);
  const blocked=await f.get(owner,source.items[0].id);assert.equal(blocked.status,'blocked');assert.equal(blocked.sourceRetryAvailable,true);assert.doesNotMatch(blocked.error,/PRIVATE/);
  assert.equal((await f.get(audit,source.items[0].id)).sourceRetryAvailable,false);
  assert.equal((await f.list(owner,{kind:'source_transcription',status:'blocked'})).total,1);
});
test('processing projection does not call a completed answer check ready or leak private evidence',()=>{
  const row={id:'answer_check:fixture',kind:'answer_check',status:'complete',mode:'inline-synthetic',attempts:1,revision:null,
    title:'Frozen publication title',briefing_id:'briefing',draft_revision:9,draft_state:'processing',archived_at:null,
    created_at:'2026-10-14T10:00:00.000Z',due_at:'2026-10-14T10:00:00.000Z',publication_id:'publication-v3',publication_version:3,
    assignment_id:'assignment',source_request_id:null,own_source:0,can_source_retry:0,content_expired:0,
    error:'PRIVATE PROVIDER ERROR',lease_token:'PRIVATE LEASE',answer_text:'PRIVATE ANSWER',evidence_json:[{quote:'PRIVATE QUOTE'}]};
  const value=processingJob(row);
  assert.equal(value.status,'complete');assert.equal(value.mode,'inline-synthetic');assert.equal(value.publication_version,3);assert.equal(value.assignment_id,'assignment');
  assert.equal(value.retryAvailable,false);assert.equal(value.error,null);
  assert.doesNotMatch(JSON.stringify(value),/PRIVATE|answer_text|evidence_json|lease_token/);
});
