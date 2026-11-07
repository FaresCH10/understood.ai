import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {openDatabase} from '../server/db.mjs';
import {seed} from '../server/seed.mjs';
import {ensureRecordingSchema} from '../server/recordings.mjs';
import {ensureCaseMessageSchema,sendCaseMessage as localMessage} from '../server/case-messages.mjs';
import {submitAnswer as localAnswer} from '../server/domain.mjs';
import * as localCases from '../server/clarifications.mjs';
import * as pgCases from '../server/postgres/clarifications.mjs';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {submitAnswer as pgAnswer} from '../server/postgres/domain.mjs';
import {processOneAssessment} from '../server/postgres/assessment-worker.mjs';
import {sendCaseMessage as pgMessage} from '../server/postgres/case-messages.mjs';
import {requestCaseRepeat} from '../server/postgres/case-repeats.mjs';
import {saveCaseReview} from '../server/postgres/case-reviews.mjs';
import {saveActivityRetention,processOneActivityPurge} from '../server/postgres/activity-retention.mjs';
import {listCaseTimeline as localTimeline} from '../server/case-timeline.mjs';
import {listCaseTimeline as pgTimeline} from '../server/postgres/case-timeline.mjs';
import {caseTimelineInput} from '../server/case-timeline-input.mjs';
import {checkedCaseTimeline} from '../src/case-timeline.ts';
import {routeNewCase as localRoute} from '../server/case-routing.mjs';
import {routeNewCase as pgRoute} from '../server/postgres/case-routing.mjs';
import {domainTransaction} from '../server/postgres/domain.mjs';

const owner={principal_type:'staff',principal_id:'maya',org_id:'cedar',site_id:'beirut',role:'owner'},worker={...owner,principal_type:'worker',principal_id:'worker-30'};
const context='a'.repeat(64);
async function fixture(pg){
  const db=pg?new PGlite():openDatabase(':memory:');let pool;
  if(pg){
    pool={async connect(){return {query:async(sql,args)=>args?.length?db.query(sql,args):(await db.exec(sql)).at(-1)||{rows:[]},release(){}};}};
    await runMigrations(pool);
    await db.exec(`INSERT INTO organizations VALUES('cedar','Synthetic'),('foreign','Foreign');
      INSERT INTO sites VALUES('beirut','cedar','Synthetic','UTC'),('foreign','foreign','Foreign','UTC');
      INSERT INTO staff(id,org_id,site_id,name,role) VALUES('maya','cedar','beirut','Synthetic Owner','owner'),('audit','cedar','beirut','Synthetic Auditor','auditor'),('foreign','foreign','foreign','Foreign private name','owner');
      INSERT INTO workers(id,org_id,site_id,code,language) VALUES('worker-30','cedar','beirut','Worker 030','en'),('worker-31','cedar','beirut','Worker 031','en');
      INSERT INTO briefings(id,org_id,site_id,title,source,state) VALUES('shelf','cedar','beirut','Synthetic','Synthetic source','draft');
      INSERT INTO publications(id,org_id,site_id,briefing_id,version,snapshot_json,state) VALUES('shelf-v3','cedar','beirut','shelf',3,'{"question":"Where?","rubric":{"askedFacts":["Finished blue","Unfinished yellow"]}}','published');
      INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,language) VALUES('assignment-30','cedar','beirut','shelf-v3','worker-30','en'),('assignment-31','cedar','beirut','shelf-v3','worker-31','en');`);
  }else{seed(db);ensureRecordingSchema(db);ensureCaseMessageSchema(db);db.exec("INSERT INTO staff VALUES('audit','cedar','beirut','Synthetic Auditor','auditor',1);INSERT INTO workers(id,org_id,site_id,code,name,language,active) VALUES('worker-31','cedar','beirut','Worker 031','Synthetic Other','en',1);INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,due_at,created_at,language) VALUES('assignment-31','cedar','beirut','shelf-v3','worker-31',NULL,'2026-01-01T00:00:00.000Z','en')");}
  const q=async(sql,args=[])=>pg?db.query(sql,args):{rows:db.prepare(sql).all(...args)};
  await q("INSERT INTO site_settings(site_id,org_id,revision,primary_contact_id) VALUES('beirut','cedar',0,'maya')");
  const original=pg?await pgAnswer(pool,worker,'assignment-30',randomUUID(),'Synthetic private original'):localAnswer(db,worker,'assignment-30',randomUUID(),'Synthetic private original');
  if(pg)await processOneAssessment(pool,{assess:async()=>({outcome:'clarification',reasons:['missing_asked_fact'],evidence:[]})});
  const id=(await q(`SELECT id FROM clarifications WHERE attempt_id=${pg?'$1':'?'}`,[original.id])).rows[0].id;
  const call=(method,principal,...args)=>pg?pgCases[method](pool,principal,...args):localCases[method](db,principal,...args);
  const message=(caseId,text,principal=worker)=>pg?pgMessage(pool,principal,caseId,{requestId:randomUUID(),text}):localMessage(db,principal,caseId,{requestId:randomUUID(),text});
  const timeline=(page=1,principal=owner,caseId=id)=>pg?pgTimeline(pool,principal,caseId,{page,pageSize:10}):localTimeline(db,principal,caseId,{page,pageSize:10});
  const all=async()=>{const first=await timeline(),items=[...first.items];for(let page=2;page<=Math.ceil(first.total/10);page++)items.push(...(await timeline(page)).items);return items;};
  return {db,pool,q,id,original,call,message,timeline,all,close:()=>db.close()};
}

