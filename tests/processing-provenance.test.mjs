import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {openDatabase} from '../server/db.mjs';
import {seed} from '../server/seed.mjs';
import {createDraft,queuePreparation} from '../server/preparation.mjs';
import {CANONICAL_SOURCE} from '../server/domain.mjs';
import {getProcessingProvenance as sqliteRead} from '../server/processing.mjs';
import {getProcessingProvenance as pgRead} from '../server/postgres/processing-provenance.mjs';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {processingProvenanceFilters,processingOperation} from '../server/processing-provenance.mjs';
import {checkedProviderHistory,checkedProviderOperation} from '../src/processing-provenance.ts';
import {createAppServer} from '../server/index.mjs';
import {createPostgresRehearsalServer} from '../server/postgres/http.mjs';
import {provisionStaffCredential} from '../server/postgres/auth.mjs';
import {createSessionContextFetch} from './helpers/session-http.mjs';
import {principalLoginBody,seedCredentials} from './helpers/sqlite-app.mjs';

const owner={principal_type:'staff',principal_id:'owner',org_id:'a',site_id:'a',role:'owner'};
const job={id:'answer_check:job',kind:'answer_check',publication_id:'publication',publication_version:3,assignment_id:'assignment'};
const started='2026-10-14T00:00:00.000Z',finished='2026-10-14T00:00:01.000Z';
const row={id:'operation',kind:'typed-assessment',model:'gemini-fixture',data_class:'synthetic',reserved_requests:1,created_at:started,run_id:'run',run_started_at:started,current_run:false,result_reference:null,
  input_hash:'a'.repeat(64),claim_token:'PRIVATE LEASE',provenance_json:{adapter:'gemini-fixture',model:'gemini-fixture',dataClass:'synthetic',promptVersion:'prompt-v1',schemaVersion:'schema-v1'},
  requests:[{sequence:1,cleanup:false,state:'accepted',http_status:200,created_at:started,finished_at:finished}],answer_text:'PRIVATE ANSWER'};
