import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {openDatabase} from '../server/db.mjs';
import {seed} from '../server/seed.mjs';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {saveActivationRequest,activationRequestReceipt} from '../server/activation.mjs';
import {saveActivationRequest as savePgActivationRequest,activationRequestReceipt as pgActivationRequestReceipt} from '../server/postgres/activation.mjs';
import {saveOperatorEntitlement,saveActivationDecision,operationsEntitlements} from '../server/postgres/entitlement-operations.mjs';
import {operatorReceipt} from '../server/postgres/operations.mjs';
import {provisionOperator,authenticateOperator} from '../server/postgres/operators.mjs';
import {tokenHash} from '../server/auth-crypto.mjs';
import {activationRequestInput} from '../server/activation-request-input.mjs';
import {operatorEntitlementInput} from '../server/operator-input.mjs';
import {getUsage} from '../server/postgres/usage.mjs';
import {checkedUsageModel} from '../src/usage-state.ts';
import {createPostgresRehearsalServer} from '../server/postgres/http.mjs';
import {provisionStaffCredential} from '../server/postgres/auth.mjs';

const owner={principal_type:'staff',principal_id:'maya',role:'owner',org_id:'cedar',site_id:'beirut'};
const input=(note='Please activate this workspace.')=>({requestId:randomUUID(),note,confirmed:true});
const pgOwner={principal_type:'staff',principal_id:'owner',org_id:'a',site_id:'a',role:'owner'};

test('activation requests require exact confirmed bounded input',()=>{
  const value=input();
  assert.deepEqual(activationRequestInput(value),{note:value.note,confirmed:true});
  assert.deepEqual(activationRequestInput({...value,note:null}),{note:null,confirmed:true});
  for(const change of [{confirmed:false},{note:''},{note:' padded '},{note:'x'.repeat(501)},{note:'bad\u0000text'},{extra:1},{requestId:'bad'}])
    assert.throws(()=>activationRequestInput({...value,...change}),/Invalid activation request/);
});

test('operator entitlement commands require exact revisions, dates and decisions',()=>{
  const now=Date.now(),value={requestId:randomUUID(),kind:'entitlement',orgId:'a',revision:0,state:'trial',
    endsAt:new Date(now+14*86400000).toISOString(),workerLimit:25,plan:'trial',termsReference:'terms-v1',
    reason:'manual_activation',activationRequestId:null,confirmed:true};
  assert.deepEqual(operatorEntitlementInput(value),{kind:'entitlement',orgId:'a',revision:0,state:'trial',
    endsAt:value.endsAt,workerLimit:25,plan:'trial',termsReference:'terms-v1',reason:'manual_activation',
    activationRequestId:null,confirmed:true});
  assert.throws(()=>operatorEntitlementInput({...value,state:'trial',endsAt:null}),/Invalid operator command/);
  assert.throws(()=>operatorEntitlementInput({...value,endsAt:'2026-13-01T00:00:00.000Z'}),/Invalid operator command/);
  assert.throws(()=>operatorEntitlementInput({...value,workerLimit:0}),/Invalid operator command/);
  assert.throws(()=>operatorEntitlementInput({...value,plan:' trial '}),/Invalid operator command/);
  assert.throws(()=>operatorEntitlementInput({...value,reason:'because'}),/Invalid operator command/);
  assert.throws(()=>operatorEntitlementInput({...value,state:'read_only',activationRequestId:randomUUID()}),/Invalid operator command/);
  assert.throws(()=>operatorEntitlementInput({...value,requestId:'bad'}),/Invalid operator command/);
  const decision={requestId:randomUUID(),kind:'activation-decision',orgId:'a',activationRequestId:randomUUID(),
    decision:'declined',reason:'owner_request',confirmed:true};
  assert.deepEqual(operatorEntitlementInput(decision),{kind:'activation-decision',orgId:'a',
    activationRequestId:decision.activationRequestId,decision:'declined',reason:'owner_request',confirmed:true});
  assert.throws(()=>operatorEntitlementInput({...decision,decision:'accepted'}),/Invalid operator command/);
});

