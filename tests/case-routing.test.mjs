import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {openDatabase,transaction} from '../server/db.mjs';
import {seed} from '../server/seed.mjs';
import {ensureClarificationSchema,requestHelp,assignClarification,resolveClarification,getClarification,workerHelpCases,workerHelpHistory} from '../server/clarifications.mjs';
import * as pgCases from '../server/postgres/clarifications.mjs';
import {ensureCaseRoutingSchema,routeNewCase,processOneCaseEscalation} from '../server/case-routing.mjs';
import * as pgRouting from '../server/postgres/case-routing.mjs';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {domainTransaction} from '../server/postgres/domain.mjs';
import {ensureRecordingSchema} from '../server/recordings.mjs';

const owner={principal_type:'staff',principal_id:'maya',org_id:'cedar',site_id:'beirut',role:'owner'};
const worker={principal_type:'worker',principal_id:'worker-30',org_id:'cedar',site_id:'beirut'};
async function fixture(pg) {
  const options={schema:'understood_test_case_routing'};let db,pool;
  if(pg) {
    db=new PGlite();pool={async connect(){return {query:async(sql,values)=>values?.length?db.query(sql,values):(await db.exec(sql)).at(-1)??{rows:[]},release(){}};}};
    await db.exec(`CREATE SCHEMA ${options.schema};SET search_path TO ${options.schema},pg_catalog`);await runMigrations(pool,options);
    await db.exec(`INSERT INTO organizations VALUES('cedar','Cedar');INSERT INTO sites VALUES('beirut','cedar','Beirut','UTC');
      INSERT INTO staff(id,org_id,site_id,name,role) VALUES('maya','cedar','beirut','Owner','owner');
      INSERT INTO workers(id,org_id,site_id,code,language) VALUES('worker-30','cedar','beirut','Worker 030','en');
      INSERT INTO briefings(id,org_id,site_id,title,source,state) VALUES('shelf','cedar','beirut','Shelf','Synthetic source','draft');
      INSERT INTO publications(id,org_id,site_id,briefing_id,version,snapshot_json,state) VALUES('shelf-v3','cedar','beirut','shelf',3,'{"title":"Shelf","question":"Where?","facts":["Synthetic fact"]}','published');
      INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,language) VALUES('assignment-30','cedar','beirut','shelf-v3','worker-30','en');`);
  }else{db=openDatabase(':memory:');seed(db);ensureRecordingSchema(db);ensureClarificationSchema(db);ensureCaseRoutingSchema(db);}
  const q=async(sql,args=[])=>pg?db.query(sql,args):{rows:db.prepare(sql).all(...args)};
  await q(`INSERT INTO staff(id,org_id,site_id,name,role) VALUES('routing-deputy','cedar','beirut','Deputy','supervisor'),('routing-manual','cedar','beirut','Manual','supervisor')`);
  await q(`INSERT INTO site_settings(site_id,org_id,revision,primary_contact_id,deputy_contact_id) VALUES('beirut','cedar',0,'maya','routing-deputy')`);
  const call=(name,...args)=>pg?pgCases[name](pool,...args,options):({requestHelp,assignClarification,resolveClarification,getClarification,workerHelpCases,workerHelpHistory})[name](db,...args);
  const escalate=()=>pg?pgRouting.processOneCaseEscalation(pool,options):processOneCaseEscalation(db);
  const past=async()=>{
    const id=randomUUID(),created=new Date(Date.now()-25*3600000).toISOString();
    if(pg)await domainTransaction(pool,options.schema,async client=>{
      await client.query(`INSERT INTO clarifications(id,org_id,site_id,assignment_id,reason,status,created_at) VALUES($1,'cedar','beirut','assignment-30','Synthetic case','open',$2)`,[id,created]);
      await pgRouting.routeNewCase(client,'cedar','beirut',id);
    });else transaction(db,()=>{
      db.prepare("INSERT INTO clarifications VALUES(?,'cedar','assignment-30',NULL,'Synthetic case',NULL,'open','',?)").run(id,created);routeNewCase(db,'cedar','beirut',id);
    });return id;
  };
  return {db,q,call,escalate,past,p:n=>pg?`$${n}`:'?',close:()=>db.close()};
}

