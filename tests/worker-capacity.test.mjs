import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {openDatabase} from '../server/db.mjs';
import {ensurePeopleSchema,createWorker,disableWorker,reenableWorker} from '../server/people.mjs';
import {createWorker as pgCreateWorker,disableWorker as pgDisableWorker,reenableWorker as pgReenableWorker} from '../server/postgres/people.mjs';
import {previewWorkerImport,confirmWorkerImport} from '../server/worker-import.mjs';
import {previewWorkerImport as pgPreviewWorkerImport,confirmWorkerImport as pgConfirmWorkerImport} from '../server/postgres/worker-import.mjs';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {assertWorkerCapacity} from '../server/entitlement-model.mjs';

const maya={principal_type:'staff',principal_id:'maya',org_id:'cedar',site_id:'beirut',role:'owner'};
const sami={principal_type:'staff',principal_id:'sami',org_id:'cedar',site_id:'tripoli',role:'owner'};
const legacyOwner={principal_type:'staff',principal_id:'legacy-owner',org_id:'legacy',site_id:'legacy-site',role:'owner'};
const upload=(text,requestId=randomUUID())=>({bytes:Buffer.from(text),filename:'workers.csv',requestId});
const capacity=/Worker capacity reached \(2 active workers\)/;

function sqliteFixture(){
  const db=openDatabase(':memory:');ensurePeopleSchema(db);
  db.exec(`INSERT INTO organizations VALUES('cedar','Cedar'),('legacy','Legacy');
    INSERT INTO sites VALUES('beirut','cedar','Beirut','UTC'),('tripoli','cedar','Tripoli','UTC'),('legacy-site','legacy','Legacy site','UTC');
    INSERT INTO staff VALUES('maya','cedar','beirut','Maya','owner',1),('sami','cedar','tripoli','Sami','owner',1),
      ('legacy-owner','legacy','legacy-site','Legacy','owner',1);`);
  const now=new Date().toISOString(),ends=new Date(Date.now()+14*86400000).toISOString();
  db.prepare(`INSERT INTO organization_entitlements VALUES('cedar','trial',?,?,2,'trial',NULL,1,'synthetic-test',?)`).run(now,ends,now);
  return db;
}
const activeWorkers=(db)=>db.prepare("SELECT COUNT(*) AS n FROM workers WHERE org_id='cedar' AND active=1").get().n;

test('worker capacity is enforced only for configured entitlements and counts requested rows',()=>{
  assert.doesNotThrow(()=>assertWorkerCapacity({workerLimit:null},1000));
  assert.doesNotThrow(()=>assertWorkerCapacity({workerLimit:25},24,1));
  assert.throws(()=>assertWorkerCapacity({workerLimit:25},25,1),/Worker capacity reached \(25 active workers\)/);
  assert.throws(()=>assertWorkerCapacity({workerLimit:25},24,2),/Worker capacity reached \(25 active workers\)/);
  assert.throws(()=>assertWorkerCapacity({workerLimit:25},0,0),/Invalid worker count/);
});

