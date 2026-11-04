import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {PGlite} from '@electric-sql/pglite';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {domainTransaction} from '../server/postgres/domain.mjs';
import {provisionOperator,authenticateOperator,operatorSession,revokeOperator} from '../server/postgres/operators.mjs';
import {insertSession,issueWorkerGrant,redeemWorkerGrant} from '../server/postgres/auth.mjs';
import {operationsSupportAccounts,revokeOperationsAccountSessions,operatorAccountFilters} from '../server/postgres/operator-support.mjs';
import {operatorSessionRevocationInput} from '../server/operator-input.mjs';
import {operatorReceipt} from '../server/postgres/operations.mjs';
import {handleOperationsRoute} from '../server/postgres/operations-http.mjs';
import {configureRuntimePermissions} from '../server/postgres/runtime-permissions.mjs';

const password='Synthetic support console tests only',schema='understood_test_operator_support';
const command=patch=>({requestId:randomUUID(),kind:'session-revocation',orgId:'qa',siteId:'main',principalType:'staff',
  principalId:'owner',expectedSessionCount:2,reason:'security_review',confirmed:true,...patch});

async function fixture(){
  const db=new PGlite();let failed=false;
  const pool={async connect(){return {query:async(sql,args)=>{
    if(failed && sql.includes('WITH tenant AS'))throw Error('PRIVATE_DATABASE_DETAIL');
    return args?.length?db.query(sql,args):(await db.exec(sql)).at(-1)??{rows:[]};},release(){}};}};
  const options={schema};await db.exec(`CREATE SCHEMA ${schema};SET search_path TO ${schema},pg_catalog`);await runMigrations(pool,options);
  await db.exec(`INSERT INTO organizations VALUES('qa','Synthetic tenant'),('foreign','Foreign tenant');
    INSERT INTO sites VALUES('main','qa','Main site','UTC'),('second','qa','Second site','UTC'),('foreign','foreign','Foreign site','UTC');
    INSERT INTO staff(id,org_id,site_id,name,role,active) VALUES('owner','qa','main','PRIVATE_OWNER_NAME','owner',true),
      ('supervisor','qa','second','PRIVATE_SUPERVISOR_NAME','supervisor',true),('disabled','qa','main','PRIVATE_DISABLED_NAME','auditor',false),
      ('foreign-owner','foreign','foreign','PRIVATE_FOREIGN_NAME','owner',true);
    INSERT INTO workers(id,org_id,site_id,code,language,active) VALUES('worker','qa','main','Worker 001','en',true),
      ('worker-disabled','qa','second','Worker 002','en',false),('foreign-worker','foreign','foreign','PRIVATE_FOREIGN_REFERENCE','en',true);
    INSERT INTO workers(id,org_id,site_id,code,language) SELECT 'page-'||n,'qa','main','Worker page '||lpad(n::text,3,'0'),'en' FROM generate_series(1,101) n;`);
  const addStaffSession=(id='owner',orgId='qa',siteId='main')=>domainTransaction(pool,schema,client=>insertSession(client,{id,org_id:orgId,site_id:siteId},'staff'));
  const customer=await addStaffSession();await addStaffSession();await addStaffSession('supervisor','qa','second');await addStaffSession('foreign-owner','foreign','foreign');
  const grant=await issueWorkerGrant(pool,{principal_type:'staff',principal_id:'owner',org_id:'qa',site_id:'main',role:'owner'},'worker',240,options);
  const worker=await redeemWorkerGrant(pool,grant.token,options);
  await provisionOperator(pool,{id:randomUUID(),email:'operator@support.example.test',name:'Synthetic operator',password},options);
  const login=await authenticateOperator(pool,{email:'operator@support.example.test',password},'local',options);
  const sessions=async()=>JSON.stringify((await db.query('SELECT * FROM sessions ORDER BY token_hash')).rows);
  return {db,pool,options,identity:login.session,login,customer,worker,addStaffSession,sessions,setFailure:value=>{failed=value;},close:()=>db.close()};
}

