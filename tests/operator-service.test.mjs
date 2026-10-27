import test from 'node:test';
import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {hostedSyntheticConfig} from '../server/postgres/hosted-config.mjs';
import {createPostgresOperatorServer} from '../server/postgres/operator-http.mjs';
import {createPostgresHostedServer} from '../server/postgres/http.mjs';
import {startHostedApi} from '../server/postgres/hosted-runtime.mjs';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {domainTransaction} from '../server/postgres/domain.mjs';
import {provisionOperator} from '../server/postgres/operators.mjs';
import {provisionStaffCredential,authenticateStaff} from '../server/postgres/auth.mjs';
import {verifyRuntimePermissions} from '../server/postgres/runtime-permissions.mjs';

const origin='https://operations.example.test',customerOrigin='https://customer.example.test';
const env={UNDERSTOOD_TIER:'staging',UNDERSTOOD_AI_MODE:'synthetic',UNDERSTOOD_ACCESS_MODE:'credential',UNDERSTOOD_DATA_CLASS:'synthetic',
  UNDERSTOOD_PUBLIC_ORIGIN:origin,UNDERSTOOD_CUSTOMER_ORIGIN:customerOrigin,UNDERSTOOD_POSTGRES_SCHEMA:'understood_stage_ops',
  UNDERSTOOD_POSTGRES_URL:'postgres://fixture@example.test/synthetic',UNDERSTOOD_POSTGRES_TLS:'true',
  UNDERSTOOD_TRUSTED_PROXY_NETWORKS:'["127.0.0.1/32"]',UNDERSTOOD_OPERATOR_ACCESS:'true'};
const proxyHeaders={host:'operations.example.test','x-forwarded-proto':'https','x-forwarded-for':'198.51.100.20'};
const publicBuild=(req,res,url)=>{res.writeHead(url.pathname==='/'?200:404,{'content-type':'text/html'});res.end('synthetic public build fixture');};
function request(base,path,options={}) {
  return new Promise((resolve,reject)=>{
    const req=httpRequest(base+path,{method:options.method ?? 'GET',headers:{...proxyHeaders,
      ...(options.body!==undefined?{'content-length':Buffer.byteLength(options.body)}:{}),...options.headers}},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('error',reject);
      res.on('end',()=>{const headers=new Headers();for(const [name,value] of Object.entries(res.headers))if(value!==undefined)headers.set(name,Array.isArray(value)?value.join(', '):value);
        resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers}));});
    });req.on('error',reject);req.end(options.body);
  });
}
async function listen(server) {
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return `http://127.0.0.1:${server.address().port}`;
}
const close=server=>new Promise(resolve=>server.close(resolve));

test('operator configuration requires a distinct HTTPS origin and omits application integration secrets',()=>{
  const config=hostedSyntheticConfig(env,{service:'operator'});
  assert.equal(config.service,'operator');assert.equal(config.runtimeRoleProfile,'operator');assert.equal(config.operatorAccess,true);
  assert.equal(config.customerOrigin,customerOrigin);assert.equal(config.mail.available,false);assert.equal(config.storageChecks,false);
  assert.equal(config.storageConfig,undefined);assert.equal(config.storageAdapter,undefined);assert.equal(config.pilotDestination,null);
  assert.ok(Object.isFrozen(config));assert.ok(Object.isFrozen(config.mail));
  for(const patch of [{UNDERSTOOD_OPERATOR_ACCESS:'false'},{UNDERSTOOD_CUSTOMER_ORIGIN:origin},{UNDERSTOOD_CUSTOMER_ORIGIN:undefined},
    {UNDERSTOOD_CUSTOMER_ORIGIN:'http://customer.example.test'},{UNDERSTOOD_CUSTOMER_ORIGIN:customerOrigin+'/path'},
    {UNDERSTOOD_CUSTOMER_ORIGIN:'https://127.0.0.1'},{UNDERSTOOD_TIER:'production'},{UNDERSTOOD_DATA_CLASS:'real'},
    {UNDERSTOOD_EMAIL_MODE:'resend'},{UNDERSTOOD_STORAGE_CHECKS:'true'},{UNDERSTOOD_PILOT_TO:'pilot@example.test'},
    {UNDERSTOOD_R2_SECRET_ACCESS_KEY:'synthetic-secret'},{UNDERSTOOD_NEON_STORAGE_ACCESS_KEY_ID:'synthetic-secret'},
    {GEMINI_API_KEY:'synthetic-secret'},{UNDERSTOOD_RESEND_KEY:'synthetic-secret'},{UNDERSTOOD_AUTH_MAIL_KEY:'synthetic-secret'},
    {UNDERSTOOD_PROVIDER_TESTS:'gemini-free'}])assert.throws(()=>hostedSyntheticConfig({...env,...patch},{service:'operator'}));
});

