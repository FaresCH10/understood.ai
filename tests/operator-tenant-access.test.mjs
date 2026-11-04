import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {provisionOperator,authenticateOperator,revokeOperator,operatorSession} from '../server/postgres/operators.mjs';
import {issueWorkerGrant,redeemWorkerGrant} from '../server/postgres/auth.mjs';
import {assignWorkerPassword,authenticateWorker} from '../server/postgres/worker-credentials.mjs';
import {operationsTenantAccess,tenantAccessFilters} from '../server/postgres/operator-tenant-access.mjs';
import {createPostgresRehearsalServer} from '../server/postgres/http.mjs';
import {saveOperatorControl} from '../server/postgres/operations.mjs';
import {checkedOperatorAccessReport} from '../src/operator-tenant-access.ts';

const password='Synthetic tenant access tests only',origin='http://127.0.0.1:3020';
async function fixture(){
  const db=new PGlite(),schema='understood_test_operator_access';let failed=false;
  const pool={async connect(){return {query:async(sql,args)=>{if(failed && sql.includes('WITH tenant AS'))throw Error('PRIVATE_DATABASE_DETAIL');return args?.length?db.query(sql,args):(await db.exec(sql)).at(-1)??{rows:[]};},release(){}};}};
  await db.exec(`CREATE SCHEMA ${schema};SET search_path TO ${schema},pg_catalog`);await runMigrations(pool,{schema});
  await db.exec(`INSERT INTO organizations VALUES('qa','Synthetic tenant'),('foreign','Foreign tenant');
    INSERT INTO sites VALUES('main','qa','Main site','UTC'),('second','qa','Second site','UTC'),('foreign','foreign','Foreign site','UTC');
    INSERT INTO staff(id,org_id,site_id,name,role) VALUES('owner','qa','main','Synthetic owner','owner');
    INSERT INTO workers(id,org_id,site_id,code,language,active) VALUES('current','qa','main','Worker current','en',true),
      ('pending','qa','main','Worker pending','ar',true),('disabled','qa','main','Worker disabled','ur',false),
      ('second','qa','second','Worker second','en',true),('foreign','foreign','foreign','PRIVATE_FOREIGN_REFERENCE','en',true);
    INSERT INTO workers(id,org_id,site_id,code,language) SELECT 'page-'||n,'qa','main','Worker '||lpad(n::text,3,'0'),'en' FROM generate_series(1,125) n;`);
  const options={schema},id=randomUUID();await provisionOperator(pool,{id,email:'operator@tenant.example.test',name:'Synthetic operator',password},options);
  const login=await authenticateOperator(pool,{email:'operator@tenant.example.test',password},'local',options);
  const owner={principal_type:'staff',principal_id:'owner',org_id:'qa',site_id:'main',role:'owner'};
  const grant=await issueWorkerGrant(pool,owner,'current',240,options),worker=await redeemWorkerGrant(pool,grant.token,options);
  await issueWorkerGrant(pool,owner,'pending',240,options);
  const snapshot=async()=>JSON.stringify(await db.query(`SELECT * FROM (SELECT 'sessions' AS source,to_jsonb(s) AS value FROM sessions s
    UNION ALL SELECT 'worker_grants',to_jsonb(g) FROM worker_grants g UNION ALL SELECT 'audit',to_jsonb(a) FROM audit a
    UNION ALL SELECT 'operator_requests',to_jsonb(r) FROM operator_requests r UNION ALL SELECT 'operator_audit',to_jsonb(o) FROM operator_audit o
    ) evidence ORDER BY source,value::text`));
  return {db,pool,options,owner,identity:login.session,login,grant,worker,snapshot,setFailure:value=>{failed=value;},close:()=>db.close()};
}

test('operator tenant access filters require one explicit bounded tenant and allow only directory metadata filters',()=>{
  assert.deepEqual(tenantAccessFilters({orgId:'qa',search:' WORKER ',state:'disabled',page:'2',pageSize:'50'}),{orgId:'qa',search:'worker',state:'disabled',page:2,pageSize:50});
  for(const input of [null,[],{}, {orgId:''},{orgId:'x'.repeat(101)},{orgId:'qa',site_id:'foreign'},{orgId:'qa',search:'\n'},
    {orgId:'qa',page:0},{orgId:'qa',page:5001},{orgId:'qa',pageSize:51},{orgId:'qa',state:'suspended'}])assert.throws(()=>tenantAccessFilters(input),/Invalid operator filters/);
});

