import test from 'node:test';
import {createSessionContextFetch} from './helpers/session-http.mjs';
const fetch=createSessionContextFetch();
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { runMigrations } from '../server/postgres/migrate.mjs';
import { publish,submitAnswer,withdrawPublication } from '../server/postgres/domain.mjs';
import { processOneAssessment } from '../server/postgres/assessment-worker.mjs';
import { receiveRecording,getRecording,getRecordingAudio,expireStagedRecording } from '../server/postgres/recordings.mjs';
import { processOneRecording } from '../server/postgres/recording-worker.mjs';
import { createDraft,editDraft,queuePreparation,processOnePreparation,copyDraft,archiveBriefing } from '../server/postgres/preparation.mjs';
import { listBriefings,getBriefing,workerBriefings,workerBriefing,sessionContext,staffOverview,listProcessing,getProcessing } from '../server/postgres/read-models.mjs';
import {listPublicationHistory,getPublicationHistoryDetail} from '../server/postgres/publication-history.mjs';
import { createPostgresRehearsalServer } from '../server/postgres/http.mjs';
import { provisionStaffCredential,issueWorkerGrant,redeemWorkerGrant,requireSession } from '../server/postgres/auth.mjs';
import { listWorkers,createWorker,updateWorker,disableWorker,reenableWorker,listCrews,createCrew,moveWorkerToCrew,renameCrew,archiveCrew,restoreCrew } from '../server/postgres/people.mjs';
import { readPublicationReport } from '../server/postgres/reports.mjs';
import { listPublicationResponses,getPublicationResponse,workerSubmissions,staffWorkerAssignments,workerRequestReceipt } from '../server/postgres/responses.mjs';
import { listAuditEvents,getAuditEvent,exportAuditEvents } from '../server/postgres/audit.mjs';
import { requestHelp,listClarifications,getClarification,resolveClarification,assignClarification,workerHelpCases } from '../server/postgres/clarifications.mjs';
import { requestExport,listExports,retryExport,downloadExport,processOneExport,expireExports } from '../server/postgres/exports.mjs';
import { previewWorkerImport,getWorkerImport,confirmWorkerImport,workerImportErrorsCsv,expireWorkerImports } from '../server/postgres/worker-import.mjs';
import { exportCsv } from '../server/exports.mjs';
import { CANONICAL_SOURCE,syntheticPrepare } from '../server/domain.mjs';
import {checkedWorkerReceipt} from '../src/worker-request.ts';

const options = {schema:'understood_test_domain',integrationMode:'synthetic'};
const owner = {principal_type:'staff',principal_id:'owner',org_id:'a',site_id:'a',role:'owner'};
const worker = {principal_type:'worker',principal_id:'w1',org_id:'a',site_id:'a'};
const request = (nextVersion=1) => ({requestId:randomUUID(),revision:1,nextVersion,workerIds:['w1','w2']});
const answer = 'Finished blue; unfinished yellow.';
const matched = {outcome:'matched',reasons:['asked_facts_present'],evidence:[{factIndex:0,quote:'Finished blue'},{factIndex:1,quote:'unfinished yellow'}]};

async function fixture() {
  const db = new PGlite(); let fail='',loseCommit=false; const queries=[];
  const client = {async query(sql,values) {
    queries.push(sql);
    if (fail && sql.includes(fail)) throw new Error('Injected failure');
    const result = values?.length ? await db.query(sql,values) : (await db.exec(sql)).at(-1) || {rows:[]};
    if (loseCommit && sql==='COMMIT') {loseCommit=false; throw new Error('Commit acknowledgement lost');}
    return result;
  },release() {}};
  const pool = {async connect() {return client;}};
  await db.exec(`CREATE SCHEMA ${options.schema}; SET search_path TO ${options.schema},pg_catalog`);
  await runMigrations(pool,options);
  await db.query("INSERT INTO organizations(id,name) VALUES ('a','A'),('b','B')");
  await db.query("INSERT INTO sites(id,org_id,name,timezone) VALUES ('a','a','A','UTC'),('c','a','C','UTC'),('b','b','B','UTC')");
  await db.query("INSERT INTO staff(id,org_id,site_id,name,role) VALUES ('owner','a','a','Owner','owner'),('other','b','b','Other','owner'),('auditor','a','a','Auditor','auditor')");
  await db.query("INSERT INTO workers(id,org_id,site_id,code,language) VALUES ('w1','a','a','001','en'),('w2','a','a','002','ur'),('w3','a','c','003','ar'),('wb','b','b','001','en')");
  await db.query(`INSERT INTO briefings(id,org_id,site_id,title,source,state,prepared_json) VALUES ('brief','a','a','Shelf',$1,'ready',$2)`,[CANONICAL_SOURCE,JSON.stringify(syntheticPrepare(CANONICAL_SOURCE))]);
  return {db,pool,queries,setFail(value) {fail=value;},loseNextCommit() {loseCommit=true;},async assignment(publicationId,workerId='w1') {return (await db.query('SELECT id FROM assignments WHERE publication_id=$1 AND worker_id=$2',[publicationId,workerId])).rows[0].id;}};
}

function wav() {
  const bytes=Buffer.alloc(44+16000*2); bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length-8,4); bytes.write('WAVEfmt ',8);
  bytes.writeUInt32LE(16,16); bytes.writeUInt16LE(1,20); bytes.writeUInt16LE(1,22); bytes.writeUInt32LE(16000,24);
  bytes.writeUInt32LE(32000,28); bytes.writeUInt16LE(2,32); bytes.writeUInt16LE(16,34); bytes.write('data',36); bytes.writeUInt32LE(bytes.length-44,40);
  for (let i=0;i<16000;i++) bytes.writeInt16LE(Math.round(4000*Math.sin(i/10)),44+i*2);
  return bytes;
}

function memoryStorage(onSave) {
  const objects=new Map(); let failRemove=false;
  return {objects,setFailRemove(value) {failRemove=value;},async save(row,bytes) {objects.set(row.id,Buffer.from(bytes)); await onSave?.(row);},
    async read(row) {if (!objects.has(row.id)) throw new Error('Object unavailable'); return objects.get(row.id);},
    async remove(row) {if (failRemove) throw new Error('Remove failed'); objects.delete(row.id);}};
}

const origin='http://127.0.0.1:3020';

test('PostgreSQL exact worker receipt lookup reauthorizes, minimizes fields and resolves accepted history without writes',async()=>{
  const f=await fixture(),{db,pool}=f;
  try{
    const pub=await publish(pool,owner,'brief',request(),options),assignment=await f.assignment(pub.id);
    const typedId=randomUUID(),helpId=randomUUID(),audioId=randomUUID(),stagingId=randomUUID();
    const typed=await submitAnswer(pool,worker,assignment,typedId,answer,options);
    assert.deepEqual(await workerRequestReceipt(pool,worker,assignment,'answer',typedId,options),{id:typed.id,outcome:null,assessmentStatus:'pending',duplicate:true});
    await processOneAssessment(pool,{assess:async()=>matched},options);
    await requestHelp(pool,worker,assignment,{requestId:helpId,text:'Synthetic help text'},options);
    await db.query("UPDATE clarifications SET status='resolved',notes='Private notes' WHERE id=$1",[helpId]);
    const audio=await receiveRecording(pool,worker,assignment,audioId,wav(),memoryStorage(),options);
    await db.query("UPDATE recordings SET status='failed',error='Private provider error' WHERE id=$1",[audio.id]);
    await assert.rejects(receiveRecording(pool,worker,assignment,stagingId,wav(),{async save(){throw Error('Storage failure');},async remove(){}},options),/not received/);
    await db.query("UPDATE publications SET state='withdrawn' WHERE id=$1",[pub.id]);
    const grant=await issueWorkerGrant(pool,owner,'w1',30,options);
    const tables=['attempts','submission_receipts','clarifications','help_requests','recordings','assignments','publications','audit'];
    const snapshot=async()=>JSON.stringify(await Promise.all(tables.map(async name=>(await db.query('SELECT * FROM '+name+' ORDER BY 1')).rows)));
    const before=await snapshot();
    for(const [kind,requestId,id] of [['answer',typedId,typed.id],['help',helpId,helpId],['audio',audioId,audio.id]]){
      const row=await workerRequestReceipt(pool,worker,assignment,kind,requestId,options);assert.equal(row.id,id);assert.equal(row.duplicate,true);
      assert.ok(!/"(?:notes|text|rubric|sha256|storage|provider|error|sequence|token)"/.test(JSON.stringify(row)));
      for(const invalid of [owner,{...worker,principal_id:'w2'},{...worker,principal_id:'w3',site_id:'c'},{...worker,principal_id:'wb',site_id:'b',org_id:'b'},{...worker,access_mode:'credential',grant_id:'revoked'},{...worker,token_hash:'f'.repeat(64)}])await assert.rejects(workerRequestReceipt(pool,invalid,assignment,kind,requestId,options),/Forbidden|Response unavailable|Sign in required/);
    }
    assert.equal((await workerRequestReceipt(pool,worker,assignment,'answer',typedId,options)).outcome,'matched');
    assert.equal((await workerRequestReceipt(pool,worker,assignment,'help',helpId,options)).status,'resolved');
    assert.equal((await workerRequestReceipt(pool,worker,assignment,'audio',audioId,options)).status,'failed');
    for(const [kind,id] of [['audio',stagingId],['answer',audioId],['audio',typedId],['help',typedId],['answer',randomUUID()]])await assert.rejects(workerRequestReceipt(pool,worker,assignment,kind,id,options),/Response unavailable/);
    await assert.rejects(workerRequestReceipt(pool,worker,assignment,'other',typedId,options),/Invalid response filter/);
    assert.equal(await snapshot(),before);
    await withHttp(f,async({request})=>{
      const member=cookieOf(await request('/auth/worker/redeem',null,post({token:grant.token})));
      const clientContext=(await (await request('/session',member)).json()).clientContext;
      const beforeReads=await snapshot();
      for(const [kind,requestId] of [['answer',typedId],['help',helpId],['audio',audioId]]){
        const path=`/worker/briefings/${assignment}/receipts/${kind}/${requestId}`;
        const response=await request(path,member,{headers:{'x-client-session-context':clientContext}});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
        checkedWorkerReceipt(await response.json(),kind,{requestId,assignmentId:assignment,clientContext});
        assert.equal((await request(path)).status,401);assert.equal((await request(path+'?org_id=b',member)).status,400);
        assert.equal((await request(path,member,{headers:{'x-client-session-context':'f'.repeat(64)}})).status,409);
      }
      assert.equal((await request(`/worker/briefings/${assignment}/receipts/audio/${stagingId}`,member)).status,404);
      assert.equal(await snapshot(),beforeReads);
      await db.query('UPDATE worker_grants SET revoked_at=clock_timestamp() WHERE id=$1',[grant.id]);
      assert.equal((await request(`/worker/briefings/${assignment}/receipts/answer/${typedId}`,member)).status,401);
    });
    await db.query("UPDATE workers SET active=false WHERE id='w1'");await assert.rejects(workerRequestReceipt(pool,worker,assignment,'answer',typedId,options),/Forbidden/);
  }finally{await db.close();}
});

