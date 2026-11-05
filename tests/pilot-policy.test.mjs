import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {openDatabase} from '../server/db.mjs';
import {seed} from '../server/seed.mjs';
import {provisionStaffCredential} from '../server/auth.mjs';
import {createSite,listSites} from '../server/sites.mjs';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {provisionOperator,authenticateOperator} from '../server/postgres/operators.mjs';
import {saveOperatorEntitlement} from '../server/postgres/entitlement-operations.mjs';
import {entitlementState} from '../server/postgres/entitlements.mjs';
import {tokenHash} from '../server/auth-crypto.mjs';
import {PILOT_DAYS,PILOT_WORKER_LIMIT} from '../server/pilot-policy.mjs';
import {provisionStaffCredential as pgCredential} from '../server/postgres/auth.mjs';
import {createSite as pgCreateSite,listSites as pgListSites} from '../server/postgres/sites.mjs';

test('pilot site creation is unavailable before and after approval, with no extra sites created',()=>{
  const db=openDatabase(':memory:');seed(db);
  try{
    provisionStaffCredential(db,'maya','pilot-owner@example.test','Synthetic pilot password only');
    const now=new Date().toISOString();db.prepare("INSERT INTO organization_entitlements VALUES('cedar','read_only',?,NULL,25,'pilot_pending',NULL,1,'registration',?)").run(now,now);
    const owner={principal_type:'staff',principal_id:'maya',org_id:'cedar',site_id:'beirut',role:'owner',access_mode:'credential'};
    const request={requestId:randomUUID(),name:'Second pilot site',timezone:'UTC',generationLanguages:['en'],confirmed:true};
    assert.equal(listSites(db,owner).canCreate,false);
    assert.throws(()=>createSite(db,owner,request),/pilot includes one site/);
    db.prepare("UPDATE organization_entitlements SET state='trial',plan='pilot',ends_at=?,revision=revision+1").run(new Date(Date.now()+PILOT_DAYS*86400000).toISOString());
    assert.equal(listSites(db,owner).canCreate,false);
    assert.throws(()=>createSite(db,owner,request),/pilot includes one site/);
    assert.equal(db.prepare("SELECT count(*) n FROM sites WHERE org_id='cedar'").get().n,1);
  }finally{db.close();}
});

test('operator approval starts the pilot clock, accepts its pending request, caps scope and expires read-only',async()=>{
  const db=new PGlite(),schema='understood_test_pilot_policy';
  const pool={async connect(){return {query:async(sql,args)=>args?.length?db.query(sql,args):(await db.exec(sql)).at(-1)||{rows:[]},release(){}};}};
  const options={schema,integrationMode:'synthetic'};
  try{
    await db.exec(`CREATE SCHEMA ${schema};SET search_path TO ${schema},pg_catalog`);await runMigrations(pool,options);
    await db.exec("INSERT INTO organizations VALUES('a','Pilot company');INSERT INTO sites VALUES('a','a','Pilot site','UTC');INSERT INTO staff(id,org_id,site_id,name,role) VALUES('owner','a','a','Pilot owner','owner');INSERT INTO organization_entitlements VALUES('a','read_only',clock_timestamp()-interval '10 days',NULL,25,'pilot_pending',NULL,1,'registration',clock_timestamp());");
    const requestId=randomUUID();await db.query("INSERT INTO organization_activation_requests(request_id,org_id,site_id,requested_by,note,entitlement_revision,state,created_at) VALUES($1,'a','a','owner','Pilot approval',1,'pending',clock_timestamp())",[requestId]);
    const operatorId=randomUUID(),email='pilot-operator@example.test',password='Synthetic operator pilot password';
    await provisionOperator(pool,{id:operatorId,email,password,name:'Pilot reviewer'},options);
    const login=await authenticateOperator(pool,{email,password},'127.0.0.1',options),identity={token_hash:tokenHash(login.token)};
    const before=Date.now(),endsAt=new Date(before+PILOT_DAYS*86400000).toISOString();
    const command={requestId:randomUUID(),kind:'entitlement',orgId:'a',revision:1,state:'trial',endsAt,workerLimit:PILOT_WORKER_LIMIT,plan:'pilot',termsReference:'pilot-scope',reason:'pilot_review',activationRequestId:requestId,confirmed:true};
    await db.exec("INSERT INTO organizations VALUES('b','Multi-site company');INSERT INTO sites VALUES('b1','b','Site one','UTC'),('b2','b','Site two','UTC')");
    await assert.rejects(saveOperatorEntitlement(pool,identity,{...command,requestId:randomUUID(),orgId:'b',revision:0,activationRequestId:null},options),/Pilot requires one site/);
    assert.throws(()=>saveOperatorEntitlement(pool,identity,{...command,requestId:randomUUID(),workerLimit:26},options),/Invalid operator command/);
    await assert.rejects(saveOperatorEntitlement(pool,identity,{...command,requestId:randomUUID(),endsAt:new Date(before+31*86400000).toISOString()},options),/Invalid operator command/);
    const result=await saveOperatorEntitlement(pool,identity,command,options);assert.equal(result.revision,2);
    const row=(await db.query("SELECT * FROM organization_entitlements WHERE org_id='a'")).rows[0];
    assert.ok(new Date(row.started_at).getTime()>=before);assert.equal(row.plan,'pilot');assert.equal(row.worker_limit,25);
    assert.equal((await db.query('SELECT state FROM organization_activation_requests WHERE request_id=$1',[requestId])).rows[0].state,'accepted');
    assert.equal((await saveOperatorEntitlement(pool,identity,command,options)).duplicate,true);
    const client={query:(sql,args)=>db.query(sql,args)};
    assert.equal((await entitlementState(client,'a',{now:Date.parse(endsAt)-1})).writeAllowed,true);
    assert.equal((await entitlementState(client,'a',{now:Date.parse(endsAt)})).writeAllowed,false);
    await pgCredential(pool,{staffId:'owner',orgId:'a',siteId:'a',email:'pilot-site-owner@example.test',password:'Synthetic pilot site password'},options);
    const owner={principal_type:'staff',principal_id:'owner',org_id:'a',site_id:'a',role:'owner',access_mode:'credential'};
    assert.equal((await pgListSites(pool,owner,{},options)).canCreate,false);
    await assert.rejects(pgCreateSite(pool,owner,{requestId:randomUUID(),name:'Second pilot site',timezone:'UTC',generationLanguages:['en'],confirmed:true},options),/pilot includes one site/);
  }finally{await db.close();}
});