test('case timeline inputs reject extra fields, noncanonical pages, oversized pages and unknown cases',()=>{
  assert.deepEqual(caseTimelineInput('case-1'),{page:1,pageSize:10});
  assert.deepEqual(caseTimelineInput('case-1',{page:'2',pageSize:'10'}),{page:2,pageSize:10});
  for(const input of [null,[],{page:0},{page:5001},{page:'1e0'},{page:true},{page:' 1'},{pageSize:50},{org_id:'foreign'}])assert.throws(()=>caseTimelineInput('case-1',input));
  assert.throws(()=>caseTimelineInput('../other',{}));
});

for(const pg of [false,true])test(`${pg?'PostgreSQL':'SQLite'} timeline is scoped, metadata-only, stable paged and never invents assessment or resolution clocks`,async()=>{
  const f=await fixture(pg);try{
    const before=JSON.stringify((await f.q('SELECT * FROM attempts ORDER BY id')).rows);
    let rows=await f.all();assert.ok(rows.some(row=>row.kind==='response_received'));assert.ok(rows.some(row=>row.kind==='owner_routed'));
    assert.equal(rows.filter(row=>row.kind==='assessment_recorded').length,pg?1:0); // SQLite synchronous legacy assessments have no separate audit clock.
    assert.equal(rows.some(row=>row.kind==='resolution_recorded'),false);
    const otherWorker={...worker,principal_id:'worker-31'},help=randomUUID();
    await f.call('requestHelp',otherWorker,'assignment-31',{requestId:help,text:'Synthetic unrelated private help'});
    await f.message(help,'Synthetic unrelated conversation',otherWorker);
    await f.message(f.id,'Synthetic PRIVATE message text must not enter the timeline');
    await f.call('assignClarification',owner,f.id,{requestId:randomUUID(),ownerId:null,expectedOwnerId:'maya'});
    await f.call('resolveClarification',owner,f.id,{requestId:randomUUID(),notes:'Synthetic PRIVATE resolution text'});
    rows=await f.all();assert.equal(rows.filter(row=>row.kind==='message_received').length,1);assert.equal(rows.filter(row=>row.kind==='owner_changed').length,1);assert.equal(rows.filter(row=>row.kind==='resolution_recorded').length,1);
    assert.equal(JSON.stringify(rows).includes('PRIVATE'),false);assert.equal(JSON.stringify(rows).includes('unrelated'),false);
    for(const row of rows)assert.deepEqual(Object.keys(row).sort(),['actorName','dueAt','id','kind','occurredAt','outcome'].sort());
    const replay=await f.timeline();assert.deepEqual(checkedCaseTimeline({...replay,clientContext:context},f.id,1,context),{...replay,clientContext:context});
    assert.deepEqual(await f.timeline(1,{...owner,principal_id:'audit',role:'auditor'}),replay);
    await assert.rejects(async()=>f.timeline(1,worker),/Forbidden/);
    await assert.rejects(async()=>f.timeline(1,{...owner,principal_id:pg?'foreign':'harbor-owner',org_id:pg?'foreign':'harbor',site_id:pg?'foreign':'harbor-yard'}),/unavailable/);
    await assert.rejects(async()=>f.timeline(1,{...owner,site_id:'other'}),/Forbidden/);
    assert.equal(JSON.stringify((await f.q('SELECT * FROM attempts ORDER BY id')).rows),before);
    assert.deepEqual((await f.timeline(5000)).items,[]);
    const historicalId=randomUUID();
    await f.q(`INSERT INTO clarifications(id,org_id,${pg?'site_id,':''}assignment_id,reason,status,created_at)
      VALUES(${pg?'$1':'?'},'cedar',${pg?"'beirut',":''}'assignment-30','Synthetic historical case','open','2020-01-01T00:00:00.000Z')`,[historicalId]);
    if(pg)await domainTransaction(f.pool,'public',client=>pgRoute(client,'cedar','beirut',historicalId));else localRoute(f.db,'cedar','beirut',historicalId);
    const routed=(await f.timeline(1,owner,historicalId)).items.find(row=>row.kind==='owner_routed');
    const clock=(await f.q(`SELECT occurred_at FROM audit WHERE object_id=${pg?'$1':'?'} AND action='clarification.routed'`,[historicalId])).rows[0].occurred_at;
    assert.equal(routed.occurredAt,clock instanceof Date?clock.toISOString():clock);
    assert.notEqual(routed.occurredAt,'2020-01-01T00:00:00.000Z');
  }finally{await f.close();}
});