test('service factories reject mixed customer/operator roles before any database call',async()=>{
  let connections=0;const pool={async connect(){connections++;throw Error('must not connect');}},config=hostedSyntheticConfig(env,{service:'operator'});
  assert.throws(()=>createPostgresHostedServer(pool,{config,publicBuild}),/Invalid hosted synthetic runtime/);
  await assert.rejects(startHostedApi(pool,{},config),/Invalid hosted API service/);
  await assert.rejects(verifyRuntimePermissions(pool,{schema:config.schema,profile:'maintenance'}),/Invalid runtime permission profile/);
  assert.throws(()=>createPostgresHostedServer(pool,{config:{...config,service:'api',runtimeRoleProfile:'application'},publicBuild}),/Invalid hosted synthetic runtime/);
  for(const patch of [{service:'api'},{runtimeRoleProfile:'application'},{operatorAccess:false},{customerOrigin:origin},
    {storageConfig:{}},{providerVerification:{}},{storageChecks:true},{mail:{available:true}},{pilotDestination:'pilot@example.test'},
    {dataClass:'real'},{tier:'production'},{aiMode:'live'}])assert.throws(()=>createPostgresOperatorServer(pool,{config:{...config,...patch},publicBuild}),patch.tier==='production'?/Production release approval/:/Invalid isolated operator/);
  assert.equal(connections,0);
});

test('operator transport denies every customer API and untrusted proxy before database or body parsing',async()=>{
  let connections=0;const pool={async connect(){connections++;throw Error('synthetic-secret must not escape');}};
  const config=hostedSyntheticConfig(env,{service:'operator'}),server=createPostgresOperatorServer(pool,{config,publicBuild}),base=await listen(server);
  try {
    for(const path of ['/api/session','/api/overview','/api/auth/staff/login','/api/auth/worker/redeem','/api/auth/recovery',
      '/api/pilot','/api/people/workers','/api/recordings/fixture','/api/source-audio/fixture','/api/reports','/api/ops']) {
      for(const method of ['GET','POST']) {
        const response=await request(base,path,{method,body:'{not json'});assert.equal(response.status,404,path);
        assert.deepEqual(await response.json(),{error:'Not found'});assert.equal(response.headers.get('cache-control'),'no-store');
      }
    }
    for(const headers of [{host:'customer.example.test'},{'x-forwarded-proto':'http'},
      {'x-forwarded-for':'198.51.100.20, 203.0.113.1'},{'x-forwarded-for':'not-an-ip'}]) {
      assert.equal((await request(base,'/api/ops/session',{headers})).status,403);
    }
    assert.equal((await request(base,'/api/ops/login',{method:'POST',headers:{origin:customerOrigin},body:'{bad'})).status,403);
    assert.equal((await request(base,'/api/ops/login',{method:'POST',body:'{bad'})).status,403);
    assert.equal(connections,0);
    assert.equal((await request(base,'/')).status,200);
    const health=await request(base,'/api/health');assert.equal(health.status,503);assert.doesNotMatch(await health.text(),/synthetic-secret/);
    assert.equal(connections,1);
  }finally{await close(server);}
});