test('PostgreSQL draft copy preserves evidence, rolls back, and replays after lost commit and later edits',async()=>{
  const f=await fixture(),{db,pool}=f;
  try {
    await publish(pool,owner,'brief',request(),options);
    const evidence=async()=>JSON.stringify(await Promise.all(['publications','assignments','attempts','submission_receipts','clarifications'].map(async table=>(await db.query(`SELECT * FROM ${table} ORDER BY 1`)).rows)));
    const before=await evidence(),original=(await db.query("SELECT * FROM briefings WHERE id='brief'")).rows[0];
    const copy={requestId:randomUUID(),revision:1,title:'Copied shelf handover',confirmed:true};
    for(const patch of [{confirmed:false},{requestId:'bad'},{revision:0},{title:'x'},{source:'injected'},{state:'ready'},{org_id:'b'}]) await assert.rejects(copyDraft(pool,owner,'brief',{...copy,...patch},options),/Invalid/);
    for(const principal of [worker,{...owner,role:'auditor'},{...owner,role:'supervisor'},{...owner,principal_id:'missing'},{...owner,site_id:'c'}]) await assert.rejects(copyDraft(pool,principal,'brief',copy,options),/Forbidden/);
    await assert.rejects(copyDraft(pool,{...owner,org_id:'b',site_id:'b',principal_id:'other'},'brief',copy,options),/unavailable/);
    await assert.rejects(copyDraft(pool,owner,'brief',{...copy,revision:2},options),/revision changed/);
    for(const failure of ['INSERT INTO briefing_copies','INSERT INTO audit']) {
      f.setFail(failure);await assert.rejects(copyDraft(pool,owner,'brief',copy,options),/Injected/);f.setFail('');
      assert.equal((await db.query('SELECT id FROM briefings WHERE id=$1',[copy.requestId])).rows.length,0);
      assert.equal((await db.query('SELECT * FROM briefing_copies')).rows.length,0);
    }
    f.loseNextCommit();await assert.rejects(copyDraft(pool,owner,'brief',copy,options),/acknowledgement lost/);
    const saved=(await db.query('SELECT * FROM briefings WHERE id=$1',[copy.requestId])).rows[0];
    assert.equal(saved.source,original.source);assert.equal(saved.title,copy.title);assert.equal(saved.prepared_json,null);assert.equal(saved.next_version,1);assert.equal(saved.revision,1);assert.equal(saved.state,'draft');
    assert.equal((await db.query('SELECT * FROM jobs WHERE briefing_id=$1',[saved.id])).rows.length,0);
    assert.deepEqual((await db.query("SELECT * FROM briefings WHERE id='brief'")).rows[0],original);assert.equal(await evidence(),before);
    await editDraft(pool,owner,saved.id,{revision:1,title:'Changed copy',source:'Changed source content for the new copy.'},options);
    await editDraft(pool,owner,'brief',{revision:1,title:'Changed original',source:'Original source changed after copy was accepted.'},options);
    const count=(await db.query('SELECT * FROM audit')).rows.length;
    assert.deepEqual(await copyDraft(pool,owner,'brief',copy,options),{id:saved.id,state:'draft',revision:2,duplicate:true});
    assert.equal((await db.query('SELECT title FROM briefings WHERE id=$1',[saved.id])).rows[0].title,'Changed copy');
    assert.equal((await db.query('SELECT * FROM audit')).rows.length,count);
    for(const patch of [{title:'Other title'},{revision:2}]) await assert.rejects(copyDraft(pool,owner,'brief',{...copy,...patch},options),/request conflict/);
    await assert.rejects(copyDraft(pool,owner,saved.id,copy,options),/request conflict/);
    await assert.rejects(db.query('UPDATE briefing_copies SET title=$1',['Other title']),/immutable/);
    await assert.rejects(db.query('DELETE FROM briefing_copies'),/immutable/);
    const existing=await createDraft(pool,owner,{requestId:randomUUID(),title:'Existing draft',source:'Existing source content for collision.'},options);
    await assert.rejects(copyDraft(pool,owner,'brief',{...copy,revision:2,requestId:existing.id},options),/request conflict/);
    await provisionStaffCredential(pool,{staffId:'owner',orgId:'a',siteId:'a',email:'owner@example.test',password:'long-enough-password'},options);
    await withHttp(f,async({request})=>{
      const staff=cookieOf(await request('/auth/staff/login',null,post({email:'owner@example.test',password:'long-enough-password'})));
      const grant=await issueWorkerGrant(pool,owner,'w1',30,options),workerCookie=cookieOf(await request('/auth/worker/redeem',null,post({token:grant.token})));
      const payload={requestId:randomUUID(),revision:2,title:'HTTP draft copy',confirmed:true};
      assert.equal((await request('/briefings/brief/copy',null,post(payload))).status,401);
      assert.equal((await request('/briefings/brief/copy',workerCookie,post(payload))).status,403);
      assert.equal((await request('/briefings/missing/copy',staff,post(payload))).status,404);
      assert.equal((await request('/briefings/brief/copy',staff,post({...payload,confirmed:false}))).status,400);
      assert.equal((await request('/briefings/brief/copy',staff,post({...payload,revision:1}))).status,409);
      const first=await request('/briefings/brief/copy',staff,post(payload));assert.equal(first.status,201);assert.match(first.headers.get('cache-control'),/no-store/);
      const repeated=await request('/briefings/brief/copy',staff,post(payload));assert.equal(repeated.status,200);assert.equal((await repeated.json()).duplicate,true);
      assert.equal((await request('/briefings/brief/copy',staff,post({...payload,title:'Different title'}))).status,409);
    });
    await db.query("UPDATE staff SET active=false WHERE id='owner'");await assert.rejects(copyDraft(pool,owner,'brief',copy,options),/Forbidden/);
  } finally {await db.close();}
});
const credentialOptions={tier:'local',aiMode:'synthetic',accessMode:'credential',publicOrigin:origin,dataClass:'synthetic',schema:options.schema};
const makePublicationRequest=request;
async function withHttp(f,run) {
  const storage=memoryStorage();
  const server=createPostgresRehearsalServer(f.pool,{...credentialOptions,storage});
  await new Promise((resolve) => server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const request=async(path,cookie,init={}) => {
    const headers={origin,'content-type':'application/json',...(cookie ? {cookie} : {}),...init.headers};
    if(cookie && (init.method==='POST' && path.startsWith('/worker/') || path.startsWith('/clarifications')) && !Object.hasOwn(headers,'x-client-session-context')) {
      const session=await (await fetch(`${base}/api/session`,{headers:{cookie}})).json();headers['x-client-session-context']=session.clientContext || '';
    }
    return fetch(`${base}/api${path}`,{...init,headers});
  };
  try {await run({request,storage,base});} finally {await new Promise((resolve) => server.close(resolve));}
}
const cookieOf=(response) => response.headers.get('set-cookie').split(';')[0];
const post=(body) => ({method:'POST',body:JSON.stringify(body)});

test('PostgreSQL publication rejects stale version confirmations, preserves old receipts and exposes scoped HTTP conflicts',async()=>{
  const f=await fixture(),{db,pool}=f;
  try {
    const input=request(),{nextVersion:omitted,...legacy}=input;
    await assert.rejects(publish(pool,owner,'brief',legacy,options),/Invalid publication version/);
    for(const nextVersion of [2,3])await assert.rejects(publish(pool,owner,'brief',{...input,nextVersion},options),/Draft version changed/);
    assert.equal((await db.query('SELECT count(*)::int n FROM publications')).rows[0].n,0);
    const first=await publish(pool,owner,'brief',input,options);assert.equal(first.version,1);
    await db.query("UPDATE briefings SET state='ready' WHERE id='brief'");
    await assert.rejects(publish(pool,owner,'brief',{...input,requestId:randomUUID()},options),/Draft version changed/);
    assert.equal((await publish(pool,owner,'brief',input,options)).duplicate,true);
    await assert.rejects(publish(pool,owner,'brief',legacy,options),/Publication request conflict/);
    await assert.rejects(publish(pool,owner,'brief',{...input,nextVersion:2},options),/Publication request conflict/);
    await assert.rejects(publish(pool,{...owner,principal_id:'auditor',role:'auditor'},'brief',input,options),/Forbidden/);
    await assert.rejects(publish(pool,{...owner,org_id:'b'},'brief',input,options),/Forbidden/);
    await provisionStaffCredential(pool,{staffId:'owner',orgId:'a',siteId:'a',email:'owner@example.test',password:'long-enough-password'},options);
    await withHttp(f,async({request:call})=>{
      const staff=cookieOf(await call('/auth/staff/login',null,post({email:'owner@example.test',password:'long-enough-password'})));
      const missing=await call('/briefings/brief/publish',staff,post({...legacy,requestId:randomUUID()}));assert.equal(missing.status,400);assert.deepEqual(await missing.json(),{error:'Invalid publication version'});
      const stale=await call('/briefings/brief/publish',staff,post({...input,requestId:randomUUID()}));assert.equal(stale.status,409);assert.deepEqual(await stale.json(),{error:'Draft version changed'});
      assert.equal((await call('/briefings/brief/publish',staff,post(input))).status,200);
      const second=await call('/briefings/brief/publish',staff,post(request(2)));assert.equal(second.status,201);assert.equal((await second.json()).version,2);
    });
    assert.equal((await db.query('SELECT count(*)::int n FROM publications')).rows[0].n,2);
    assert.equal((await db.query('SELECT count(*)::int n FROM assignments')).rows[0].n,4);
    assert.equal((await db.query("SELECT count(*)::int n FROM audit WHERE action='briefing.published'")).rows[0].n,2);
  }finally{await db.close();}
});

test('PostgreSQL historical versionless publication receipt stays immutable and replay-only',async()=>{
  const f=await fixture(),{db,pool}=f;
  try {
    const input={requestId:randomUUID(),revision:1,workerIds:['w1','w2']},json=JSON.stringify({revision:1,workerIds:['w1','w2'],dueAt:null});
    await db.query("INSERT INTO publications(id,org_id,site_id,briefing_id,version,snapshot_json,state) SELECT 'legacy-publication',org_id,site_id,id,1,prepared_json,'published' FROM briefings WHERE id='brief'");
    for(const id of ['w1','w2'])await db.query("INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,language) SELECT $1,org_id,site_id,'legacy-publication',id,language FROM workers WHERE id=$2",[randomUUID(),id]);
    await db.query("INSERT INTO publication_requests(request_id,org_id,site_id,briefing_id,publication_id,request_json) VALUES($1,'a','a','brief','legacy-publication',$2)",[input.requestId,json]);
    await db.query("UPDATE briefings SET next_version=2,state='draft' WHERE id='brief'");
    assert.deepEqual(await publish(pool,owner,'brief',input,options),{id:'legacy-publication',version:1,assigned:2,duplicate:true});
    await assert.rejects(publish(pool,owner,'brief',{...input,nextVersion:1},options),/Publication request conflict/);
    await assert.rejects(publish(pool,owner,'brief',{...input,requestId:randomUUID()},options),/Invalid publication version/);
    assert.deepEqual((await db.query('SELECT request_json FROM publication_requests')).rows[0].request_json,JSON.parse(json));
    assert.equal((await db.query('SELECT count(*)::int n FROM audit')).rows[0].n,0);
    await db.query("UPDATE staff SET active=false WHERE id='owner'");await assert.rejects(publish(pool,owner,'brief',input,options),/Forbidden/);
  }finally{await db.close();}
});

test('PostgreSQL archive preserves received answers, closes new work and safely replays after lost commit',async()=>{
  const f=await fixture(),{db,pool}=f;
  try {
    const pubRequest=request(),publication=await publish(pool,owner,'brief',pubRequest,options),assignmentId=await f.assignment(publication.id);
    const submissionId=randomUUID(),received=await submitAnswer(pool,worker,assignmentId,submissionId,answer,options);
    const help=await requestHelp(pool,worker,assignmentId,{requestId:randomUUID(),text:'Please help with the shelf'},options);
    const change={requestId:randomUUID(),revision:1,nextVersion:2,reason:'Retire the handover',confirmed:true};
    const original=(await db.query("SELECT * FROM briefings WHERE id='brief'")).rows[0];
    const snapshot=(await db.query('SELECT snapshot_json FROM publications WHERE id=$1',[publication.id])).rows[0].snapshot_json;
    const frozen=[];for(const table of ['assignments','attempts','submission_receipts','clarifications','help_requests']) frozen.push((await db.query(`SELECT * FROM ${table} ORDER BY 1`)).rows);
    for(const patch of [{confirmed:false},{requestId:'bad'},{revision:0},{nextVersion:0},{reason:'x'},{source:'injected'},{org_id:'b'}]) await assert.rejects(archiveBriefing(pool,owner,'brief',{...change,...patch},options),/Invalid/);
    for(const principal of [worker,{...owner,role:'auditor'},{...owner,role:'supervisor'},{...owner,principal_id:'missing'},{...owner,site_id:'c'}]) await assert.rejects(archiveBriefing(pool,principal,'brief',change,options),/Forbidden/);
    await assert.rejects(archiveBriefing(pool,{...owner,org_id:'b',site_id:'b',principal_id:'other'},'brief',change,options),/unavailable/);
    for(const patch of [{revision:2},{nextVersion:3}]) await assert.rejects(archiveBriefing(pool,owner,'brief',{...change,...patch},options),/revision changed/);
    for(const failure of ['INSERT INTO briefing_archives','INSERT INTO audit']) {
      f.setFail(failure);await assert.rejects(archiveBriefing(pool,owner,'brief',change,options),/Injected/);f.setFail('');
      assert.deepEqual((await db.query("SELECT * FROM briefings WHERE id='brief'")).rows[0],original);
      assert.equal((await db.query('SELECT state FROM publications WHERE id=$1',[publication.id])).rows[0].state,'published');
      assert.equal((await db.query('SELECT * FROM briefing_archives')).rows.length,0);
    }
    f.loseNextCommit();await assert.rejects(archiveBriefing(pool,owner,'brief',change,options),/acknowledgement lost/);
    const archived=await archiveBriefing(pool,owner,'brief',change,options);assert.equal(archived.duplicate,true);assert.deepEqual(archived.closedPublicationIds,[publication.id]);
    assert.equal((await db.query("SELECT COUNT(*)::int n FROM audit WHERE action='briefing.archived'")).rows[0].n,1);
    assert.deepEqual((await db.query('SELECT snapshot_json FROM publications WHERE id=$1',[publication.id])).rows[0].snapshot_json,snapshot);
    const after=[];for(const table of ['assignments','attempts','submission_receipts','clarifications','help_requests']) after.push((await db.query(`SELECT * FROM ${table} ORDER BY 1`)).rows);assert.deepEqual(after,frozen);
    const detail=await getBriefing(pool,owner,'brief',options);assert.equal(detail.archive.reason,change.reason);assert.equal(detail.publications[0].state,'archived');assert.deepEqual(detail.prepared,original.prepared_json);
    assert.equal((await listBriefings(pool,owner,{},options)).total,0);
    assert.equal((await listBriefings(pool,owner,{archiveStatus:'archived',publicationStatus:'archived',status:'draft',search:'shelf'},options)).total,1);
    assert.deepEqual((await listBriefings(pool,owner,{archiveStatus:'all',page:2,pageSize:1},options)).items,[]);
    await assert.rejects(listBriefings(pool,owner,{archiveStatus:'bad'},options),/Invalid/);
    for(const patch of [{reason:'Different reason'},{revision:2},{nextVersion:3}]) await assert.rejects(archiveBriefing(pool,owner,'brief',{...change,...patch},options),/request conflict/);
    await assert.rejects(archiveBriefing(pool,owner,'brief',{...change,requestId:randomUUID()},options),/is archived/);
    await assert.rejects(editDraft(pool,owner,'brief',{revision:1,title:'New title',source:CANONICAL_SOURCE},options),/is archived/);
    await assert.rejects(queuePreparation(pool,owner,'brief',1,options),/is archived/);
    await assert.rejects(publish(pool,owner,'brief',request(),options),/is archived/);
    assert.equal((await publish(pool,owner,'brief',pubRequest,options)).duplicate,true);
    await assert.rejects(submitAnswer(pool,worker,assignmentId,randomUUID(),answer,options),/unavailable/);
    await assert.rejects(requestHelp(pool,worker,assignmentId,{requestId:randomUUID(),text:'New request'},options),/unavailable/);
    assert.equal((await requestHelp(pool,worker,assignmentId,{requestId:help.id,text:'Please help with the shelf'},options)).duplicate,true);
    assert.equal((await submitAnswer(pool,worker,assignmentId,submissionId,answer,options)).duplicate,true);
    assert.equal((await workerBriefing(pool,worker,assignmentId,options)).state,'archived');
    await processOneAssessment(pool,{assess:async()=>matched},options);
    assert.equal((await db.query('SELECT assessment_status,outcome FROM attempts WHERE id=$1',[received.id])).rows[0].outcome,'matched');
    assert.equal((await readPublicationReport(pool,owner,{...options,publicationId:publication.id})).metrics.matches,1);
    const copy=await copyDraft(pool,owner,'brief',{requestId:randomUUID(),revision:1,title:'Fresh archived copy',confirmed:true},options);
    assert.equal((await getBriefing(pool,owner,copy.id,options)).prepared,null);
    await assert.rejects(archiveBriefing(pool,owner,copy.id,change,options),/request conflict/);
    await assert.rejects(db.query('UPDATE briefing_archives SET archived_by=$1',['owner']),/immutable/);
    await assert.rejects(db.query('DELETE FROM briefing_archives'),/immutable/);
    await provisionStaffCredential(pool,{staffId:'owner',orgId:'a',siteId:'a',email:'owner@example.test',password:'long-enough-password'},options);
    await withHttp(f,async({request})=>{
      const staff=cookieOf(await request('/auth/staff/login',null,post({email:'owner@example.test',password:'long-enough-password'})));
      const grant=await issueWorkerGrant(pool,owner,'w1',30,options),workerCookie=cookieOf(await request('/auth/worker/redeem',null,post({token:grant.token})));
      const payload={requestId:randomUUID(),revision:1,nextVersion:1,reason:'HTTP archive',confirmed:true},path=`/briefings/${copy.id}/archive`;
      assert.equal((await request(path,null,post(payload))).status,401);assert.equal((await request(path,workerCookie,post(payload))).status,403);
      assert.equal((await request('/briefings/missing/archive',staff,post(payload))).status,404);
      assert.equal((await request(path,staff,post({...payload,confirmed:false}))).status,400);assert.equal((await request(path,staff,post({...payload,nextVersion:2}))).status,409);
      const result=await request(path,staff,post(payload));assert.equal(result.status,200);assert.match(result.headers.get('cache-control'),/no-store/);
      assert.equal((await (await request(path,staff,post(payload))).json()).duplicate,true);
      assert.equal((await request(path,staff,post({...payload,reason:'Changed reason'}))).status,409);
      assert.equal((await request(`/briefings/${copy.id}/process`,staff,post({revision:1}))).status,409);
      assert.equal((await (await request('/briefings?archiveStatus=archived',staff)).json()).total,2);
      assert.equal((await request('/briefings?archiveStatus=bad',staff)).status,400);
    });
    await db.query("UPDATE staff SET active=false WHERE id='owner'");await assert.rejects(archiveBriefing(pool,owner,'brief',change,options),/Forbidden/);
  } finally {await db.close();}
});

test('PostgreSQL archive fences an in-flight preparation result without clearing saved source',async()=>{
  const f=await fixture(),{db,pool}=f;
  try {
    await db.query("UPDATE briefings SET state='draft',prepared_json=NULL WHERE id='brief'");
    const job=await queuePreparation(pool,owner,'brief',1,options);
    assert.equal(await processOnePreparation(pool,{...options,async prepare(source){
      await archiveBriefing(pool,owner,'brief',{requestId:randomUUID(),revision:1,nextVersion:1,reason:'Retire during processing',confirmed:true},options);
      return syntheticPrepare(source);
    }}),true);
    const row=(await db.query("SELECT source,state,prepared_json FROM briefings WHERE id='brief'")).rows[0];
    assert.equal(row.source,CANONICAL_SOURCE);assert.equal(row.state,'failed');assert.equal(row.prepared_json,null);
    const cancelled=(await db.query('SELECT status,error,lease_token,lease_until FROM jobs WHERE id=$1',[job.id])).rows[0];
    assert.deepEqual(cancelled,{status:'failed',error:'Briefing archived',lease_token:null,lease_until:null});
    assert.equal((await db.query("SELECT * FROM audit WHERE action='briefing.prepared'")).rows.length,0);
    assert.equal(await processOnePreparation(pool,options),false);
  } finally {await db.close();}
});

test('PostgreSQL response drilldown isolates exact publication and paged receipt history without mutation',async () => {
  const f=await fixture(),{db,pool}=f;
  try {
    const pub=await publish(pool,owner,'brief',request(),options),assignment=await f.assignment(pub.id);
    let list=await listPublicationResponses(pool,owner,pub.id,{pageSize:1},options);assert.equal(list.total,2);assert.equal(list.items.length,1);assert.equal(list.items[0].status,'awaiting_response');
    assert.ok(!/rubric|answerText|reasons|storage|question/.test(JSON.stringify(list)));
    await submitAnswer(pool,worker,assignment,randomUUID(),answer,options);
    assert.equal((await listPublicationResponses(pool,owner,pub.id,{status:'assessment_pending'},options)).total,1);
    await processOneAssessment(pool,{assess:async () => matched},options);
    const audio=await receiveRecording(pool,worker,assignment,randomUUID(),wav(),memoryStorage(),options);
    list=await listPublicationResponses(pool,owner,pub.id,{search:'001'},options);assert.equal(list.items[0].status,'assessment_pending');assert.equal(list.items[0].outcome,null);
    await db.query("UPDATE recordings SET status='failed' WHERE id=$1",[audio.id]);
    assert.equal((await listPublicationResponses(pool,owner,pub.id,{status:'failed_audio'},options)).total,1);
    assert.equal((await staffWorkerAssignments(pool,owner,'w1',{},options)).items[0].status,'failed_audio');
    await submitAnswer(pool,worker,assignment,randomUUID(),answer,options);
    let detail=await getPublicationResponse(pool,owner,pub.id,assignment,{pageSize:1},options);assert.equal(detail.total,3);assert.equal(detail.receipts[0].isLatest,true);assert.equal(detail.receipts[0].outcome,null);
    await processOneAssessment(pool,{assess:async () => matched},options);
    detail=await getPublicationResponse(pool,owner,pub.id,assignment,{pageSize:1},options);assert.equal(detail.receipts[0].outcome,'matched');assert.equal(detail.receipts[0].evidence.length,2);
    detail=await getPublicationResponse(pool,owner,pub.id,assignment,{page:2,pageSize:1},options);assert.equal(detail.receipts[0].recordingId,audio.id);assert.equal(detail.receipts[0].isLatest,false);
    const own=await workerSubmissions(pool,worker,assignment,{pageSize:1},options);assert.equal(own.total,3);assert.equal(own.receipts[0].outcome,'matched');assert.equal(own.receipts[0].isLatest,true);
    assert.deepEqual(Object.keys(own.receipts[0]).sort(),['id','kind','receivedAt','isLatest','answerText','outcome','recordingId','audioStatus'].sort());
    assert.ok(!/reasons|evidence|notes|facts|rubric|sequence|storage|sha256/.test(JSON.stringify(own)));
    assert.equal((await workerSubmissions(pool,worker,assignment,{page:2,pageSize:1},options)).receipts[0].recordingId,audio.id);
    await assert.rejects(workerSubmissions(pool,owner,assignment,{},options),/Forbidden/);
    await assert.rejects(workerSubmissions(pool,{...worker,principal_id:'w2'},assignment,{},options),/Response unavailable/);
    await assert.rejects(workerSubmissions(pool,{...worker,access_mode:'credential',grant_id:'revoked'},assignment,{},options),/Sign in required/);
    assert.equal((await getPublicationResponse(pool,owner,pub.id,assignment,{page:5000},options)).receipts.length,0);
    await assert.rejects(listPublicationResponses(pool,worker,pub.id,{},options),/Forbidden/);
    const other={...owner,principal_id:'other',org_id:'b',site_id:'b'};
    await assert.rejects(getPublicationResponse(pool,other,pub.id,assignment,{},options),/Publication unavailable/);
    await assert.rejects(getPublicationResponse(pool,owner,pub.id,'foreign-assignment',{},options),/Response unavailable/);
    await assert.rejects(getPublicationResponse(pool,owner,pub.id,assignment,null,options),/Invalid response filter/);
    assert.equal((await getPublicationResponse(pool,{...owner,principal_id:'auditor',role:'auditor'},pub.id,assignment,{},options)).total,3);
    await db.query("UPDATE briefings SET state='ready' WHERE id='brief'");
    const newer=await publish(pool,owner,'brief',request(2),options);
    await assert.rejects(getPublicationResponse(pool,owner,newer.id,assignment,{},options),/Response unavailable/);
    const auditBefore=(await db.query('SELECT COUNT(*)::int n FROM audit')).rows[0].n;
    detail=await getPublicationResponse(pool,owner,pub.id,assignment,{},options);assert.equal(detail.publication.state,'superseded');assert.equal(detail.total,3);
    assert.equal((await workerSubmissions(pool,worker,assignment,{},options)).assignment.state,'superseded');
    const directory=await staffWorkerAssignments(pool,owner,'w1',{pageSize:1},options);assert.equal(directory.total,2);assert.equal(directory.items[0].publicationId,newer.id);assert.equal(directory.items[0].status,'awaiting_response');
    const older=await staffWorkerAssignments(pool,owner,'w1',{page:2,pageSize:1},options);assert.equal(older.items[0].publicationId,pub.id);assert.equal(older.items[0].state,'superseded');assert.equal(older.items[0].status,'matched');
    assert.equal(older.items[0].assignmentId,assignment);assert.ok(!/answerText|rubric|facts|question|reasons|notes|storage|sha256/.test(JSON.stringify(older)));
    const empty=await staffWorkerAssignments(pool,owner,'w1',{page:5000},options);assert.equal(empty.total,2);assert.equal(empty.items.length,0);
    assert.equal((await staffWorkerAssignments(pool,owner,'w2',{},options)).items[0].language,'ur');
    await assert.rejects(staffWorkerAssignments(pool,worker,'w1',{},options),/Forbidden/);
    await assert.rejects(staffWorkerAssignments(pool,{...owner,principal_id:'auditor',role:'auditor'},'w1',{},options),/Forbidden/);
    for(const id of ['missing','w3','wb']) await assert.rejects(staffWorkerAssignments(pool,owner,id,{},options),/Worker unavailable/);
    for(const session of [{...owner,principal_id:'missing'},{...owner,site_id:'c'},{...owner,org_id:'b'}]) await assert.rejects(staffWorkerAssignments(pool,session,'w1',{},options),/Forbidden/);
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM audit')).rows[0].n,auditBefore);
    await provisionStaffCredential(pool,{staffId:'owner',orgId:'a',siteId:'a',email:'owner@example.test',password:'long-enough-password'},options);
    await withHttp(f,async ({request}) => {
      const staff=cookieOf(await request('/auth/staff/login',null,post({email:'owner@example.test',password:'long-enough-password'})));
      const path=`/publications/${pub.id}/responses`;
      assert.equal((await request(path,null)).status,401);assert.equal((await request(`${path}?status=resolved`,staff)).status,400);
      assert.equal((await (await request(path,staff)).json()).total,2);
      assert.equal((await request(`${path}/missing`,staff)).status,404);
      assert.equal((await (await request(`${path}/${assignment}?pageSize=1`,staff)).json()).receipts.length,1);
      const directoryPath='/people/workers/w1/assignments';
      assert.equal((await request(directoryPath,null)).status,401);assert.equal((await request('/people/workers/wb/assignments',staff)).status,404);
      assert.equal((await request(`${directoryPath}?status=all`,staff)).status,400);assert.equal((await request(`${directoryPath}?pageSize=51`,staff)).status,400);
      assert.equal((await (await request(`${directoryPath}?page=2&pageSize=1`,staff)).json()).items[0].publicationId,pub.id);
      const grant=await issueWorkerGrant(pool,owner,'w1',60,options);
      const workerCookie=cookieOf(await request('/auth/worker/redeem',null,post({token:grant.token})));
      const ownPath=`/worker/briefings/${assignment}/submissions`;
      assert.equal((await request(ownPath,staff)).status,403);assert.equal((await request(`${ownPath}?status=all`,workerCookie)).status,400);
      const result=await (await request(`${ownPath}?pageSize=1`,workerCookie)).json();assert.equal(result.total,3);assert.equal(result.assignment.state,'superseded');assert.ok(!/rubric|reasons|evidence|notes|sequence/.test(JSON.stringify(result)));
      assert.equal((await request(directoryPath,workerCookie)).status,403);
    });
    await db.query("UPDATE workers SET language='ar',active=false WHERE id='w1'");
    const disabled=await staffWorkerAssignments(pool,owner,'w1',{},options);assert.equal(disabled.worker.active,false);assert.equal(disabled.items[0].language,'en');assert.equal(disabled.total,2);
    await db.query("UPDATE staff SET active=false WHERE id='owner'");
    await assert.rejects(staffWorkerAssignments(pool,owner,'w1',{},options),/Forbidden/);
  } finally {await db.close();}
});

test('PostgreSQL library returns bounded scoped pages and separates ready drafts from latest publication state',async () => {
  const f=await fixture(),{db,pool}=f;
  try {
    await db.query(`INSERT INTO briefings(id,org_id,site_id,title,source,state,updated_at)
      SELECT 'library-'||n,'a','a','Synthetic library '||lpad(n::text,3,'0'),'A scoped synthetic source','draft','2026-01-01T00:00:00Z'::timestamptz FROM generate_series(0,124) n`);
    await db.query(`INSERT INTO briefings(id,org_id,site_id,title,source,state) VALUES
      ('foreign-site','a','c','Synthetic library foreign site','A scoped synthetic source','draft'),
      ('foreign-org','b','b','Synthetic library foreign organization','A scoped synthetic source','draft'),
      ('percent-title','a','a','100% readiness','A scoped synthetic source','draft')`);
    const pub=await publish(pool,owner,'brief',request(),options);
    await db.query("UPDATE briefings SET state='ready' WHERE id='brief'");
    let result=await listBriefings(pool,owner,{search:'SYNTHETIC library',sort:'title',page:2,pageSize:20},options);
    assert.equal(result.total,125);assert.equal(result.items.length,20);assert.equal(result.items[0].title,'Synthetic library 020');assert.equal(result.items.at(-1).title,'Synthetic library 039');
    assert.ok(!/source|prepared_json|rubric/.test(JSON.stringify(result)));
    result=await listBriefings(pool,owner,{search:'Synthetic library',page:5000},options);assert.equal(result.items.length,0);assert.equal(result.total,125);
    assert.equal((await listBriefings(pool,owner,{search:'%'},options)).total,1);
    assert.equal((await listBriefings(pool,owner,{publicationStatus:'unpublished'},options)).total,126);
    result=await listBriefings(pool,owner,{status:'ready',publicationStatus:'published'},options);assert.equal(result.total,1);assert.equal(result.items[0].published_version,1);
    const auditor={...owner,principal_id:'auditor',role:'auditor'};
    assert.equal((await listBriefings(pool,auditor,{status:'ready'},options)).total,1);
    await assert.rejects(listBriefings(pool,worker,{},options),/Forbidden/);
    await withdrawPublication(pool,owner,'brief',{requestId:randomUUID(),publicationId:pub.id,version:1,reason:'Library state test'},options);
    assert.equal((await listBriefings(pool,owner,{status:'ready',publicationStatus:'withdrawn'},options)).total,1);
    assert.equal((await listBriefings(pool,owner,{publicationStatus:'published'},options)).total,0);
    await provisionStaffCredential(pool,{staffId:'owner',orgId:'a',siteId:'a',email:'owner@example.test',password:'long-enough-password'},options);
    await withHttp(f,async ({request}) => {
      const staff=cookieOf(await request('/auth/staff/login',null,post({email:'owner@example.test',password:'long-enough-password'})));
      assert.equal((await (await request('/briefings?search=Synthetic%20library&page=7&sort=title',staff)).json()).items.length,5);
      for(const query of ['?pageSize=101','?page=0','?sort=invalid','?org_id=b']) assert.equal((await request(`/briefings${query}`,staff)).status,400);
      assert.equal((await request('/briefings',null)).status,401);
    });
  } finally {await db.close();}
});

test('PostgreSQL worker inbox pages beyond 100 versions, keeps closed sent answers and rechecks authority',async () => {
  const f=await fixture(),{db,pool}=f;
  try {
    const pub=await publish(pool,owner,'brief',request(),options),assignment=await f.assignment(pub.id);
    await submitAnswer(pool,worker,assignment,randomUUID(),answer,options);
    await db.query("UPDATE publications SET state='superseded' WHERE id=$1",[pub.id]);
    const snapshot=JSON.stringify(syntheticPrepare(CANONICAL_SOURCE));
    await db.query(`INSERT INTO publications(id,org_id,site_id,briefing_id,version,snapshot_json,published_at,state)
      SELECT 'inbox-'||lpad(n::text,3,'0'),'a','a','brief',100+n,$1::jsonb,'2026-01-01T00:00:00Z',CASE WHEN n<120 THEN 'superseded' ELSE 'published' END FROM generate_series(0,124) n`,[snapshot]);
    await db.query(`INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,language,due_at)
      SELECT 'inbox-assignment-'||lpad(n::text,3,'0'),'a','a','inbox-'||lpad(n::text,3,'0'),'w1','en',CASE WHEN n=122 THEN '2000-01-01T00:00:00Z'::timestamptz ELSE NULL END FROM generate_series(0,124) n`);
    const audio=await receiveRecording(pool,worker,'inbox-assignment-124',randomUUID(),wav(),memoryStorage(),options);
    await db.query("UPDATE workers SET language='ur' WHERE id='w1'");
    const before=(await db.query('SELECT * FROM submission_receipts ORDER BY sequence')).rows,audit=(await db.query('SELECT COUNT(*)::int n FROM audit')).rows[0].n;
    let result=await workerBriefings(pool,worker,{...options,history:true},{page:7,pageSize:20});assert.equal(result.total,126);assert.equal(result.items.length,6);assert.equal(result.items.at(-1).id,'inbox-assignment-000');
    assert.deepEqual(result.counts,{todo:3,sent:2,history:126,followup:0});assert.equal(result.items[0].language,'en');
    const inboxText=JSON.stringify(result);
    for(const key of ['rubric','source','facts','question','reasons','notes','answer_text','snapshot','sequence','storage'])
      assert.ok(!inboxText.includes(`"${key}":`),key);
    assert.ok(!inboxText.includes(answer));
    result=await workerBriefings(pool,worker,options,{view:'todo',pageSize:1});assert.equal(result.total,3);assert.equal(result.items.length,1);assert.ok(!['inbox-assignment-122','inbox-assignment-124',assignment].includes(result.items[0].id));
    result=await workerBriefings(pool,worker,options,{view:'sent'});assert.equal(result.total,2);assert.equal(result.items[0].state,'superseded');assert.equal(result.items[0].assessmentStatus,'pending');assert.equal(result.items[1].audioStatus,'received');
    await db.query("UPDATE recordings SET status='failed' WHERE id=$1",[audio.id]);
    result=await workerBriefings(pool,worker,options,{view:'sent'});assert.equal(result.total,2);assert.equal(result.items[1].audioStatus,'failed');
    assert.equal((await workerBriefings(pool,worker,options)).total,5);
    assert.equal((await workerBriefings(pool,worker,{...options,history:true},{page:5000})).items.length,0);
    assert.equal((await staffWorkerAssignments(pool,owner,'w1',{page:7,pageSize:20},options)).total,126);
    assert.equal((await workerBriefings(pool,{...worker,principal_id:'wb',org_id:'b',site_id:'b'},{...options,history:true})).total,0);
    for(const session of [owner,{...worker,site_id:'c'},{...worker,principal_id:'missing'}]) await assert.rejects(workerBriefings(pool,session,options),/Forbidden/);
    await assert.rejects(workerBriefings(pool,{...worker,access_mode:'credential',grant_id:'revoked'},options),/Sign in required/);
    const grant=await issueWorkerGrant(pool,owner,'w1',60,options);
    await withHttp(f,async ({request}) => {
      const cookie=cookieOf(await request('/auth/worker/redeem',null,post({token:grant.token})));
      for(const query of ['?view=unknown','?pageSize=51','?worker_id=wb','?history=true']) assert.equal((await request(`/worker/history${query}`,cookie)).status,400);
      const result=await (await request('/worker/history?page=7&pageSize=20',cookie)).json();assert.equal(result.total,126);assert.equal(result.items.length,6);
      assert.equal((await (await request('/worker/briefings?view=sent',cookie)).json()).total,2);
    });
    // Grant issuance/redeem has its own audit; the inbox reads themselves did not append evidence.
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM audit')).rows[0].n,audit+2);
    assert.deepEqual((await db.query('SELECT * FROM submission_receipts ORDER BY sequence')).rows,before);
    await db.query("UPDATE workers SET active=false WHERE id='w1'");await assert.rejects(workerBriefings(pool,worker,options),/Forbidden/);
  } finally {await db.close();}
});

test('PostgreSQL withdrawal is scoped, atomic, exactly replayed and preserves pending assessment',async () => {
  const f=await fixture(),{db,pool}=f;
  try {
    const pub=await publish(pool,owner,'brief',request(),options),assignment=await f.assignment(pub.id),submissionId=randomUUID();
    const snapshot=(await db.query('SELECT snapshot_json FROM publications WHERE id=$1',[pub.id])).rows[0].snapshot_json;
    const accepted=await submitAnswer(pool,worker,assignment,submissionId,answer,options);
    const input={requestId:randomUUID(),publicationId:pub.id,version:1,reason:'Source instruction replaced'};
    await assert.rejects(withdrawPublication(pool,worker,'brief',input,options),/Forbidden/);
    await assert.rejects(withdrawPublication(pool,{...owner,principal_id:'auditor',role:'auditor'},'brief',input,options),/Forbidden/);
    await assert.rejects(withdrawPublication(pool,{...owner,principal_id:'other',org_id:'b',site_id:'b'},'brief',input,options),/unavailable/);
    await assert.rejects(withdrawPublication(pool,owner,'brief',{...input,version:2},options),/no longer current/);
    f.setFail('INSERT INTO audit');await assert.rejects(withdrawPublication(pool,owner,'brief',input,options),/Injected/);f.setFail('');
    assert.equal((await db.query('SELECT state FROM publications WHERE id=$1',[pub.id])).rows[0].state,'published');
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM publication_withdrawals')).rows[0].n,0);
    f.loseNextCommit();await assert.rejects(withdrawPublication(pool,owner,'brief',input,options),/acknowledgement lost/);
    assert.equal((await withdrawPublication(pool,owner,'brief',input,options)).duplicate,true);
    await assert.rejects(withdrawPublication(pool,owner,'brief',{...input,reason:'Changed reason'},options),/conflict/);
    await assert.rejects(withdrawPublication(pool,owner,'brief',{...input,requestId:randomUUID()},options),/no longer current/);
    assert.equal((await submitAnswer(pool,worker,assignment,submissionId,answer,options)).id,accepted.id);
    await assert.rejects(submitAnswer(pool,worker,assignment,randomUUID(),answer,options),/unavailable/);
    await assert.rejects(requestHelp(pool,worker,assignment,{requestId:randomUUID(),text:'I need help'},options),/unavailable/);
    assert.equal((await workerBriefing(pool,worker,assignment,options)).state,'withdrawn');
    assert.equal((await workerBriefings(pool,worker,options)).items.length,0);
    assert.equal((await workerBriefings(pool,worker,{...options,history:true})).items.length,1);
    assert.equal(await processOneAssessment(pool,{async assess() {return matched;}},options),true);
    assert.equal((await readPublicationReport(pool,owner,{...options,publicationId:pub.id})).metrics.matches,1);
    assert.deepEqual((await db.query('SELECT snapshot_json FROM publications WHERE id=$1',[pub.id])).rows[0].snapshot_json,snapshot);
    assert.equal((await db.query("SELECT COUNT(*)::int n FROM audit WHERE action='briefing.withdrawn'")).rows[0].n,1);
    await assert.rejects(db.query("UPDATE publication_withdrawals SET reason='Changed reason'"),/immutable/);
    await assert.rejects(db.query('DELETE FROM publication_withdrawals'),/immutable/);
    assert.equal((await getBriefing(pool,owner,'brief',options)).publications[0].withdrawal.reason,input.reason);
    await provisionStaffCredential(pool,{staffId:'owner',orgId:'a',siteId:'a',email:'owner@example.test',password:'long-enough-password'},options);
    const grant=await issueWorkerGrant(pool,owner,'w1',30,options);
    await withHttp(f,async ({request}) => {
      const staff=cookieOf(await request('/auth/staff/login',null,post({email:'owner@example.test',password:'long-enough-password'})));
      const member=cookieOf(await request('/auth/worker/redeem',null,post({token:grant.token})));
      assert.equal((await request('/briefings/brief/withdraw',null,post(input))).status,401);
      assert.equal((await request('/briefings/brief/withdraw',member,post(input))).status,403);
      assert.equal((await request('/briefings/brief/withdraw',staff,post({...input,reason:''}))).status,400);
      assert.equal((await request('/briefings/brief/withdraw',staff,post({...input,reason:'Changed reason'}))).status,409);
      assert.equal((await (await request('/briefings/brief/withdraw',staff,post(input))).json()).duplicate,true);
    });
    await db.query("UPDATE briefings SET state='ready' WHERE id='brief'");
    const next=await publish(pool,owner,'brief',request(2),options);
    assert.equal((await withdrawPublication(pool,owner,'brief',input,options)).id,pub.id);
    assert.equal((await db.query('SELECT state FROM publications WHERE id=$1',[next.id])).rows[0].state,'published');
  } finally {await db.close();}
});

test('PostgreSQL overview and preparation queue report scoped live evidence, exact frozen titles and current civil date',async () => {
  const f=await fixture(),{db,pool}=f;
  try {
    assert.equal((await staffOverview(pool,owner,options)).metrics.assigned,0);
    const pub=await publish(pool,owner,'brief',request(),options),assignment=await f.assignment(pub.id);
    await submitAnswer(pool,worker,assignment,'overview-answer','Finished blue',options);
    let overview=await staffOverview(pool,owner,options); assert.equal(overview.metrics.responses,1); assert.equal(overview.metrics.unassessed,1); assert.equal(overview.metrics.pending,1);
    await processOneAssessment(pool,{async assess() {return {outcome:'clarification',reasons:['missing_asked_fact'],evidence:[]};}},options);
    await db.query("UPDATE briefings SET title='Changed draft' WHERE id='brief'");
    overview=await staffOverview(pool,owner,options); assert.equal(overview.metrics.clarifications,1); assert.equal(overview.cases.length,1); assert.notEqual(overview.cases[0].title,'Changed draft');
    assert.equal(overview.date,new Intl.DateTimeFormat('en',{timeZone:'UTC',weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date(overview.asOf)));
    assert.equal(overview.publication.id,pub.id); assert.equal(overview.demo,false);
    assert.equal((await getBriefing(pool,owner,'brief',options)).publications[0].metrics.assigned,2);
    const draft=await createDraft(pool,owner,{requestId:randomUUID(),title:'New briefing',source:CANONICAL_SOURCE},options);
    await queuePreparation(pool,owner,draft.id,1,options);
    const jobs=await listProcessing(pool,owner,{kind:'prepare'},options); assert.equal(jobs.total,1); assert.equal(jobs.items[0].briefing_id,draft.id); assert.equal(jobs.items[0].status,'queued');
    const allJobs=await listProcessing(pool,owner,{},options);assert.equal(allJobs.total,2);
    const checkJob=allJobs.items.find(row=>row.kind==='answer_check');assert.equal(checkJob.status,'complete');assert.equal(checkJob.publication_id,pub.id);assert.equal(checkJob.assignment_id,assignment);assert.notEqual(checkJob.title,'Changed draft');
    assert.ok(!/lease_token|prepared_json|rubric/.test(JSON.stringify(jobs)));
    await assert.rejects(staffOverview(pool,worker,options),/Forbidden/);
    await assert.rejects(listProcessing(pool,worker,{},options),/Forbidden/);
    const foreign={...owner,principal_id:'other',org_id:'b',site_id:'b'};
    assert.equal((await staffOverview(pool,foreign,options)).metrics.assigned,0); assert.equal((await listProcessing(pool,foreign,{},options)).total,0);
    await provisionStaffCredential(pool,{staffId:'owner',orgId:'a',siteId:'a',email:'owner@example.test',password:'long-enough-password'},options);
    const grant=await issueWorkerGrant(pool,owner,'w1',30,options);
    await withHttp(f,async ({request}) => {
      const staff=cookieOf(await request('/auth/staff/login',null,post({email:'owner@example.test',password:'long-enough-password'})));
      const member=cookieOf(await request('/auth/worker/redeem',null,post({token:grant.token})));
      assert.equal((await request('/overview',staff)).status,200); assert.equal((await request('/processing',staff)).status,200);
      const checkedDetail=await request(`/processing/${encodeURIComponent(checkJob.id)}`,staff);assert.equal(checkedDetail.status,200);assert.equal((await checkedDetail.json()).id,checkJob.id);
      assert.equal((await request('/overview',member)).status,403); assert.equal((await request('/processing',member)).status,403);
    });
  } finally {await db.close();}
});

test('PostgreSQL historical briefing detail keeps each frozen audience and receipt outcome independent',async()=>{
  const f=await fixture(),{db,pool}=f;
  try {
    const first=await publish(pool,owner,'brief',request(),options),oldAssignment=await f.assignment(first.id);
    await submitAnswer(pool,worker,oldAssignment,'old-version-answer',answer,options);
    await processOneAssessment(pool,{async assess(){return matched;}},options);
    await db.query("UPDATE briefings SET state='ready' WHERE id='brief'");
    const second=await publish(pool,owner,'brief',{requestId:randomUUID(),revision:1,nextVersion:2,workerIds:['w2']},options);
    const newAssignment=await f.assignment(second.id,'w2'),urduWorker={...worker,principal_id:'w2'};
    await submitAnswer(pool,urduWorker,newAssignment,'new-version-answer','Pending check',options);
    const before=JSON.stringify((await db.query('SELECT * FROM publications ORDER BY id')).rows);
    f.queries.length=0;
    const detail=await getBriefing(pool,owner,'brief',options);
    assert.ok(f.queries.some(sql=>sql.includes('ISOLATION LEVEL REPEATABLE READ')));
    assert.deepEqual(detail.publications.map(row=>row.id),[second.id]);
    const history=await listPublicationHistory(pool,owner,'brief',{},options);
    assert.deepEqual(history.items.map(row=>row.id),[second.id,first.id]);
    const oldDetail=await getPublicationHistoryDetail(pool,owner,'brief',first.id,options);
    assert.deepEqual(detail.publications[0].metrics,{assigned:1,responses:1,matches:0,clarifications:0,unassessed:1,pending:0,completion:100});
    assert.deepEqual(oldDetail.metrics,{assigned:2,responses:1,matches:1,clarifications:0,unassessed:0,pending:1,completion:50});
    await processOneAssessment(pool,{async assess(){return {outcome:'clarification',reasons:['missing_asked_fact'],evidence:[]};}},options);
    const checked=await getBriefing(pool,owner,'brief',options);
    assert.equal(checked.publications[0].metrics.clarifications,1);assert.deepEqual((await getPublicationHistoryDetail(pool,owner,'brief',first.id,options)).metrics,oldDetail.metrics);
    assert.equal(JSON.stringify((await db.query('SELECT * FROM publications ORDER BY id')).rows),before);
    await assert.rejects(getBriefing(pool,worker,'brief',options),/Forbidden/);
    await assert.rejects(getBriefing(pool,{...owner,principal_id:'other',org_id:'b',site_id:'b'},'brief',options),/unavailable/);
    const auditor=await getBriefing(pool,{...owner,principal_id:'auditor',role:'auditor'},'brief',options);
    assert.deepEqual(auditor.publications.map(row=>row.metrics),checked.publications.map(row=>row.metrics));
    assert.deepEqual((await getPublicationHistoryDetail(pool,{...owner,principal_id:'auditor',role:'auditor'},'brief',first.id,options)).metrics,oldDetail.metrics);
    await provisionStaffCredential(pool,{staffId:'owner',orgId:'a',siteId:'a',email:'owner@example.test',password:'long-enough-password'},options);
    await withHttp(f,async({request})=>{
      const staff=cookieOf(await request('/auth/staff/login',null,post({email:'owner@example.test',password:'long-enough-password'})));
      const response=await request('/briefings/brief',staff);assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);
      assert.deepEqual((await response.json()).publications.map(row=>row.metrics),checked.publications.map(row=>row.metrics));
    });
  } finally {await db.close();}
});

test('PostgreSQL processing paging, detail privacy and guarded current-revision retry match SQLite',async()=>{
  const f=await fixture(),{db,pool}=f;
  try {
    await db.query(`INSERT INTO jobs(id,org_id,site_id,briefing_id,revision,kind,status,error,due_at,created_at)
      SELECT 'job-' || lpad(i::text,3,'0'),'a','a','brief',i+1,'prepare',CASE WHEN i%2=0 THEN 'ready' ELSE 'failed' END,
        'provider-secret https://private.invalid/key','2099-10-01T00:00:00Z'::timestamptz,'2026-10-01T00:00:00Z'::timestamptz FROM generate_series(0,124) i`);
    const first=await listProcessing(pool,owner,{pageSize:100},options),last=await listProcessing(pool,owner,{page:2,pageSize:100},options);
    assert.equal(first.total,125);assert.equal(first.items.length,100);assert.equal(last.items.length,25);
    assert.equal(new Set([...first.items,...last.items].map(row=>row.id)).size,125);assert.equal(first.items[0].id,'job-000');
    assert.equal((await listProcessing(pool,owner,{status:'failed'},options)).total,62);
    assert.equal((await listProcessing(pool,owner,{search:'%'} ,options)).total,0);assert.deepEqual((await listProcessing(pool,owner,{page:100},options)).items,[]);
    assert.ok(!/provider-secret|lease_token|rubric/.test(JSON.stringify(first)));assert.equal(last.items.every(row=>!row.retryAvailable),true);
    await assert.rejects(getProcessing(pool,worker,'job-000',options),/Forbidden/);
    await assert.rejects(getProcessing(pool,{...owner,principal_id:'other',org_id:'b',site_id:'b'},'job-000',options),/unavailable/);
    assert.equal((await getProcessing(pool,{...owner,principal_id:'auditor',role:'auditor'},'job-000',options)).status,'ready');
    const draft=await createDraft(pool,owner,{requestId:randomUUID(),title:'Retry fixture',source:CANONICAL_SOURCE},options);
    const queued=await queuePreparation(pool,owner,draft.id,1,options);
    await db.query("UPDATE jobs SET status='failed',error='provider-secret' WHERE id=$1",[queued.id]);
    await db.query("UPDATE briefings SET state='failed' WHERE id=$1",[draft.id]);
    assert.equal((await getProcessing(pool,owner,queued.id,options)).retryAvailable,true);
    const retry=await queuePreparation(pool,owner,draft.id,1,options);assert.equal(retry.id,queued.id);
    assert.equal((await queuePreparation(pool,owner,draft.id,1,options)).duplicate,true);
    await editDraft(pool,owner,draft.id,{revision:1,title:'Retry fixture',source:CANONICAL_SOURCE+' Updated.'},options);
    assert.equal((await getProcessing(pool,owner,queued.id,options)).retryAvailable,false);
    await assert.rejects(queuePreparation(pool,owner,draft.id,1,options),/revision changed/);
    await archiveBriefing(pool,owner,draft.id,{requestId:randomUUID(),revision:2,nextVersion:1,reason:'Close fixture',confirmed:true},options);
    assert.ok((await getProcessing(pool,owner,queued.id,options)).archived_at);
    await assert.rejects(queuePreparation(pool,owner,draft.id,2,options),/archived/);
    await provisionStaffCredential(pool,{staffId:'owner',orgId:'a',siteId:'a',email:'owner@example.test',password:'long-enough-password'},options);
    await withHttp(f,async({request})=>{
      const staff=cookieOf(await request('/auth/staff/login',null,post({email:'owner@example.test',password:'long-enough-password'})));
      for(const path of ['/processing?pageSize=100','/processing/job-000']) {const response=await request(path,staff);assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);}
      assert.equal((await request('/processing?status=bogus',staff)).status,400);assert.equal((await request('/processing/missing',staff)).status,404);
      assert.equal((await request('/processing/job-000')).status,401);
    });
  } finally {await db.close();}
});