test('PostgreSQL timeline includes only this case repeated answers and recorded reviews, with no private reasons',async()=>{
  const f=await fixture(true);try{
    const initial=(await f.q('SELECT * FROM attempts WHERE id=$1',[f.original.id])).rows[0];
    await requestCaseRepeat(f.pool,owner,f.id,{requestId:randomUUID(),dueAt:new Date(Date.now()+3600000).toISOString()});
    const repeated=await pgAnswer(f.pool,worker,'assignment-30',randomUUID(),'Synthetic deliberate repeat');
    await saveCaseReview(f.pool,owner,f.id,{requestId:randomUUID(),kind:'disagree',reason:'Synthetic PRIVATE disagreement'});
    for(let index=0;index<13;index++)await f.message(f.id,'Synthetic PRIVATE message '+index);
    const rows=await f.all(),first=await f.timeline(),second=await f.timeline(2);
    assert.equal(first.items.length,10);assert.equal(second.items.length,10);assert.equal(new Set(rows.map(row=>row.id)).size,rows.length);
    assert.ok(rows.some(row=>row.id==='response:'+repeated.id));assert.equal(rows.filter(row=>row.kind==='response_received').length,2);
    assert.equal(rows.filter(row=>row.kind==='repeat_requested').length,1);assert.equal(rows.filter(row=>row.kind==='assessment_disputed').length,1);
    assert.equal(JSON.stringify(rows).includes('PRIVATE'),false);assert.deepEqual((await f.q('SELECT * FROM attempts WHERE id=$1',[f.original.id])).rows[0],initial);
    for(let page=1;page<=Math.ceil(first.total/10);page++)checkedCaseTimeline({...await f.timeline(page),clientContext:context},f.id,page,context);
  }finally{await f.close();}
});

test('timeline client rejects wrong scope/context, malformed states, private extras, duplicates and inconsistent paging',()=>{
  const event={id:'case:case-1',kind:'case_opened',occurredAt:'2026-10-20T12:00:00.000Z',actorName:null,outcome:null,dueAt:null},page={caseId:'case-1',page:1,pageSize:10,total:1,items:[event],clientContext:context};
  assert.deepEqual(checkedCaseTimeline(page,'case-1',1,context),page);
  assert.throws(()=>checkedCaseTimeline({...page,clientContext:'b'.repeat(64)},'case-1',1,context),error=>error.code==='session');
  for(const changed of [{...page,caseId:'other'},{...page,notes:'PRIVATE'},{...page,total:2},{...page,pageSize:20},{...page,items:[{...event,outcome:'matched'}]},
    {...page,items:[{...event,kind:'invented'}]},{...page,total:2,items:[event,event]},{...page,items:[{...event,occurredAt:'not-a-date'}]},
    {...page,items:[{...event,kind:'deadline_changed'}]}])assert.throws(()=>checkedCaseTimeline(changed,'case-1',1,context));
});

test('timeline cannot reconstruct expired audit identities or include another tenant audit pointing to this case',async()=>{
  const f=await fixture(true);try{
    const eventId=randomUUID(),foreignId=randomUUID();
    await f.q(`INSERT INTO audit(id,org_id,site_id,actor_type,actor_id,action,object_id,occurred_at)
      VALUES($1,'cedar','beirut','staff','maya','clarification.assigned',$2,clock_timestamp()-interval '40 days'),
        ($3,'foreign','foreign','staff','foreign','clarification.assigned',$2,clock_timestamp())`,[eventId,f.id,foreignId]);
    let rows=await f.all();assert.ok(rows.some(row=>row.id==='audit:'+eventId));assert.equal(rows.some(row=>row.id==='audit:'+foreignId),false);
    await saveActivityRetention(f.pool,owner,{requestId:randomUUID(),revision:0,days:30,confirmed:true});
    assert.equal(await processOneActivityPurge(f.pool),true);
    rows=await f.all();assert.equal(rows.some(row=>row.id==='audit:'+eventId),false);
    assert.deepEqual((await f.q('SELECT actor_id,object_id FROM audit WHERE id=$1',[eventId])).rows[0],{actor_id:'',object_id:''});
    await f.q("UPDATE staff SET active=false WHERE id='maya'");await assert.rejects(f.timeline(),/Forbidden/);
  }finally{await f.close();}
});