test('support inputs require bounded explicit workspace/account scope and reject forged privileges',()=>{
  assert.deepEqual(operatorAccountFilters({orgId:'qa',search:' OWNER ',principalType:'staff',state:'enabled',page:'2',pageSize:'50'}),
    {orgId:'qa',search:'owner',principalType:'staff',state:'enabled',page:2,pageSize:50});
  for(const input of [null,[],{}, {orgId:''},{orgId:'qa',search:'\n'},{orgId:'qa',principalType:'operator'},
    {orgId:'qa',state:'suspended'},{orgId:'qa',page:5001},{orgId:'qa',pageSize:51},{orgId:'qa',email:'private'}])
    assert.throws(()=>operatorAccountFilters(input),/Invalid operator filters/);
  const valid=command();assert.equal(operatorSessionRevocationInput(valid).requestId,undefined);
  for(const patch of [{confirmed:false},{requestId:'invalid'},{kind:'tenant'},{orgId:' '},{siteId:'\n'},
    {principalId:''},{principalType:'operator'},{expectedSessionCount:0},{expectedSessionCount:100001},{expectedSessionCount:1.5},
    {reason:'arbitrary'},{token:'private'},{password:'private'}])assert.throws(()=>operatorSessionRevocationInput({...valid,...patch}),/Invalid operator command/);
});

test('support directory is fully paginated, scopes staff/workers and exposes only bounded operational metadata',async()=>{
  const f=await fixture();try{
    const before=await f.sessions(),all=[];
    for(let page=1;page<=6;page++){
      const report=await operationsSupportAccounts(f.pool,f.identity,{orgId:'qa',page},f.options);
      assert.equal(report.total,106);assert.equal(report.orgId,'qa');assert.equal(report.page,page);assert.equal(report.pageSize,20);all.push(...report.items);
    }
    assert.equal(all.length,106);assert.equal(new Set(all.map(p=>p.principalType+':'+p.id)).size,106);
    assert.equal(all.find(p=>p.id==='owner').activeSessionCount,2);assert.equal(all.find(p=>p.id==='owner').reference,'owner');
    assert.equal(all.find(p=>p.id==='worker').activeSessionCount,1);assert.equal(all.find(p=>p.id==='worker').role,'worker');
    for(const row of all)assert.deepEqual(Object.keys(row).sort(),['id','reference','principalType','role','enabled','siteId','siteName','siteState','admissionState','activeSessionCount'].sort());
    assert.doesNotMatch(JSON.stringify(all),/PRIVATE_|password|token|hash|email|answer|source|audio|language/);
    assert.equal((await operationsSupportAccounts(f.pool,f.identity,{orgId:'qa',principalType:'staff'},f.options)).total,3);
    assert.equal((await operationsSupportAccounts(f.pool,f.identity,{orgId:'qa',state:'disabled'},f.options)).total,2);
    assert.equal((await operationsSupportAccounts(f.pool,f.identity,{orgId:'qa',search:'Second site'},f.options)).total,2);
    assert.equal((await operationsSupportAccounts(f.pool,f.identity,{orgId:'qa',search:'%_'},f.options)).total,0);
    await f.db.exec("INSERT INTO site_access_controls(site_id,org_id,revision,state,reason) VALUES('main','qa',1,'paused','maintenance');INSERT INTO site_lifecycle(site_id,org_id,revision,state,reason) VALUES('second','qa',1,'archived','maintenance')");
    assert.equal((await operationsSupportAccounts(f.pool,f.identity,{orgId:'qa',search:'owner'},f.options)).items[0].admissionState,'paused');
    assert.equal((await operationsSupportAccounts(f.pool,f.identity,{orgId:'qa',search:'supervisor'},f.options)).items[0].siteState,'archived');
    await assert.rejects(operationsSupportAccounts(f.pool,f.identity,{orgId:'missing'},f.options),/Tenant unavailable/);
    await assert.rejects(operationsSupportAccounts(f.pool,{token_hash:'0'.repeat(64)},{orgId:'qa'},f.options),/Operator sign in required/);
    assert.equal(await f.sessions(),before);
  }finally{await f.close();}
});