test('PostgreSQL exports freeze latest received evidence, replay exactly and download scoped formula-safe metadata',async () => {
  const f=await fixture(),{db,pool}=f;
  try {
    const pub=await publish(pool,owner,'brief',request(),options),assignment=await f.assignment(pub.id);
    await db.query("UPDATE workers SET code='=HYPERLINK(\"bad\")' WHERE id='w1'");
    await submitAnswer(pool,worker,assignment,'export-answer',answer,options);
    const input={requestId:randomUUID(),publicationId:pub.id},job=await requestExport(pool,owner,input,options);
    assert.equal(job.status,'queued'); assert.equal(job.duplicate,false);
    assert.equal((await requestExport(pool,owner,input,options)).duplicate,true);
    await assert.rejects(requestExport(pool,owner,{...input,publicationId:'other'},options),/conflict/);
    await assert.rejects(requestExport(pool,worker,input,options),/Forbidden/);
    await assert.rejects(requestExport(pool,{...owner,principal_id:'other',org_id:'b',site_id:'b'},{...input,requestId:randomUUID()},options),/unavailable/);
    await assert.rejects(downloadExport(pool,owner,job.id,options),/not ready/);
    await processOneAssessment(pool,{async assess() {return matched;}},options);
    assert.equal(await processOneExport(pool,options),true); assert.equal(await processOneExport(pool,options),false);
    const file=await downloadExport(pool,owner,job.id,options);
    assert.equal(file.csv.charCodeAt(0),0xfeff);
    assert.ok(file.csv.includes("'=HYPERLINK")); assert.ok(file.csv.includes('assessment_pending')); assert.ok(!file.csv.includes('matched'));
    assert.ok(file.csv.includes('awaiting_response')); assert.ok(!/Finished blue|rubric|answer_text|password|token/.test(file.csv));
    const list=await listExports(pool,owner,options); assert.equal(list[0].status,'ready');
    for (const key of ['snapshot_json','csv','csv_hex','checksum','lease_token']) assert.equal(Object.hasOwn(list[0],key),false);
    await assert.rejects(downloadExport(pool,{...owner,principal_id:'other',org_id:'b',site_id:'b'},job.id,options),/unavailable/);
    await assert.rejects(db.query("UPDATE report_exports SET snapshot_json='[]' WHERE id=$1",[job.id]),/immutable/);
    await db.query("UPDATE report_exports SET checksum=repeat('0',64) WHERE id=$1",[job.id]);
    await assert.rejects(downloadExport(pool,owner,job.id,options),/integrity/);
    assert.equal((await db.query("SELECT COUNT(*)::int n FROM audit WHERE action='export.downloaded'")).rows[0].n,1);
    const secondInput={requestId:randomUUID(),publicationId:pub.id}; f.setFail('INSERT INTO audit');
    await assert.rejects(requestExport(pool,owner,secondInput,options),/Injected/); f.setFail('');
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM report_exports')).rows[0].n,1);
  } finally {await db.close();}
});

