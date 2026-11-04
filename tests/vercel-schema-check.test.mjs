import test from 'node:test';
import assert from 'node:assert/strict';
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