test('session revocation preserves exact target, rejects stale/foreign scope and records an immutable idempotent receipt',async()=>{
  const f=await fixture();try{
    const before=await f.sessions();
    for(const patch of [{expectedSessionCount:1},{expectedSessionCount:3}])
      await assert.rejects(revokeOperationsAccountSessions(f.pool,f.identity,command(patch),f.options),/Account sessions changed/);
    for(const patch of [{orgId:'foreign'},{siteId:'second'},{principalType:'worker'},{principalId:'missing'}])
      await assert.rejects(revokeOperationsAccountSessions(f.pool,f.identity,command(patch),f.options),/Account unavailable/);
    assert.equal(await f.sessions(),before);
    const input=command(),result=await revokeOperationsAccountSessions(f.pool,f.identity,input,f.options);
    assert.deepEqual(result,{kind:'session-revocation',orgId:'qa',siteId:'main',principalType:'staff',principalId:'owner',revokedSessionCount:2,duplicate:false});
    const rows=(await f.db.query('SELECT principal_id,revoked_at IS NOT NULL AS revoked FROM sessions ORDER BY principal_id')).rows;
    assert.equal(rows.filter(r=>r.revoked).length,2);assert.ok(rows.filter(r=>r.revoked).every(r=>r.principal_id==='owner'));
    const receipt=await operatorReceipt(f.pool,f.identity,input.requestId,f.options);
    assert.equal(receipt.request.reason,'security_review');assert.equal(receipt.request.principalId,'owner');assert.equal(receipt.result.revokedSessionCount,2);
    await f.addStaffSession();
    assert.equal((await revokeOperationsAccountSessions(f.pool,f.identity,input,f.options)).duplicate,true);
    assert.equal((await operationsSupportAccounts(f.pool,f.identity,{orgId:'qa',search:'owner'},f.options)).items[0].activeSessionCount,1);
    await assert.rejects(revokeOperationsAccountSessions(f.pool,f.identity,{...input,reason:'maintenance'},f.options),/Operator request conflict/);
    await provisionOperator(f.pool,{id:randomUUID(),email:'other@support.example.test',name:'Other synthetic operator',password},f.options);
    const other=await authenticateOperator(f.pool,{email:'other@support.example.test',password},'other',f.options);
    await assert.rejects(revokeOperationsAccountSessions(f.pool,other.session,input,f.options),/Operator request conflict/);
    assert.equal((await operatorReceipt(f.pool,other.session,input.requestId,f.options)).found,false);
    const audit=(await f.db.query("SELECT action,object_type,object_id FROM operator_audit WHERE action='account.sessions_revoked'")).rows;
    assert.deepEqual(audit,[{action:'account.sessions_revoked',object_type:'customer_account',object_id:JSON.stringify(['qa','main','staff','owner'])}]);
    await assert.rejects(f.db.query('UPDATE operator_requests SET result_json=$1 WHERE request_id=$2',[JSON.stringify({forged:true}),input.requestId]),/append-only/);
    await revokeOperator(f.pool,f.identity,f.options);
    await assert.rejects(revokeOperationsAccountSessions(f.pool,f.identity,command({expectedSessionCount:1}),f.options),/Operator sign in required/);
  }finally{await f.close();}
});