test('PostgreSQL export leases fence stale completion, revoke requesters, bound retries and purge expired content',async () => {
  const f=await fixture(),{db,pool}=f;
  try {
    const pub=await publish(pool,owner,'brief',request(),options);
    const makeJob=() => requestExport(pool,owner,{requestId:randomUUID(),publicationId:pub.id},options);
    const job=await makeJob();
    await processOneExport(pool,{...options,async render(rows) {
      await db.query("UPDATE report_exports SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[job.id]);
      await processOneExport(pool,options); return exportCsv(rows);
    }});
    const saved=(await db.query('SELECT status,attempts FROM report_exports WHERE id=$1',[job.id])).rows[0];
    assert.equal(saved.status,'ready'); assert.equal(saved.attempts,2);
    assert.equal((await db.query("SELECT COUNT(*)::int n FROM audit WHERE action='export.ready' AND object_id=$1",[job.id])).rows[0].n,1);
    const failed=await makeJob();
    const broken={...options,render() {throw new Error('secret provider error');}};
    for (let n=0;n<3;n++) {
      assert.equal(await processOneExport(pool,broken),true);
      const status=(await listExports(pool,owner,options)).find((row) => row.id===failed.id);
      assert.equal(status.status,'failed'); assert.equal(status.attempts,n+1); assert.equal(status.error,'Export generation failed');
      if (n<2) await retryExport(pool,owner,failed.id,{requestId:randomUUID(),attempts:n+1},options);
    }
    await assert.rejects(retryExport(pool,owner,failed.id,{requestId:randomUUID(),attempts:2},options),/cannot be retried/);
    const interrupted=await makeJob(); f.setFail('INSERT INTO audit');
    await assert.rejects(processOneExport(pool,options),/Injected/); f.setFail('');
    assert.equal((await db.query('SELECT status,csv FROM report_exports WHERE id=$1',[interrupted.id])).rows[0].status,'processing');
    await db.query("UPDATE report_exports SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[interrupted.id]);
    await processOneExport(pool,options);
    assert.equal((await db.query('SELECT status FROM report_exports WHERE id=$1',[interrupted.id])).rows[0].status,'ready');
    const expired=randomUUID();
    await db.query(`INSERT INTO report_exports(id,org_id,site_id,publication_id,requested_by,created_at,expires_at,status,snapshot_json)
      VALUES($1,'a','a',$2,'owner',clock_timestamp()-interval '48 hours',clock_timestamp()-interval '24 hours','queued','[]')`,[expired,pub.id]);
    await assert.rejects(downloadExport(pool,owner,expired,options),/expired/);
    const purged=(await db.query('SELECT status,snapshot_json,csv FROM report_exports WHERE id=$1',[expired])).rows[0];
    assert.deepEqual(purged,{status:'expired',snapshot_json:null,csv:null});
    assert.equal((await requestExport(pool,owner,{requestId:expired,publicationId:pub.id},options)).status,'expired');
    assert.equal(await expireExports(pool,options),0);
    const revoked=await makeJob();
    await db.query("UPDATE staff SET active=false WHERE id='owner'");
    await processOneExport(pool,options);
    assert.equal((await db.query('SELECT status,csv FROM report_exports WHERE id=$1',[revoked.id])).rows[0].status,'failed');
    await assert.rejects(downloadExport(pool,owner,job.id,options),/Forbidden/);
  } finally {await db.close();}
});

test('PostgreSQL CSV preview/confirm is explicit, scoped, atomic and replayed without grants or assignments',async () => {
  const f=await fixture(),{db,pool}=f;
  try {
    const crew=await createCrew(pool,owner,{name:'Morning'},options),pub=await publish(pool,owner,'brief',request(),options);
    const input={requestId:randomUUID(),filename:'crew.csv',bytes:Buffer.from('\uFEFFworker_id,language,crew\r\n"Quoted Worker",ar,Morning\r\nNew Urdu,ur,\r\n')};
    const preview=await previewWorkerImport(pool,owner,input,options); assert.equal(preview.validRows,2); assert.equal(preview.imported,0);
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM workers')).rows[0].n,4);
    assert.equal((await previewWorkerImport(pool,owner,input,options)).duplicate,true);
    await assert.rejects(previewWorkerImport(pool,owner,{...input,filename:'other.csv'},options),/conflict/);
    await assert.rejects(previewWorkerImport(pool,worker,input,options),/Forbidden/);
    await assert.rejects(getWorkerImport(pool,{...owner,principal_id:'other',org_id:'b',site_id:'b'},preview.id,options),/unavailable/);
    f.setFail('INSERT INTO crew_memberships'); await assert.rejects(confirmWorkerImport(pool,owner,preview.id,options),/Injected/); f.setFail('');
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM workers')).rows[0].n,4);
    assert.equal((await getWorkerImport(pool,owner,preview.id,options)).status,'validated');
    f.setFail('INSERT INTO audit'); await assert.rejects(confirmWorkerImport(pool,owner,preview.id,options),/Injected/); f.setFail('');
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM workers')).rows[0].n,4);
    assert.equal((await confirmWorkerImport(pool,owner,preview.id,options)).imported,2);
    assert.equal((await confirmWorkerImport(pool,owner,preview.id,options)).duplicate,true);
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM workers')).rows[0].n,6);
    assert.equal((await db.query('SELECT crew_id FROM crew_memberships')).rows[0].crew_id,crew.id);
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM assignments WHERE publication_id=$1',[pub.id])).rows[0].n,2);
    for (const table of ['worker_grants','sessions']) assert.equal((await db.query(`SELECT COUNT(*)::int n FROM ${table}`)).rows[0].n,0);
    await assert.rejects(db.query("UPDATE worker_imports SET rows_json='[]' WHERE id=$1",[preview.id]),/immutable/);
    assert.equal((await db.query("SELECT COUNT(*)::int n FROM audit WHERE action='workers.imported'")).rows[0].n,1);
    const conflictInput={requestId:randomUUID(),filename:'new.csv',bytes:Buffer.from('worker_id,language\nRaced worker,en\n')};
    await previewWorkerImport(pool,owner,conflictInput,options);
    await createWorker(pool,owner,{code:'Raced worker',language:'en'},options);
    assert.equal((await getWorkerImport(pool,owner,conflictInput.requestId,options)).invalidRows,1);
    await assert.rejects(confirmWorkerImport(pool,owner,conflictInput.requestId,options),/Fix CSV errors/);
  } finally {await db.close();}
});

test('PostgreSQL import invalid rows/parser errors cannot commit and expiry durably purges staged data',async () => {
  const f=await fixture(),{db,pool}=f;
  try {
    const bad={requestId:randomUUID(),filename:'errors.csv',bytes:Buffer.from('worker_id,language,crew\n003,en,\nDuplicate,en,\nDuplicate,ar,\n=SUM(1),xyz,\nUnknown crew,ur,Elsewhere\n')};
    const preview=await previewWorkerImport(pool,owner,bad,options); assert.equal(preview.invalidRows,4);
    await assert.rejects(confirmWorkerImport(pool,owner,bad.requestId,options),/Fix CSV errors/);
    const csv=await workerImportErrorsCsv(pool,owner,bad.requestId,options); assert.ok(csv.includes("'=SUM(1)")); assert.ok(!csv.includes('other-site'));
    for (const bytes of [Buffer.from('worker_id,language\n"bad,en\n'),Buffer.from([0xff,0xfe]),Buffer.from('wrong,headers\nA,en\n'),Buffer.from('worker_id,language\n')]) {
      const input={requestId:randomUUID(),filename:'bad.csv',bytes},parsed=await previewWorkerImport(pool,owner,input,options);
      assert.ok(parsed.errors.length); assert.equal(parsed.totalRows,0); await assert.rejects(confirmWorkerImport(pool,owner,input.requestId,options),/Fix CSV errors/);
    }
    const expired=randomUUID();
    await db.query(`INSERT INTO worker_imports(id,org_id,site_id,requested_by,filename,sha256,status,rows_json,errors_json,created_at,expires_at)
      VALUES($1,'a','a','owner','expired.csv',repeat('0',64),'validated','[]','[]',clock_timestamp()-interval '48 hours',clock_timestamp()-interval '24 hours')`,[expired]);
    await assert.rejects(confirmWorkerImport(pool,owner,expired,options),/expired/);
    assert.deepEqual((await db.query('SELECT status,rows_json,errors_json FROM worker_imports WHERE id=$1',[expired])).rows[0],{status:'expired',rows_json:null,errors_json:null});
    assert.equal(await expireWorkerImports(pool,options),0);
    await assert.rejects(workerImportErrorsCsv(pool,owner,expired,options),/expired/);
    assert.equal((await db.query("SELECT COUNT(*)::int n FROM audit WHERE action='workers.import_expired'")).rows[0].n,1);
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM workers')).rows[0].n,4);
  } finally {await db.close();}
});

test('PostgreSQL HTTP import/export contracts enforce scope, raw body limits and server-ready downloads',async () => {
  const f=await fixture(),{pool}=f;
  try {
    await provisionStaffCredential(pool,{staffId:'owner',orgId:'a',siteId:'a',email:'owner@example.test',password:'long-enough-password'},options);
    const pub=await publish(pool,owner,'brief',request(),options),grant=await issueWorkerGrant(pool,owner,'w1',30,options);
    await withHttp(f,async ({request}) => {
      const staff=cookieOf(await request('/auth/staff/login',null,post({email:'owner@example.test',password:'long-enough-password'})));
      const member=cookieOf(await request('/auth/worker/redeem',null,post({token:grant.token})));
      const importId=randomUUID(),path=`/people/imports/preview?requestId=${importId}&filename=crew.csv`,upload={method:'POST',headers:{'content-type':'text/csv; charset=utf-8'},body:'worker_id,language\nNew import,ar\n'};
      assert.equal((await request(path,member,upload)).status,403);
      assert.equal((await request(path+'&org_id=b',staff,upload)).status,400);
      assert.equal((await request(path,staff,{...upload,body:'x'.repeat(256*1024+1)})).status,413);
      assert.equal((await request(path,staff,upload)).status,200);
      const detail=await (await request(`/people/imports/${importId}`,staff)).json(); assert.equal(detail.validRows,1); assert.equal(detail.imported,0);
      assert.equal((await request(`/people/imports/${importId}/confirm`,staff,post({org_id:'b'}))).status,400);
      assert.equal((await request(`/people/imports/${importId}/confirm`,staff,post({}))).status,200);
      assert.equal((await request(`/people/imports/${importId}`,member)).status,403);
      const exportId=randomUUID();
      assert.equal((await request('/reports/exports',member,post({requestId:exportId,publicationId:pub.id}))).status,403);
      assert.equal((await request('/reports/exports',staff,post({requestId:exportId,publicationId:pub.id}))).status,202);
      assert.equal((await request(`/reports/exports/${exportId}/download`,staff)).status,409);
      await processOneExport(pool,options);
      const ready=await request(`/reports/exports/${exportId}/download`,staff); assert.equal(ready.status,200); assert.equal(ready.headers.get('cache-control'),'no-store');
      const csv=await ready.text(); assert.ok(csv.includes('001')); assert.ok(!csv.includes('New import'));
      assert.equal((await request(`/reports/exports/${exportId}/download`,member)).status,403);
      const list=await (await request('/reports/exports',staff)).json(); assert.equal(list[0].status,'ready');
    });
  } finally {await f.db.close();}
});

test('PostgreSQL activity uses civil dates, scoped filters, bounded formula-safe metadata and atomic export audit',async () => {
  const f=await fixture(),{db,pool}=f;
  const event=async (id,type,actor,action,object,time,org='a',site='a') => db.query('INSERT INTO audit(id,org_id,site_id,actor_type,actor_id,action,object_id,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id,org,site,type,actor,action,object,time]);
  try {
    await db.query("UPDATE sites SET timezone='Asia/Beirut' WHERE id='a'");
    await event('first','staff','owner','test.created','@bad','2026-10-03T21:30:00Z');
    await event('second','worker','w1','answer.received','attempt','2026-10-03T22:00:00Z');
    await event('later','system','pipeline','audio.generated','job','2026-10-04T22:00:00Z');
    await event('foreign','staff','other','private.action','foreign','2026-10-04T12:00:00Z','b','b');
    await event('other-site','system','pipeline','private.action','other-site','2026-10-04T12:00:00Z','a','c');
    const result=await listAuditEvents(pool,owner,{date:'2026-10-04',pageSize:1},options);
    assert.equal(result.total,2); assert.equal(result.rows[0].id,'second'); assert.equal(result.timezone,'Asia/Beirut');
    assert.equal((await listAuditEvents(pool,owner,{date:'2026-10-04',pageSize:1,page:2},options)).rows[0].id,'first');
    assert.equal((await listAuditEvents(pool,owner,{actorType:'worker'},options)).rows[0].actor,'001');
    assert.equal((await listAuditEvents(pool,owner,{search:'Owner'},options)).total,1);
    assert.equal((await listAuditEvents(pool,owner,{action:'audio.generated'},options)).total,1);
    assert.equal((await listAuditEvents(pool,owner,{search:'%'},options)).total,0);
    assert.ok(!result.actions.includes('private.action'));
    assert.equal((await getAuditEvent(pool,{...owner,principal_id:'auditor',role:'auditor'},'first',options)).action,'test.created');
    for (const eventId of ['foreign','other-site','missing']) await assert.rejects(getAuditEvent(pool,owner,eventId,options),/unavailable/);
    for (const filters of [{date:'2026-02-30'},{site_id:'b'},{pageSize:51},{page:0},{actorType:'any'}]) await assert.rejects(listAuditEvents(pool,owner,filters,options),/Invalid/);
    await assert.rejects(listAuditEvents(pool,worker,{},options),/Forbidden/);
    await db.query("UPDATE staff SET name='=HYPERLINK(\"evil\")' WHERE id='owner'");
    const csv=await exportAuditEvents(pool,owner,{action:'test.created',pageSize:1,page:100},options);
    assert.ok(csv.includes("'=HYPERLINK")); assert.ok(csv.includes("'@bad")); assert.ok(csv.includes('first'));
    assert.ok(!/answer_text|rubric|password|token_hash|foreign/.test(csv));
    assert.equal((await db.query("SELECT COUNT(*)::int n FROM audit WHERE action='audit.exported'")).rows[0].n,1);
    f.setFail('INSERT INTO audit'); await assert.rejects(exportAuditEvents(pool,owner,{},options),/Injected/); f.setFail('');
    assert.equal((await db.query("SELECT COUNT(*)::int n FROM audit WHERE action='audit.exported'")).rows[0].n,1);
    await event('huge','system','pipeline','huge','x'.repeat(2_000_000),'2026-10-04T12:00:00Z');
    await assert.rejects(exportAuditEvents(pool,owner,{action:'huge'},options),/exceeds export limit/);
    await db.query("INSERT INTO audit(id,org_id,site_id,actor_type,actor_id,action,object_id) SELECT 'bounded-'||n,'a','a','system','pipeline','bounded','job' FROM generate_series(1,5001) n");
    await assert.rejects(listAuditEvents(pool,owner,{action:'bounded'},options),/exceeds limit/);
    await assert.rejects(db.query("DELETE FROM audit WHERE id='first'"),/read-only/);
    await assert.rejects(db.query("UPDATE audit SET action='forged' WHERE id='first'"),/read-only/);
    await db.query("UPDATE staff SET active=false WHERE id='owner'");
    await assert.rejects(getAuditEvent(pool,owner,'first',options),/Forbidden/);
  } finally {await db.close();}
});

test('PostgreSQL independent help is immutable, scoped, replayed exactly and does not create an answer receipt',async () => {
  const f=await fixture(),{db,pool}=f;
  try {
    const pub=await publish(pool,owner,'brief',request(),options),assignment=await f.assignment(pub.id),input={requestId:randomUUID(),text:'Not sure about the second shelf'};
    await db.query("UPDATE assignments SET due_at=clock_timestamp()-interval '1 day' WHERE id=$1",[assignment]);
    const help=await requestHelp(pool,worker,assignment,input,options);
    assert.equal(help.duplicate,false); assert.equal((await requestHelp(pool,worker,assignment,{...input,text:` ${input.text} `},options)).duplicate,true);
    for (const table of ['attempts','submission_receipts','assessment_jobs']) assert.equal((await db.query(`SELECT COUNT(*)::int n FROM ${table}`)).rows[0].n,0);
    assert.equal((await db.query("SELECT COUNT(*)::int n FROM audit WHERE action='help.requested'")).rows[0].n,1);
    await assert.rejects(requestHelp(pool,worker,assignment,{...input,text:'changed'},options),/conflict/);
    await assert.rejects(requestHelp(pool,{...worker,principal_id:'w2'},assignment,input,options),/unavailable/);
    await assert.rejects(requestHelp(pool,worker,assignment,{...input,org_id:'b'},options),/Invalid/);
    const assignment2=await f.assignment(pub.id,'w2');
    await assert.rejects(requestHelp(pool,{...worker,principal_id:'w2'},assignment2,input,options),/conflict/);
    await assert.rejects(db.query("UPDATE help_requests SET text='rewritten' WHERE case_id=$1",[help.id]),/immutable/);
    await assert.rejects(db.query('DELETE FROM help_requests WHERE case_id=$1',[help.id]),/immutable/);
    await db.query("UPDATE publications SET state='withdrawn' WHERE id=$1",[pub.id]);
    assert.equal((await requestHelp(pool,worker,assignment,input,options)).duplicate,true);
    await assert.rejects(requestHelp(pool,worker,assignment,{...input,requestId:randomUUID()},options),/unavailable/);
    const detail=await getClarification(pool,owner,help.id,options);
    assert.equal(detail.helpRequest.text,input.text); assert.equal(detail.attempt_id,null); assert.equal(detail.language,'en');
    f.setFail('INSERT INTO audit');
    await db.query("UPDATE publications SET state='published' WHERE id=$1",[pub.id]);
    await assert.rejects(requestHelp(pool,worker,assignment,{...input,requestId:randomUUID()},options),/Injected/); f.setFail('');
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM clarifications')).rows[0].n,1);
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM help_requests')).rows[0].n,1);
    const safe=await workerHelpCases(pool,worker,assignment,options);
    assert.equal(safe[0].helpText,input.text); assert.ok(!/reason|notes|rubric|snapshot|answer_text/.test(JSON.stringify(safe)));
    await assert.rejects(workerHelpCases(pool,{...worker,principal_id:'w2'},assignment,options),/unavailable/);
  } finally {await db.close();}
});

test('PostgreSQL clarification ownership and resolution preserve original assessment and audit atomically',async () => {
  const f=await fixture(),{db,pool}=f;
  try {
    const pub=await publish(pool,owner,'brief',request(),options),assignment=await f.assignment(pub.id);
    const attempt=await submitAnswer(pool,worker,assignment,'submission-case','Finished blue',options);
    await processOneAssessment(pool,{async assess() {return {outcome:'clarification',reasons:['missing_asked_fact'],evidence:[]};}},options);
    const caseId=(await db.query('SELECT id FROM clarifications WHERE attempt_id=$1',[attempt.id])).rows[0].id;
    await db.query("UPDATE briefings SET title='Changed draft' WHERE id='brief'");
    await db.query("UPDATE workers SET language='ar' WHERE id='w1'");
    const detail=await getClarification(pool,owner,caseId,options);
    assert.equal(detail.answer_text,'Finished blue'); assert.equal(detail.outcome,'clarification'); assert.equal(detail.attempts[0].id,attempt.id);
    assert.notEqual(detail.title,'Changed draft'); assert.equal(detail.language,'en'); assert.equal(detail.snapshot.source,CANONICAL_SOURCE);
    assert.deepEqual(detail.owners.map((row) => row.id),['owner']);
    await assert.rejects(getClarification(pool,worker,caseId,options),/Forbidden/);
    await assert.rejects(getClarification(pool,{...owner,principal_id:'other',org_id:'b',site_id:'b'},caseId,options),/unavailable/);
    const auditor={...owner,principal_id:'auditor',role:'auditor'};
    assert.equal((await getClarification(pool,auditor,caseId,options)).id,caseId);
    for (const ownerId of ['other','auditor','missing']) await assert.rejects(assignClarification(pool,owner,caseId,{ownerId},options),/unavailable/);
    f.setFail('INSERT INTO audit'); await assert.rejects(assignClarification(pool,owner,caseId,{ownerId:'owner'},options),/Injected/); f.setFail('');
    assert.equal((await db.query('SELECT owner_staff_id FROM clarifications WHERE id=$1',[caseId])).rows[0].owner_staff_id,null);
    assert.equal((await assignClarification(pool,owner,caseId,{ownerId:'owner'},options)).duplicate,false);
    assert.equal((await assignClarification(pool,owner,caseId,{ownerId:'owner'},options)).duplicate,true);
    assert.equal((await listClarifications(pool,owner,{owner:'mine',status:'open'},options)).total,1);
    assert.equal((await listClarifications(pool,owner,{owner:'unassigned'},options)).total,0);
    assert.equal((await listClarifications(pool,owner,{search:'%'},options)).total,0);
    await db.query("UPDATE assignments SET due_at=clock_timestamp()-interval '1 minute' WHERE id=$1",[assignment]);
    assert.ok(Date.parse(detail.case_due_at)>Date.now());
    assert.equal((await listClarifications(pool,owner,{overdue:'true'},options)).total,0);
    for (const filters of [{site_id:'b'},{page:0},{status:'closed'},{overdue:'maybe'}]) await assert.rejects(listClarifications(pool,owner,filters,options),/Invalid/);
    await assert.rejects(resolveClarification(pool,auditor,caseId,{notes:'Read-only cannot resolve'},options),/Forbidden/);
    const resolution={notes:'Reviewed in person; original result is unchanged.'};
    f.setFail('INSERT INTO audit'); await assert.rejects(resolveClarification(pool,owner,caseId,resolution,options),/Injected/); f.setFail('');
    assert.equal((await db.query('SELECT status FROM clarifications WHERE id=$1',[caseId])).rows[0].status,'open');
    assert.equal((await resolveClarification(pool,owner,caseId,resolution,options)).duplicate,false);
    assert.equal((await resolveClarification(pool,owner,caseId,resolution,options)).duplicate,true);
    await assert.rejects(resolveClarification(pool,owner,caseId,{notes:'Changed private notes'},options),/conflict/);
    await assert.rejects(assignClarification(pool,owner,caseId,{ownerId:null},options),/conflict/);
    await assert.rejects(db.query("UPDATE clarifications SET reason='forged' WHERE id=$1",[caseId]),/immutable/);
    await assert.rejects(db.query("UPDATE clarifications SET status='open' WHERE id=$1",[caseId]),/immutable/);
    assert.equal((await db.query('SELECT outcome FROM attempts WHERE id=$1',[attempt.id])).rows[0].outcome,'clarification');
    const report=await readPublicationReport(pool,owner,{...options,publicationId:pub.id}); assert.equal(report.metrics.clarifications,1);
    const safe=await workerHelpCases(pool,worker,assignment,options); assert.equal(safe[0].status,'resolved');
    assert.ok(!JSON.stringify(safe).includes('Reviewed in person'));
    assert.equal((await db.query("SELECT COUNT(*)::int n FROM audit WHERE action='clarification.resolved'")).rows[0].n,1);
    assert.equal((await listClarifications(pool,owner,{status:'resolved',page:2,pageSize:1},options)).rows.length,0);
  } finally {await db.close();}
});

test('PostgreSQL HTTP activity and help enforce credentials, scope, filter bounds and private-note isolation',async () => {
  const f=await fixture(),{db,pool}=f;
  try {
    await provisionStaffCredential(pool,{staffId:'owner',orgId:'a',siteId:'a',email:'owner@example.test',password:'long-enough-password'},options);
    await provisionStaffCredential(pool,{staffId:'other',orgId:'b',siteId:'b',email:'other@example.test',password:'long-enough-password'},options);
    const pub=await publish(pool,owner,'brief',request(),options),assignment=await f.assignment(pub.id),grant=await issueWorkerGrant(pool,owner,'w1',30,options);
    await withHttp(f,async ({request}) => {
      assert.equal((await request('/audit')).status,401);
      const staff=cookieOf(await request('/auth/staff/login',null,post({email:'owner@example.test',password:'long-enough-password'})));
      const foreign=cookieOf(await request('/auth/staff/login',null,post({email:'other@example.test',password:'long-enough-password'})));
      const member=cookieOf(await request('/auth/worker/redeem',null,post({token:grant.token})));
      assert.equal((await request('/audit?org_id=b',staff)).status,400);
      assert.equal((await request('/clarifications?status=closed',staff)).status,400);
      for (const path of ['/audit','/audit.csv','/clarifications']) assert.equal((await request(path,member)).status,403);
      const input={requestId:randomUUID(),text:'Not sure about the second shelf'},path=`/worker/briefings/${assignment}/help`;
      const clientContext=(await (await request('/session',member)).json()).clientContext;
      for(const duplicate of [false,true]){
        const response=await request(path,member,post(input));assert.equal(response.status,duplicate?200:201);
        assert.equal(checkedWorkerReceipt(await response.json(),'help',{requestId:input.requestId,assignmentId:assignment,clientContext}).duplicate,duplicate);
      }
      assert.equal((await request(path,member,post({...input,text:'Changed'}))).status,409);
      assert.equal((await request(`/clarifications/${input.requestId}`,foreign)).status,404);
      assert.equal((await request(`/clarifications/${input.requestId}`,member)).status,403);
      const list=await (await request('/clarifications',staff)).json(); assert.equal(list.total,1);
      assert.equal((await request(`/clarifications/${input.requestId}/assign`,staff,post({ownerId:'owner'}))).status,200);
      const notes='Private supervisor resolution';
      assert.equal((await request(`/clarifications/${input.requestId}/resolve`,staff,post({notes}))).status,200);
      const safe=await (await request(path,member)).json(); assert.equal(safe[0].status,'resolved'); assert.ok(!JSON.stringify(safe).includes(notes));
      const helpHistory=await request(`${path}-history?page=1&pageSize=5`,member),helpPage=await helpHistory.json();
      assert.equal(helpHistory.status,200);assert.equal(helpHistory.headers.get('cache-control'),'no-store');assert.equal(helpPage.clientContext,clientContext);
      assert.equal(helpPage.assignment.id,assignment);assert.equal(helpPage.cases[0].status,'resolved');assert.equal(helpPage.total,1);assert.ok(!JSON.stringify(helpPage).includes(notes));
      assert.equal((await request(`${path}-history?pageSize=50`,member)).status,400);
      assert.equal((await request(`${path}-history`,staff)).status,403);
      assert.equal((await request('/worker/briefings/missing/help-history',member)).status,404);
      const events=await (await request('/audit?action=help.requested',staff)).json(); assert.equal(events.total,1);
      assert.equal((await request(`/audit/${events.rows[0].id}`,foreign)).status,404);
      assert.equal((await request(`/audit/${events.rows[0].id}`,member)).status,403);
      const csv=await request('/audit.csv?action=help.requested',staff); assert.equal(csv.status,200); assert.equal(csv.headers.get('cache-control'),'no-store');
      const body=await csv.text(); assert.ok(body.includes('help.requested')); assert.ok(!body.includes(input.text)); assert.ok(!body.includes(notes));
      await db.query("UPDATE staff SET active=false WHERE id='owner'");
      assert.equal((await request('/audit',staff)).status,401);
    });
  } finally {await db.close();}
});

test('PostgreSQL publish freezes explicit audience, validates scope/readiness/revision and replays exactly',async () => {
  const f = await fixture(); const {db,pool}=f;
  try {
    await assert.rejects(publish(pool,{...owner,role:'auditor',principal_id:'auditor'},'brief',request(),options),/Forbidden/);
    await assert.rejects(publish(pool,{...owner,org_id:'b'},'brief',request(),options),/Forbidden/);
    for (const workerIds of [['w1','wb'],['w1','w3'],['w1','missing']]) await assert.rejects(publish(pool,owner,'brief',{...request(),workerIds},options),/Recipient unavailable/);
    await assert.rejects(publish(pool,owner,'brief',{...request(),revision:2},options),/revision changed/);
    await assert.rejects(publish(pool,owner,'brief',{...request(),dueAt:'2000-01-01T00:00:00Z'},options),/future/);
    await assert.rejects(publish(pool,owner,'brief',request(),{...options,integrationMode:'live'}),/verification is unavailable/);
    await db.query("UPDATE workers SET active=false WHERE id='w2'");
    await assert.rejects(publish(pool,owner,'brief',request(),options),/Recipient unavailable/);
    await db.query("UPDATE workers SET active=true WHERE id='w2'");
    const input = request(); const first = await publish(pool,owner,'brief',input,options);
    const replay = await publish(pool,owner,'brief',{...input,workerIds:['w2','w1']},options);
    assert.equal(replay.id,first.id); assert.equal(replay.duplicate,true); assert.equal(first.assigned,2);
    await assert.rejects(publish(pool,owner,'brief',{...input,workerIds:['w1']},options),/conflict/);
    await db.query("INSERT INTO workers(id,org_id,site_id,code,language) VALUES ('new','a','a','004','en')");
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM assignments WHERE publication_id=$1',[first.id])).rows[0].n,2);
    await assert.rejects(db.query("UPDATE publications SET snapshot_json='{}' WHERE id=$1",[first.id]),/immutable/);
    await assert.rejects(db.query("UPDATE publication_requests SET request_json='{}'"),/immutable/);
    await db.query("UPDATE briefings SET state='ready',revision=2 WHERE id='brief'");
    const second = await publish(pool,owner,'brief',{...request(2),revision:2,workerIds:['w1']},options);
    assert.equal(second.version,2); assert.equal((await db.query('SELECT state FROM publications WHERE id=$1',[first.id])).rows[0].state,'superseded');
    assert.equal((await db.query('SELECT snapshot_json FROM publications WHERE id=$1',[first.id])).rows[0].snapshot_json.source,CANONICAL_SOURCE);
  } finally {await db.close();}
});

test('PostgreSQL publish and answer receipts roll back all evidence on downstream failure',async () => {
  const f=await fixture(); const {db,pool}=f;
  try {
    const input=request(); f.setFail('INSERT INTO audit');
    await assert.rejects(publish(pool,owner,'brief',input,options),/Injected/);
    for (const table of ['publications','assignments','publication_requests']) assert.equal((await db.query(`SELECT COUNT(*)::int n FROM ${table}`)).rows[0].n,0);
    assert.equal((await db.query("SELECT state,next_version FROM briefings WHERE id='brief'")).rows[0].state,'ready');
    f.setFail(''); const pub=await publish(pool,owner,'brief',input,options); const assignment=await f.assignment(pub.id);
    f.setFail('INSERT INTO assessment_jobs');
    await assert.rejects(submitAnswer(pool,worker,assignment,'submission-1',answer,options),/Injected/);
    for (const table of ['attempts','submission_receipts','assessment_jobs']) assert.equal((await db.query(`SELECT COUNT(*)::int n FROM ${table}`)).rows[0].n,0);
    f.setFail(''); assert.equal((await submitAnswer(pool,worker,assignment,'submission-1',answer,options)).assessmentStatus,'pending');
    assert.ok(f.queries.some((sql) => sql.includes('worker_id=$4 FOR UPDATE')));
  } finally {await db.close();}
});

test('PostgreSQL typed receipt is pending, deduplicated, scoped and fenced from deadline/withdrawal changes',async () => {
  const f=await fixture(); const {db,pool}=f;
  try {
    const pub=await publish(pool,owner,'brief',request(),options), assignment=await f.assignment(pub.id);
    for (const forged of [{...worker,principal_id:'w2'},{...worker,principal_id:'wb',org_id:'b',site_id:'b'},{...worker,site_id:'c'}]) await assert.rejects(submitAnswer(pool,forged,assignment,'submission-1',answer,options),/unavailable|Forbidden/);
    await assert.rejects(submitAnswer(pool,worker,assignment,'short',' ',options),/Invalid/);
    const receipt=await submitAnswer(pool,worker,assignment,'submission-1',answer,options);
    assert.equal(receipt.outcome,null); assert.equal((await submitAnswer(pool,worker,assignment,'submission-1',` ${answer} `,options)).duplicate,true);
    await assert.rejects(submitAnswer(pool,worker,assignment,'submission-1','Changed answer',options),/conflict/);
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM assessment_jobs')).rows[0].n,1);
    const report=await readPublicationReport(pool,owner,{...options,publicationId:pub.id});
    assert.equal(report.metrics.responses,1); assert.equal(report.metrics.unassessed,1); assert.equal(report.rows[0][2],'assessment_pending');
    await db.query("UPDATE publications SET state='withdrawn' WHERE id=$1",[pub.id]);
    assert.equal((await submitAnswer(pool,worker,assignment,'submission-1',answer,options)).duplicate,true);
    await assert.rejects(submitAnswer(pool,worker,assignment,'submission-2',answer,options),/unavailable/);
    await db.query("UPDATE publications SET state='published' WHERE id=$1",[pub.id]);
    await db.query("UPDATE assignments SET due_at=clock_timestamp()-interval '1 second' WHERE id=$1",[assignment]);
    await assert.rejects(submitAnswer(pool,worker,assignment,'submission-2',answer,options),/deadline/);
    await db.query("UPDATE workers SET active=false WHERE id='w1'");
    await assert.rejects(submitAnswer(pool,worker,assignment,'submission-1',answer,options),/Forbidden/);
  } finally {await db.close();}
});

test('PostgreSQL assessment uses exact frozen rubric and preserves original attempts and receipt ordering',async () => {
  const f=await fixture(); const {db,pool}=f;
  try {
    const pub=await publish(pool,owner,'brief',request(),options),assignment=await f.assignment(pub.id);
    const first=await submitAnswer(pool,worker,assignment,'submission-1',answer,options);
    await db.query("UPDATE briefings SET source='changed draft' WHERE id='brief'");
    let seen;
    assert.equal(await processOneAssessment(pool,{async assess(...input) {seen=input; return matched;}},options),true);
    assert.deepEqual(seen,[answer,syntheticPrepare(CANONICAL_SOURCE).question,['finished -> blue shelf','unfinished -> yellow shelf']]);
    assert.equal((await db.query('SELECT outcome FROM attempts WHERE id=$1',[first.id])).rows[0].outcome,'matched');
    await assert.rejects(db.query("UPDATE attempts SET outcome='clarification' WHERE id=$1",[first.id]),/immutable/);
    await assert.rejects(db.query("UPDATE attempts SET answer_text='rewritten' WHERE id=$1",[first.id]),/immutable/);
    const second=await submitAnswer(pool,worker,assignment,'submission-2','Not sure',options);
    const report=await readPublicationReport(pool,owner,{...options,publicationId:pub.id});
    assert.equal(report.metrics.matches,0); assert.equal(report.metrics.unassessed,1);
    await processOneAssessment(pool,{async assess() {return {outcome:'clarification',reasons:['missing_asked_fact'],evidence:[]};}},options);
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM clarifications WHERE attempt_id=$1',[second.id])).rows[0].n,1);
    assert.equal((await db.query('SELECT outcome FROM attempts WHERE id=$1',[first.id])).rows[0].outcome,'matched');
    const final=await readPublicationReport(pool,owner,{...options,publicationId:pub.id});
    assert.equal(final.metrics.clarifications,1); assert.equal(final.metrics.responses,1);
    assert.equal(await processOneAssessment(pool,{async assess() {throw new Error('No job');}},options),false);
  } finally {await db.close();}
});

test('PostgreSQL invalid assessment, interruption and stale leases never manufacture a match',async () => {
  const f=await fixture(); const {db,pool}=f;
  try {
    const pub=await publish(pool,owner,'brief',request(),options),assignment=await f.assignment(pub.id);
    const attempt=await submitAnswer(pool,worker,assignment,'submission-1',answer,options);
    for (let n=0;n<3;n++) {
      await processOneAssessment(pool,{async assess() {return {...matched,evidence:[{factIndex:0,quote:'invented'}]};}},options);
      await db.query("UPDATE assessment_jobs SET due_at=clock_timestamp()-interval '1 second'");
    }
    const failed=(await db.query('SELECT status,attempts,error FROM assessment_jobs')).rows[0];
    assert.equal(failed.status,'failed'); assert.equal(failed.attempts,3); assert.equal(failed.error,'Answer assessment failed');
    assert.equal((await db.query('SELECT outcome FROM attempts WHERE id=$1',[attempt.id])).rows[0].outcome,null);
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM clarifications')).rows[0].n,0);
    await submitAnswer(pool,worker,assignment,'submission-2',answer,options);
    await processOneAssessment(pool,{async assess() {
      await db.query("UPDATE assessment_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE status='processing'");
      return matched;
    }},options);
    assert.equal((await db.query("SELECT outcome FROM attempts WHERE submission_id='submission-2'")).rows[0].outcome,null);
    await processOneAssessment(pool,{async assess() {return matched;}},options);
    assert.equal((await db.query("SELECT outcome FROM attempts WHERE submission_id='submission-2'")).rows[0].outcome,'matched');
    await submitAnswer(pool,worker,assignment,'submission-3',answer,options);
    await processOneAssessment(pool,{async assess() {
      await db.query("UPDATE workers SET active=false WHERE id='w1'");
      return matched;
    }},options);
    assert.equal((await db.query("SELECT j.status,t.outcome FROM assessment_jobs j JOIN attempts t ON t.id=j.attempt_id WHERE t.submission_id='submission-3'")).rows[0].status,'blocked');
  } finally {await db.close();}
});

test('PostgreSQL private audio stores before receipt, preserves order and denies foreign/private reads',async () => {
  const f=await fixture(); const {db,pool}=f;
  try {
    const pub=await publish(pool,owner,'brief',request(),options),assignment=await f.assignment(pub.id);
    let duringSave;
    const storage=memoryStorage(async () => {
      duringSave=await readPublicationReport(pool,owner,{...options,publicationId:pub.id});
      await submitAnswer(pool,worker,assignment,'typed-during-save',answer,options);
    });
    const submission=randomUUID(),bytes=wav();
    const received=await receiveRecording(pool,worker,assignment,submission,bytes,storage,options);
    assert.equal(duringSave.metrics.responses,0); assert.equal(received.status,'received'); assert.ok(received.receivedAt);
    assert.equal((await getRecording(pool,worker,received.id,options)).aiStatus,'pending');
    assert.deepEqual(await getRecordingAudio(pool,worker,received.id,storage,options),bytes);
    for (const denied of [{...worker,principal_id:'w2'},{...owner,principal_id:'other',org_id:'b',site_id:'b'},{...owner,site_id:'c'}]) await assert.rejects(getRecordingAudio(pool,denied,received.id,storage,options),/unavailable|Forbidden/);
    const replay=await receiveRecording(pool,worker,assignment,submission,bytes,storage,options);
    assert.equal(replay.duplicate,true); assert.equal(storage.objects.size,1);
    const changed=Buffer.from(bytes); changed.writeInt16LE(1234,44);
    await assert.rejects(receiveRecording(pool,worker,assignment,submission,changed,storage,options),/conflict/);
    const report=await readPublicationReport(pool,owner,{...options,publicationId:pub.id});
    assert.equal(report.metrics.responses,1); assert.equal(report.metrics.unassessed,1); assert.equal(report.rows[0][2],'received');
    const receipts=(await db.query('SELECT kind FROM submission_receipts ORDER BY sequence')).rows;
    assert.deepEqual(receipts.map((row) => row.kind),['typed','audio']);
    await submitAnswer(pool,worker,assignment,'typed-after-audio',answer,options);
    assert.equal((await readPublicationReport(pool,owner,{...options,publicationId:pub.id})).rows[0][2],'assessment_pending');
    await db.query("UPDATE publications SET state='withdrawn' WHERE id=$1",[pub.id]);
    assert.equal((await receiveRecording(pool,worker,assignment,submission,bytes,storage,options)).duplicate,true);
    assert.deepEqual(await getRecordingAudio(pool,owner,received.id,storage,options),bytes);
    await assert.rejects(receiveRecording(pool,worker,assignment,randomUUID(),bytes,storage,options),/unavailable/);
  } finally {await db.close();}
});

test('PostgreSQL failed audio acceptance compensates privately and never returns a false receipt',async () => {
  const f=await fixture(); const {db,pool}=f;
  try {
    const pub=await publish(pool,owner,'brief',request(),options),assignment=await f.assignment(pub.id);
    const submission=randomUUID(),storage=memoryStorage(() => f.setFail('INSERT INTO audit'));
    await assert.rejects(receiveRecording(pool,worker,assignment,submission,wav(),storage,options),/not received/);
    f.setFail(''); assert.equal(storage.objects.size,0);
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM submission_receipts')).rows[0].n,0);
    assert.equal((await db.query('SELECT status FROM recordings')).rows[0].status,'failed');
    await assert.rejects(receiveRecording(pool,worker,assignment,submission,wav(),storage,options),/unavailable/);
    const interrupted=memoryStorage(async () => {await db.query("UPDATE publications SET state='withdrawn' WHERE id=$1",[pub.id]);});
    await db.query("UPDATE publications SET state='published' WHERE id=$1",[pub.id]);
    await assert.rejects(receiveRecording(pool,worker,assignment,randomUUID(),wav(),interrupted,options),/not received/);
    assert.equal(interrupted.objects.size,0);
    assert.equal((await readPublicationReport(pool,owner,{...options,publicationId:pub.id})).metrics.responses,0);
    await db.query("UPDATE publications SET state='published' WHERE id=$1",[pub.id]);
    const cleanup=memoryStorage(() => {throw new Error('Storage interrupted');}); cleanup.setFailRemove(true);
    await assert.rejects(receiveRecording(pool,worker,assignment,randomUUID(),wav(),cleanup,options),/not received/);
    assert.equal(cleanup.objects.size,1);
    await assert.rejects(getRecording(pool,owner,[...cleanup.objects.keys()][0],options),/unavailable/);
    cleanup.setFailRemove(false); assert.equal(await expireStagedRecording(pool,cleanup,options),true);
    assert.equal(cleanup.objects.size,0); assert.equal(await expireStagedRecording(pool,cleanup,options),false);
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM submission_receipts')).rows[0].n,0);
  } finally {await db.close();}
});

test('PostgreSQL lost receipt commit acknowledgement preserves accepted audio, not compensation',async () => {
  const f=await fixture(); const {db,pool}=f;
  try {
    const pub=await publish(pool,owner,'brief',request(),options),assignment=await f.assignment(pub.id);
    const storage=memoryStorage(() => f.loseNextCommit());
    const received=await receiveRecording(pool,worker,assignment,randomUUID(),wav(),storage,options);
    assert.equal(received.duplicate,true); assert.equal(received.status,'received'); assert.equal(storage.objects.size,1);
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM submission_receipts')).rows[0].n,1);
    assert.equal((await db.query("SELECT COUNT(*)::int n FROM audit WHERE action='answer.received'")).rows[0].n,1);
    assert.deepEqual(await getRecordingAudio(pool,worker,received.id,storage,options),wav());
  } finally {await db.close();}
});

test('PostgreSQL voice worker checks frozen evidence once and older audio cannot replace a newer typed answer',async () => {
  const f=await fixture(); const {db,pool}=f;
  try {
    const pub=await publish(pool,owner,'brief',request(),options),assignment=await f.assignment(pub.id),storage=memoryStorage();
    const received=await receiveRecording(pool,worker,assignment,randomUUID(),wav(),storage,options);
    let transcribes=0,seen;
    const adapter={async transcribe(bytes,mime) {transcribes++; assert.deepEqual(bytes,wav()); assert.equal(mime,'audio/wav'); return {text:answer};},
      async assess(...input) {seen=input; return matched;}};
    assert.equal(await processOneRecording(pool,adapter,storage,options),true);
    assert.equal((await getRecording(pool,worker,received.id,options)).status,'transcribed');
    assert.equal(transcribes,1); assert.equal(seen[1],syntheticPrepare(CANONICAL_SOURCE).question);
    assert.equal((await readPublicationReport(pool,owner,{...options,publicationId:pub.id})).metrics.matches,1);
    assert.equal(await processOneRecording(pool,adapter,storage,options),false);
    const second=await receiveRecording(pool,worker,assignment,randomUUID(),wav(),storage,options);
    await processOneRecording(pool,{...adapter,async assess() {
      await submitAnswer(pool,worker,assignment,'typed-newer-than-audio','Not sure',options);
      return matched;
    }},storage,options);
    assert.equal((await getRecording(pool,worker,second.id,options)).status,'transcribed');
    const report=await readPublicationReport(pool,owner,{...options,publicationId:pub.id});
    assert.equal(report.metrics.matches,0); assert.equal(report.metrics.unassessed,1); assert.equal(report.metrics.responses,1);
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM attempts')).rows[0].n,3);
  } finally {await db.close();}
});

test('PostgreSQL recording worker retries without leaking provider errors and stale results cannot commit',async () => {
  const f=await fixture(); const {db,pool}=f;
  try {
    const pub=await publish(pool,owner,'brief',request(),options),assignment=await f.assignment(pub.id),storage=memoryStorage();
    const first=await receiveRecording(pool,worker,assignment,randomUUID(),wav(),storage,options);
    let transcribes=0;
    const adapter={async transcribe() {transcribes++; return {text:answer};},async assess() {throw new Error('Secret provider URL or API key');}};
    for (let n=0;n<3;n++) {
      await processOneRecording(pool,adapter,storage,options);
      await db.query('UPDATE recordings SET retry_at=clock_timestamp() WHERE id=$1',[first.id]);
    }
    assert.equal(transcribes,1); assert.equal((await getRecording(pool,worker,first.id,options)).status,'failed');
    assert.equal((await db.query('SELECT error FROM recordings WHERE id=$1',[first.id])).rows[0].error,'Recording AI processing failed');
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM attempts')).rows[0].n,0);
    const stale=await receiveRecording(pool,worker,assignment,randomUUID(),wav(),storage,options);
    const valid={...adapter,async assess() {return matched;}};
    await processOneRecording(pool,{...valid,async transcribe() {
      await db.query("UPDATE recordings SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[stale.id]);
      return {text:'obsolete'};
    }},storage,options);
    assert.equal((await db.query('SELECT transcript FROM recordings WHERE id=$1',[stale.id])).rows[0].transcript,null);
    await processOneRecording(pool,valid,storage,options);
    assert.equal((await getRecording(pool,worker,stale.id,options)).status,'transcribed');
    const late=await receiveRecording(pool,worker,assignment,randomUUID(),wav(),storage,options);
    await processOneRecording(pool,{...valid,async assess() {
      await db.query("UPDATE recordings SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[late.id]);
      return matched;
    }},storage,options);
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM attempts')).rows[0].n,1);
    await processOneRecording(pool,valid,storage,options);
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM attempts')).rows[0].n,2);
  } finally {await db.close();}
});

test('PostgreSQL recording dispatch fences paused claims, storage races and allowlist rejection even with a cached transcript',async()=>{
  const f=await fixture(),{db,pool}=f;
  try {
    const pub=await publish(pool,owner,'brief',request(),options),assignment=await f.assignment(pub.id),storage=memoryStorage();
    const received=await receiveRecording(pool,worker,assignment,randomUUID(),wav(),storage,options);let transcribes=0,assessments=0;
    const adapter={transcribe:async()=>{transcribes++;return {text:answer};},assess:async()=>{assessments++;return matched;}};
    await db.exec("INSERT INTO system_controls(id,revision,jobs_paused,provider_paused) VALUES('global',1,false,true)");
    assert.equal(await processOneRecording(pool,adapter,storage,options),false);
    assert.equal((await db.query('SELECT attempts FROM recordings WHERE id=$1',[received.id])).rows[0].attempts,0);
    await db.exec('UPDATE system_controls SET provider_paused=false,jobs_paused=true');
    assert.equal(await processOneRecording(pool,adapter,storage,options),false);
    await db.exec("UPDATE system_controls SET jobs_paused=false;INSERT INTO tenant_controls(org_id,revision,state,reason) VALUES('a',1,'suspended','pilot_review')");
    assert.equal(await processOneRecording(pool,adapter,storage,options),false);
    assert.equal((await db.query('SELECT attempts FROM recordings WHERE id=$1',[received.id])).rows[0].attempts,0);
    await db.exec("UPDATE tenant_controls SET state='active'");
    const read=storage.read;storage.read=async row=>{const bytes=await read(row);await db.exec('UPDATE system_controls SET provider_paused=true');return bytes;};
    await processOneRecording(pool,adapter,storage,options);assert.equal(transcribes,0);assert.equal(assessments,0);
    storage.read=read;await db.exec("UPDATE system_controls SET provider_paused=false;UPDATE recordings SET lease_until=clock_timestamp()-interval '1 second'");
    await processOneRecording(pool,adapter,storage,options);assert.equal(transcribes,1);assert.equal(assessments,1);
    const denied=await receiveRecording(pool,worker,assignment,randomUUID(),wav(),storage,options);
    await db.query("UPDATE recordings SET transcript='Potentially private cached text' WHERE id=$1",[denied.id]);
    await processOneRecording(pool,{...adapter,permitsRecording:()=>false},storage,options);
    assert.equal(transcribes,1);assert.equal(assessments,1);
    assert.equal((await db.query('SELECT status FROM recordings WHERE id=$1',[denied.id])).rows[0].status,'blocked');
    const purged=await receiveRecording(pool,worker,assignment,randomUUID(),wav(),storage,options);
    storage.read=async row=>{const bytes=await read(row);await db.query("INSERT INTO recording_purges(recording_id,org_id,site_id,status,created_at) VALUES($1,'a','a','queued',clock_timestamp())",[row.id]);return bytes;};
    await processOneRecording(pool,adapter,storage,options);assert.equal(transcribes,1);assert.equal(assessments,1);
    await db.query("UPDATE recordings SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[purged.id]);
    assert.equal(await processOneRecording(pool,adapter,storage,options),false);
  }finally{await db.close();}
});

test('PostgreSQL recording completion rejects worker revocation and provider pause during in-flight results',async()=>{
  const f=await fixture(),{db,pool}=f;
  try {
    const pub=await publish(pool,owner,'brief',request(),options),assignment=await f.assignment(pub.id),storage=memoryStorage();
    const first=await receiveRecording(pool,worker,assignment,randomUUID(),wav(),storage,options);let assessments=0;
    const adapter={async transcribe(){await db.exec("UPDATE workers SET active=false WHERE id='w1'");return {text:answer};},async assess(){assessments++;return matched;}};
    await processOneRecording(pool,adapter,storage,options);assert.equal(assessments,0);
    assert.equal((await db.query('SELECT transcript FROM recordings WHERE id=$1',[first.id])).rows[0].transcript,null);
    await db.query("UPDATE recordings SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[first.id]);
    await processOneRecording(pool,adapter,storage,options);
    assert.equal((await db.query('SELECT status FROM recordings WHERE id=$1',[first.id])).rows[0].status,'blocked');
    await db.exec("UPDATE workers SET active=true WHERE id='w1'");
    const second=await receiveRecording(pool,worker,assignment,randomUUID(),wav(),storage,options);
    await processOneRecording(pool,{transcribe:async()=>({text:answer}),async assess(){
      await db.exec("INSERT INTO system_controls(id,revision,jobs_paused,provider_paused) VALUES('global',1,false,true)");return matched;
    }},storage,options);
    assert.equal((await db.query('SELECT count(*)::int n FROM attempts')).rows[0].n,0);
    assert.notEqual((await db.query('SELECT status FROM recordings WHERE id=$1',[second.id])).rows[0].status,'transcribed');
  }finally{await db.close();}
});

test('PostgreSQL draft edits invalidate readiness, queue once and fence obsolete preparation',async () => {
  const f=await fixture(); const {db,pool}=f;
  try {
    const pub=await publish(pool,owner,'brief',request(),options);
    const input={requestId:randomUUID(),title:'New shelf draft',source:CANONICAL_SOURCE};
    const draft=await createDraft(pool,owner,input,options);
    assert.equal((await createDraft(pool,owner,input,options)).duplicate,true);
    await assert.rejects(createDraft(pool,owner,{...input,title:'Different title'},options),/conflict/);
    await assert.rejects(queuePreparation(pool,{...owner,principal_id:'auditor',role:'auditor'},draft.id,1,options),/Forbidden/);
    await assert.rejects(queuePreparation(pool,owner,draft.id,2,options),/revision changed/);
    const queued=await queuePreparation(pool,owner,draft.id,1,options);
    assert.equal((await queuePreparation(pool,owner,draft.id,1,options)).id,queued.id);
    await processOnePreparation(pool,{...options,async prepare(source) {
      await editDraft(pool,owner,draft.id,{title:'Edited title',source,revision:1},options);
      return syntheticPrepare(source);
    }});
    assert.equal((await getBriefing(pool,owner,draft.id,options)).state,'draft');
    assert.equal((await getBriefing(pool,owner,draft.id,options)).prepared,null);
    assert.equal((await db.query('SELECT status FROM jobs WHERE id=$1',[queued.id])).rows[0].status,'failed');
    await queuePreparation(pool,owner,draft.id,2,options);
    await processOnePreparation(pool,options);
    const ready=await getBriefing(pool,owner,draft.id,options);
    assert.equal(ready.state,'ready'); assert.equal(ready.prepared.source,CANONICAL_SOURCE);
    await assert.rejects(editDraft(pool,owner,draft.id,{title:'Stale edit',source:CANONICAL_SOURCE,revision:1},options),/revision changed/);
    await editDraft(pool,owner,draft.id,{title:'Changed source',source:'A different unsupported source',revision:2},options);
    assert.equal((await getBriefing(pool,owner,draft.id,options)).prepared,null);
    await queuePreparation(pool,owner,draft.id,3,options); await processOnePreparation(pool,options);
    assert.equal((await getBriefing(pool,owner,draft.id,options)).state,'failed');
    assert.equal((await db.query('SELECT snapshot_json FROM publications WHERE id=$1',[pub.id])).rows[0].snapshot_json.source,CANONICAL_SOURCE);
    assert.ok((await listBriefings(pool,owner,{},options)).items.some((row) => row.id===draft.id));
    await assert.rejects(getBriefing(pool,worker,draft.id,options),/Forbidden/);
  } finally {await db.close();}
});

test('PostgreSQL preparation stale leases and audit failure cannot save readiness, worker DTOs omit private content',async () => {
  const f=await fixture(); const {db,pool}=f;
  try {
    const pub=await publish(pool,owner,'brief',request(),options),assignment=await f.assignment(pub.id);
    const inbox=await workerBriefings(pool,worker,options),detail=await workerBriefing(pool,worker,assignment,options);
    assert.equal(inbox.items.length,1); assert.equal(detail.content.question,syntheticPrepare(CANONICAL_SOURCE).question);
    assert.equal(detail.publicationId,pub.id);assert.equal(detail.version,1);
    for (const hidden of ['rubric','askedFacts','snapshot','reasons','notes','lease_token','source','org_id']) assert.ok(!Object.hasOwn(detail,hidden),hidden);
    assert.equal(detail.outcome,null); assert.equal(detail.assessmentStatus,null);
    await submitAnswer(pool,worker,assignment,'typed-pending-read',answer,options);
    assert.equal((await workerBriefing(pool,worker,assignment,options)).assessmentStatus,'pending');
    for (const denied of [{...worker,principal_id:'w2'},{...worker,principal_id:'wb',org_id:'b',site_id:'b'}]) await assert.rejects(workerBriefing(pool,denied,assignment,options),/unavailable/);
    assert.equal((await workerBriefings(pool,{...worker,principal_id:'wb',org_id:'b',site_id:'b'},options)).total,0);
    await assert.rejects(sessionContext(pool,{...worker,principal_type:'unknown'},options),/Forbidden/);
    const context=await sessionContext(pool,{...worker,name:'001'},options);assert.equal(context.organization,'A');assert.equal(context.timezone,'UTC');
    const draft=await createDraft(pool,owner,{requestId:randomUUID(),title:'Lease check',source:CANONICAL_SOURCE},options);
    const queued=await queuePreparation(pool,owner,draft.id,1,options);
    await processOnePreparation(pool,{...options,async prepare(source) {
      await db.query("UPDATE jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[queued.id]);
      return syntheticPrepare(source);
    }});
    assert.equal((await getBriefing(pool,owner,draft.id,options)).prepared,null);
    f.setFail('INSERT INTO audit'); await processOnePreparation(pool,options); f.setFail('');
    const failed=await getBriefing(pool,owner,draft.id,options);
    assert.equal(failed.state,'failed'); assert.equal(failed.prepared,null);
    await queuePreparation(pool,owner,draft.id,1,options); await processOnePreparation(pool,options);
    assert.equal((await getBriefing(pool,owner,draft.id,options)).state,'ready');
    await assert.rejects(processOnePreparation(pool,{...options,integrationMode:'live'}),/unavailable/);
    assert.equal(await processOnePreparation(pool,options),false);
  } finally {await db.close();}
});

test('PostgreSQL HTTP rehearsal denies production/demo/public schema and exercises credential publication/submission',async () => {
  const f=await fixture();
  try {
    assert.throws(() => createPostgresRehearsalServer(f.pool,{...credentialOptions,tier:'production'}),/Production startup blocked/);
    for (const changed of [{dataClass:'real'},{accessMode:'demo'},{schema:'public'}]) assert.throws(() => createPostgresRehearsalServer(f.pool,{...credentialOptions,...changed}),/isolated synthetic/);
    const password='Synthetic HTTP credential password';
    await provisionStaffCredential(f.pool,{staffId:'owner',orgId:'a',siteId:'a',email:'owner@example.test',password},options);
    await withHttp(f,async ({request}) => {
      assert.equal((await request('/health')).status,200);
      assert.equal((await (await request('/session')).json()).authenticated,false);
      assert.equal((await request('/briefings')).status,401);
      assert.equal((await request('/demo/session',null,post({principal:'owner'}))).status,404);
      assert.equal((await request('/auth/staff/login',null,{...post({email:'owner@example.test',password}),headers:{origin:'https://evil.test'}})).status,403);
      const response=await request('/auth/staff/login',null,post({email:'owner@example.test',password})); assert.equal(response.status,200);
      assert.match(response.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/); const staff=cookieOf(response);
      assert.equal((await request('/briefings',staff)).status,200);
      const publicationInput=makePublicationRequest();
      const publicationResponse=await request('/briefings/brief/publish',staff,post(publicationInput)); assert.equal(publicationResponse.status,201);
      const publication=await publicationResponse.json();
      assert.equal((await request('/briefings/brief/publish',staff,post(publicationInput))).status,200);
      const issued=await request('/worker-grants',staff,post({workerId:'w1'})); assert.equal(issued.status,201);
      const grant=await issued.json(),redeemed=await request('/auth/worker/redeem',null,post({token:grant.token})); assert.equal(redeemed.status,200);
      const workerCookie=cookieOf(redeemed);
      assert.equal((await request('/auth/worker/redeem',null,post({token:grant.token}))).status,401);
      assert.equal((await request('/briefings',workerCookie)).status,403);
      assert.equal((await request('/reports',workerCookie)).status,403);
      const inbox=await (await request('/worker/briefings',workerCookie)).json(); assert.equal(inbox.items.length,1);
      const detail=await (await request(`/worker/briefings/${inbox.items[0].id}`,workerCookie)).json();
      assert.ok(!JSON.stringify(detail).includes('askedFacts')); assert.equal(detail.outcome,null);
      const submission={submissionId:randomUUID(),text:answer};
      const context=(await (await request('/session',workerCookie)).json()).clientContext;
      const staffContext=(await (await request('/session',staff)).json()).clientContext;
      const answerPath=`/worker/briefings/${inbox.items[0].id}/answers`;
      for(const value of ['',staffContext]) {
        const rejected=await request(answerPath,workerCookie,{...post(submission),headers:{'x-client-session-context':value}});
        assert.equal(rejected.status,409);assert.deepEqual(await rejected.json(),{error:'Session context changed'});
      }
      assert.equal((await f.db.query('SELECT count(*)::int AS n FROM attempts')).rows[0].n,0);
      assert.equal((await request('/logout',staff,{...post({}),headers:{'x-client-session-context':context}})).status,409);
      assert.equal((await request('/briefings',staff)).status,200);
      const first=await request(`/worker/briefings/${inbox.items[0].id}/answers`,workerCookie,post(submission)); assert.equal(first.status,201);
      const expected={requestId:submission.submissionId,assignmentId:inbox.items[0].id,clientContext:context};
      const firstReceipt=checkedWorkerReceipt(await first.json(),'answer',expected);assert.equal(firstReceipt.assessmentStatus,'pending');
      const repeated=await request(`/worker/briefings/${inbox.items[0].id}/answers`,workerCookie,post(submission));assert.equal(repeated.status,200);
      assert.equal(checkedWorkerReceipt(await repeated.json(),'answer',expected).id,firstReceipt.id);
      assert.equal((await request(`/worker/briefings/${inbox.items[0].id}/answers`,workerCookie,post({...submission,text:'changed'}))).status,409);
      await processOneAssessment(f.pool,{async assess() {return matched;}},options);
      const complete=await request(answerPath,workerCookie,post(submission));
      assert.equal(checkedWorkerReceipt(await complete.json(),'answer',expected).outcome,'matched');
      const report=await (await request(`/reports?publicationId=${publication.id}`,staff)).json(); assert.equal(report.metrics.matches,1);
      const revoked=await request(`/worker-grants/${grant.id}/revoke`,staff,post({})); assert.equal(revoked.status,200);
      assert.equal((await request('/worker/briefings',workerCookie)).status,401);
      assert.equal((await request('/logout',staff,post({}))).status,200);
      assert.equal((await request('/briefings',staff)).status,401);
    });
  } finally {await f.db.close();}
});

test('PostgreSQL HTTP rehearsal bounds JSON/audio, redacts internal failures and authenticates private playback',async () => {
  const f=await fixture();
  try {
    const password='Synthetic private HTTP password';
    await provisionStaffCredential(f.pool,{staffId:'owner',orgId:'a',siteId:'a',email:'owner@example.test',password},options);
    await withHttp(f,async ({request}) => {
      const staff=cookieOf(await request('/auth/staff/login',null,post({email:'owner@example.test',password})));
      assert.equal((await request('/briefings',staff,{method:'POST',body:'['})).status,400);
      assert.equal((await request('/briefings',staff,post([]))).status,400);
      assert.equal((await request('/briefings',staff,post({source:'a'.repeat(17000)}))).status,413);
      const draft={requestId:randomUUID(),title:'HTTP source',source:CANONICAL_SOURCE};
      const created=await request('/briefings',staff,post(draft)); assert.equal(created.status,201);
      const id=(await created.json()).id;
      assert.equal((await request(`/briefings/${id}/process`,staff,post({revision:1}))).status,202);
      await processOnePreparation(f.pool,options);
      assert.equal((await (await request(`/briefings/${id}`,staff)).json()).state,'ready');
      const published=await (await request(`/briefings/${id}/publish`,staff,post(makePublicationRequest()))).json();
      const grant=await (await request('/worker-grants',staff,post({workerId:'w1'}))).json();
      const accessPath='/people/workers/w1/access';
      const accessResponse=await request(accessPath,staff);assert.equal(accessResponse.status,200);assert.match(accessResponse.headers.get('cache-control'),/no-store/);
      const access=await accessResponse.json();assert.equal(access.total,1);assert.equal(access.items[0].status,'available');assert.ok(!JSON.stringify(access).includes(grant.token));assert.ok(!JSON.stringify(access).includes('token_hash'));
      assert.equal((await request(`${accessPath}?org_id=b`,staff)).status,400);
      assert.equal((await request('/people/workers/wb/access',staff)).status,404);
      assert.equal((await request('/worker-grants',staff,post({workerId:'w1',expiresInMinutes:null}))).status,400);
      const workerCookie=cookieOf(await request('/auth/worker/redeem',null,post({token:grant.token})));
      assert.equal((await request(accessPath,workerCookie)).status,403);
      assert.equal((await (await request(accessPath,staff)).json()).items[0].status,'redeemed');
      assert.equal((await request(`/worker-grants/${grant.id}/revoke`,staff,post({workerId:'w1'}))).status,400);
      const assignment=await f.assignment(published.id),submissionId=randomUUID();
      const upload=await request(`/worker/briefings/${assignment}/audio`,workerCookie,{method:'POST',headers:{'content-type':'audio/wav','x-submission-id':submissionId},body:wav()});
      const clientContext=(await (await request('/session',workerCookie)).json()).clientContext;
      const expected={requestId:submissionId,assignmentId:assignment,clientContext};
      assert.equal(upload.status,201); const receipt=checkedWorkerReceipt(await upload.json(),'audio',expected);
      const duplicate=await request(`/worker/briefings/${assignment}/audio`,workerCookie,{method:'POST',headers:{'content-type':'audio/wav','x-submission-id':submissionId},body:wav()});
      assert.equal(duplicate.status,200);assert.equal(checkedWorkerReceipt(await duplicate.json(),'audio',expected).id,receipt.id);
      assert.equal((await request(`/recordings/${receipt.id}/audio`)).status,401);
      const audio=await request(`/recordings/${receipt.id}/audio`,workerCookie); assert.equal(audio.status,200);
      assert.equal(audio.headers.get('cache-control'),'no-store'); assert.deepEqual(Buffer.from(await audio.arrayBuffer()),wav());
      assert.equal((await request(`/worker/briefings/${assignment}/audio`,workerCookie,{method:'POST',headers:{'content-type':'audio/wav','x-submission-id':randomUUID()},body:Buffer.from('corrupt')})).status,400);
      f.setFail('SELECT b.id');
      const error=await request('/briefings',staff); assert.equal(error.status,503); assert.ok(!JSON.stringify(await error.json()).includes('Injected')); f.setFail('');
    });
  } finally {await f.db.close();}
});

test('PostgreSQL directory validates scoped pagination, crews and edits without changing frozen assignment language',async () => {
  const f=await fixture(); const {db,pool}=f;
  try {
    const page=await listWorkers(pool,owner,{page:2,pageSize:1},options); assert.equal(page.total,2); assert.equal(page.items[0].code,'002');
    assert.deepEqual((await listWorkers(pool,owner,{page:100,pageSize:1},options)).items,[]);
    assert.equal((await listWorkers(pool,owner,{page:100,pageSize:1},options)).total,2);
    assert.equal((await listWorkers(pool,owner,{search:'%'},options)).total,0);
    assert.equal((await listWorkers(pool,owner,{language:'ur'},options)).total,1);
    for (const filters of [{pageSize:501},{org_id:'b'},{language:'xx'},{page:-1}]) await assert.rejects(listWorkers(pool,owner,filters,options),/Invalid/);
    await assert.rejects(listWorkers(pool,worker,{},options),/Forbidden/);
    const newcomer=await createWorker(pool,owner,{code:'New 001',language:'ar'},options);
    await assert.rejects(createWorker(pool,owner,{code:'New 001',language:'ar'},options),/Worker ID already in use/);
    await assert.rejects(createWorker(pool,owner,{code:'Injected',language:'en',site_id:'c'},options),/Invalid/);
    await assert.rejects(updateWorker(pool,{...owner,principal_id:'other',org_id:'b',site_id:'b'},newcomer.id,{language:'ur'},options),/unavailable/);
    const crew=await createCrew(pool,owner,{name:'Morning'},options);
    await assert.rejects(createCrew(pool,owner,{name:'Morning'},options),/already exists/);
    await db.query("INSERT INTO crews(id,org_id,site_id,name) VALUES ('foreign-crew','a','c','Other site')");
    await assert.rejects(moveWorkerToCrew(pool,owner,newcomer.id,'foreign-crew',options),/unavailable/);
    await moveWorkerToCrew(pool,owner,newcomer.id,crew.id,options);
    assert.equal((await listCrews(pool,owner,{},options)).items[0].member_count,1);
    const pub=await publish(pool,owner,'brief',request(),options),assignment=await f.assignment(pub.id);
    await updateWorker(pool,owner,'w1',{language:'ar'},options);
    assert.equal((await workerBriefing(pool,worker,assignment,options)).language,'en');
    assert.equal((await readPublicationReport(pool,owner,{...options,publicationId:pub.id})).languages[0].language,'en');
    await assert.rejects(db.query("UPDATE assignments SET language='ar' WHERE id=$1",[assignment]),/immutable/);
    assert.equal((await moveWorkerToCrew(pool,owner,newcomer.id,null,options)).crew_id,null);
    assert.equal((await listCrews(pool,owner,{},options)).items[0].member_count,0);
  } finally {await db.close();}
});

test('PostgreSQL disable atomically revokes access, preserves evidence and rolls back after audit failure',async () => {
  const f=await fixture(); const {db,pool}=f;
  try {
    const pub=await publish(pool,owner,'brief',request(),options),assignment=await f.assignment(pub.id);
    await submitAnswer(pool,worker,assignment,'disable-evidence',answer,options);
    const grant=await issueWorkerGrant(pool,owner,'w1',240,options),session=await redeemWorkerGrant(pool,grant.token,options);
    const req={headers:{cookie:`understood_session=${session.token}`}};
    f.setFail('INSERT INTO audit'); await assert.rejects(disableWorker(pool,owner,'w1',options),/Injected/); f.setFail('');
    assert.equal((await requireSession(pool,req,options)).principal_id,'w1');
    assert.equal((await disableWorker(pool,owner,'w1',options)).active,false);
    await assert.rejects(requireSession(pool,req,options),/Sign in required/);
    await disableWorker(pool,owner,'w1',options);
    assert.equal((await db.query("SELECT COUNT(*)::int n FROM audit WHERE action='worker.disabled'")).rows[0].n,1);
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM attempts')).rows[0].n,1);
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM assignments WHERE publication_id=$1',[pub.id])).rows[0].n,2);
    assert.equal((await listWorkers(pool,owner,{status:'inactive'},options)).total,1);
    await assert.rejects(disableWorker(pool,{...owner,principal_id:'auditor',role:'auditor'},'w2',options),/Forbidden/);
  } finally {await db.close();}
});

test('PostgreSQL reactivation preserves evidence and old access revocation with durable replay, lost commit and rollback',async () => {
  const f=await fixture(),{db,pool}=f;
  try {
    const crew=await createCrew(pool,owner,{name:'Retained crew'},options);await moveWorkerToCrew(pool,owner,'w1',crew.id,options);
    const pub=await publish(pool,owner,'brief',request(),options),assignment=await f.assignment(pub.id);
    await submitAnswer(pool,worker,assignment,randomUUID(),answer,options);
    const grant=await issueWorkerGrant(pool,owner,'w1',240,options),session=await redeemWorkerGrant(pool,grant.token,options);
    await disableWorker(pool,owner,'w1',options);await archiveCrew(pool,owner,crew.id,{expectedName:crew.name,confirmed:true},options);
    const tables=['publications','assignments','attempts','submission_receipts','crew_memberships','sessions','worker_grants'];
    const evidence=async () => {const result=[];for(const table of tables) result.push(JSON.stringify((await db.query(`SELECT * FROM ${table} ORDER BY 1`)).rows));return result;};
    const before=await evidence(),restore={requestId:randomUUID(),expectedName:crew.name,confirmed:true},enable={requestId:randomUUID(),expectedCode:'001',confirmed:true};
    for(const bad of [{...restore,confirmed:false},{...restore,confirmed:'true'},{...restore,requestId:'bad'},{...restore,expectedName:null},{...restore,site_id:'c'}]) await assert.rejects(restoreCrew(pool,owner,crew.id,bad,options),/Invalid/);
    for(const bad of [{...enable,confirmed:false},{...enable,requestId:null},{...enable,expectedCode:null},{...enable,active:true}]) await assert.rejects(reenableWorker(pool,owner,'w1',bad,options),/Invalid/);
    const other={...owner,principal_id:'other',org_id:'b',site_id:'b'};
    await assert.rejects(restoreCrew(pool,other,crew.id,restore,options),/unavailable/);await assert.rejects(reenableWorker(pool,other,'w1',enable,options),/unavailable/);
    for(const badSession of [{...owner,principal_id:'auditor',role:'auditor'},{...owner,principal_id:'missing'},worker,{...owner,role:'supervisor'}]) {
      await assert.rejects(restoreCrew(pool,badSession,crew.id,restore,options),/Forbidden/);
      await assert.rejects(reenableWorker(pool,badSession,'w1',enable,options),/Forbidden/);
    }
    await assert.rejects(restoreCrew(pool,owner,crew.id,{...restore,expectedName:'Old name'},options),/name changed/);
    await assert.rejects(reenableWorker(pool,owner,'w1',{...enable,expectedCode:'Old code'},options),/code changed/);
    f.setFail('INSERT INTO audit');await assert.rejects(restoreCrew(pool,owner,crew.id,restore,options),/Injected/);await assert.rejects(reenableWorker(pool,owner,'w1',enable,options),/Injected/);f.setFail('');
    f.setFail('INSERT INTO directory_reactivations');await assert.rejects(restoreCrew(pool,owner,crew.id,restore,options),/Injected/);await assert.rejects(reenableWorker(pool,owner,'w1',enable,options),/Injected/);f.setFail('');
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM directory_reactivations')).rows[0].n,0);
    assert.equal((await db.query("SELECT COUNT(*)::int n FROM audit WHERE action IN ('crew.restored','worker.reenabled')")).rows[0].n,0);
    assert.equal((await listCrews(pool,owner,{status:'inactive'},options)).total,1);assert.equal((await listWorkers(pool,owner,{status:'inactive'},options)).total,1);
    f.loseNextCommit();await assert.rejects(restoreCrew(pool,owner,crew.id,restore,options),/acknowledgement lost/);
    assert.equal((await restoreCrew(pool,owner,crew.id,restore,options)).duplicate,true);
    f.loseNextCommit();await assert.rejects(reenableWorker(pool,owner,'w1',enable,options),/acknowledgement lost/);
    assert.equal((await reenableWorker(pool,owner,'w1',enable,options)).duplicate,true);
    assert.equal((await db.query("SELECT COUNT(*)::int n FROM audit WHERE action IN ('crew.restored','worker.reenabled')")).rows[0].n,2);
    assert.deepEqual(await evidence(),before);
    await assert.rejects(requireSession(pool,{headers:{cookie:`understood_session=${session.token}`}},options),/Sign in required/);
    await assert.rejects(restoreCrew(pool,owner,crew.id,{...restore,expectedName:'Other name'},options),/request conflict/);
    await assert.rejects(reenableWorker(pool,owner,'w1',{...enable,requestId:restore.requestId},options),/request conflict/);
    await assert.rejects(db.query("UPDATE directory_reactivations SET expected_label='Other'"),/immutable/);await assert.rejects(db.query('DELETE FROM directory_reactivations'),/immutable/);
    await disableWorker(pool,owner,'w1',options);await archiveCrew(pool,owner,crew.id,{expectedName:crew.name,confirmed:true},options);
    assert.equal((await reenableWorker(pool,owner,'w1',enable,options)).active,false);assert.equal((await restoreCrew(pool,owner,crew.id,restore,options)).active,false);
    assert.equal((await db.query("SELECT COUNT(*)::int n FROM audit WHERE action IN ('crew.restored','worker.reenabled')")).rows[0].n,2);
    await db.query("UPDATE staff SET active=false WHERE id='owner'");
    await assert.rejects(restoreCrew(pool,owner,crew.id,restore,options),/Forbidden/);await assert.rejects(reenableWorker(pool,owner,'w1',enable,options),/Forbidden/);
  } finally {await db.close();}
});

test('PostgreSQL crew rename and archive serialize membership admission and preserve evidence with replay and rollback',async () => {
  const f=await fixture(),{db,pool}=f;
  try {
    const crew=await createCrew(pool,owner,{name:'Morning 014'},options),other=await createCrew(pool,owner,{name:'Evening'},options);
    await moveWorkerToCrew(pool,owner,'w1',crew.id,options);
    const pub=await publish(pool,owner,'brief',request(),options),assignment=await f.assignment(pub.id);
    await submitAnswer(pool,worker,assignment,'crew-evidence',answer,options);
    const grant=await issueWorkerGrant(pool,owner,'w1',240,options),session=await redeemWorkerGrant(pool,grant.token,options);
    const req={headers:{cookie:`understood_session=${session.token}`}};
    const preserved=async () => {
      const result=[];
      for(const table of ['workers','crew_memberships','assignments','attempts','submission_receipts','sessions','worker_grants','publications']) result.push(JSON.stringify((await db.query(`SELECT * FROM ${table} ORDER BY 1`)).rows));
      return result;
    };
    const before=await preserved(),rename={name:'فريق الصباح 014',expectedName:crew.name};
    await assert.rejects(renameCrew(pool,{...owner,principal_id:'other',org_id:'b',site_id:'b'},crew.id,rename,options),/unavailable/);
    await assert.rejects(renameCrew(pool,{...owner,site_id:'c'},crew.id,rename,options),/Forbidden/);
    await assert.rejects(archiveCrew(pool,{...owner,principal_id:'auditor',role:'auditor'},crew.id,{expectedName:crew.name,confirmed:true},options),/Forbidden/);
    await assert.rejects(renameCrew(pool,worker,crew.id,rename,options),/Forbidden/);
    for(const input of [{...rename,site_id:'b'},{...rename,name:null},{...rename,expectedName:null}]) await assert.rejects(renameCrew(pool,owner,crew.id,input,options),/Invalid/);
    await assert.rejects(renameCrew(pool,owner,crew.id,{...rename,expectedName:'Old name'},options),/name changed/);
    await assert.rejects(renameCrew(pool,owner,crew.id,{...rename,name:other.name},options),/already exists/);
    f.setFail('INSERT INTO audit');await assert.rejects(renameCrew(pool,owner,crew.id,rename,options),/Injected/);f.setFail('');
    assert.equal((await listCrews(pool,owner,{},options)).items.find((row) => row.id===crew.id).name,crew.name);
    f.loseNextCommit();await assert.rejects(renameCrew(pool,owner,crew.id,rename,options),/acknowledgement lost/);
    assert.equal((await renameCrew(pool,owner,crew.id,rename,options)).name,rename.name);
    assert.equal((await renameCrew(pool,owner,crew.id,rename,options)).member_count,1);
    assert.equal((await db.query("SELECT COUNT(*)::int n FROM audit WHERE action='crew.renamed'")).rows[0].n,1);
    const archive={expectedName:rename.name,confirmed:true};
    for(const input of [{expectedName:rename.name},{...archive,confirmed:false},{...archive,confirmed:'true'},{...archive,name:rename.name}]) await assert.rejects(archiveCrew(pool,owner,crew.id,input,options),/Invalid/);
    await assert.rejects(archiveCrew(pool,owner,crew.id,{...archive,expectedName:crew.name},options),/name changed/);
    f.setFail('INSERT INTO audit');await assert.rejects(archiveCrew(pool,owner,crew.id,archive,options),/Injected/);f.setFail('');
    assert.equal((await listCrews(pool,owner,{},options)).items.find((row) => row.id===crew.id).active,true);
    f.loseNextCommit();await assert.rejects(archiveCrew(pool,owner,crew.id,archive,options),/acknowledgement lost/);
    assert.equal((await archiveCrew(pool,owner,crew.id,archive,options)).active,false);
    assert.equal((await archiveCrew(pool,owner,crew.id,archive,options)).member_count,1);
    assert.equal((await db.query("SELECT COUNT(*)::int n FROM audit WHERE action='crew.archived'")).rows[0].n,1);
    await assert.rejects(renameCrew(pool,owner,crew.id,{name:'New name',expectedName:rename.name},options),/archived/);
    await assert.rejects(moveWorkerToCrew(pool,owner,'w2',crew.id,options),/unavailable/);
    assert.deepEqual(await preserved(),before);
    assert.equal((await requireSession(pool,req,options)).principal_id,'w1');
    assert.ok(f.queries.some((sql) => sql.includes('FOR UPDATE OF c')));
    assert.ok(f.queries.some((sql) => sql.includes('active=true FOR SHARE')));
    assert.equal((await moveWorkerToCrew(pool,owner,'w1',other.id,options)).crew_id,other.id);
  } finally {await db.close();}
});

test('PostgreSQL crews page beyond 500 with literal filters and complete scoped counts without writes',async () => {
  const f=await fixture(),{db,pool}=f;
  try {
    await db.query("INSERT INTO crews(id,org_id,site_id,name,active) SELECT 'crew-'||n,'a','a','Crew '||lpad(n::text,3,'0'),n<=600 FROM generate_series(1,602) n");
    await db.query("INSERT INTO crews(id,org_id,site_id,name) VALUES ('literal','a','a','Literal_under.score'),('foreign','b','b','Crew Foreign'),('foreign-site','a','c','Crew Other site')");
    await moveWorkerToCrew(pool,owner,'w1','crew-1',options);
    const before=await db.query('SELECT * FROM audit ORDER BY id');
    const page=await listCrews(pool,owner,{page:7,pageSize:100},options);assert.equal(page.total,603);assert.equal(page.items.length,3);assert.equal(page.items[0].name,'Crew 601');
    assert.deepEqual((await listCrews(pool,owner,{search:'_'},options)).items.map((row) => row.id),['literal']);
    assert.equal((await listCrews(pool,owner,{search:'%'},options)).total,0);
    assert.equal((await listCrews(pool,owner,{status:'active'},options)).total,601);assert.equal((await listCrews(pool,owner,{status:'inactive'},options)).total,2);
    assert.equal((await listCrews(pool,owner,{search:'Crew 001'},options)).items[0].member_count,1);
    const empty=await listCrews(pool,owner,{page:5000,pageSize:100},options);assert.equal(empty.total,603);assert.deepEqual(empty.items,[]);
    assert.equal((await listCrews(pool,owner,{search:'Foreign'},options)).total,0);
    for(const filters of [{page:0},{page:5001},{page:null},{page:true},{pageSize:101},{pageSize:false},{search:null},{search:'x'.repeat(81)},{status:null},{status:'archived'},{org_id:'b'}]) await assert.rejects(listCrews(pool,owner,filters,options),/Invalid/);
    for(const session of [worker,{...owner,principal_id:'auditor',role:'auditor'},{...owner,principal_id:'missing'},{...owner,site_id:'c'}]) await assert.rejects(listCrews(pool,session,{},options),/Forbidden/);
    assert.deepEqual((await db.query('SELECT * FROM audit ORDER BY id')).rows,before.rows);
    await db.query("UPDATE staff SET active=false WHERE id='owner'");await assert.rejects(listCrews(pool,owner,{},options),/Forbidden/);
  } finally {await db.close();}
});

test('PostgreSQL worker crew filters include archived retained membership and deny foreign scope without changing frozen evidence',async () => {
  const f=await fixture(),{db,pool}=f;
  try {
    await publish(pool,owner,'brief',request(),options);
    const crew=await createCrew(pool,owner,{name:'Retained crew'},options);
    await db.query("INSERT INTO crews(id,org_id,site_id,name) VALUES ('foreign-crew','b','b','Foreign crew'),('other-site','a','c','Other site')");
    await moveWorkerToCrew(pool,owner,'w1',crew.id,options);await moveWorkerToCrew(pool,owner,'w2',crew.id,options);
    await disableWorker(pool,owner,'w2',options);await archiveCrew(pool,owner,crew.id,{expectedName:crew.name,confirmed:true},options);
    const tables=['publications','assignments','audit','crew_memberships','workers','crews'];
    const before=[];for(const table of tables) before.push((await db.query(`SELECT * FROM ${table} ORDER BY 1`)).rows);
    assert.equal((await listWorkers(pool,owner,{crewId:crew.id},options)).total,1);
    const page=await listWorkers(pool,owner,{crewId:crew.id,status:'all',page:2,pageSize:1},options);assert.equal(page.total,2);assert.equal(page.items[0].id,'w2');
    assert.equal((await listWorkers(pool,owner,{crewId:crew.id,status:'inactive',language:'ur'},options)).total,1);
    assert.equal((await listWorkers(pool,owner,{crewId:crew.id,language:'ur'},options)).total,0);
    assert.equal((await listWorkers(pool,owner,{crewId:crew.id,search:'001',language:'en'},options)).total,1);
    assert.equal((await listWorkers(pool,owner,{crewId:'none',status:'all'},options)).total,0);
    for(const id of ['foreign-crew','other-site','missing']) await assert.rejects(listWorkers(pool,owner,{crewId:id},options),/Crew unavailable/);
    for(const id of ['',null,true,{},'x'.repeat(101)]) await assert.rejects(listWorkers(pool,owner,{crewId:id},options),/Invalid crew/);
    const after=[];for(const table of tables) after.push((await db.query(`SELECT * FROM ${table} ORDER BY 1`)).rows);assert.deepEqual(after,before);
  } finally {await db.close();}
});

test('PostgreSQL HTTP directory routes use the existing people contract and deny workers',async () => {
  const f=await fixture();
  try {
    const password='Synthetic directory HTTP password';
    await provisionStaffCredential(f.pool,{staffId:'owner',orgId:'a',siteId:'a',email:'owner@example.test',password},options);
    await withHttp(f,async ({request}) => {
      const staff=cookieOf(await request('/auth/staff/login',null,post({email:'owner@example.test',password})));
      const created=await request('/people/workers',staff,post({code:'HTTP Worker',language:'en'})); assert.equal(created.status,201);
      const person=await created.json();
      const crew=await (await request('/people/crews',staff,post({name:'HTTP Crew'}))).json();
      assert.equal((await request(`/people/workers/${person.id}/crew`,staff,post({crewId:crew.id}))).status,200);
      const crewPage=await request('/people/crews?search=HTTP&status=active&pageSize=1',staff);assert.equal(crewPage.status,200);assert.match(crewPage.headers.get('cache-control'),/no-store/);
      const crewRows=await crewPage.json();assert.equal(crewRows.total,1);assert.equal(crewRows.items[0].member_count,1);assert.equal(crewRows.pageSize,1);
      assert.equal((await request('/people/crews?org_id=b',staff)).status,400);assert.equal((await request('/people/crews?page=5001',staff)).status,400);
      assert.equal((await (await request(`/people/workers?crewId=${crew.id}`,staff)).json()).total,1);
      assert.equal((await (await request('/people/workers?crewId=none',staff)).json()).total,2);
      assert.equal((await request('/people/workers?crewId=missing',staff)).status,404);assert.equal((await request('/people/workers?crewId=',staff)).status,400);
      assert.equal((await request(`/people/workers/${person.id}`,staff,{method:'PATCH',body:JSON.stringify({language:'ur'})})).status,200);
      const rows=await (await request('/people/workers?search=HTTP&pageSize=5',staff)).json(); assert.equal(rows.total,1); assert.equal(rows.items[0].language,'ur');
      assert.equal((await request('/people/workers',staff,post({code:'HTTP Worker',language:'en'}))).status,409);
      const grant=await (await request('/worker-grants',staff,post({workerId:'w1'}))).json();
      const workerCookie=cookieOf(await request('/auth/worker/redeem',null,post({token:grant.token})));
      assert.equal((await request('/people/workers',workerCookie)).status,403);
      assert.equal((await request('/people/crews',workerCookie)).status,403);
      const crewPath=`/people/crews/${crew.id}`,rename={name:'HTTP Renamed',expectedName:crew.name};
      assert.equal((await request(crewPath,workerCookie,{method:'PATCH',body:JSON.stringify(rename)})).status,403);
      assert.equal((await request(crewPath,staff,{method:'PATCH',body:JSON.stringify(rename)})).status,200);
      assert.equal((await request(crewPath,staff,{method:'PATCH',body:JSON.stringify({...rename,name:'Stale edit'})})).status,409);
      assert.equal((await request(`${crewPath}/archive`,staff,post({expectedName:rename.name}))).status,400);
      assert.equal((await request(`${crewPath}/archive`,workerCookie,post({expectedName:rename.name,confirmed:true}))).status,403);
      assert.equal((await request(`${crewPath}/archive`,staff,post({expectedName:rename.name,confirmed:true}))).status,200);
      assert.equal((await request(`${crewPath}/archive`,staff,post({expectedName:rename.name,confirmed:true}))).status,200);
      assert.equal((await (await request('/people/crews?status=inactive',staff)).json()).total,1);
      assert.equal((await (await request('/people/crews?status=active',staff)).json()).total,0);
      assert.equal((await request(`/people/workers/${person.id}/crew`,staff,post({crewId:crew.id}))).status,404);
      assert.equal((await request(`/people/workers/${person.id}/disable`,staff,post({}))).status,200);
      assert.equal((await (await request(`/people/workers?crewId=${crew.id}&status=inactive`,staff)).json()).total,1);
      assert.equal((await (await request('/people/workers?status=inactive',staff)).json()).total,1);
      const enable={requestId:randomUUID(),expectedCode:person.code,confirmed:true},restore={requestId:randomUUID(),expectedName:rename.name,confirmed:true};
      for(const [path,body] of [[`/people/workers/${person.id}/reenable`,enable],[`${crewPath}/restore`,restore]]) {
        assert.equal((await request(path,workerCookie,post(body))).status,403);
        assert.equal((await request(path,null,post(body))).status,401);
        assert.equal((await request(path,staff,post({...body,confirmed:false}))).status,400);
        assert.equal((await request(path,staff,post({...body,requestId:'bad'}))).status,400);
        assert.equal((await request(path,staff,post({...body,org_id:'b'}))).status,400);
        const accepted=await request(path,staff,post(body));assert.equal(accepted.status,200);assert.match(accepted.headers.get('cache-control'),/no-store/);assert.equal((await accepted.json()).active,true);
        assert.equal((await (await request(path,staff,post(body))).json()).duplicate,true);
      }
      assert.equal((await request(`/people/workers/${person.id}/reenable`,staff,post({...enable,expectedCode:'Changed'}))).status,409);
      assert.equal((await request(`${crewPath}/restore`,staff,post({...restore,expectedName:'Changed'}))).status,409);
      assert.equal((await f.db.query('SELECT COUNT(*)::int n FROM directory_reactivations')).rows[0].n,2);
    });
  } finally {await f.db.close();}
});
