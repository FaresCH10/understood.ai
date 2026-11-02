import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {getUsage} from '../server/postgres/usage.mjs';
import {checkedUsageModel} from '../src/usage-state.ts';

test('customer usage reports own UTC reservation evidence, closed/pause/exhausted states and reset without leaking global/private operation data',async()=>{
  const db=new PGlite(),schema='understood_test_usage_allowance';
  const pool={async connect(){return {query:async(sql,args)=>args?.length?db.query(sql,args):(await db.exec(sql)).at(-1)||{rows:[]},release(){}};}};
  const session={principal_type:'staff',principal_id:'owner',org_id:'org',site_id:'site',role:'owner'};
  try{
    await db.exec(`CREATE SCHEMA ${schema};SET search_path TO ${schema},pg_catalog`);await runMigrations(pool,{schema});
    await db.exec("INSERT INTO organizations VALUES('org','Org'),('foreign','Other');INSERT INTO sites VALUES('site','org','Site','Asia/Beirut');INSERT INTO staff(id,org_id,site_id,name,role) VALUES('owner','org','site','Owner','owner');");
    const read=async()=>checkedUsageModel(await getUsage(pool,session,{schema}),'synthetic-credential','owner');let value=await read();assert.equal(value.providerAllowance.state,'closed');assert.equal(value.providerAllowance.limit,0);assert.equal(value.spend.actual.amount,null);
    await db.exec("INSERT INTO provider_policies(scope_key,org_id,revision,enabled,max_daily_requests) VALUES('global',NULL,1,true,10),('tenant:org','org',1,true,5);");
    await db.exec(`INSERT INTO provider_operations(id,org_id,kind,reference_id,claim_token,model,data_class,reserved_requests,quota_day,input_hash,provenance_json)
      SELECT id,org_id,'source-transcription',reference_id,'PRIVATE_CLAIM','private-model','synthetic',reserved,(clock_timestamp() AT TIME ZONE 'UTC')::date-days,
        repeat('a',64),'{"model":"private-model","dataClass":"synthetic","adapter":"fixture","promptVersion":"v1","schemaVersion":"v1"}'::jsonb
      FROM (VALUES('own','org','PRIVATE_REFERENCE',3,0),('other','foreign','FOREIGN_PRIVATE_REFERENCE',6,0),('yesterday','org','OLD_PRIVATE_REFERENCE',4,1)) AS fixture(id,org_id,reference_id,reserved,days)`);
    await db.exec("INSERT INTO provider_requests(id,operation_id,sequence,cleanup,state,http_status,finished_at) VALUES('accepted','own',1,false,'accepted',200,clock_timestamp()),('uncertain','own',2,false,'uncertain',NULL,clock_timestamp()),('foreign-request','other',1,false,'accepted',200,clock_timestamp());");
    value=await read();const allowance=value.providerAllowance;
    assert.equal(value.controls.quota.state,'enforced');assert.equal(value.controls.pause.state,'operator_managed');
    assert.equal(allowance.state,'available');assert.equal(allowance.reserved,3);assert.equal(allowance.remaining,2);assert.deepEqual(allowance.requests,{started:0,accepted:1,rejected:0,uncertain:1});
    assert.equal(Date.parse(allowance.resetsAt)-Date.parse(`${allowance.day}T00:00:00.000Z`),86400000);assert.equal(allowance.timezone,'UTC');assert.equal(allowance.billingVerified,false);
    assert.doesNotMatch(JSON.stringify(value),/PRIVATE|private-model|foreign|claim_token|input_hash|scope_key/);
    assert.doesNotMatch(JSON.stringify(allowance),/global/);
    await db.exec("INSERT INTO system_controls VALUES('global',1,false,true,clock_timestamp())");assert.equal((await read()).providerAllowance.reason,'provider_paused');
    await db.exec("UPDATE system_controls SET jobs_paused=true");assert.equal((await read()).providerAllowance.reason,'jobs_paused');
    await db.exec("UPDATE system_controls SET jobs_paused=false,provider_paused=false;UPDATE provider_policies SET max_daily_requests=9 WHERE scope_key='global'");assert.equal((await read()).providerAllowance.state,'exhausted');
    await db.exec("UPDATE provider_policies SET enabled=false WHERE scope_key='tenant:org'");assert.equal((await read()).providerAllowance.state,'closed');
    const live=checkedUsageModel(await getUsage(pool,session,{schema,integrationMode:'live'}),'live-credential','owner');
    assert.equal(live.providerAllowance.dataClass,'real');assert.equal(live.providerAllowance.reserved,3);assert.equal(live.spend.actual.amount,null);
    assert.throws(()=>checkedUsageModel(live,'synthetic-credential','owner'));
    await assert.rejects(getUsage(pool,{...session,org_id:'foreign'},{schema}),/Forbidden/);await assert.rejects(getUsage(pool,{...session,principal_type:'worker'},{schema}),/Forbidden/);
    await db.exec("UPDATE staff SET active=false WHERE id='owner'");await assert.rejects(read(),/Forbidden/);
  }finally{await db.close();}
});