test('browser access report rejects foreign identity, wrong pages, private fields, duplicated workers and malformed observations',()=>{
  const worker={id:'worker',reference:'Worker 001',siteId:'site',siteName:'Site',enabled:true,siteState:'active',admissionState:'active',credentialState:'session_active',lastSignInAt:null};
  const report={orgId:'qa',tenantName:'Synthetic tenant',tenantState:'active',asOf:'2026-10-12T00:00:00.000Z',total:1,page:1,pageSize:20,items:[worker]};
  assert.deepEqual(checkedOperatorAccessReport(report,'qa',1),report);
  for(const patch of [{orgId:'foreign'},{page:2},{pageSize:50},{total:-1},{asOf:'invalid'},{tenantState:'unknown'},{privateRubric:'private'},
    {items:[worker,worker],total:2},{items:[{...worker,token:'secret'}]},{items:[{...worker,credentialState:'active'}]},
    {items:[{...worker,lastSignInAt:'invalid'}]},{items:[{...worker,reference:'x'.repeat(101)}]},{items:[null]}])
    assert.throws(()=>checkedOperatorAccessReport({...report,...patch},'qa',1),/could not be verified/);
  for(const value of [null,{},[]])assert.throws(()=>checkedOperatorAccessReport(value,'qa',1));
});

test('tenant access pages complete scoped metadata beyond 100, preserves exact counts and performs no writes',async()=>{
  const f=await fixture();try{
    const before=await f.snapshot(),all=[];
    for(let page=1;page<=7;page++){const r=await operationsTenantAccess(f.pool,f.identity,{orgId:'qa',page},f.options);assert.equal(r.total,129);assert.equal(r.orgId,'qa');assert.equal(r.page,page);assert.equal(r.pageSize,20);all.push(...r.items);}
    assert.equal(all.length,129);assert.equal(new Set(all.map(w=>w.id)).size,129);
    assert.equal(all.find(w=>w.id==='current').credentialState,'session_active');assert.ok(all.find(w=>w.id==='current').lastSignInAt);
    assert.equal(all.find(w=>w.id==='pending').credentialState,'link_available');assert.equal(all.find(w=>w.id==='pending').lastSignInAt,null);
    assert.equal(all.find(w=>w.id==='disabled').enabled,false);
    for(const row of all)assert.deepEqual(Object.keys(row).sort(),['admissionState','credentialState','enabled','id','lastSignInAt','reference','siteId','siteName','siteState'].sort());
    assert.doesNotMatch(JSON.stringify(all),/PRIVATE_FOREIGN_REFERENCE|token|hash|password|answer|rubric|audio|language/);
    assert.equal((await operationsTenantAccess(f.pool,f.identity,{orgId:'qa',state:'disabled'},f.options)).total,1);
    assert.equal((await operationsTenantAccess(f.pool,f.identity,{orgId:'qa',state:'enabled'},f.options)).total,128);
    assert.equal((await operationsTenantAccess(f.pool,f.identity,{orgId:'qa',search:'Second site'},f.options)).total,1);
    assert.equal((await operationsTenantAccess(f.pool,f.identity,{orgId:'qa',search:'%_'},f.options)).total,0);
    assert.deepEqual((await operationsTenantAccess(f.pool,f.identity,{orgId:'qa',page:5000},f.options)).items,[]);
    await assert.rejects(operationsTenantAccess(f.pool,f.identity,{orgId:'missing'},f.options),/Tenant unavailable/);
    await assert.rejects(operationsTenantAccess(f.pool,{token_hash:'0'.repeat(64)},{orgId:'qa'},f.options),/Operator sign in required/);
    assert.equal(await f.snapshot(),before);
  }finally{await f.close();}
});

test('access observations distinguish site/tenant restrictions and revoked, expired or unredeemed credential evidence',async()=>{
  const f=await fixture();try{
    const read=search=>operationsTenantAccess(f.pool,f.identity,{orgId:'qa',search},f.options);
    await f.db.query("INSERT INTO site_access_controls(site_id,org_id,revision,state,reason) VALUES('main','qa',1,'paused','maintenance')");
    assert.equal((await read('current')).items[0].admissionState,'paused');
    await f.db.query("INSERT INTO site_lifecycle(site_id,org_id,revision,state,reason) VALUES('second','qa',1,'archived','maintenance')");
    assert.equal((await read('second')).items[0].siteState,'archived');
    await f.db.query("UPDATE sessions SET expires_at='1970-01-01' WHERE principal_id='current'");
    assert.equal((await read('current')).items[0].credentialState,'no_current_access');
    await f.db.query("UPDATE sessions SET expires_at=clock_timestamp()+interval '1 hour' WHERE principal_id='current'");
    await f.db.query("UPDATE worker_grants SET revoked_at=clock_timestamp() WHERE worker_id='current'");
    assert.equal((await read('current')).items[0].credentialState,'no_current_access');
    await f.db.query("UPDATE worker_grants SET expires_at='1970-01-01' WHERE worker_id='pending'");
    assert.equal((await read('pending')).items[0].credentialState,'no_current_access');
    await saveOperatorControl(f.pool,f.identity,{requestId:randomUUID(),kind:'tenant',orgId:'qa',revision:0,state:'suspended',reason:'maintenance',confirmed:true},f.options);
    const r=await read('current');assert.equal(r.tenantState,'suspended');assert.ok(r.items[0].lastSignInAt);
    await revokeOperator(f.pool,f.identity,f.options);await assert.rejects(read('current'),/Operator sign in required/);
  }finally{await f.close();}
});