test('SQLite trial capacity is org-wide across sites for creation, reactivation and atomic imports',()=>{
  const db=sqliteFixture();
  try{
    const first=createWorker(db,maya,{code:'Cedar 001',language:'en'});
    const second=createWorker(db,sami,{code:'Cedar 002',language:'ar'});
    assert.equal(activeWorkers(db),2);
    assert.throws(()=>createWorker(db,maya,{code:'Cedar 003',language:'ur'}),capacity);
    assert.equal(activeWorkers(db),2);

    disableWorker(db,sami,second.id);
    assert.equal(createWorker(db,maya,{code:'Cedar 003',language:'ur'}).code,'Cedar 003');
    const enableSecond={requestId:randomUUID(),expectedCode:'Cedar 002',confirmed:true};
    assert.throws(()=>reenableWorker(db,sami,second.id,enableSecond),capacity);
    assert.equal(db.prepare('SELECT active FROM workers WHERE id=?').get(second.id).active,0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM directory_reactivations').get().n,0);

    disableWorker(db,maya,first.id);
    assert.equal(reenableWorker(db,sami,second.id,enableSecond).active,true);
    assert.equal(activeWorkers(db),2);

    const twoRows=previewWorkerImport(db,maya,upload('worker_id,language\nCedar 101,en\nCedar 102,ar\n'));
    assert.throws(()=>confirmWorkerImport(db,maya,twoRows.id),capacity);
    assert.equal(activeWorkers(db),2);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM workers WHERE code IN ('Cedar 101','Cedar 102')").get().n,0);

    disableWorker(db,sami,second.id);
    const oneRow=previewWorkerImport(db,maya,upload('worker_id,language\nCedar 101,en\n'));
    assert.deepEqual(confirmWorkerImport(db,maya,oneRow.id),{id:oneRow.id,status:'imported',imported:1,duplicate:false});
    assert.equal(activeWorkers(db),2);

    for(const code of ['Legacy 001','Legacy 002','Legacy 003'])createWorker(db,legacyOwner,{code,language:'en'});
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM workers WHERE org_id='legacy' AND active=1").get().n,3);
  }finally{db.close();}
});

test('PostgreSQL trial capacity matches the SQLite contract across sites, reactivation and imports',async()=>{
  const db=new PGlite();
  const pool={async connect(){return {async query(sql,values){return values?.length ? await db.query(sql,values) : (await db.exec(sql)).at(-1) || {rows:[]};},release(){}};}};
  const schema='understood_test_worker_capacity',options={schema,integrationMode:'synthetic'};
  const owner={...maya,org_id:'a',site_id:'a',principal_id:'owner'};
  const ownerB={...maya,org_id:'a',site_id:'b',principal_id:'owner-b'};
  const legacy={...maya,org_id:'legacy',site_id:'legacy-site',principal_id:'legacy-owner'};
  await db.exec(`CREATE SCHEMA ${schema}; SET search_path TO ${schema},pg_catalog`);
  await runMigrations(pool,options);
  await db.exec(`INSERT INTO organizations(id,name) VALUES('a','A'),('legacy','Legacy');
    INSERT INTO sites(id,org_id,name,timezone) VALUES('a','a','A','UTC'),('b','a','B','UTC'),('legacy-site','legacy','L','UTC');
    INSERT INTO staff(id,org_id,site_id,name,role,active) VALUES('owner','a','a','Owner','owner',true),
      ('owner-b','a','b','Owner B','owner',true),('legacy-owner','legacy','legacy-site','Legacy','owner',true);
    INSERT INTO organization_entitlements(org_id,state,started_at,ends_at,worker_limit,plan,revision,updated_by,updated_at)
      VALUES('a','trial',clock_timestamp(),clock_timestamp()+interval '14 days',2,'trial',1,'synthetic-test',clock_timestamp())`);
  const active=async()=>(await db.query("SELECT count(*)::int AS n FROM workers WHERE org_id='a' AND active=true")).rows[0].n;
  try{
    const first=await pgCreateWorker(pool,owner,{code:'Cedar 001',language:'en'},options);
    const second=await pgCreateWorker(pool,ownerB,{code:'Cedar 002',language:'ar'},options);
    assert.equal(await active(),2);
    await assert.rejects(pgCreateWorker(pool,owner,{code:'Cedar 003',language:'ur'},options),capacity);
    assert.equal(await active(),2);

    await pgDisableWorker(pool,ownerB,second.id,options);
    await pgCreateWorker(pool,owner,{code:'Cedar 003',language:'ur'},options);
    const enableSecond={requestId:randomUUID(),expectedCode:'Cedar 002',confirmed:true};
    await assert.rejects(pgReenableWorker(pool,ownerB,second.id,enableSecond,options),capacity);
    assert.equal((await db.query('SELECT active FROM workers WHERE id=$1',[second.id])).rows[0].active,false);

    await pgDisableWorker(pool,owner,first.id,options);
    assert.equal((await pgReenableWorker(pool,ownerB,second.id,enableSecond,options)).active,true);
    assert.equal(await active(),2);

    const twoRows=await pgPreviewWorkerImport(pool,owner,upload('worker_id,language\nCedar 101,en\nCedar 102,ar\n'),options);
    await assert.rejects(pgConfirmWorkerImport(pool,owner,twoRows.id,options),capacity);
    assert.equal(await active(),2);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM workers WHERE code IN ('Cedar 101','Cedar 102')")).rows[0].n,0);

    await pgDisableWorker(pool,ownerB,second.id,options);
    const oneRow=await pgPreviewWorkerImport(pool,owner,upload('worker_id,language\nCedar 101,en\n'),options);
    assert.deepEqual(await pgConfirmWorkerImport(pool,owner,oneRow.id,options),
      {id:oneRow.id,status:'imported',imported:1,duplicate:false});
    assert.equal(await active(),2);

    for(const code of ['Legacy 001','Legacy 002','Legacy 003'])await pgCreateWorker(pool,legacy,{code,language:'en'},options);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM workers WHERE org_id='legacy' AND active=true")).rows[0].n,3);
  }finally{await db.close();}
});