for(const pg of [false,true])test(`${pg?'PostgreSQL':'SQLite'} worker Help history pages every own case beyond the old100-row limit without changing evidence or leaking notes`,async()=>{
  const f=await fixture(pg);try{
    const ids=[];
    for(let i=0;i<7;i++){
      const id=randomUUID();ids.push(id);await f.call('requestHelp',worker,'assignment-30',{requestId:id,text:`Synthetic independent help ${i}`});
      if(i<6)await f.call('resolveClarification',owner,id,{notes:i===0?'Private synthetic supervisor notes':`Synthetic resolution ${i}`});
    }
    for(let i=0;i<101;i++)await f.q(`INSERT INTO clarifications(id,org_id,${pg?'site_id,':''}assignment_id,reason,status,notes,created_at)
      VALUES(${f.p(1)},'cedar',${pg?"'beirut',":''}'assignment-30','Synthetic historical follow-up','open','Private historical notes',${f.p(2)})`,[randomUUID(),'2026-01-01T00:00:00.000Z']);
    const inventory=async()=>Promise.all(['clarifications','help_requests','case_routing','attempts','audit','submission_receipts'].map(async table=>(await f.q(`SELECT * FROM ${table} ORDER BY 1`)).rows));
    const before=await inventory(),found=[];
    for(let page=1;page<=22;page++){
      const value=await f.call('workerHelpHistory',worker,'assignment-30',{page,pageSize:5});
      assert.deepEqual({...value.assignment},{id:'assignment-30',version:3,language:pg?'en':'ur',state:'published'});
      assert.equal(value.total,108);assert.equal(value.page,page);assert.equal(value.pageSize,5);assert.equal(value.cases.length,page===22?3:5);
      for(const row of value.cases){assert.deepEqual(Object.keys(row).sort(),['createdAt','helpText','id','owner','status']);found.push(row.id);}
      assert.ok(!JSON.stringify(value).includes('Private'));
    }
    assert.equal(new Set(found).size,108);assert.ok(ids.every(id=>found.includes(id)));
    assert.deepEqual((await f.call('workerHelpHistory',worker,'assignment-30',{page:5000})).cases,[]);
    for(const filters of [{page:0},{page:5001},{page:true},{page:[]},{page:'1e0'},{pageSize:50},{workerId:'another'},{version:4}])
      await assert.rejects(async()=>f.call('workerHelpHistory',worker,'assignment-30',filters),/Invalid help history/);
    await assert.rejects(async()=>f.call('workerHelpHistory',{...worker,principal_id:'another'},'assignment-30',{}),/Forbidden|unavailable/);
    await assert.rejects(async()=>f.call('workerHelpHistory',owner,'assignment-30',{}),/Forbidden/);
    assert.deepEqual(await inventory(),before);
  }finally{await f.close();}
});