test('password sessions report genuine sign-in times and require an active matching credential revision',async()=>{
  const f=await fixture();try{
    const read=async()=> (await operationsTenantAccess(f.pool,f.identity,{orgId:'qa',search:'Worker 001'},f.options)).items[0];
    const input={company:'qa',workerId:'Worker 001',password:'Synthetic worker password only'};
    assert.equal((await read()).lastSignInAt,null);
    await assignWorkerPassword(f.pool,f.owner,'page-1',{expectedCode:'Worker 001',workerId:'Worker 001',password:input.password,confirmed:true},f.options);
    assert.equal((await read()).credentialState,'no_current_access');assert.equal((await read()).lastSignInAt,null);
    const signIn=()=>authenticateWorker(f.pool,input,'synthetic-worker',f.options);
    await signIn();
    const signedAt=(await f.db.query("SELECT created_at FROM sessions WHERE principal_id='page-1'")).rows[0].created_at.toISOString();
    const before=await f.snapshot(),observed=await read();
    assert.equal(observed.credentialState,'session_active');assert.equal(new Date(observed.lastSignInAt).toISOString(),signedAt);
    assert.equal(await f.snapshot(),before);assert.doesNotMatch(JSON.stringify(observed),/token|hash|password|credential_revision/);
    await f.db.query("UPDATE sessions SET revoked_at=clock_timestamp() WHERE principal_id='page-1'");
    assert.equal((await read()).credentialState,'no_current_access');assert.equal(new Date((await read()).lastSignInAt).toISOString(),signedAt);
    await signIn();await f.db.query("UPDATE sessions SET expires_at='1970-01-01' WHERE principal_id='page-1'");
    assert.equal((await read()).credentialState,'no_current_access');
    await signIn();await f.db.query("UPDATE worker_credentials SET credential_revision=credential_revision+1 WHERE worker_id='page-1'");
    assert.equal((await read()).credentialState,'no_current_access');
    await signIn();assert.equal((await read()).credentialState,'session_active');
    await f.db.query("UPDATE worker_credentials SET state='setup',password_salt=NULL,password_hash=NULL,password_changed_at=NULL,credential_revision=credential_revision+1 WHERE worker_id='page-1'");
    assert.equal((await read()).credentialState,'no_current_access');assert.ok((await read()).lastSignInAt);
    await f.db.query("INSERT INTO sessions(token_hash,org_id,site_id,principal_type,principal_id,expires_at,access_mode) VALUES(repeat('d',64),'qa','main','worker','page-2',clock_timestamp()+interval '1 hour','demo')");
    const demo=(await operationsTenantAccess(f.pool,f.identity,{orgId:'qa',search:'Worker 002'},f.options)).items[0];
    assert.equal(demo.credentialState,'no_current_access');assert.equal(demo.lastSignInAt,null);
  }finally{await f.close();}
});

test('tenant access HTTP requires separate operator cookie/context, rejects ambiguous scope and redacts database failures',async()=>{
  const f=await fixture();let server;try{
    server=createPostgresRehearsalServer(f.pool,{...f.options,operatorAccess:true,dataClass:'synthetic',tier:'local',aiMode:'synthetic',accessMode:'credential',publicOrigin:origin});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}/api/ops/tenant-access`;
    const headers={cookie:`understood_operator=${f.login.token}`,'x-operator-context':operatorSession(f.identity).clientContext};
    assert.equal((await fetch(base+'?orgId=qa')).status,401);
    assert.equal((await fetch(base+'?orgId=qa',{headers:{cookie:`understood_session=${f.worker.token}`}})).status,401);
    assert.equal((await fetch(base+'?orgId=qa',{headers:{cookie:headers.cookie}})).status,409);
    const before=await f.snapshot(),response=await fetch(base+'?orgId=qa&search=current',{headers});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal((await response.json()).items[0].reference,'Worker current');
    for(const query of ['', '?orgId=qa&orgId=foreign','?orgId=qa&site_id=foreign','?orgId=qa&pageSize=51'])assert.equal((await fetch(base+query,{headers})).status,400);
    assert.equal((await fetch(base+'?orgId=missing',{headers})).status,404);
    f.setFailure(true);const failed=await fetch(base+'?orgId=qa',{headers});assert.equal(failed.status,503);assert.doesNotMatch(JSON.stringify(await failed.json()),/PRIVATE_DATABASE_DETAIL/);f.setFailure(false);
    assert.equal(await f.snapshot(),before);
  }finally{if(server)await new Promise(resolve=>server.close(resolve));await f.close();}
});