test('SQLite scoped activation requests are replay-safe, single-pending and readable while read-only',()=>{
  const db=openDatabase(':memory:');seed(db);
  try {
    db.prepare("INSERT INTO staff VALUES('maya2','cedar','beirut','Second Owner','owner',1)").run();
    db.prepare("INSERT INTO staff VALUES('sam','cedar','beirut','Sam Supervisor','supervisor',1)").run();
    const now=new Date().toISOString();
    db.prepare(`INSERT INTO organization_entitlements VALUES('cedar','read_only',?,NULL,25,'pilot','terms-v1',1,'system',?)`).run(now,now);
    db.prepare(`INSERT INTO organization_entitlement_transitions
      SELECT org_id,revision,state,started_at,ends_at,worker_limit,plan,terms_reference,'Synthetic setup','system','synthetic-test',NULL,?
      FROM organization_entitlements WHERE org_id='cedar'`).run(now);
    const value=input(),saved=saveActivationRequest(db,owner,value);
    assert.equal(saved.duplicate,false);assert.equal(saved.state,'pending');assert.equal(saved.changesApplied,false);
    assert.equal(saved.delivery,'platform_operations');assert.equal(saved.request.note,value.note);
    assert.equal(saveActivationRequest(db,owner,value).duplicate,true);
    assert.throws(()=>saveActivationRequest(db,owner,{...value,note:'Changed'}),/conflict/);
    assert.throws(()=>saveActivationRequest(db,{...owner,principal_id:'sam',role:'supervisor'},input()),/Forbidden/);
    assert.throws(()=>saveActivationRequest(db,{...owner,principal_id:'harbor-owner'},input()),/Forbidden/);
    assert.throws(()=>saveActivationRequest(db,{...owner,site_id:'harbor-yard'},input()),/Forbidden/);
    assert.throws(()=>saveActivationRequest(db,{...owner,principal_id:'maya2'},input()),/already pending/);
    assert.equal(activationRequestReceipt(db,owner,value.requestId).found,true);
    assert.deepEqual(activationRequestReceipt(db,{...owner,principal_id:'maya2'},value.requestId),{found:false});
    assert.throws(()=>activationRequestReceipt(db,owner,'bad'),/Invalid activation request/);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action='entitlement.activation_requested'").get().n,1);
    assert.throws(()=>db.prepare("UPDATE organization_activation_requests SET note='Changed' WHERE request_id=?").run(value.requestId),/closed/i);
    assert.throws(()=>db.prepare('DELETE FROM organization_activation_requests WHERE request_id=?').run(value.requestId),/immutable/i);
  } finally {db.close();}
});

