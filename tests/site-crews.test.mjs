import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {openDatabase} from '../server/db.mjs';
import {seed} from '../server/seed.mjs';
import {createAppServer} from '../server/index.mjs';
import {createPostgresRehearsalServer} from '../server/postgres/http.mjs';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {siteCrewOverview} from '../server/site-crews.mjs';
import {siteCrewOverview as pgOverview} from '../server/postgres/site-crews.mjs';
import * as people from '../server/people.mjs';
import * as pgPeople from '../server/postgres/people.mjs';
import {publish,syntheticPrepare,CANONICAL_SOURCE} from '../server/domain.mjs';
import {publish as pgPublish} from '../server/postgres/domain.mjs';
import {requestWorkerDeletion} from '../server/deletions.mjs';
import {requestWorkerDeletion as pgDelete} from '../server/postgres/deletions.mjs';
import {provisionStaffCredential} from '../server/auth.mjs';
import {provisionStaffCredential as pgProvision} from '../server/postgres/auth.mjs';
import {createSessionContextFetch} from './helpers/session-http.mjs';
import {readCrewOverview,readCrewMembers,readCrewChange} from '../src/crew-overview.ts';
import {readCrewInstructions} from '../src/crew-overview.ts';
import {sqliteWorkspace} from '../server/workspace-sqlite.mjs';
import {postgresWorkspace} from '../server/postgres/workspace.mjs';

const config={tier:'local',aiMode:'synthetic',dataClass:'synthetic',accessMode:'credential',publicOrigin:'http://127.0.0.1:3020'};
async function fixture(pg) {
  const db=pg?new PGlite():openDatabase(':memory:'),options={schema:'understood_test_site_crews',integrationMode:'synthetic'};
  const queries=[];
  const pool={async connect(){return {async query(sql,args){queries.push(sql);return args?.length?db.query(sql,args):(await db.exec(sql)).at(-1)||{rows:[]};},release(){}};}};
  const query=async(sql,args=[])=>{if(pg){let n=0;return (await db.query(sql.replaceAll('?',()=>`$${++n}`),args)).rows;}return db.prepare(sql).all(...args);};
  if(pg){
    await db.exec(`CREATE SCHEMA ${options.schema};SET search_path TO ${options.schema},pg_catalog`);await runMigrations(pool,options);
    await db.exec(`INSERT INTO organizations VALUES('cedar','Synthetic Cedar'),('harbor','Foreign');
      INSERT INTO sites VALUES('beirut','cedar','بيروت QA','Asia/Beirut'),('tripoli','cedar','Tripoli','UTC'),('harbor-yard','harbor','Foreign','UTC');
      INSERT INTO staff(id,org_id,site_id,name,role) VALUES('maya','cedar','beirut','Maya QA','owner'),('harbor-owner','harbor','harbor-yard','Foreign','owner');
      INSERT INTO workers(id,org_id,site_id,code,language) VALUES('worker-1','cedar','beirut','Worker 001','en'),('worker-2','cedar','beirut','عامل 002','ar'),('worker-3','cedar','beirut','Worker 003','ur');`);
    await query("INSERT INTO briefings(id,org_id,site_id,title,source,state,prepared_json) VALUES('shelf','cedar','beirut','Shelf',?,'ready',?)",[CANONICAL_SOURCE,JSON.stringify(syntheticPrepare(CANONICAL_SOURCE))]);
  }else {seed(db);await query("INSERT OR IGNORE INTO sites(id,org_id,name,timezone) VALUES('tripoli','cedar','Tripoli','UTC')");}
  for(const [id,site,role] of [['rami','beirut','supervisor'],['viewer','beirut','auditor'],['admin','beirut','administrator'],['tripoli-owner','tripoli','owner']])await query('INSERT INTO staff(id,org_id,site_id,name,role) VALUES(?,?,?,?,?)',[id,'cedar',site,id,role]);
  const server=pg?createPostgresRehearsalServer(pool,{...config,...options}):createAppServer(db,config);
  await query("INSERT INTO site_settings(site_id,org_id,revision,primary_contact_id,deputy_contact_id) VALUES('beirut','cedar',0,'maya','rami')");
  const owner={principal_type:'staff',principal_id:'maya',org_id:'cedar',site_id:'beirut',role:'owner'};
  const invoke=(method,...args)=>pg?pgPeople[method](pool,owner,...args,options):people[method](db,owner,...args);
  const read=(input={},session=owner)=>pg?pgOverview(pool,session,input,options):siteCrewOverview(db,session,input);
  return {pg,db,pool,options,query,queries,server,owner,invoke,read,close:()=>db.close()};
}

