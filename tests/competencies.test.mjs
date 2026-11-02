import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {openDatabase,NOW} from '../server/db.mjs';
import {seed} from '../server/seed.mjs';
import {submitAnswer} from '../server/domain.mjs';
import {competencySettingInput,competencyFilters} from '../server/competency-input.mjs';
import {saveCompetencySetting,listCompetencies,workerCompetencies,awardCompetency} from '../server/competencies.mjs';
import {saveCompetencySetting as pgSave,listCompetencies as pgList,workerCompetencies as pgWorker,awardCompetency as pgAward} from '../server/postgres/competencies.mjs';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {domainTransaction} from '../server/postgres/domain.mjs';
import {createAppServer} from '../server/index.mjs';
import {createSessionContextFetch} from './helpers/session-http.mjs';
import {principalLoginBody,seedCredentials} from './helpers/sqlite-app.mjs';

const fetch=createSessionContextFetch();
const owner={principal_type:'staff',principal_id:'maya',org_id:'cedar',site_id:'beirut',role:'owner'};
const auditor={...owner,principal_id:'auditor',role:'auditor'};
const worker1={principal_type:'worker',principal_id:'worker-1',org_id:'cedar',site_id:'beirut'};
const worker30={principal_type:'worker',principal_id:'worker-30',org_id:'cedar',site_id:'beirut'};
const foreign={...owner,principal_id:'harbor-owner',org_id:'harbor',site_id:'harbor-yard'};
const DAY=86400000,daysAgo=n=>new Date(Date.now()-n*DAY).toISOString();

test('competency inputs bound validity, filters and pages',()=>{
  for(const value of [{revision:1},{revision:0,validityDays:365},{revision:1,validityDays:0},{revision:1,validityDays:3651},
    {revision:1,validityDays:30.5},{revision:1,validityDays:'365'},{revision:1,validityDays:null,extra:true},null])
    assert.throws(()=>competencySettingInput(value),/Invalid competency setting/);
  assert.deepEqual(competencySettingInput({revision:2,validityDays:null}),{revision:2,validityDays:null});
  for(const value of [{status:'pending'},{search:'x'.repeat(81)},{page:0},{pageSize:101},{extra:1}])
    assert.throws(()=>competencyFilters(value),/Invalid competency filter/);
  assert.deepEqual(competencyFilters({search:'  Rana  '}),{status:'active',search:'Rana',page:1,pageSize:20});
});

function sqliteFixture() {
  const db=openDatabase(':memory:');
  seed(db);
  db.prepare('INSERT INTO staff VALUES(?,?,?,?,?,1)').run('auditor','cedar','beirut','Auditor','auditor');
  const snapshot=JSON.parse(db.prepare('SELECT snapshot_json FROM publications WHERE id=?').get('shelf-v3').snapshot_json);
  snapshot.competency={validityDays:365,title:'Shelf safety'};
  db.prepare('INSERT INTO publications VALUES(?,?,?,?,?,?,?,?)').run('shelf-comp','cedar','beirut','shelf',5,JSON.stringify(snapshot),NOW(),'published');
  const addAssignment=db.prepare('INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,due_at,created_at,language) VALUES(?,?,?,?,?,?,?,?)');
  const addAttempt=db.prepare('INSERT INTO attempts VALUES(?,?,?,?,?,?,?,?)');
  for(const [id,worker] of [['assignment-comp','worker-30'],['assignment-comp-audio','worker-1'],
    ['assignment-comp-exp','worker-2'],['assignment-comp-soon','worker-3'],['assignment-comp-forged','worker-4'],['assignment-comp-open','worker-5']])
    addAssignment.run(id,'cedar','beirut','shelf-comp',worker,null,NOW(),'en');
  addAttempt.run('attempt-comp-audio','cedar','assignment-comp-audio','seed-audio','Blue shelf','matched','[]',NOW());
  addAttempt.run('attempt-comp-exp','cedar','assignment-comp-exp','seed-exp','Blue shelf','matched','[]',daysAgo(400));
  addAttempt.run('attempt-comp-soon','cedar','assignment-comp-soon','seed-soon','Blue shelf','matched','[]',daysAgo(350));
  addAttempt.run('attempt-comp-open','cedar','assignment-comp-open','seed-open','Blue shelf','clarification','[]',NOW());
  return {db,snapshot,addAttempt};
}

