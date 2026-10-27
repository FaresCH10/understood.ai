import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {neonRehearsalSchema,rehearseNeonDatabase} from '../server/postgres/neon-rehearsal.mjs';
import {neonTestRoles,checkNeonScopedRoles} from '../server/postgres/neon-role-check.mjs';
import {runtimeTablePolicy} from '../server/postgres/runtime-permissions.mjs';
import {domainTransaction} from '../server/postgres/domain.mjs';
const env={UNDERSTOOD_NEON_TEST_URL:'postgresql://owner:PRIVATE_PASSWORD@ep-synthetic-test.eu-central-1.aws.neon.tech/neondb?sslmode=require',UNDERSTOOD_NEON_TEST_ISOLATED:'true'};
test('Neon rehearsal schema is unique and cannot target public or an arbitrary existing schema',()=>{
  const first=neonRehearsalSchema(randomUUID()),second=neonRehearsalSchema(randomUUID());assert.notEqual(first,second);assert.match(first,/^understood_neon_test_[a-f0-9]{32}$/);
  for(const value of ['public','other_schema','../escape',undefined,'x'.repeat(100)])assert.throws(()=>neonRehearsalSchema(value));
});
test('temporary NOLOGIN role names cannot select an existing arbitrary role or schema',async()=>{
  const id=randomUUID(),roles=neonTestRoles(id);assert.equal(new Set(roles).size,2);assert.ok(roles.every(role=>role.length<=63));
  for(const value of ['postgres','pg_superuser','PUBLIC',undefined,'../escape'])assert.throws(()=>neonTestRoles(value));
  let calls=0;await assert.rejects(checkNeonScopedRoles({query(){calls++;}},{schema:'public',runId:id}));assert.equal(calls,0);
  const first=runtimeTablePolicy();first[0].writable=false;assert.equal(runtimeTablePolicy()[0].writable,true);
  assert.equal(runtimeTablePolicy().find(row=>row.table==='schema_migrations').writable,false);
});
test('Neon rehearsal stops before schema writes when isolated preflight fails',async()=>{
  let calls=0;const events=[],result=await rehearseNeonDatabase(env,{preflight:async()=>{throw Error('PRIVATE_PASSWORD');},makePool:()=>{calls++;},checkpoint:async value=>events.push(value)});
  assert.equal(calls,0);assert.equal(result.state,'failed');assert.equal(result.cleanup,'not-created');assert.doesNotMatch(JSON.stringify(events),/PRIVATE_PASSWORD/);
});
function memoryFixture({loseCommit=false,foreignMarker=false}={}){
  const db=new PGlite(),events=[],commands=[];let tail=Promise.resolve();
  // PGlite has one session; this checks orchestration, not native concurrency.
  const pool={on(){},async connect(){const previous=tail;let release;tail=new Promise(resolve=>{release=resolve;});await previous;return {query:async(sql,args)=>{
    commands.push(sql);if(foreignMarker && sql.startsWith("SELECT obj_description"))return {rows:[{marker:'Another run'}]};
    const result=args?.length?await db.query(sql,args):(await db.exec(sql)).at(-1)??{rows:[]};
    if(loseCommit && sql==='COMMIT'){loseCommit=false;throw Error('Synthetic lost creation acknowledgement');}return result;
  },release};},async query(sql,args){const client=await this.connect();try{return await client.query(sql,args);}finally{client.release();}},async end(){}};
  return {db,pool,events,commands};
}
const preflight=async()=>({passed:true,databaseWrites:0,targetFingerprint:'a'.repeat(64),postgresMajor:18});
test('Neon rehearsal uses all migrations and scoped synthetic contracts, then removes only its own schema',async()=>{
  const {db,pool,events,commands}=memoryFixture();
  try{
    const result=await rehearseNeonDatabase(env,{makePool:()=>pool,preflight,checkpoint:async value=>events.push(JSON.parse(JSON.stringify(value)))});
    assert.equal(result.state,'passed',JSON.stringify(result));assert.equal(result.migrationsApplied,113);assert.equal(result.cleanup,'verified-removed');assert.equal(result.outsideCatalogIdentitiesUnchanged,true);assert.equal(result.checks.length,8);assert.equal(result.providerCalls,0);assert.equal(result.productionVerdict,false);
    assert.equal((await db.query('SELECT 1 FROM pg_namespace WHERE nspname=$1',[result.schema])).rows.length,0);assert.ok(events.some(value=>value.phase==='schema-creation'));assert.ok(events.some(value=>value.phase==='cleanup'));
    const drops=commands.filter(sql=>/^DROP SCHEMA/.test(sql));assert.deepEqual(drops,[`DROP SCHEMA "${result.schema}" CASCADE`]);assert.doesNotMatch(JSON.stringify(events),/PRIVATE_PASSWORD|postgresql:\/\//);
    assert.equal(commands.some(sql=>/^CREATE ROLE/.test(sql)),false);
    assert.deepEqual(result.denials,{foreignKey:'23503',publication:'23514',audit:'23514',foreignReader:'unavailable'});
  }finally{await db.close();}
});
test('explicit temporary role rehearsal verifies scoped runtime permissions without accepting an assumed production login',async()=>{
  const {db,pool,events,commands}=memoryFixture();
  try{
    const result=await rehearseNeonDatabase(env,{makePool:()=>pool,preflight,temporaryNologinRoles:true,checkpoint:async value=>events.push(JSON.parse(JSON.stringify(value)))});
    assert.equal(result.state,'passed',JSON.stringify(result));assert.equal(result.roles.state,'passed');assert.equal(result.roles.cleanup,'verified-removed');assert.equal(result.cleanup,'verified-removed');assert.equal(result.roles.checks.length,5);
    assert.equal(result.roles.directLoginVerified,false);assert.equal(result.roles.databaseWidePrivilegesVerified,false);assert.equal(result.roles.outsideAclAndRolesUnchanged,true);
    assert.equal(commands.filter(sql=>/^CREATE ROLE/.test(sql)).length,2);assert.ok(commands.filter(sql=>/^CREATE ROLE/.test(sql)).every(sql=>sql.includes('NOLOGIN')));
    assert.equal(commands.filter(sql=>/^DROP ROLE/.test(sql)).length,2);
    assert.equal(commands.some(sql=>/^ALTER DEFAULT PRIVILEGES/.test(sql)||/^REVOKE.*ON DATABASE/.test(sql)),false);
    assert.equal((await db.query('SELECT 1 FROM pg_roles WHERE rolname=ANY($1::text[])',[result.roles.roles])).rows.length,0);
  }finally{await db.close();}
});
test('extended synthetic races preserve immutable earlier evidence and reject obsolete assessment completion',async()=>{
  const {db,pool,commands}=memoryFixture();
  try{
    const result=await rehearseNeonDatabase(env,{makePool:()=>pool,preflight,extendedConcurrency:true});
    assert.equal(result.state,'passed',JSON.stringify(result));assert.equal(result.cleanup,'verified-removed');assert.equal(result.concurrency.checks.length,6);
    assert.equal(result.concurrency.processDeathVerified,false);assert.equal(result.concurrency.providerCalls,0);assert.equal(result.concurrency.productionVerdict,false);
    assert.equal(result.committedCountsPhase,'after-core-assessment-before-extension');assert.equal(commands.some(sql=>/^CREATE ROLE/.test(sql)),false);
  }finally{await db.close();}
});
test('injected interruption state recovers only a pending exact job; embedded orchestration is not actual process death',async()=>{
  const {db,pool}=memoryFixture();
  try{
    const result=await rehearseNeonDatabase(env,{makePool:()=>pool,preflight,extendedConcurrency:true,interruptAssessment:async({schema,jobId})=>{
      await domainTransaction(pool,schema,client=>client.query("UPDATE assessment_jobs SET status='processing',attempts=1,lease_token=$2,lease_until=clock_timestamp()+interval '90 seconds' WHERE id=$1",[jobId,randomUUID()]));
      return {kind:'owned-process-interruption',childExited:true,processDeathVerified:true};
    }});
    assert.equal(result.state,'passed',JSON.stringify(result));assert.equal(result.concurrency.checks.length,7);assert.equal(result.concurrency.processDeathVerified,true);assert.equal(result.cleanup,'verified-removed');assert.equal(result.productionVerdict,false);
  }finally{await db.close();}
});
test('temporary role cleanup refuses an altered ownership marker or unrelated ACL change',async()=>{
  for(const change of ['marker','outside-acl']){
    const {db,pool,commands}=memoryFixture();let changed=false;
    try{
      const result=await rehearseNeonDatabase(env,{makePool:()=>pool,preflight,temporaryNologinRoles:true,checkpoint:async value=>{
        if(changed || value.roles?.phase!=='role-cleanup')return;changed=true;
        if(change==='marker')await db.exec(`COMMENT ON ROLE "${value.roles.roles[0]}" IS 'not this run'`);
        else await db.exec('REVOKE TEMPORARY ON DATABASE postgres FROM PUBLIC');
      }});
      assert.equal(changed,true);assert.equal(result.state,'failed');assert.equal(result.roles.cleanup,'refused-or-unverified');assert.equal(commands.filter(sql=>/^DROP ROLE/.test(sql)).length,0);
      assert.equal((await db.query('SELECT 1 FROM pg_roles WHERE rolname=ANY($1::text[])',[result.roles.roles])).rows.length,2);
    }finally{await db.close();}
  }
});
test('lost schema-creation acknowledgement is reconciled only through the original ownership marker',async()=>{
  const {db,pool,commands}=memoryFixture({loseCommit:true});
  try{const result=await rehearseNeonDatabase(env,{makePool:()=>pool,preflight});assert.equal(result.state,'failed');assert.equal(result.failedPhase,'schema-creation');assert.equal(result.cleanup,'verified-removed');assert.equal(commands.filter(sql=>/^CREATE SCHEMA/.test(sql)).length,1);assert.equal((await db.query('SELECT 1 FROM pg_namespace WHERE nspname=$1',[result.schema])).rows.length,0);}finally{await db.close();}
});
test('Neon cleanup refuses changed ownership or outside catalog identities without any schema drop',async()=>{
  for(const foreignMarker of [true,false]){
    const {db,pool,commands}=memoryFixture({foreignMarker});
    try{
      const result=await rehearseNeonDatabase(env,{makePool:()=>pool,preflight,checkpoint:async value=>{if(!foreignMarker && value.phase==='scope-and-immutability')await db.exec('CREATE SCHEMA outside_fixture_change');}});
      assert.equal(result.state,'failed');assert.equal(result.cleanup,'refused-scope-change');assert.equal(commands.filter(sql=>/^DROP SCHEMA/.test(sql)).length,0);assert.equal((await db.query('SELECT 1 FROM pg_namespace WHERE nspname=$1',[result.schema])).rows.length,1);
    }finally{await db.close();}
  }
});