for(const pg of [false,true])test(`${pg?'PostgreSQL':'SQLite'} team overview keeps frozen counts separate from current membership and minimizes scoped activity`,async()=>{
  const f=await fixture(pg),scope=JSON.stringify(['cedar','beirut','maya']);
  try {
    const beforeSchema=pg?null:await f.query("SELECT name,sql FROM sqlite_master ORDER BY name");
    const legacy=await f.read();assert.equal(legacy.crewSnapshotAvailable,false);
    if(!pg){assert.equal(legacy.metrics.assigned,30);assert.deepEqual(await f.query("SELECT name,sql FROM sqlite_master ORDER BY name"),beforeSchema);}
    const first=await f.invoke('createCrew',{name:'الفريق QA الأول'}),second=await f.invoke('createCrew',{name:'Second QA crew'});
    assert.equal(readCrewChange(first,scope).id,first.id);
    await assert.rejects(async()=>f.invoke('moveWorkersToCrew',first.id,{members:[{workerId:'worker-1',expectedCrewId:null},{workerId:'zz-missing',expectedCrewId:null}],confirmedMoves:false}),/Worker unavailable/);
    assert.equal((await f.invoke('listWorkers',{workerId:'worker-1'})).items[0].crew_id,null);
    const added=await f.invoke('moveWorkersToCrew',first.id,{members:[{workerId:'worker-1',expectedCrewId:null},{workerId:'worker-2',expectedCrewId:null}],confirmedMoves:false});assert.equal(added.items.length,2);
    const duplicate=await f.invoke('moveWorkersToCrew',first.id,{members:[{workerId:'worker-1',expectedCrewId:null},{workerId:'worker-2',expectedCrewId:null}],confirmedMoves:false});assert.equal(duplicate.items.length,2);
    await f.invoke('moveWorkerToCrew','worker-1',first.id);await f.invoke('moveWorkerToCrew','worker-2',first.id);await f.invoke('moveWorkerToCrew','worker-3',second.id);
    if(!pg)await f.query("UPDATE briefings SET state='ready',prepared_json=? WHERE id='shelf'",[JSON.stringify(syntheticPrepare(CANONICAL_SOURCE))]);
    const draft=(await f.query("SELECT revision,next_version FROM briefings WHERE id='shelf'"))[0],body={requestId:randomUUID(),revision:draft.revision,nextVersion:draft.next_version,workerIds:['worker-1','worker-2','worker-3']};
    const publication=pg?await pgPublish(f.pool,f.owner,'shelf',body,f.options):publish(f.db,f.owner,'shelf',body);
    const assignments=await f.query('SELECT id,worker_id FROM assignments WHERE publication_id=?',[publication.id]);
    for(const [index,outcome] of [[0,'matched'],[1,'clarification']]){
      const assignment=assignments.find(row=>row.worker_id===`worker-${index+1}`).id,submission=randomUUID(),at=new Date().toISOString();
      await f.query(`INSERT INTO attempts(id,org_id,${pg?'site_id,':''}assignment_id,submission_id,answer_text,outcome,reasons_json,received_at${pg?',assessment_status':''}) VALUES(?,?${pg?',?':''},?,?,'PRIVATE ANSWER',?,'[]',?${pg?",'complete'":''})`,[randomUUID(),'cedar',...(pg?['beirut']:[]),assignment,submission,outcome,at]);
      await f.query("INSERT INTO submission_receipts(org_id,assignment_id,submission_id,kind,received_at) VALUES('cedar',?,?,'typed',?)",[assignment,submission,at]);
    }
    const original=readCrewOverview(await f.read(),{page:1,pageSize:5,scope});
    assert.equal(original.crewSnapshotAvailable,true);assert.deepEqual(original.metrics,{assigned:3,responses:2,matches:1,clarifications:1,unassessed:0,pending:1,completion:67});
    assert.equal(original.contacts.primary.role,'owner');assert.equal(original.contacts.deputy.role,'supervisor');
    const firstBefore=original.items.find(row=>row.id===first.id),secondBefore=original.items.find(row=>row.id===second.id);
    assert.equal(firstBefore.metrics.assigned,2);assert.equal(secondBefore.metrics.pending,1);
    const history=(crewId,session=f.owner,page=1,filters={})=>pg?postgresWorkspace(f.pool,session,'crew-instructions',{crewId,page,...filters},f.options):sqliteWorkspace(f.db,session,'crew-instructions',{crewId,page,...filters});
    const firstHistory=readCrewInstructions(await history(first.id),{crewId:first.id,page:1});
    assert.equal(firstHistory.total,1);assert.deepEqual(firstHistory.summary,{ongoing:0,followUp:1,done:0});
    assert.equal((await history(first.id,f.owner,1,{search:'SHELF',status:'follow-up'})).total,1);
    assert.equal((await history(first.id,f.owner,1,{search:'%'})).total,0);
    const filtered=await history(first.id,f.owner,1,{status:'done'});assert.equal(filtered.total,0);assert.deepEqual(filtered.summary,firstHistory.summary);
    assert.equal((await history(first.id,f.owner,1,{status:'done'})).historyTotal,1);assert.equal(firstHistory.items[0].briefingId,'shelf');
    assert.deepEqual(firstHistory.items[0].counts,{sent:0,inProgress:1,followUp:1,done:0,total:2});
    assert.equal(firstHistory.items[0].status,'follow-up');assert.ok(!JSON.stringify(firstHistory).includes('PRIVATE ANSWER'));
    assert.equal((await history(second.id)).items[0].counts.total,1);
    assert.deepEqual((await history(first.id,f.owner,2)).items,[]);
    for(const invalid of [0,5001,'bad'])await assert.rejects(history(first.id,f.owner,invalid),/Invalid/);
    await assert.rejects(history(first.id,{principal_type:'staff',principal_id:'harbor-owner',org_id:'harbor',site_id:'harbor-yard',role:'owner'}),/unavailable/);
    await assert.rejects(history(first.id,{principal_type:'worker',principal_id:'worker-1',org_id:'cedar',site_id:'beirut'}),/Forbidden/);
    await assert.rejects(async()=>f.invoke('moveWorkersToCrew',second.id,{members:[{workerId:'worker-1',expectedCrewId:first.id}],confirmedMoves:false}),/Confirm worker moves/);
    await assert.rejects(async()=>f.invoke('moveWorkersToCrew',second.id,{members:[{workerId:'worker-1',expectedCrewId:null}],confirmedMoves:true}),/Worker membership changed/);
    const moved=await f.invoke('moveWorkersToCrew',second.id,{members:[{workerId:'worker-1',expectedCrewId:first.id}],confirmedMoves:true});assert.equal(moved.items[0].crew_id,second.id);
    await f.invoke('renameCrew',first.id,{expectedName:first.name,name:'الفريق QA الجديد'});
    await f.invoke('archiveCrew',first.id,{expectedName:'الفريق QA الجديد',confirmed:true});
    await assert.rejects(async()=>f.invoke('moveWorkersToCrew',first.id,{members:[{workerId:'worker-3',expectedCrewId:second.id}],confirmedMoves:true}),/Crew unavailable/);
    const current=readCrewOverview(await f.read(),{page:1,pageSize:5,scope});
    assert.equal(current.items.find(row=>row.id===first.id).member_count,1);assert.equal(current.items.find(row=>row.id===second.id).member_count,2);
    assert.deepEqual(current.items.find(row=>row.id===first.id).metrics,firstBefore.metrics);assert.deepEqual(current.items.find(row=>row.id===second.id).metrics,secondBefore.metrics);
    assert.deepEqual((await history(first.id)).items,firstHistory.items);
    const completed=assignments.find(row=>row.worker_id==='worker-1').id;
    await f.query('INSERT INTO assignment_completions(assignment_id,org_id,site_id,worker_id,completed_at) VALUES(?,?,?,?,?)',[completed,'cedar','beirut','worker-1',new Date().toISOString()]);
    assert.equal((await history(first.id)).items[0].counts.done,1);
    assert.equal(current.activity.length,6);assert.ok(current.activity.some(row=>row.action==='crew.archived'));
    assert.ok(!JSON.stringify(current).includes('PRIVATE ANSWER'));assert.ok(!JSON.stringify(current).includes('rubric'));
    const workers=await f.invoke('listWorkers',{crewId:second.id,status:'active',page:1,pageSize:5});
    assert.equal(readCrewMembers(workers,{crewId:second.id,page:1,pageSize:5,scope}).total,2);
    assert.equal((await f.read({search:'%'})).total,0);assert.equal((await f.read({page:2,pageSize:1})).items.length,1);
    const foreign={principal_type:'staff',principal_id:'harbor-owner',org_id:'harbor',site_id:'harbor-yard',role:'owner'};
    assert.equal((await f.read({},foreign)).items.length,0);assert.equal((await f.read({},foreign)).activity.length,0);
    const otherSite={...f.owner,principal_id:'tripoli-owner',site_id:'tripoli'};assert.equal((await f.read({},otherSite)).items.length,0);
    for(const session of [{...f.owner,role:'supervisor'},{...f.owner,principal_id:'viewer',role:'auditor'},{...f.owner,principal_id:'admin',role:'administrator'}, {...f.owner,principal_type:'worker',principal_id:'worker-1'}])await assert.rejects(async()=>f.read({},session),/Forbidden/);
    await assert.rejects(async()=>f.read({org_id:'harbor'}),/Invalid input/);
    for(const filters of [{page:5001},{pageSize:101},{status:'archived'},{search:'x'.repeat(81)}])await assert.rejects(async()=>f.read(filters),/Invalid/);
    await assert.rejects(async()=>f.read({},{...f.owner,token_hash:'revoked'}),/Sign in required/);
    await f.query(`UPDATE staff SET active=${pg?'false':'0'} WHERE id='rami'`);assert.equal((await f.read()).contacts.deputy,null);
    const change={requestId:randomUUID(),expectedCode:'Worker 001',reason:'worker_request',confirmed:true};
    if(pg)await pgDelete(f.pool,f.owner,'worker-1',change,f.options);else requestWorkerDeletion(f.db,f.owner,'worker-1',change);
    const redacted=await f.read(),knownEvents=await f.query("SELECT id FROM audit WHERE action='worker.crew_moved' AND object_id='worker-1'");
    for(const event of redacted.activity.filter(row=>knownEvents.some(known=>known.id===row.id)))assert.equal(event.item,null);
    assert.equal((await f.query('SELECT count(*) AS n FROM assignments WHERE publication_id=?',[publication.id]))[0].n,3);
    if(pg)assert.ok(f.queries.some(sql=>sql==='SET TRANSACTION ISOLATION LEVEL REPEATABLE READ'));
  }finally{await f.close();}
});