test('support HTTP requires operator cookie/context, rejects ambiguous scope and redacts failures',async()=>{
  const f=await fixture();try{
    // Exercise the real HTTP route without a listener; isolated transport/origin
    // enforcement is covered separately by operator-service.test.mjs.
    const base='http://127.0.0.1:3020/api/ops/support',route=async(url,options={})=>{
      const req=Readable.from(options.body===undefined?[]:[Buffer.from(options.body)]);
      req.method=options.method??'GET';req.headers=options.headers??{};req.socket={remoteAddress:'127.0.0.1'};
      let status,headers,body;const res={writeHead(code,value){status=code;headers=value;},end(value){body=value;}};
      assert.equal(await handleOperationsRoute(f.pool,req,res,new URL(url),{schema,enabled:true}),true);
      return new Response(body,{status,headers});
    };
    const headers={cookie:`understood_operator=${f.login.token}`,'x-operator-context':operatorSession(f.identity).clientContext};
    assert.equal((await route(base+'/accounts?orgId=qa')).status,401);
    assert.equal((await route(base+'/accounts?orgId=qa',{headers:{cookie:`understood_session=${f.customer.token}`}})).status,401);
    assert.equal((await route(base+'/accounts?orgId=qa',{headers:{cookie:headers.cookie}})).status,409);
    for(const suffix of ['', '?orgId=qa&orgId=foreign','?orgId=qa&principalType=operator','?orgId=qa&pageSize=51'])
      assert.equal((await route(base+'/accounts'+suffix,{headers})).status,400);
    const response=await route(base+'/accounts?orgId=qa&principalType=staff',{headers});
    assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal((await response.json()).total,3);
    f.setFailure(true);const failed=await route(base+'/accounts?orgId=qa',{headers});assert.equal(failed.status,503);assert.doesNotMatch(JSON.stringify(await failed.json()),/PRIVATE_DATABASE_DETAIL/);f.setFailure(false);
    const input=command({principalType:'worker',principalId:'worker',expectedSessionCount:1});
    const post=body=>route(base+'/revoke-sessions',{method:'POST',headers:{...headers,origin:'http://127.0.0.1:3020','content-type':'application/json'},body:JSON.stringify(body)});
    assert.equal((await post({...input,confirmed:false})).status,400);
    const revoked=await post(input),body=await revoked.json();assert.equal(revoked.status,200);assert.equal(body.revokedSessionCount,1);
    assert.equal(body.requestId,input.requestId);assert.equal(body.clientContext,headers['x-operator-context']);assert.equal(body.principalId,'worker');
    assert.equal((await (await post(input)).json()).duplicate,true);
  }finally{await f.close();}
});

test('support directory and targeted revocation run under the existing restricted operator column role',async()=>{
  const f=await fixture();try{
    // Include a revision-bound password session alongside the access-link
    // session so its credential scope trigger also runs under the narrow role.
    await f.db.exec(`INSERT INTO worker_credentials(worker_id,org_id,site_id,login_id,state,password_salt,password_hash,credential_revision,password_changed_at)
      VALUES('worker','qa','main','worker-001','active',repeat('a',32),repeat('b',128),1,clock_timestamp())`);
    await domainTransaction(f.pool,schema,client=>insertSession(client,{id:'worker',org_id:'qa',site_id:'main'},'worker',null,3600,1));
    await f.db.exec('CREATE ROLE support_operator_runtime LOGIN');
    await configureRuntimePermissions(f.pool,{schema,role:'support_operator_runtime',profile:'operator',dedicatedDatabase:true,writersStopped:true});
    await f.db.exec(`SET SESSION AUTHORIZATION support_operator_runtime;SET search_path TO ${schema},pg_catalog`);
    const report=await operationsSupportAccounts(f.pool,f.identity,{orgId:'qa',principalType:'staff'},f.options);assert.equal(report.total,3);
    assert.equal((await revokeOperationsAccountSessions(f.pool,f.identity,command(),f.options)).revokedSessionCount,2);
    assert.equal((await revokeOperationsAccountSessions(f.pool,f.identity,command({principalType:'worker',principalId:'worker'}),f.options)).revokedSessionCount,2);
    for(const sql of ['SELECT name FROM staff','SELECT token_hash FROM sessions','SELECT password_hash FROM staff_credentials','SELECT * FROM recordings'])
      await assert.rejects(f.db.query(sql),error=>error.code==='42501');
    await assert.rejects(f.db.query('UPDATE sessions SET revoked_at=NULL'),error=>error.code==='42501');
  }finally{await f.close();}
});