test('provider projection and client DTO distinguish HTTP success from completion and refuse corrupt receipts',()=>{
  const value=processingOperation(row,job);assert.equal(value.resultReference,null);assert.equal(value.requests[0].state,'accepted');checkedProviderOperation(value,'answer_check');assert.doesNotMatch(JSON.stringify(value),/PRIVATE|input_hash|claim_token|answer_text|sha256/);
  for(const request of [{...row.requests[0],state:'accepted',http_status:429},{...row.requests[0],state:'started'},{...row.requests[0],sequence:2},{...row.requests[0],finished_at:'2026-10-13T00:00:00Z'}])assert.throws(()=>processingOperation({...row,requests:[request]},job));
  assert.throws(()=>processingOperation({...row,requests:Array(2).fill(row.requests[0])},job));
  const unknown=processingOperation({...row,input_hash:null,provenance_json:null,requests:[]},job);assert.equal(unknown.provenance,null);assert.deepEqual(unknown.requests,[]);
  assert.equal(processingOperation({...row,provenance_json:{...row.provenance_json,private:'PRIVATE'}},job).provenance,null);
  for(const change of [{dataClass:'real'},{private:'PRIVATE'},{resultReference:'bundle'},{runId:'https://secret'},{reservedRequests:0},{requests:[{...value.requests[0],state:'uncertain'}]},{stage:{step:1,name:'speech',language:'ar',track:'body'}}])assert.throws(()=>checkedProviderOperation({...value,...change},'answer_check'));
  const page={jobId:job.id,kind:job.kind,publicationId:job.publication_id,publicationVersion:3,assignmentId:job.assignment_id,supported:true,items:[value],total:1,page:1,pageSize:10};checkedProviderHistory(page,job,1);
  for(const change of [{jobId:'other'},{publicationVersion:4},{assignmentId:'other'},{page:2},{items:[value,value],total:2},{supported:false},{total:0},{private:'PRIVATE'}])assert.throws(()=>checkedProviderHistory({...page,...change},job,1));
});
test('provider page filters reject scope overrides, duplicates-by-type and invalid bounds',()=>{
  assert.deepEqual(processingProvenanceFilters(),{page:1,pageSize:10});
  for(const value of [{page:0},{page:5001},{pageSize:21},{page:[1]},{page:'1e2'},{site:'other'},null,[]])assert.throws(()=>processingProvenanceFilters(value));
});
test('SQLite provider history reports unavailable journal honestly and performs no schema or business writes',()=>{
  const db=openDatabase(':memory:');seed(db);const actor={...owner,principal_id:'maya',org_id:'cedar',site_id:'beirut'};
  try{
    const draft=createDraft(db,actor,{requestId:randomUUID(),title:'Synthetic metadata',source:CANONICAL_SOURCE}),queued=queuePreparation(db,actor,draft.id,1);
    const snapshot=()=>JSON.stringify({schema:db.prepare("SELECT name,sql FROM sqlite_master ORDER BY name").all(),jobs:db.prepare('SELECT * FROM jobs ORDER BY id').all(),audit:db.prepare('SELECT * FROM audit ORDER BY id').all()}),before=snapshot();
    const value=sqliteRead(db,actor,queued.id);assert.equal(value.supported,false);assert.deepEqual(value.items,[]);assert.equal(value.total,0);assert.equal(snapshot(),before);
    assert.throws(()=>sqliteRead(db,{...actor,principal_type:'worker'},queued.id),/Forbidden/);
  }finally{db.close();}
});
async function fixture(){
  const db=new PGlite(),schema='understood_test_provider_history',commands=[];
  const pool={async connect(){return {query:async(sql,args)=>{commands.push(sql);return args?.length?db.query(sql,args):(await db.exec(sql)).at(-1)??{rows:[]};},release(){}};}};
  await db.exec(`CREATE SCHEMA ${schema};SET search_path TO ${schema},pg_catalog`);await runMigrations(pool,{schema});
  await db.exec(`INSERT INTO organizations VALUES('a','Synthetic A'),('b','Synthetic B');INSERT INTO sites VALUES('a','a','Site A','UTC'),('c','a','Site C','UTC'),('b','b','Site B','UTC');
    INSERT INTO staff(id,org_id,site_id,name,role) VALUES('owner','a','a','Owner','owner'),('auditor','a','a','Auditor','auditor'),('other','a','c','Other site owner','owner'),('foreign','b','b','Foreign','owner');
    INSERT INTO workers(id,org_id,site_id,code,language) VALUES('worker','a','a','001','en');
    INSERT INTO briefings(id,org_id,site_id,title,source,state) VALUES('briefing','a','a','Synthetic','PRIVATE SOURCE','draft');
    INSERT INTO publications(id,org_id,site_id,briefing_id,version,snapshot_json,state) VALUES('publication','a','a','briefing',3,'{}','published');
    INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,language) VALUES('assignment','a','a','publication','worker','en');
    INSERT INTO attempts(id,org_id,site_id,assignment_id,submission_id,answer_text,outcome,reasons_json,assessment_status) VALUES('attempt','a','a','assignment','submission','PRIVATE ANSWER',NULL,'[]','pending');`);
  const claim=randomUUID();await db.query("INSERT INTO assessment_jobs(id,org_id,site_id,assignment_id,attempt_id,status,lease_token,lease_until) VALUES('job','a','a','assignment','attempt','processing',$1,clock_timestamp()+interval '1 hour')",[claim]);
  const ids=[];
  for(let index=0;index<12;index++){
    const id=randomUUID();ids.push(id);const token=index<4?claim:randomUUID(),time=new Date(Date.parse(started)+index*1000).toISOString();
    await db.query(`INSERT INTO provider_operations(id,org_id,kind,reference_id,claim_token,model,data_class,reserved_requests,quota_day,input_hash,provenance_json,created_at)
      VALUES($1,'a','typed-assessment','job',$2,'gemini-fixture','synthetic',1,CURRENT_DATE,$3,$4,$5)`,[id,token,'a'.repeat(64),JSON.stringify(row.provenance_json),time]);
    const state=['started','accepted','rejected','uncertain'][index%4];
    await db.query(`INSERT INTO provider_requests(id,operation_id,sequence,cleanup,state,http_status,created_at,finished_at) VALUES($1,$2,1,false,$3,$4,$5,$6)`,[randomUUID(),id,state,state==='accepted'?200:state==='rejected'?429:null,time,state==='started'?null:new Date(Date.parse(time)+500).toISOString()]);
  }
  await db.query(`INSERT INTO provider_operations(id,org_id,kind,reference_id,claim_token,model,data_class,reserved_requests,quota_day,input_hash,provenance_json)
    VALUES($1,'b','typed-assessment','job',$2,'gemini-fixture','synthetic',1,CURRENT_DATE,$3,$4)`,[randomUUID(),randomUUID(),'b'.repeat(64),JSON.stringify(row.provenance_json)]);
  return {db,pool,schema,commands,ids,options:{schema}};
}
test('PostgreSQL provider pages are scoped, bounded, repeatable and metadata-only across active and historical claims',async()=>{
  const f=await fixture();
  try{
    f.commands.length=0;const first=await pgRead(f.pool,owner,job.id,{},f.options);assert.equal(first.total,12);assert.equal(first.items.length,10);checkedProviderHistory(first,job,1);
    const second=await pgRead(f.pool,owner,job.id,{page:2},f.options);assert.equal(second.items.length,2);checkedProviderHistory(second,job,2);
    const all=[...first.items,...second.items];assert.equal(new Set(all.map(item=>item.id)).size,12);assert.equal(all.filter(item=>item.currentRun).length,4);assert.equal(new Set(all.slice(-4).map(item=>item.runId)).size,1);
    assert.equal(all.filter(item=>item.requests[0].state==='uncertain').length,3);assert.ok(all.every(item=>item.resultReference===null));
    assert.doesNotMatch(JSON.stringify(all),/PRIVATE|input_hash|claim_token|lease_token|token_hash|provenance_json|snapshot_json/);
    assert.ok(f.commands.some(sql=>sql==='SET TRANSACTION ISOLATION LEVEL REPEATABLE READ'));assert.ok(f.commands.every(sql=>!/^\s*(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b/i.test(sql)));
    assert.equal((await pgRead(f.pool,{...owner,principal_id:'auditor',role:'auditor'},job.id,{},f.options)).total,12);
    for(const actor of [{...owner,principal_id:'other',site_id:'c'},{...owner,principal_id:'foreign',org_id:'b',site_id:'b'}])await assert.rejects(pgRead(f.pool,actor,job.id,{},f.options),/unavailable/);
    await assert.rejects(pgRead(f.pool,{...owner,principal_type:'worker'},job.id,{},f.options),/Forbidden/);
  }finally{await f.db.close();}
});
for(const pg of [false,true])test(`${pg?'PostgreSQL':'SQLite'} provider history HTTP requires captured context and rejects duplicate or foreign filters`,async()=>{
  const f=pg?await fixture():null,db=pg?f.db:openDatabase(':memory:');let server;
  try{
    let id=job.id;if(!pg){seedCredentials(db);const draft=createDraft(db,{...owner,org_id:'cedar',site_id:'beirut',principal_id:'maya'},{requestId:randomUUID(),title:'HTTP synthetic',source:CANONICAL_SOURCE});id=queuePreparation(db,{...owner,org_id:'cedar',site_id:'beirut',principal_id:'maya'},draft.id,1).id;}
    const origin='http://127.0.0.1:3032',config={tier:'local',aiMode:'synthetic',dataClass:'synthetic',accessMode:'credential',publicOrigin:origin,schema:f?.schema};
    if(pg)await provisionStaffCredential(f.pool,{staffId:'owner',orgId:'a',siteId:'a',email:'owner@history.example.test',password:'Synthetic-provider-history-password'},f.options);
    server=pg?createPostgresRehearsalServer(f.pool,config):createAppServer(db,config);await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const base=`http://127.0.0.1:${server.address().port}/api`,contextual=createSessionContextFetch(),input=pg?{email:'owner@history.example.test',password:'Synthetic-provider-history-password'}:principalLoginBody('maya');
    const login=await contextual(base+('/auth/staff/login'),{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(input)});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0],url=base+'/processing/'+encodeURIComponent(id)+'/provenance';
    for(const context of [undefined,'invalid','0'.repeat(64)])assert.equal((await fetch(url,{headers:{cookie,...(context===undefined?{}:{'x-client-session-context':context})}})).status,409);
    for(const query of ['page=1&page=2','site=foreign','pageSize=21'])assert.equal((await contextual(url+'?'+query,{headers:{cookie}})).status,400);
    const response=await contextual(url+'?page=1',{headers:{cookie}});assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);
    const body=await response.json();assert.equal(body.supported,pg);assert.equal((await fetch(url)).status,401);
  }finally{if(server?.listening)await new Promise(resolve=>server.close(resolve));await db.close();}
});