for(const pg of [false,true])test(`${pg?'PostgreSQL':'SQLite'} team overview HTTP denies wrong authority, duplicate filters and private cross-site context`,async()=>{
  const f=await fixture(pg),password='Synthetic crew password only 123',fetch=createSessionContextFetch();
  try{
    for(const [id,orgId,siteId] of [['maya','cedar','beirut'],['viewer','cedar','beirut'],['harbor-owner','harbor','harbor-yard']]){
      if(pg)await pgProvision(f.pool,{staffId:id,orgId,siteId,email:`${id}@example.test`,password},f.options);
      else provisionStaffCredential(f.db,id,`${id}@example.test`,password);
    }
    const savedCrew=await f.invoke('createCrew',{name:'HTTP scoped QA'});
    await new Promise(resolve=>f.server.listen(0,'127.0.0.1',resolve));
    const base=`http://127.0.0.1:${f.server.address().port}/api`,call=(path,cookie,body)=>fetch(base+path,{method:body?'POST':'GET',headers:{origin:config.publicOrigin,'content-type':'application/json',...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined});
    const login=async id=>(await call('/auth/staff/login',null,{email:`${id}@example.test`,password})).headers.get('set-cookie').split(';')[0];
    const owner=await login('maya'),viewer=await login('viewer'),foreign=await login('harbor-owner'),path='/people/crew-overview';
    assert.equal((await call(path,null)).status,401);assert.equal((await call(path,viewer)).status,403);
    const good=await call(path,owner);assert.equal(good.status,200);assert.match(good.headers.get('cache-control'),/no-store/);
    assert.equal(readCrewOverview(await good.json(),{page:1,pageSize:5,scope:'["cedar","beirut","maya"]'}).items[0].name,'HTTP scoped QA');
    assert.equal((await (await call(path,foreign)).json()).total,0);
    for(const query of ['page=1&page=2','site_id=harbor-yard','pageSize=101','status=other'])assert.equal((await call(path+'?'+query,owner)).status,400);
    assert.equal((await call(path,owner,{name:'Forbidden mutation'})).status,404);
    assert.equal((await f.read()).total,1);
    const historyPath=`/workspace/crews/${savedCrew.id}/instructions`;
    const contexts=new Map(await Promise.all([owner,viewer,foreign].map(async cookie=>[cookie,(await (await call('/session',cookie)).json()).clientContext])));
    const historyCall=(query,cookie)=>fetch(base+historyPath+query,{headers:cookie?{cookie,'x-client-session-context':contexts.get(cookie)}:{}});
    assert.equal((await call(historyPath,owner)).status,409);
    assert.equal((await historyCall('',null)).status,401);
    assert.equal((await historyCall('',viewer)).status,403);
    const history=await historyCall('',owner);assert.equal(history.status,200,JSON.stringify(await history.clone().json()));
    assert.deepEqual(readCrewInstructions(await history.json(),{crewId:savedCrew.id,page:1}).items,[]);
    assert.notEqual((await historyCall('',foreign)).status,200);
    for(const query of ['page=0','page=1&page=2','org_id=harbor'])assert.equal((await historyCall('?'+query,owner)).status,400);
    for(const query of ['status=other','search='+('x'.repeat(81))])assert.equal((await historyCall('?'+query,owner)).status,400);
    const memberPath=`/people/crews/${savedCrew.id}/members`,batch={members:[{workerId:'worker-1',expectedCrewId:null},{workerId:'worker-2',expectedCrewId:null}],confirmedMoves:false};
    assert.equal((await call(memberPath,null,batch)).status,401);
    assert.equal((await call(memberPath,viewer,batch)).status,403);
    assert.equal((await call(memberPath,foreign,batch)).status,409);
    const admitted=await call(memberPath,owner,batch);assert.equal(admitted.status,200);assert.equal((await admitted.json()).items.length,2);
    assert.equal((await call(memberPath,owner,{...batch,members:[batch.members[0],batch.members[0]]})).status,400);
    assert.equal((await globalThis.fetch(base+memberPath,{method:'POST',headers:{cookie:owner,origin:config.publicOrigin,'content-type':'application/json'},body:JSON.stringify(batch)})).status,409);
  }finally{if(f.server.listening)await new Promise(resolve=>f.server.close(resolve));await f.close();}
});
