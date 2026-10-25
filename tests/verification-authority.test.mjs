import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {mkdtemp,readdir,copyFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {domainTransaction} from '../server/postgres/domain.mjs';
import {configureRuntimePermissions,verifyRuntimePermissions} from '../server/postgres/runtime-permissions.mjs';
import {provisionOperator,authenticateOperator,revokeOperator} from '../server/postgres/operators.mjs';
import {currentVerificationAuthority} from '../server/postgres/verification-authority.mjs';

const schema='verification_authority_test',password='Synthetic verification authority only';
async function fixture(){
  const db=new PGlite(),queries=[],pool={async connect(){return {async query(sql,args){queries.push(sql);return args?.length?db.query(sql,args):(await db.exec(sql)).at(-1)??{rows:[]};},release(){}};}};
  await db.exec(`CREATE SCHEMA ${schema};SET search_path TO ${schema},pg_catalog`);await runMigrations(pool,{schema});
  const operatorId=randomUUID();await provisionOperator(pool,{id:operatorId,email:'operator@example.test',password,name:'Synthetic operator'},{schema});
  for(const profile of ['application','worker','operator']){
    await db.exec(`CREATE ROLE verification_${profile} LOGIN`);
    await configureRuntimePermissions(pool,{schema,role:`verification_${profile}`,profile,dedicatedDatabase:true,writersStopped:true});
  }
  const owner=()=>db.exec(`SET SESSION AUTHORIZATION postgres;RESET ROLE;SET search_path TO ${schema},pg_catalog`);
  async function as(profile,run){await owner();if(profile!=='owner')await db.exec(`SET SESSION AUTHORIZATION verification_${profile}`);try{return await run();}finally{await owner();}}
  const login=()=>as('operator',()=>authenticateOperator(pool,{email:'operator@example.test',password},'synthetic',{schema}));
  async function approve(session,{expired=false,requestId=randomUUID()}={}){
    const operationId=randomUUID();
    await as('owner',()=>domainTransaction(pool,schema,async client=>{
      await client.query("INSERT INTO provider_operations(id,org_id,kind,reference_id,model,data_class,reserved_requests,quota_day) VALUES($1,NULL,'connection-test',$2,'gemini-test','synthetic',1,CURRENT_DATE)",[operationId,requestId]);
      await client.query(`INSERT INTO provider_verifications(request_id,operator_id,session_hash,operation_id,config_hash,request_json,state,deadline_at)
        VALUES($1,$2,$3,$4,$5,$6,'pending',clock_timestamp()+${expired?"interval '-1 second'":"interval '90 seconds'"})`,
        [requestId,session.operator_id,session.token_hash,operationId,'f'.repeat(64),JSON.stringify({kind:'provider-verification',maxRequests:1,confirmed:true})]);
    }));return requestId;
  }
  const check=id=>as('worker',()=>domainTransaction(pool,schema,client=>currentVerificationAuthority(client,id)));
  return {db,pool,queries,as,login,approve,check,operatorId,close:()=>db.close()};
}

test('worker sees only minimal approval metadata and cannot create, extend, revoke or read operator identity/session evidence',async()=>{
  const f=await fixture();try{
    const login=await f.login(),id=await f.approve(login.session);f.queries.length=0;await f.check(id);
    await f.as('worker',async()=>{
      assert.equal((await verifyRuntimePermissions(f.pool,{schema,profile:'worker'})).readOnlyTables,35);
      const rows=(await f.db.query('SELECT * FROM provider_verification_authorities')).rows;
      assert.deepEqual(Object.keys(rows[0]).sort(),['expires_at','request_id','revoked']);assert.equal(rows[0].request_id,id);
      for(const sql of ['SELECT * FROM operator_sessions','SELECT * FROM platform_operators','SELECT * FROM provider_verifications',
        'INSERT INTO provider_verification_authorities DEFAULT VALUES','DELETE FROM provider_verification_authorities',
        'UPDATE provider_verification_authorities SET revoked=true',"UPDATE provider_verification_authorities SET expires_at=clock_timestamp()+interval '1 day'"])
        await assert.rejects(f.db.query(sql),error=>error.code==='42501',sql);
    });
    await f.as('application',()=>assert.rejects(f.db.query('SELECT * FROM provider_verification_authorities'),error=>error.code==='42501'));
    await f.as('operator',async()=>{
      await assert.rejects(f.db.query("UPDATE provider_verification_authorities SET expires_at=clock_timestamp()+interval '1 day'"),error=>error.code==='42501');
      await assert.rejects(f.db.query('INSERT INTO provider_verification_authorities DEFAULT VALUES'),error=>error.code==='42501');
      await assert.rejects(f.db.query('DELETE FROM provider_verification_authorities'),error=>error.code==='42501');
    });
    await assert.rejects(f.check(randomUUID()),/authority changed/);await assert.rejects(f.check('invalid'),/Invalid verification/);
    const lock=f.queries.findIndex(sql=>sql.startsWith("SELECT pg_advisory_xact_lock(hashtextextended(current_schema()||':verification-authority'")),read=f.queries.findIndex(sql=>sql.startsWith('SELECT NOT revoked'));
    assert.ok(lock>=0 && read>lock);
  }finally{await f.close();}
});
test('authorization retains all UUID versions accepted by existing provider commands',async()=>{
  const f=await fixture();try{
    const login=await f.login();
    for(const version of [1,2,3,4,5])await f.check(await f.approve(login.session,{requestId:`11111111-1111-${version}111-8111-111111111111`}));
    for(const version of [0,6,7,8,9])await assert.rejects(f.check(`11111111-1111-${version}111-8111-111111111111`),/Invalid verification/);
  }finally{await f.close();}
});
for(const action of ['logout','new_login','delete_session','shorten_expiry','disable_operator','change_revision','rotate_password','complete_verification'])test(`verification approval closes on ${action} without giving worker private authority`,async()=>{
  const f=await fixture();try{
    const login=await f.login(),id=await f.approve(login.session);await f.check(id);
    if(action==='logout')await f.as('operator',()=>revokeOperator(f.pool,login.session,{schema}));
    if(action==='new_login')await f.login();
    if(action==='delete_session')await f.as('operator',()=>f.db.query('DELETE FROM operator_sessions WHERE token_hash=$1',[login.session.token_hash]));
    if(action==='shorten_expiry')await f.as('owner',()=>f.db.query("UPDATE operator_sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE token_hash=$1",[login.session.token_hash]));
    if(action==='disable_operator')await f.as('owner',()=>f.db.query('UPDATE platform_operators SET active=false WHERE id=$1',[f.operatorId]));
    if(action==='change_revision')await f.as('owner',()=>f.db.query('UPDATE platform_operators SET revision=revision+1 WHERE id=$1',[f.operatorId]));
    if(action==='rotate_password')await f.as('owner',()=>provisionOperator(f.pool,{id:f.operatorId,email:'operator@example.test',password:'New synthetic verification password',name:'Synthetic operator'},{schema}));
    if(action==='complete_verification')await f.as('owner',()=>f.db.query("UPDATE provider_verifications SET state='failed',finished_at=clock_timestamp() WHERE request_id=$1",[id]));
    await assert.rejects(f.check(id),/authority changed/);
    await f.as('operator',()=>assert.rejects(f.db.query('UPDATE provider_verification_authorities SET revoked=false WHERE request_id=$1',[id]),/immutable/));
  }finally{await f.close();}
});
test('expired approvals fail closed and runtime admission rejects disabled, privileged or altered authority guards',async()=>{
  const f=await fixture();try{
    const login=await f.login(),id=await f.approve(login.session,{expired:true});await assert.rejects(f.check(id),/authority changed/);
    for(const [damage,restore] of [
      ['ALTER TABLE operator_sessions DISABLE TRIGGER verification_authority_session','ALTER TABLE operator_sessions ENABLE TRIGGER verification_authority_session'],
      ['ALTER FUNCTION revoke_verification_authority() SECURITY DEFINER','ALTER FUNCTION revoke_verification_authority() SECURITY INVOKER'],
      ["ALTER FUNCTION capture_verification_authority() SET search_path='pg_catalog'",'ALTER FUNCTION capture_verification_authority() RESET ALL'],
    ]){
      await f.db.exec(damage);await f.as('worker',()=>assert.rejects(verifyRuntimePermissions(f.pool,{schema,profile:'worker'}),/authority guards/));await f.db.exec(restore);
    }
    const original=(await f.db.query("SELECT pg_get_functiondef('revoke_verification_authority()'::regprocedure) AS body")).rows[0].body;
    await f.db.exec(original.replace("':verification-authority'","':verification-authority\r'"));
    await f.as('worker',()=>assert.rejects(verifyRuntimePermissions(f.pool,{schema,profile:'worker'}),/authority guards/));
    await f.db.exec(original);await f.as('worker',()=>verifyRuntimePermissions(f.pool,{schema,profile:'worker'}));
  }finally{await f.close();}
});

test('89 migration backfills real88 verification rows conservatively without reopening history',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'understood-verification-legacy-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  for(const name of await readdir('server/postgres/migrations'))if(/^\d{3}_[a-z0-9_]+\.sql$/.test(name) && name<'089_')
    await copyFile(join('server/postgres/migrations',name),join(directory,name));
  const db=new PGlite(),pool={async connect(){return {query:async(sql,args)=>args?.length?db.query(sql,args):(await db.exec(sql)).at(-1)??{rows:[]},release(){}};}};
  try{
    assert.equal((await runMigrations(pool,{directory})).length,88);
    const cases=['active','expired_session','missing_session','revoked_session','inactive_operator','completed','expired_approval','mismatched_operator'],ids=new Map();
    for(const kind of cases){
      const operatorId=randomUUID(),requestId=randomUUID(),operationId=randomUUID(),sessionHash=randomUUID().replaceAll('-','').repeat(2);ids.set(kind,requestId);
      await provisionOperator(pool,{id:operatorId,email:`${kind}@example.test`,name:kind,password});
      const sessionOperator=kind==='mismatched_operator'?randomUUID():operatorId;
      if(sessionOperator!==operatorId)await provisionOperator(pool,{id:sessionOperator,email:'other@example.test',name:'Other synthetic operator',password});
      if(kind==='inactive_operator')await db.query('UPDATE platform_operators SET active=false WHERE id=$1',[operatorId]);
      if(kind!=='missing_session')await db.query(`INSERT INTO operator_sessions(token_hash,operator_id,operator_revision,expires_at,revoked_at)
        VALUES($1,$2,1,clock_timestamp()+${kind==='expired_session'?"interval '-1 second'":"interval '1 hour'"},${kind==='revoked_session'?'clock_timestamp()':'NULL'})`,[sessionHash,sessionOperator]);
      await db.query("INSERT INTO provider_operations(id,org_id,kind,reference_id,model,data_class,reserved_requests,quota_day) VALUES($1,NULL,'connection-test',$2,'gemini-test','synthetic',1,CURRENT_DATE)",[operationId,requestId]);
      await db.query(`INSERT INTO provider_verifications(request_id,operator_id,session_hash,operation_id,config_hash,request_json,state,deadline_at,finished_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,clock_timestamp()+${kind==='expired_approval'?"interval '-1 second'":"interval '90 seconds'"},${kind==='completed'?'clock_timestamp()':'NULL'})`,
        [requestId,operatorId,sessionHash,operationId,'f'.repeat(64),JSON.stringify({kind:'provider-verification',maxRequests:1,confirmed:true}),kind==='completed'?'failed':'pending']);
    }
    const before=(await db.query('SELECT * FROM provider_verifications ORDER BY request_id')).rows;
    assert.deepEqual(await runMigrations(pool),['089_provider_verification_authorities.sql', '090_provider_verification_jobs.sql', '091_provider_verification_workers.sql', '092_worker_identity_locks.sql', '093_clarification_action_receipts.sql', '094_staff_clarification_creations.sql', '095_staff_inperson_recordings.sql','096_instruction_modes_and_acknowledgments.sql','097_worker_language_identity.sql','098_worker_password_credentials.sql','099_worker_language_locales.sql','100_presentation_artifacts.sql','101_presentation_retention.sql','102_recording_presentation_guard.sql','103_instruction_deliveries.sql','104_instruction_content_retention.sql','105_organization_entitlements.sql','106_owner_registration.sql','107_first_run_onboarding.sql','108_notification_events.sql']);
    assert.deepEqual((await db.query('SELECT * FROM provider_verifications ORDER BY request_id')).rows,before);
    for(const kind of cases){
      const check=()=>domainTransaction(pool,'public',client=>currentVerificationAuthority(client,ids.get(kind)));
      if(kind==='active')await check();else await assert.rejects(check(),/authority changed/,kind);
    }
    const authorities=(await db.query('SELECT * FROM provider_verification_authorities ORDER BY request_id')).rows;
    assert.equal(authorities.length,cases.length);assert.deepEqual(await runMigrations(pool),[]);
    assert.deepEqual((await db.query('SELECT * FROM provider_verification_authorities ORDER BY request_id')).rows,authorities);
  }finally{await db.close();}
});
