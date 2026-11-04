import {createServer} from 'node:http';
import {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {configureRuntimePermissions,verifyRuntimePermissions} from '../server/postgres/runtime-permissions.mjs';
import {provisionOperator} from '../server/postgres/operators.mjs';
import {handleOperationsRoute} from '../server/postgres/operations-http.mjs';
import {loadOperatorBuild} from '../server/public-build.mjs';
import {verifyMutationOrigin} from '../server/auth.mjs';
import {send} from '../server/http.mjs';
import {recordVerificationWorker} from '../server/postgres/verification-workers.mjs';
import {processOneProviderVerification} from '../server/postgres/provider-verification-worker.mjs';
import {resolveProviderVerification} from '../server/ai/provider-verification-config.mjs';
import {CANONICAL_SOURCE,syntheticPrepare} from '../server/domain.mjs';
import {domainTransaction} from '../server/postgres/domain.mjs';
import {readJson} from '../server/http.mjs';
import {insertSession} from '../server/postgres/auth.mjs';
import {passwordRecord} from '../server/auth-crypto.mjs';

if(process.argv.length!==3 || process.argv[2]!=='--confirm-local-operator-ui')throw Error('Confirm the disposable local operator UI fixture');
const port=Number(process.env.UNDERSTOOD_QA_OPERATOR_PORT || 3194);
if(!Number.isInteger(port) || port<1024 || port>65535)throw Error('Invalid operator fixture port');
const origin=`http://127.0.0.1:${port}`,schema='understood_operator_ui',role='operator_ui_runtime';
const verification=process.env.UNDERSTOOD_QA_VERIFICATION==='true',db=new PGlite();let tail=Promise.resolve();
const poolFor=identity=>({async connect(){
  const previous=tail;let release;tail=new Promise(resolve=>{release=resolve;});await previous;
  try{await db.exec('SET SESSION AUTHORIZATION postgres;RESET ROLE');if(identity!=='postgres')await db.exec(`SET SESSION AUTHORIZATION ${identity}`);}
  catch(error){release();throw error;}
  return {query:async(sql,args)=>args?.length?db.query(sql,args):(await db.exec(sql)).at(-1)??{rows:[]},release};
}}),owner=poolFor('postgres'),pool=poolFor(role),worker=poolFor('operator_ui_worker');
await db.exec(`CREATE SCHEMA ${schema};SET search_path TO ${schema},pg_catalog`);await runMigrations(owner,{schema});
await db.exec(`INSERT INTO organizations VALUES('synthetic','Cedar Works · synthetic QA'),('synthetic-east','Atlas Field Services · synthetic QA');
  INSERT INTO sites VALUES('qa','synthetic','Beirut workshop','Asia/Beirut'),('qa-yard','synthetic','North yard','Asia/Beirut'),
    ('qa-archive','synthetic','Old workshop','Asia/Beirut'),('qa-east','synthetic-east','East operations','UTC');
  INSERT INTO staff(id,org_id,site_id,name,role,active) VALUES
    ('qa-owner','synthetic','qa','Synthetic Cedar owner','owner',true),
    ('qa-supervisor','synthetic','qa-yard','Synthetic yard supervisor','supervisor',true),
    ('qa-disabled-staff','synthetic','qa','Synthetic former auditor','auditor',false),
    ('qa-east-owner','synthetic-east','qa-east','Synthetic Atlas owner','owner',true);
  INSERT INTO workers(id,org_id,site_id,code,language,active) VALUES
    ('qa-worker-active','synthetic','qa','CW-1042','en',true),
    ('qa-worker-disabled','synthetic','qa','CW-1055','ar',false),
    ('qa-worker-new','synthetic','qa','CW-1080','ur',true),
    ('qa-worker-yard','synthetic','qa-yard','CW-2011','en',true),
    ('qa-worker-archived','synthetic','qa-archive','CW-3004','ar',true),
    ('qa-east-worker','synthetic-east','qa-east','AF-1010','en',true);`);
const syntheticCredential=await passwordRecord('Disposable synthetic worker only');
await domainTransaction(owner,schema,async client=>{
  await client.query(`INSERT INTO worker_credentials(worker_id,org_id,site_id,login_id,state,password_salt,password_hash,credential_revision,password_changed_at)
    VALUES('qa-worker-active','synthetic','qa','CW-1042','active',$1,$2,1,clock_timestamp()),
      ('qa-east-worker','synthetic-east','qa-east','AF-1010','active',$1,$2,1,clock_timestamp())`,[syntheticCredential.salt,syntheticCredential.derived]);
  await client.query("INSERT INTO worker_credentials(worker_id,org_id,site_id,login_id,state,credential_revision,setup_issued_at) VALUES('qa-worker-new','synthetic','qa','CW-1080','setup',1,clock_timestamp())");
  for(const [id,orgId,siteId,type,revision] of [
    ['qa-owner','synthetic','qa','staff',null],['qa-owner','synthetic','qa','staff',null],
    ['qa-supervisor','synthetic','qa-yard','staff',null],['qa-east-owner','synthetic-east','qa-east','staff',null],
    ['qa-worker-active','synthetic','qa','worker',1],['qa-east-worker','synthetic-east','qa-east','worker',1]])
    await insertSession(client,{id,org_id:orgId,site_id:siteId},type,null,8*3600,revision);
  await client.query("INSERT INTO site_access_controls(site_id,org_id,revision,state,reason) VALUES('qa-yard','synthetic',1,'paused','maintenance')");
  await client.query("INSERT INTO site_lifecycle(site_id,org_id,revision,state,reason) VALUES('qa-archive','synthetic',1,'archived','maintenance')");
});
await provisionOperator(owner,{id:randomUUID(),email:'operator@example.test',name:'Synthetic operator',password:'Disposable synthetic operator only'},{schema});
await db.exec(`CREATE ROLE ${role} LOGIN`);
await configureRuntimePermissions(owner,{schema,role,profile:'operator',dedicatedDatabase:true,writersStopped:true});
await db.exec('SET SESSION AUTHORIZATION postgres;RESET ROLE;CREATE ROLE operator_ui_worker LOGIN');
await configureRuntimePermissions(owner,{schema,role:'operator_ui_worker',profile:'worker',dedicatedDatabase:true,writersStopped:true});
await verifyRuntimePermissions(pool,{schema,profile:'operator'});await verifyRuntimePermissions(worker,{schema,profile:'worker'});
let calls=0,workerId=randomUUID(),workerActive=verification,receiptOutage=false,loseAck=false,heartbeatBusy=false;
const privateConfig=resolveProviderVerification({UNDERSTOOD_TIER:'local',UNDERSTOOD_AI_MODE:'synthetic',UNDERSTOOD_ACCESS_MODE:'credential',
  UNDERSTOOD_DATA_CLASS:'synthetic',UNDERSTOOD_PROVIDER_TESTS:verification?'gemini-free':'disabled',GEMINI_API_KEY:'synthetic-browser-never-live'},
  {fetchImpl:async()=>{calls++;const {title,facts,question,rubric}=syntheticPrepare(CANONICAL_SOURCE);
    return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({title,facts,question,askedFacts:rubric.askedFacts})}]}}]});}});