for(const pg of [false,true])test(`${pg?'PostgreSQL':'SQLite'} cases route once, keep independent deadlines and escalate atomically without changing original evidence`,async()=>{
  const f=await fixture(pg);
  try {
    const body={requestId:randomUUID(),text:'Synthetic help with the second shelf.'};
    const initial=await f.q('SELECT COUNT(*) AS n FROM submission_receipts');
    const first=await f.call('requestHelp',worker,'assignment-30',body),detail=await f.call('getClarification',owner,first.id);
    assert.equal(detail.owner_staff_id,'maya');assert.equal(Date.parse(detail.case_due_at)-Date.parse(detail.created_at),86400000);
    assert.equal((await f.call('requestHelp',worker,'assignment-30',body)).duplicate,true);
    assert.equal((await f.q('SELECT COUNT(*) AS n FROM case_routing')).rows[0].n,1);
    assert.deepEqual((await f.q('SELECT COUNT(*) AS n FROM submission_receipts')).rows,initial.rows);
    const own=(await f.call('workerHelpCases',worker,'assignment-30')).find(row=>row.id===first.id);assert.equal(own.owner,pg?'Owner':'Maya Haddad');assert.equal(Object.hasOwn(own,'notes'),false);
    assert.equal(await f.escalate(),false);
    const old=await f.past(),before=(await f.q(`SELECT reason,attempt_id,notes FROM clarifications WHERE id=${f.p(1)}`,[old])).rows;
    if(pg)await f.db.exec("CREATE FUNCTION fail_escalation_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='clarification.escalated' THEN RAISE EXCEPTION 'Audit failure'; END IF; RETURN NEW; END $$;CREATE TRIGGER fail_escalation_audit BEFORE INSERT ON audit FOR EACH ROW EXECUTE FUNCTION fail_escalation_audit()");
    else f.db.exec("CREATE TRIGGER fail_escalation_audit BEFORE INSERT ON audit WHEN NEW.action='clarification.escalated' BEGIN SELECT RAISE(ABORT,'Audit failure'); END");
    await assert.rejects(async()=>f.escalate(),/Audit failure/);assert.equal((await f.call('getClarification',owner,old)).owner_staff_id,'maya');
    if(pg)await f.db.exec('DROP TRIGGER fail_escalation_audit ON audit');else f.db.exec('DROP TRIGGER fail_escalation_audit');
    assert.equal(await f.escalate(),true);assert.equal(await f.escalate(),false);
    const after=await f.call('getClarification',owner,old);assert.equal(after.owner_staff_id,'routing-deputy');assert.ok(after.escalated_at);
    assert.deepEqual((await f.q(`SELECT reason,attempt_id,notes FROM clarifications WHERE id=${f.p(1)}`,[old])).rows,before);
    assert.equal((await f.q("SELECT COUNT(*) AS n FROM audit WHERE action='clarification.escalated'")).rows[0].n,1);
    await assert.rejects(f.q('UPDATE case_routing SET due_at=created_at'),/immutable/);
  }finally{await f.close();}
});

for(const pg of [false,true])test(`${pg?'PostgreSQL':'SQLite'} escalation respects manual owners, resolution, unavailable contacts, worker deletion and operator pause`,async()=>{
  const f=await fixture(pg);
  try {
    const manual=await f.past();await f.call('assignClarification',owner,manual,{ownerId:'routing-manual'});await f.call('assignClarification',owner,manual,{ownerId:'maya'});
    const resolved=await f.past();await f.call('resolveClarification',owner,resolved,{notes:'Synthetic in-person resolution.'});
    assert.equal(await f.escalate(),false);
    const deleted=await f.past();await f.q(`UPDATE workers SET active=${pg?'false':'0'} WHERE id='worker-30'`);assert.equal(await f.escalate(),false);
    await f.q(`UPDATE workers SET active=${pg?'true':'1'} WHERE id='worker-30'`);
    await f.q(`UPDATE staff SET active=${pg?'false':'0'} WHERE id='routing-deputy'`);assert.equal(await f.escalate(),false);
    await f.q(`UPDATE staff SET active=${pg?'true':'1'} WHERE id='routing-deputy'`);
    if(pg){await f.q("INSERT INTO tenant_controls(org_id,revision,state,reason) VALUES('cedar',1,'suspended','pilot_review')");assert.equal(await f.escalate(),false);await f.q("UPDATE tenant_controls SET state='active' WHERE org_id='cedar'");}
    assert.equal(await f.escalate(),true);assert.equal((await f.call('getClarification',owner,deleted)).owner_staff_id,'routing-deputy');
    await f.q(`UPDATE staff SET active=${pg?'false':'0'} WHERE id='maya'`);
    const fallback=await f.past();assert.equal((await f.q(`SELECT routed_owner_id FROM case_routing WHERE case_id=${f.p(1)}`,[fallback])).rows[0].routed_owner_id,'routing-deputy');
    assert.equal(await f.escalate(),false);
  }finally{await f.close();}
});