test('PostgreSQL activation is operator-only, revision-bound, ledgered and auto-accepts the owner request',async()=>{
  const db=new PGlite(),schema='understood_test_entitlement_activation';
  const pool={async connect(){return {async query(sql,values){return values?.length?db.query(sql,values):(await db.exec(sql)).at(-1)||{rows:[]};},release(){}};}};
  const options={schema,integrationMode:'synthetic'};
  await db.exec(`CREATE SCHEMA ${schema};SET search_path TO ${schema},pg_catalog`);await runMigrations(pool,options);
  await db.exec("INSERT INTO organizations(id,name) VALUES('a','A');INSERT INTO sites(id,org_id,name,timezone) VALUES('a','a','A','UTC');INSERT INTO staff(id,org_id,site_id,name,role,active) VALUES('owner','a','a','Owner','owner',true),('supervisor','a','a','Supervisor','supervisor',true);");
  const operatorId=randomUUID(),email=`operator-${randomUUID()}@example.test`,password=`Synthetic-${randomUUID()}!`;
  await provisionOperator(pool,{id:operatorId,email,password,name:'Synthetic Operator'},options);
  const login=await authenticateOperator(pool,{email,password},'127.0.0.1',options),identity={token_hash:tokenHash(login.token)};
  try {
    const request=input(),saved=await savePgActivationRequest(pool,pgOwner,request,options);
    assert.equal(saved.state,'pending');assert.equal(saved.duplicate,false);
    assert.equal((await savePgActivationRequest(pool,pgOwner,request,options)).duplicate,true);
    await assert.rejects(savePgActivationRequest(pool,{...pgOwner,principal_id:'supervisor',role:'supervisor'},input(),options),/Forbidden/);
    assert.equal((await pgActivationRequestReceipt(pool,pgOwner,request.requestId,options)).found,true);

    const endsAt=new Date(Date.now()+14*86400000).toISOString(),commandId=randomUUID();
    const command={requestId:commandId,kind:'entitlement',orgId:'a',revision:0,state:'trial',endsAt,workerLimit:25,
      plan:'trial',termsReference:'terms-v1',reason:'manual_activation',activationRequestId:request.requestId,confirmed:true};
    const activated=await saveOperatorEntitlement(pool,identity,command,options);
    assert.equal(activated.duplicate,false);assert.equal(activated.revision,1);assert.equal(activated.state,'trial');
    assert.equal(activated.activationRequestId,request.requestId);
    const entitlement=(await db.query("SELECT * FROM organization_entitlements WHERE org_id='a'")).rows[0];
    assert.equal(entitlement.state,'trial');assert.equal(entitlement.revision,1);assert.equal(entitlement.plan,'trial');
    assert.equal(entitlement.worker_limit,25);assert.equal(new Date(entitlement.ends_at).toISOString(),endsAt);
    assert.equal((await db.query(`SELECT COUNT(*)::int AS n FROM organization_entitlement_transitions
      WHERE org_id='a' AND revision=1 AND actor_type='operator' AND actor_id=$1 AND reason='manual_activation'`,[operatorId])).rows[0].n,1);
    const accepted=(await db.query('SELECT state,decided_by,decision_ref FROM organization_activation_requests WHERE request_id=$1',[request.requestId])).rows[0];
    assert.deepEqual({state:accepted.state,decidedBy:accepted.decided_by,decisionRef:accepted.decision_ref},{state:'accepted',decidedBy:operatorId,decisionRef:commandId});
    const receipt=await operatorReceipt(pool,identity,commandId,options);
    assert.equal(receipt.found,true);assert.equal(receipt.request.reason,'manual_activation');assert.equal(receipt.result.revision,1);
    assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM operator_audit WHERE action='activation.accepted'")).rows[0].n,1);
    assert.equal((await saveOperatorEntitlement(pool,identity,command,options)).duplicate,true);
    await assert.rejects(saveOperatorEntitlement(pool,identity,{...command,plan:'other'},options),/conflict/);
    await assert.rejects(saveOperatorEntitlement(pool,identity,{...command,requestId:randomUUID(),revision:0},options),/revision changed/);
    await assert.rejects(saveOperatorEntitlement(pool,{token_hash:tokenHash('x'.repeat(43))},command,options),/sign in required/i);

    const usage=checkedUsageModel(await getUsage(pool,pgOwner,options),'synthetic-credential','owner');
    assert.equal(usage.entitlement.state,'trial');assert.equal(usage.entitlement.activeWorkers,0);
    assert.equal(usage.entitlement.request,null);assert.ok(usage.entitlement.daysRemaining>=13);

    const second=input('Please extend the pilot.'),secondSaved=await savePgActivationRequest(pool,pgOwner,second,options);
    assert.equal(secondSaved.state,'pending');
    const decisionId=randomUUID(),decision={requestId:decisionId,kind:'activation-decision',orgId:'a',
      activationRequestId:second.requestId,decision:'declined',reason:'owner_request',confirmed:true};
    const declined=await saveActivationDecision(pool,identity,decision,options);
    assert.deepEqual({kind:declined.kind,state:declined.state,activationRequestId:declined.activationRequestId},
      {kind:'activation-decision',state:'declined',activationRequestId:second.requestId});
    assert.equal((await pgActivationRequestReceipt(pool,pgOwner,second.requestId,options)).state,'declined');
    assert.equal((await saveActivationDecision(pool,identity,decision,options)).duplicate,true);
    await assert.rejects(saveActivationDecision(pool,identity,{...decision,requestId:randomUUID()},options),/closed/);

    const third=input('Please activate after review.');await savePgActivationRequest(pool,pgOwner,third,options);
    const activeEnd=new Date(Date.now()+30*86400000).toISOString();
    const extended=await saveOperatorEntitlement(pool,identity,{requestId:randomUUID(),kind:'entitlement',orgId:'a',revision:1,
      state:'active',endsAt:activeEnd,workerLimit:30,plan:'pilot',termsReference:'terms-v2',reason:'trial_extension',
      activationRequestId:null,confirmed:true},options);
    assert.equal(extended.revision,2);assert.equal(extended.state,'active');assert.equal(extended.activationRequestId,third.requestId);
    assert.equal((await db.query('SELECT state FROM organization_activation_requests WHERE request_id=$1',[third.requestId])).rows[0].state,'accepted');

    const suspended=await saveOperatorEntitlement(pool,identity,{requestId:randomUUID(),kind:'entitlement',orgId:'a',revision:2,
      state:'read_only',endsAt:null,workerLimit:30,plan:'pilot',termsReference:'terms-v2',reason:'security_review',
      activationRequestId:null,confirmed:true},options);
    assert.equal(suspended.revision,3);assert.equal(suspended.state,'read_only');
    const readOnlyUsage=checkedUsageModel(await getUsage(pool,pgOwner,options),'synthetic-credential','owner');
    assert.equal(readOnlyUsage.entitlement.effectiveState,'read_only');assert.equal(readOnlyUsage.entitlement.writeAllowed,false);
    const fourth=input('Please reactivate this workspace.');const pendingFour=await savePgActivationRequest(pool,pgOwner,fourth,options);
    assert.equal(pendingFour.state,'pending');
    const reactivated=await saveOperatorEntitlement(pool,identity,{requestId:randomUUID(),kind:'entitlement',orgId:'a',revision:3,
      state:'active',endsAt:null,workerLimit:30,plan:'pilot',termsReference:'terms-v2',reason:'manual_activation',
      activationRequestId:fourth.requestId,confirmed:true},options);
    assert.equal(reactivated.revision,4);assert.equal(reactivated.state,'active');assert.equal(reactivated.activationRequestId,fourth.requestId);
    const listing=await operationsEntitlements(pool,identity,{search:'a',state:'active'},options);
    assert.equal(listing.total,1);assert.equal(listing.items[0].entitlement.state,'active');assert.equal(listing.items[0].entitlement.activeWorkers,0);
    assert.equal(listing.items[0].entitlement.request,null);
  } finally {await db.close();}
});