if(verification)await recordVerificationWorker(worker,workerId,privateConfig,'idle',{schema});
const heartbeat=setInterval(()=>{if(!workerActive || heartbeatBusy)return;heartbeatBusy=true;
  recordVerificationWorker(worker,workerId,privateConfig,'idle',{schema}).catch(()=>{workerActive=false;}).finally(()=>{heartbeatBusy=false;});},5000);
const build=await loadOperatorBuild('dist'),requests=[];
// Loopback HTTP rendering only: hosted TLS/proxy/cookie enforcement has separate tests.
const server=createServer(async(req,res)=>{
  try {
    if(req.socket.remoteAddress!=='127.0.0.1')return send(res,403,{error:'Local fixture only'});
    const url=new URL(req.url,origin);requests.push({method:req.method,path:url.pathname});
    if(url.pathname==='/api/qa/operator-evidence' && req.method==='GET')return send(res,200,{synthetic:true,runtimeRole:role,requests,productionReady:false});
    // This loopback-only fixture is explicitly opted into by its CLI flag. The
    // QA endpoint injects lost responses after a real database commit.
    if(url.pathname==='/api/qa/support' && req.method==='POST'){
      verifyMutationOrigin(req,{publicOrigin:origin});const body=await readJson(req,1024);
      if(!body || Object.keys(body).join(',')!=='action')return send(res,400,{error:'Unknown synthetic action'});
      if(body.action==='lose-ack')loseAck=true;
      else if(body.action==='receipt-outage')receiptOutage=true;
      else if(body.action==='receipt-recover')receiptOutage=false;
      else return send(res,400,{error:'Unknown synthetic action'});
      return send(res,200,{ok:true,synthetic:true});
    }
    if(url.pathname==='/api/qa/support-evidence' && req.method==='GET'){
      const evidence=await domainTransaction(owner,schema,async client=>({
        accounts:(await client.query(`SELECT org_id AS "orgId",site_id AS "siteId",principal_type AS "principalType",principal_id AS "principalId",
          COUNT(*) FILTER(WHERE revoked_at IS NULL AND expires_at>CURRENT_TIMESTAMP)::int AS "activeSessionCount",
          COUNT(*) FILTER(WHERE revoked_at IS NOT NULL)::int AS "revokedSessionCount"
          FROM sessions GROUP BY org_id,site_id,principal_type,principal_id ORDER BY org_id,site_id,principal_type,principal_id`)).rows,
        revocationReceipts:(await client.query("SELECT COUNT(*)::int AS count FROM operator_requests WHERE request_json->>'kind'='session-revocation'")).rows[0].count,
        revocationAuditCount:(await client.query("SELECT COUNT(*)::int AS count FROM operator_audit WHERE action='account.sessions_revoked'")).rows[0].count}));
      return send(res,200,{synthetic:true,...evidence,receiptOutage,productionReady:false});
    }
    if(verification && url.pathname==='/api/qa/verification' && req.method==='POST'){
      verifyMutationOrigin(req,{publicOrigin:origin});const {action}=await readJson(req,1024);
      if(action==='run')await processOneProviderVerification(worker,privateConfig,{schema});
      else if(action==='stop'){workerActive=false;await recordVerificationWorker(worker,workerId,undefined,'stopped',{schema});}
      else if(action==='start'){workerId=randomUUID();await recordVerificationWorker(worker,workerId,privateConfig,'idle',{schema});workerActive=true;}
      else if(action==='receipt-outage')receiptOutage=true;
      else if(action==='receipt-recover')receiptOutage=false;
      else if(action==='lose-ack')loseAck=true;
      else return send(res,400,{error:'Unknown synthetic action'});
      return send(res,200,{ok:true});
    }
    if(verification && url.pathname==='/api/qa/verification-evidence' && req.method==='GET'){
      const rows=await domainTransaction(worker,schema,async client=>({jobs:(await client.query('SELECT status,COUNT(*)::int n FROM provider_verification_jobs GROUP BY status')).rows,
        slots:(await client.query('SELECT COALESCE(SUM(reserved_requests),0)::int n FROM provider_operations')).rows[0].n}));
      return send(res,200,{...rows,calls,workerActive,receiptOutage,externalRequests:0,productionReady:false});
    }
    if(!url.pathname.startsWith('/api/'))return build(req,res,url);
    if(!url.pathname.startsWith('/api/ops/'))return send(res,404,{error:'Not found'});
    if(req.method!=='GET')verifyMutationOrigin(req,{publicOrigin:origin});
    if(receiptOutage && url.pathname.startsWith('/api/ops/receipts/'))return send(res,503,{error:'Synthetic receipt outage'});
    let target=res;
    if(loseAck && req.method==='POST' && ['/api/ops/providers/verify','/api/ops/support/revoke-sessions'].includes(url.pathname)){
      loseAck=false;let status,headers;
      target={writeHead:(code,value)=>{status=code;headers=value;},end:body=>{if(status===200)send(res,503,{error:'Synthetic lost acknowledgement'});else {res.writeHead(status,headers);res.end(body);}}};
    }
    await handleOperationsRoute(pool,req,target,url,{schema,enabled:true,workerVerification:verification,secure:false});
  }catch{send(res,503,{error:'Disposable operator fixture unavailable'});}
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
let stopping=false;
const stop=()=>{if(stopping)return;stopping=true;workerActive=false;clearInterval(heartbeat);server.close(()=>void tail.then(()=>db.close()));};
process.once('SIGINT',stop);process.once('SIGTERM',stop);
console.log(`Disposable in-memory operator UI: ${origin}/. Fixed synthetic login operator@example.test / Disposable synthetic operator only. No cloud, provider, mail or real data. Not hosted TLS/cookie evidence.`);
