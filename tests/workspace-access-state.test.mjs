import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {openDatabase} from '../server/db.mjs';
import {sqliteApp,TEST_PASSWORD} from './helpers/sqlite-app.mjs';
import {workspaceAccessState as sqliteAccess,entitlementState as sqliteEntitlement} from '../server/entitlements.mjs';
import {saveActivationRequest} from '../server/activation.mjs';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {createPostgresRehearsalServer} from '../server/postgres/http.mjs';
import {provisionStaffCredential} from '../server/postgres/auth.mjs';
import {provisionOperator,authenticateOperator} from '../server/postgres/operators.mjs';
import {saveActivationDecision,saveOperatorEntitlement} from '../server/postgres/entitlement-operations.mjs';
import {saveActivationRequest as pgRequest} from '../server/postgres/activation.mjs';
import {workspaceAccessState as pgAccess} from '../server/postgres/entitlements.mjs';
import {pendingWorkspaceState} from '../server/pilot-policy.mjs';
import {tokenHash} from '../server/auth-crypto.mjs';

const request=()=>({requestId:randomUUID(),note:'PRIVATE_REQUEST_NOTE',confirmed:true});

test('workspace decision is shown only for pending pilots and plans',()=>{
  assert.equal(pendingWorkspaceState('pilot_pending','declined'),'declined');
  assert.equal(pendingWorkspaceState('pro_pending','declined'),'declined');
  assert.equal(pendingWorkspaceState('pilot_pending','pending'),'pending');
  assert.equal(pendingWorkspaceState('pilot_pending',null),'pending');
  for(const plan of ['pilot','pro','trial',null])assert.equal(pendingWorkspaceState(plan,'declined'),null);
});

test('SQLite supervisor session exposes the latest pilot decision and keeps rejected access closed',async()=>{
  const db=openDatabase(':memory:'),server=sqliteApp(db),origin='http://127.0.0.1:3020';
  try{
    const now=new Date().toISOString();
    db.prepare("INSERT INTO organization_entitlements VALUES('cedar','read_only',?,NULL,25,'pilot_pending',NULL,1,'registration',?)").run(now,now);
    const owner={principal_type:'staff',principal_id:'maya',org_id:'cedar',site_id:'beirut',role:'owner'},first=request();
    saveActivationRequest(db,owner,first);
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}/api`;
    const login=await fetch(base+'/auth/staff/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({email:'maya@example.test',password:TEST_PASSWORD})});
    assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
    const session=async()=>{const response=await fetch(base+'/session',{headers:{cookie}});assert.equal(response.status,200);return response.json();};
    assert.equal((await session()).workspaceAccessState,'pending');
    db.prepare("UPDATE organization_activation_requests SET state='declined',decided_at=?,decided_by='reviewer',decision_ref=? WHERE request_id=?").run(now,randomUUID(),first.requestId);
    const declined=await session();assert.equal(declined.workspaceAccessState,'declined');assert.equal(declined.workspacePlan,'pilot_pending');
    assert.equal(JSON.stringify(declined).includes('PRIVATE_REQUEST_NOTE'),false);
    assert.equal(sqliteEntitlement(db,'cedar').writeAllowed,false);
    assert.equal((await fetch(base+'/overview',{headers:{cookie,'x-client-session-context':declined.clientContext}})).status,403);
    saveActivationRequest(db,owner,request());assert.equal(sqliteAccess(db,'cedar'),'pending');
    db.prepare("UPDATE organization_entitlements SET state='trial',plan='pilot',ends_at=?,revision=revision+1 WHERE org_id='cedar'").run(new Date(Date.now()+86400000).toISOString());
    assert.equal(sqliteAccess(db,'cedar'),null);
  }finally{if(server.listening)await new Promise(resolve=>server.close(resolve));db.close();}
});

test('PostgreSQL operator decline reaches the signed-in session without granting access or leaking another workspace decision',async()=>{
  const db=new PGlite(),schema='understood_test_declined_pilot';let queue=Promise.resolve();
  const pool={async connect(){const previous=queue;let release;queue=new Promise(done=>{release=done;});await previous;return {release,async query(sql,args){return args?.length?db.query(sql,args):(await db.exec(sql)).at(-1)||{rows:[]};}};}};
  const origin='http://127.0.0.1:3147',options={schema,integrationMode:'synthetic',dataClass:'synthetic',tier:'local',aiMode:'synthetic',accessMode:'credential',publicOrigin:origin};
  let server;
  try{
    await db.exec(`CREATE SCHEMA ${schema};SET search_path TO ${schema},pg_catalog`);await runMigrations(pool,{schema});
    await db.exec("INSERT INTO organizations VALUES('a','A'),('b','B');INSERT INTO sites VALUES('a','a','A','UTC'),('b','b','B','UTC');INSERT INTO staff(id,org_id,site_id,name,role) VALUES('owner','a','a','Owner','owner'),('other','b','b','Other','owner');INSERT INTO organization_entitlements VALUES('a','read_only',clock_timestamp(),NULL,25,'pilot_pending',NULL,1,'registration',clock_timestamp()),('b','read_only',clock_timestamp(),NULL,25,'pilot_pending',NULL,1,'registration',clock_timestamp());");
    const owner={principal_type:'staff',principal_id:'owner',org_id:'a',site_id:'a',role:'owner'},first=request();
    await pgRequest(pool,owner,first,options);
    const password='Synthetic-pilot-decision-password-123';
    await provisionStaffCredential(pool,{staffId:'owner',orgId:'a',siteId:'a',email:'decline-owner@example.test',password},options);
    const operatorId=randomUUID();await provisionOperator(pool,{id:operatorId,email:'decline-reviewer@example.test',password,name:'Reviewer'},options);
    const operator=await authenticateOperator(pool,{email:'decline-reviewer@example.test',password},'127.0.0.1',options),identity={token_hash:tokenHash(operator.token)};
    server=createPostgresRehearsalServer(pool,options);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}/api`;
    const login=await fetch(base+'/auth/staff/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({email:'decline-owner@example.test',password})});
    assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
    const session=async()=>{const response=await fetch(base+'/session',{headers:{cookie}});assert.equal(response.status,200);return response.json();};
    assert.equal((await session()).workspaceAccessState,'pending');
    await saveActivationDecision(pool,identity,{requestId:randomUUID(),kind:'activation-decision',orgId:'a',activationRequestId:first.requestId,decision:'declined',reason:'pilot_review',confirmed:true},options);
    const declined=await session();assert.equal(declined.workspaceAccessState,'declined');assert.equal(declined.workspacePlan,'pilot_pending');
    assert.equal(JSON.stringify(declined).includes('PRIVATE_REQUEST_NOTE'),false);
    assert.equal((await fetch(base+'/overview',{headers:{cookie,'x-client-session-context':declined.clientContext}})).status,403);
    assert.equal(await pgAccess({query:(sql,args)=>db.query(sql,args)},'b'),'pending');
    const second=request();await pgRequest(pool,owner,second,options);assert.equal((await session()).workspaceAccessState,'pending');
    await saveOperatorEntitlement(pool,identity,{requestId:randomUUID(),kind:'entitlement',orgId:'a',revision:1,state:'trial',endsAt:new Date(Date.now()+86400000).toISOString(),workerLimit:25,plan:'pilot',termsReference:'approved-pilot',reason:'pilot_review',activationRequestId:second.requestId,confirmed:true},options);
    const approved=await session();assert.equal(approved.workspaceAccessState,null);assert.equal(approved.workspacePlan,'pilot');
  }finally{if(server?.listening)await new Promise(resolve=>server.close(resolve));await db.close();}
});