test('SQLite competency configuration is revision-bound and award is immutable evidence',()=>{
  const {db}=sqliteFixture();
  try {
    assert.throws(()=>saveCompetencySetting(db,worker30,'shelf',{revision:1,validityDays:365}),/Forbidden/);
    assert.throws(()=>saveCompetencySetting(db,auditor,'shelf',{revision:1,validityDays:365}),/Forbidden/);
    assert.throws(()=>saveCompetencySetting(db,foreign,'shelf',{revision:1,validityDays:365}),/Briefing unavailable/);
    assert.throws(()=>saveCompetencySetting(db,owner,'missing',{revision:1,validityDays:365}),/Briefing unavailable/);
    assert.throws(()=>saveCompetencySetting(db,owner,'shelf',{revision:9,validityDays:365}),/Draft revision changed/);
    assert.deepEqual(saveCompetencySetting(db,owner,'shelf',{revision:1,validityDays:365}),{id:'shelf',revision:1,validityDays:365,unchanged:false});
    assert.equal(db.prepare('SELECT competency_validity_days FROM briefings WHERE id=?').get('shelf').competency_validity_days,365);
    assert.deepEqual(saveCompetencySetting(db,owner,'shelf',{revision:1,validityDays:365}),{id:'shelf',revision:1,validityDays:365,unchanged:true});
    assert.equal(saveCompetencySetting(db,owner,'shelf',{revision:1,validityDays:30}).unchanged,false);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action='briefing.competency_configured'").get().n,2);

    const submissionId=randomUUID();
    const typed=submitAnswer(db,worker30,'assignment-comp',submissionId,'Finished items go on the blue shelf and unfinished items on the yellow shelf.');
    assert.equal(typed.outcome,'matched');
    assert.equal(submitAnswer(db,worker30,'assignment-comp',submissionId,'Finished items go on the blue shelf and unfinished items on the yellow shelf.').duplicate,true);
    const typedAward=db.prepare('SELECT * FROM worker_competencies WHERE assignment_id=?').get('assignment-comp');
    assert.equal(typedAward.title,'Shelf safety');assert.equal(typedAward.source,'typed');assert.equal(typedAward.worker_id,'worker-30');
    assert.equal(Date.parse(typedAward.expires_at)-Date.parse(typedAward.awarded_at),365*DAY);

    assert.ok(awardCompetency(db,{orgId:'cedar',siteId:'beirut',workerId:'worker-1',assignmentId:'assignment-comp-audio',attemptId:'attempt-comp-audio',source:'audio'}));
    assert.ok(awardCompetency(db,{orgId:'cedar',siteId:'beirut',workerId:'worker-2',assignmentId:'assignment-comp-exp',attemptId:'attempt-comp-exp',source:'audio'}));
    assert.ok(awardCompetency(db,{orgId:'cedar',siteId:'beirut',workerId:'worker-3',assignmentId:'assignment-comp-soon',attemptId:'attempt-comp-soon',source:'typed'}));
    assert.equal(awardCompetency(db,{orgId:'cedar',siteId:'beirut',workerId:'worker-1',assignmentId:'assignment-comp-audio',attemptId:'attempt-comp-audio',source:'audio'}),null);
    assert.equal(awardCompetency(db,{orgId:'cedar',siteId:'beirut',workerId:'worker-1',assignmentId:'assignment-comp-open',attemptId:'attempt-comp-open',source:'typed'}),null);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM worker_competencies').get().n,4);

    assert.throws(()=>db.prepare('UPDATE worker_competencies SET title=? WHERE assignment_id=?').run('Forged','assignment-comp'),/immutable/);
    assert.throws(()=>db.prepare('DELETE FROM worker_competencies WHERE assignment_id=?').run('assignment-comp'),/immutable/);
    const forged=(id,assignmentId,attemptId,expiresAt)=>db.prepare(`INSERT INTO worker_competencies(id,org_id,site_id,worker_id,briefing_id,publication_id,assignment_id,
      attempt_id,title,language,source,awarded_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id,'cedar','beirut','worker-4','shelf','shelf-comp',assignmentId,attemptId,'Shelf safety','en','typed',NOW(),expiresAt);
    assert.throws(()=>forged(randomUUID(),'assignment-comp-forged','attempt-comp-audio',new Date(Date.now()+364*DAY).toISOString()),/Competency award is invalid/);
    assert.throws(()=>forged(randomUUID(),'assignment-comp-open','attempt-comp-open',new Date(Date.now()+365*DAY).toISOString()),/Competency award is invalid/);

    const page=listCompetencies(db,owner,{status:'all',pageSize:2});
    assert.equal(page.total,4);assert.equal(page.items.length,2);assert.deepEqual(page.counts,{active:2,expiring:1,expired:1});
    assert.deepEqual(listCompetencies(db,owner,{status:'expired'}).items.map(item=>item.workerName),['Omar Nassar']);
    assert.equal(listCompetencies(db,owner,{status:'active'}).total,2);
    assert.equal(listCompetencies(db,owner,{status:'expiring'}).total,1);
    assert.equal(listCompetencies(db,owner,{search:'Rana'}).total,1);
    assert.equal(listCompetencies(db,owner,{status:'all',search:'Shelf safety'}).total,4);
    assert.equal(listCompetencies(db,owner,{search:'%'}).total,0);
    assert.equal(listCompetencies(db,foreign).total,0);
    assert.throws(()=>listCompetencies(db,worker30),/Forbidden/);
    assert.equal(listCompetencies(db,auditor).total,2);
    assert.deepEqual(workerCompetencies(db,worker1).items.map(item=>item.workerId),['worker-1']);
    assert.equal(workerCompetencies(db,worker1).items[0].source,'audio');
    assert.throws(()=>workerCompetencies(db,owner),/Forbidden/);
  } finally { db.close(); }
});

async function pgFixture() {
  const db=new PGlite(),schema='understood_test_competencies';
  const pool={async connect(){return {async query(sql,v){return v?.length ? db.query(sql,v) : (await db.exec(sql)).at(-1) || {rows:[]};},release(){}};}};
  await db.exec(`CREATE SCHEMA ${schema};SET search_path TO ${schema},pg_catalog`);
  await runMigrations(pool,{schema});
  await db.query("INSERT INTO organizations VALUES('cedar','Cedar Works'),('harbor','Harbor')");
  await db.query("INSERT INTO sites VALUES('beirut','cedar','Beirut','Asia/Beirut'),('harbor-yard','harbor','Yard','UTC')");
  await db.query("INSERT INTO staff(id,org_id,site_id,name,role) VALUES('maya','cedar','beirut','Maya Haddad','owner'),('auditor','cedar','beirut','Auditor','auditor'),('harbor-owner','harbor','harbor-yard','Harbor','owner')");
  for(const [id,code,name] of [['worker-1','Worker 001','Rana Khoury'],['worker-2','Worker 002','Omar Nassar'],['worker-3','Worker 003','Lina Haddad'],['worker-4','Worker 004','Yusuf Karim'],['worker-5','Worker 005','Mariam Saleh']])
    await db.query('INSERT INTO workers(id,org_id,site_id,code,name,language) VALUES($1,$2,$3,$4,$5,$6)',[id,'cedar','beirut',code,name,'en']);
  const briefingId='brief-comp';
  await db.query("INSERT INTO briefings(id,org_id,site_id,title,source,state) VALUES($1,'cedar','beirut','Shelf handover','Put items on shelves.','ready')",[briefingId]);
  const snapshot={title:'Shelf handover',source:'Put items on shelves.',languages:{en:{title:'Shelf handover',text:'Put items on the blue shelf.',question:'Where?'}},competency:{validityDays:365,title:'Shelf safety'}};
  const tx=fn=>domainTransaction(pool,schema,fn);
  await db.query("INSERT INTO publications(id,org_id,site_id,briefing_id,version,snapshot_json,state) VALUES('pub-comp','cedar','beirut',$1,1,$2,'published')",[briefingId,JSON.stringify(snapshot)]);
  const addAssignment=(id,worker)=>db.query("INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,language) VALUES($1,'cedar','beirut','pub-comp',$2,'en')",[id,worker]);
  const addAttempt=(id,assignmentId,days,outcome='matched')=>db.query("INSERT INTO attempts(id,org_id,site_id,assignment_id,submission_id,answer_text,outcome,reasons_json,received_at) VALUES($1,'cedar','beirut',$2,$3,'Blue shelf',$4,'[]',now()-make_interval(days=>$5))",
    [id,assignmentId,`seed-${id}`,outcome,days]);
  await addAssignment('assignment-comp','worker-1');
  await addAssignment('assignment-comp-exp','worker-2');
  await addAssignment('assignment-comp-soon','worker-3');
  await addAssignment('assignment-comp-forged','worker-4');
  await addAssignment('assignment-comp-open','worker-5');
  await addAttempt('attempt-comp','assignment-comp',0);
  await addAttempt('attempt-comp-exp','assignment-comp-exp',400);
  await addAttempt('attempt-comp-soon','assignment-comp-soon',350);
  await addAttempt('attempt-comp-open','assignment-comp-open',0,'clarification');
  return {db,pool,schema,tx,worker1,worker30};
}

test('PostgreSQL competency settings, awards and expiry statuses match SQLite',async()=>{
  const f=await pgFixture();
  const {db,pool,schema,tx}=f;
  try {
    assert.throws(()=>competencySettingInput({revision:1,validityDays:4000}),/Invalid competency setting/);
    assert.deepEqual(await pgSave(pool,owner,'brief-comp',{revision:1,validityDays:365},{schema}),{id:'brief-comp',revision:1,validityDays:365,unchanged:false});
    assert.equal((await pgSave(pool,owner,'brief-comp',{revision:1,validityDays:365},{schema})).unchanged,true);
    await assert.rejects(pgSave(pool,owner,'brief-comp',{revision:2,validityDays:365},{schema}),/Draft revision changed/);
    await assert.rejects(pgSave(pool,foreign,'brief-comp',{revision:1,validityDays:365},{schema}),/Briefing unavailable/);
    await assert.rejects(pgSave(pool,{...owner,principal_id:'worker-1',principal_type:'worker'},'brief-comp',{revision:1,validityDays:365},{schema}),/Forbidden/);

    for(const [assignmentId,attemptId,workerId,source] of [['assignment-comp','attempt-comp','worker-1','typed'],
      ['assignment-comp-exp','attempt-comp-exp','worker-2','audio'],['assignment-comp-soon','attempt-comp-soon','worker-3','typed']])
      assert.ok(await tx(client=>pgAward(client,{orgId:'cedar',siteId:'beirut',workerId,assignmentId,attemptId,source})));
    assert.equal(await tx(client=>pgAward(client,{orgId:'cedar',siteId:'beirut',workerId:'worker-1',assignmentId:'assignment-comp',attemptId:'attempt-comp',source:'typed'})),null);
    assert.equal(await tx(client=>pgAward(client,{orgId:'cedar',siteId:'beirut',workerId:'worker-5',assignmentId:'assignment-comp-open',attemptId:'attempt-comp-open',source:'typed'})),null);
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM worker_competencies')).rows[0].n,3);

    await assert.rejects(db.query("UPDATE worker_competencies SET title='Forged'"),/immutable/);
    await assert.rejects(db.query('DELETE FROM worker_competencies'),/immutable/);
    await assert.rejects(db.query(`INSERT INTO worker_competencies(id,org_id,site_id,worker_id,briefing_id,publication_id,assignment_id,attempt_id,
      title,language,source,awarded_at,expires_at)
      SELECT 'forged',org_id,site_id,worker_id,briefing_id,publication_id,assignment_id,attempt_id,title,language,source,awarded_at,awarded_at+interval '364 days'
      FROM worker_competencies LIMIT 1`),/Competency award is invalid/);
    await assert.rejects(db.query(`INSERT INTO worker_competencies(id,org_id,site_id,worker_id,briefing_id,publication_id,assignment_id,attempt_id,
      title,language,source,awarded_at,expires_at)
      VALUES('forged-open','cedar','beirut','worker-5','brief-comp','pub-comp','assignment-comp-open','attempt-comp-open','Shelf safety','en','typed',now(),now()+interval '365 days')`),/Competency award is invalid/);

    const all=await pgList(pool,owner,{status:'all',pageSize:2},{schema});
    assert.equal(all.total,3);assert.equal(all.items.length,2);assert.deepEqual(all.counts,{active:1,expiring:1,expired:1});
    const expired=await pgList(pool,owner,{status:'expired'},{schema});
    assert.deepEqual(expired.items.map(item=>item.workerName),['Omar Nassar']);
    assert.equal((await pgList(pool,owner,{status:'active'},{schema})).total,1);
    assert.equal((await pgList(pool,owner,{status:'expiring'},{schema})).total,1);
    assert.equal((await pgList(pool,owner,{search:'Rana'},{schema})).total,1);
    assert.equal((await pgList(pool,owner,{search:'%'},{schema})).total,0);
    assert.equal((await pgList(pool,foreign,{},{schema})).total,0);
    await assert.rejects(pgList(pool,{...owner,principal_type:'worker'},{},{schema}),/Forbidden/);
    assert.equal((await pgList(pool,auditor,{},{schema})).total,1);
    const own=await pgWorker(pool,{...worker1},{schema});
    assert.deepEqual(own.items.map(item=>item.workerId),['worker-1']);
    assert.equal(new Date(own.items[0].expiresAt)-new Date(own.items[0].awardedAt),365*DAY);
    await assert.rejects(pgWorker(pool,owner,{schema}),/Forbidden/);
  } finally { await db.close(); }
});

test('competency HTTP endpoints configure, list and expose only the worker’s own awards',async()=>{
  const db=openDatabase(':memory:');
  const app=createAppServer(db,{tier:'local',aiMode:'synthetic',accessMode:'credential',publicOrigin:'http://127.0.0.1:3020'});
  seedCredentials(db);
  await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${app.address().port}`;
  try {
    const login=await fetch(`${base}/api/auth/staff/login`,{method:'POST',headers:{'content-type':'application/json',origin:'http://127.0.0.1:3020'},body:JSON.stringify(principalLoginBody('maya'))});
    assert.equal(login.status,200);
    const cookie=login.headers.get('set-cookie').split(';')[0];
    let response=await fetch(`${base}/api/briefings/shelf/competency`,{method:'POST',headers:{cookie,'content-type':'application/json',origin:'http://127.0.0.1:3020'},body:JSON.stringify({revision:1,validityDays:180})});
    assert.equal(response.status,200);assert.equal((await response.json()).validityDays,180);
    response=await fetch(`${base}/api/briefings/shelf/competency`,{method:'POST',headers:{cookie,'content-type':'application/json',origin:'http://127.0.0.1:3020'},body:JSON.stringify({revision:1,validityDays:4000})});
    assert.equal(response.status,400);assert.equal((await response.json()).error,'Invalid competency setting');
    response=await fetch(`${base}/api/competencies?status=all`,{headers:{cookie}});
    assert.equal(response.status,200);assert.equal((await response.json()).total,0);

    const snapshot=JSON.parse(db.prepare('SELECT snapshot_json FROM publications WHERE id=?').get('shelf-v3').snapshot_json);
    snapshot.competency={validityDays:180,title:'Shelf safety'};
    db.prepare('INSERT INTO publications VALUES(?,?,?,?,?,?,?,?)').run('shelf-http','cedar','beirut','shelf',6,JSON.stringify(snapshot),NOW(),'published');
    db.prepare('INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,due_at,created_at,language) VALUES(?,?,?,?,?,?,?,?)').run('assignment-http','cedar','beirut','shelf-http','worker-1',null,NOW(),'en');
    db.prepare('INSERT INTO attempts VALUES(?,?,?,?,?,?,?,?)').run('attempt-http','cedar','assignment-http','seed-http','Blue shelf','matched','[]',NOW());
    awardCompetency(db,{orgId:'cedar',siteId:'beirut',workerId:'worker-1',assignmentId:'assignment-http',attemptId:'attempt-http',source:'typed'});

    response=await fetch(`${base}/api/competencies?status=active`,{headers:{cookie}});
    const staffList=await response.json();
    assert.equal(staffList.total,1);assert.equal(staffList.items[0].title,'Shelf safety');assert.equal(staffList.items[0].workerName,'Rana Khoury');

    const workerLogin=await fetch(`${base}/api/auth/worker/login`,{method:'POST',headers:{'content-type':'application/json',origin:'http://127.0.0.1:3020'},body:JSON.stringify(principalLoginBody('worker-1'))});
    assert.equal(workerLogin.status,200);
    const workerCookie=workerLogin.headers.get('set-cookie').split(';')[0];
    response=await fetch(`${base}/api/worker/competencies`,{headers:{cookie:workerCookie}});
    const mine=await response.json();
    assert.equal(mine.items.length,1);assert.equal(mine.items[0].briefingId,'shelf');
    response=await fetch(`${base}/api/worker/competencies?status=active`,{headers:{cookie:workerCookie}});
    assert.equal(response.status,400);
    response=await fetch(`${base}/api/competencies`,{headers:{cookie:workerCookie}});
    assert.equal(response.status,403);
  } finally {
    await new Promise(resolve=>app.close(resolve));
    db.close();
  }
});