test('dedicated operator HTTP retains session context, exact controls, revocation and host-only cookie isolation',async()=>{
  const db=new PGlite(),pool={async connect(){return {query:async(sql,values)=>values?.length?db.query(sql,values):(await db.exec(sql)).at(-1)??{rows:[]},release(){}};}};
  const config=hostedSyntheticConfig(env,{service:'operator'}),options={schema:config.schema},password='Synthetic-operator-service-password';
  let server;
  try {
    await db.exec(`CREATE SCHEMA ${config.schema}`);await runMigrations(pool,options);
    await domainTransaction(pool,config.schema,client=>client.query("INSERT INTO organizations VALUES('cedar','Synthetic Cedar');INSERT INTO sites VALUES('beirut','cedar','Beirut','Asia/Beirut');INSERT INTO staff(id,org_id,site_id,name,role) VALUES('maya','cedar','beirut','Maya','owner')"));
    await provisionOperator(pool,{id:randomUUID(),email:'operator@example.test',name:'Synthetic operator',password},options);
    await provisionStaffCredential(pool,{staffId:'maya',orgId:'cedar',siteId:'beirut',email:'maya@example.test',password},options);
    const customer=await authenticateStaff(pool,'maya@example.test',password,'synthetic-customer',options);
    server=createPostgresOperatorServer(pool,{config,publicBuild});const base=await listen(server);
    const unauthenticated=await request(base,'/api/ops/session',{headers:{cookie:`__Host-understood_session=${customer.session.token}`}});
    assert.deepEqual(await unauthenticated.json(),{available:true,authenticated:false});
    assert.equal((await request(base,'/api/ops/overview',{headers:{cookie:`__Host-understood_session=${customer.session.token}`}})).status,401);
    const input={method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({email:'operator@example.test',password})};
    assert.equal((await request(base,'/api/ops/login',{...input,body:JSON.stringify({email:'maya@example.test',password})})).status,401);
    assert.equal((await request(base,'/api/ops/login',{...input,body:'{invalid'})).status,400);
    assert.equal((await request(base,'/api/ops/login',{...input,body:JSON.stringify({email:'x'.repeat(4100)})})).status,413);
    const login=await request(base,'/api/ops/login',input);assert.equal(login.status,200);const session=await login.json();
    const cookie=login.headers.get('set-cookie').split(';')[0];
    assert.match(login.headers.get('set-cookie'),/^__Host-understood_operator=[A-Za-z0-9_-]{43}; HttpOnly; SameSite=Strict; Path=\/; Max-Age=3600; Secure$/);
    assert.doesNotMatch(login.headers.get('set-cookie'),/Domain=/);
    assert.match(login.headers.get('strict-transport-security'),/31536000/);
    const headers={cookie,'x-operator-context':session.clientContext,origin,'content-type':'application/json'};
    assert.equal((await request(base,'/api/ops/overview',{headers:{cookie}})).status,409);
    assert.equal((await request(base,'/api/ops/overview',{headers:{...headers,cookie:cookie.replace('__Host-understood_operator','understood_operator')}})).status,401);
    const overview=await request(base,'/api/ops/overview',{headers});assert.equal(overview.status,200);
    assert.doesNotMatch(JSON.stringify(await overview.json()),/password|answer_text|rubric|token_hash/);
    const providers=await (await request(base,'/api/ops/providers',{headers})).json();
    assert.equal(providers.productionReady,false);assert.ok(providers);
    const command={requestId:randomUUID(),kind:'tenant',orgId:'cedar',revision:0,state:'suspended',reason:'pilot_review',confirmed:true};
    const save=()=>request(base,'/api/ops/controls',{method:'POST',headers,body:JSON.stringify(command)});
    assert.equal((await request(base,'/api/ops/controls',{method:'POST',headers:{...headers,origin:customerOrigin},body:JSON.stringify(command)})).status,403);
    assert.equal((await save()).status,200);assert.equal((await (await save()).json()).duplicate,true);
    const receipt=await (await request(base,`/api/ops/receipts/${command.requestId}`,{headers})).json();
    assert.equal(receipt.found,true);assert.equal(receipt.clientContext,session.clientContext);
    assert.equal((await request(base,'/api/session',{headers})).status,404);
    const logout=await request(base,'/api/ops/logout',{method:'POST',headers,body:'{}'});assert.equal(logout.status,200);
    assert.match(logout.headers.get('set-cookie'),/^__Host-understood_operator=;.*Max-Age=0; Secure$/);
    assert.equal((await request(base,'/api/ops/overview',{headers})).status,401);
    assert.deepEqual(await (await fetch(base+'/api/health')).json(),{status:'ok',mode:'synthetic-credential',backend:'postgres-operator-synthetic'});
  }finally{if(server)await close(server);await db.close();}
});
