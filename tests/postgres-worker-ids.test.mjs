import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {listWorkers,createWorker,readWorkerIdSettings,updateWorkerIdPrefix} from '../server/postgres/people.mjs';

const schema='understood_test_worker_ids';
const options={schema};
const owner={principal_type:'staff',principal_id:'owner',org_id:'a',site_id:'a',role:'owner'};
const supervisor={...owner,principal_id:'supervisor',role:'supervisor'};
const other={principal_type:'staff',principal_id:'other',org_id:'b',site_id:'b',role:'owner'};

async function fixture() {
  const db=new PGlite();
  const client={async query(sql,values){return values?.length ? await db.query(sql,values) : (await db.exec(sql)).at(-1) || {rows:[]};},release(){}};
  const pool={async connect(){return client;}};
  await db.exec(`CREATE SCHEMA ${schema}; SET search_path TO ${schema},pg_catalog`);
  await runMigrations(pool,options);
  await db.query("INSERT INTO organizations(id,name) VALUES ('a','Stark Industry'),('b','Helton Park')");
  await db.query("INSERT INTO sites(id,org_id,name,timezone) VALUES ('a','a','A','UTC'),('b','b','B','UTC')");
  await db.query("INSERT INTO staff(id,org_id,site_id,name,role) VALUES ('owner','a','a','Owner','owner'),('supervisor','a','a','Supervisor','supervisor'),('other','b','b','Other','owner')");
  await db.query("INSERT INTO workers(id,org_id,site_id,code,language) VALUES ('demo','a','a','Worker 001','en')");
  return {db,pool};
}

test('PostgreSQL numbers worker IDs per company and restricts prefix edits to owners',async()=>{
  const {db,pool}=await fixture();
  try {
    assert.deepEqual(await readWorkerIdSettings(pool,owner,options),{prefix:'ST',suggestedPrefix:'ST',format:'ST-001',nextCode:'ST-001',canEdit:true});
    assert.equal((await createWorker(pool,owner,{password:'Stark-Demo-Pass-1'},options)).code,'ST-001');
    assert.equal((await createWorker(pool,owner,{code:'',password:'Stark-Demo-Pass-2'},options)).code,'ST-002');
    assert.equal((await createWorker(pool,owner,{code:'ST-004',password:'Stark-Demo-Pass-3'},options)).code,'ST-004');
    assert.equal((await readWorkerIdSettings(pool,owner,options)).nextCode,'ST-005');
    assert.equal((await readWorkerIdSettings(pool,other,options)).nextCode,'HE-001');
    assert.equal((await readWorkerIdSettings(pool,supervisor,options)).canEdit,false);
    await assert.rejects(updateWorkerIdPrefix(pool,supervisor,{prefix:'HT'},options),/Forbidden/);
    await assert.rejects(updateWorkerIdPrefix(pool,owner,{prefix:'H'},options),/Invalid worker ID prefix/);
    assert.equal((await updateWorkerIdPrefix(pool,owner,{prefix:'ht'},options)).nextCode,'HT-001');
    assert.equal((await createWorker(pool,owner,{password:'Stark-Demo-Pass-4'},options)).code,'HT-001');
    assert.equal((await readWorkerIdSettings(pool,owner,options)).suggestedPrefix,'ST');
    const codes=(await listWorkers(pool,owner,{pageSize:100},options)).items.map(worker=>worker.code);
    assert.ok(codes.includes('Worker 001'));
    assert.ok(codes.includes('HT-001'));
    assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM audit WHERE action='organization.worker_prefix_updated'")).rows[0].n,1);
  } finally {await db.close();}
});