test('credential activation request HTTP binds page session and returns exact scoped receipts',async()=>{
  const db=new PGlite(),schema='understood_test_activation_http',origin='http://127.0.0.1:3020';
  const pool={async connect(){return {async query(sql,values){return values?.length?db.query(sql,values):(await db.exec(sql)).at(-1)||{rows:[]};},release(){}};}};
  const options={schema,integrationMode:'synthetic',dataClass:'synthetic',tier:'local',aiMode:'synthetic',accessMode:'credential',publicOrigin:origin};
  await db.exec(`CREATE SCHEMA ${schema};SET search_path TO ${schema},pg_catalog`);await runMigrations(pool,{schema,integrationMode:'synthetic'});
  await db.exec("INSERT INTO organizations(id,name) VALUES('a','A');INSERT INTO sites(id,org_id,name,timezone) VALUES('a','a','A','UTC');INSERT INTO staff(id,org_id,site_id,name,role,active) VALUES('owner','a','a','Owner','owner',true);");
  const password=`Synthetic-${randomUUID()}!`,server=createPostgresRehearsalServer(pool,options);
  try {
    await provisionStaffCredential(pool,{staffId:'owner',orgId:'a',siteId:'a',email:'owner@activation.example.test',password},{schema});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const base=`http://127.0.0.1:${server.address().port}/api`;
    const login=await fetch(`${base}/auth/staff/login`,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({email:'owner@activation.example.test',password})});
    assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
    const session=await (await fetch(`${base}/session`,{headers:{cookie}})).json(),value=input();
    const post=(headers,body=value)=>fetch(`${base}/entitlement/requests`,{method:'POST',headers:{cookie,origin,'content-type':'application/json',...headers},body:JSON.stringify(body)});
    assert.equal((await fetch(`${base}/entitlement/requests`)).status,401);
    assert.equal((await post({})).status,409);
    assert.equal((await post({'x-client-session-context':session.clientContext,origin:'http://evil.example.test'})).status,403);
    const headers={'x-client-session-context':session.clientContext};
    const saved=await post(headers);assert.equal(saved.status,201);assert.equal(saved.headers.get('cache-control'),'no-store');
    const accepted=await saved.json();assert.equal(accepted.state,'pending');assert.equal(accepted.changesApplied,false);
    assert.equal((await post(headers)).status,200);
    assert.equal((await post(headers,{...value,note:'Changed'})).status,409);
    assert.equal((await post(headers,{...input(),extra:true})).status,400);
    assert.equal((await post(headers,input())).status,409);
    const found=await fetch(`${base}/entitlement/requests/${value.requestId}`,{headers:{cookie,...headers}});
    assert.equal(found.status,200);assert.equal((await found.json()).found,true);
    assert.equal((await fetch(`${base}/entitlement/requests/${value.requestId}`,{headers:{cookie}})).status,409);
    assert.equal((await fetch(`${base}/entitlement/requests/${value.requestId}?org_id=foreign`,{headers:{cookie,...headers}})).status,400);
    await db.exec("UPDATE sessions SET revoked_at=clock_timestamp() WHERE principal_id='owner'");assert.equal((await post(headers)).status,401);
  } finally {if(server.listening)await new Promise(resolve=>server.close(resolve));await db.close();}
});
