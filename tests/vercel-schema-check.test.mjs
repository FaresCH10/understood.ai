import test from 'node:test';
import assert from 'node:assert/strict';
import {rootCertificates} from 'node:tls';
import {checkVercelSchema} from '../scripts/vercel-schema-check.mjs';
test('hosted builds require the database while ordinary local builds can skip the check',async()=>{
  await assert.rejects(checkVercelSchema({env:{VERCEL:'1'},log:()=>{}}),/DATABASE_URL is required/);
  assert.equal(await checkVercelSchema({env:{},log:()=>{}}),null);
});
test('schema mismatches fail a release and close the connection without applying migrations',async()=>{
  let closed=0;
  await assert.rejects(checkVercelSchema({env:{DATABASE_URL:'private-test-connection'},createPool:async()=>({end:async()=>closed++}),verify:async()=>{throw Error('PostgreSQL schema migrations are not current');},log:()=>{}}),/not current/);
  assert.equal(closed,1);
});
test('verified schema reports its count and closes the connection',async()=>{
  let closed=false;
  const result=await checkVercelSchema({env:{DATABASE_URL:'private-test-connection',UNDERSTOOD_POSTGRES_SCHEMA:'understood'},createPool:async options=>{assert.equal(options.tls,true);return {end:async()=>{closed=true;}};},verify:async(_pool,{schema})=>({schema,migrations:122}),log:()=>{}});
  assert.deepEqual(result,{schema:'understood',migrations:122});assert.equal(closed,true);
});

test('production verifies the runtime database and portable CA without a demo URL',async()=>{
  const env={VERCEL:'1',UNDERSTOOD_TIER:'production',UNDERSTOOD_POSTGRES_URL:'production-fixture',
    UNDERSTOOD_POSTGRES_SCHEMA:'understood_prod_customer',UNDERSTOOD_POSTGRES_CA_PEM:rootCertificates[0]};
  const pool={end:async()=>{}};
  for(const databaseUrl of [undefined,'demo-fixture']) {
    await checkVercelSchema({env:{...env,DATABASE_URL:databaseUrl},createPool:async options=>{
      assert.equal(options.connectionString,env.UNDERSTOOD_POSTGRES_URL);
      assert.equal(options.caPem,env.UNDERSTOOD_POSTGRES_CA_PEM);
      assert.equal(options.tls,true);
      return pool;
    },verify:async(connection,{schema})=>{assert.equal(connection,pool);assert.equal(schema,env.UNDERSTOOD_POSTGRES_SCHEMA);return {migrations:1};},log:()=>{}});
  }
  await assert.rejects(checkVercelSchema({env:{...env,DATABASE_URL:'demo-fixture',UNDERSTOOD_POSTGRES_URL:''}}),/UNDERSTOOD_POSTGRES_URL is required/);
  await assert.rejects(checkVercelSchema({env:{VERCEL:'1',UNDERSTOOD_AI_MODE:'live',DATABASE_URL:'demo-fixture'}}),/approved production runtime/);
  await assert.rejects(checkVercelSchema({env:{...env,UNDERSTOOD_POSTGRES_CA_PEM:'invalid'}}),/Invalid Vercel PostgreSQL CA/);
});
