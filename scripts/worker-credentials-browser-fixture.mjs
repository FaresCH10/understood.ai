import {PGlite} from '@electric-sql/pglite';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {createPostgresRehearsalServer} from '../server/postgres/http.mjs';
import {loadPublicBuild} from '../server/public-build.mjs';
import {insertSession,inSchema,issueWorkerGrant,provisionStaffCredential} from '../server/postgres/auth.mjs';
import {issueWorkerCredentialSetup} from '../server/postgres/worker-credentials.mjs';
import {requireLocalRequest,sessionCookie} from '../server/auth.mjs';

const port=Number(process.env.UNDERSTOOD_CREDENTIAL_FIXTURE_PORT??3245),schema='understood_test_worker_credentials_browser',db=new PGlite();
if(!Number.isInteger(port) || port<1024 || port>65535 || [3020,3021].includes(port))throw Error('Use a separate disposable fixture port');
let queue=Promise.resolve();
const pool={async connect(){const previous=queue;let release;queue=new Promise(done=>{release=done;});await previous;return {query:async(sql,args)=>args?.length?db.query(sql,args):(await db.exec(sql)).at(-1)||{rows:[]},release};}};
const origin=`http://127.0.0.1:${port}`,owner={principal_type:'staff',principal_id:'owner',org_id:'qa',site_id:'qa',role:'owner'},options={schema};
await db.exec(`CREATE SCHEMA ${schema};SET search_path TO ${schema},pg_catalog`);await runMigrations(pool,{schema});
await db.exec(`INSERT INTO organizations VALUES('qa','Synthetic Credential QA');
  INSERT INTO sites VALUES('qa','qa','Beirut QA','Asia/Beirut');
  INSERT INTO staff(id,org_id,site_id,name,role) VALUES('owner','qa','qa','Synthetic Owner','owner');
  INSERT INTO workers(id,org_id,site_id,code,name,language,active) VALUES
    ('worker','qa','qa','Worker 001','Synthetic Worker','en',true),
    ('worker2','qa','qa','Worker 002','Second Worker','en',true);`);
await provisionStaffCredential(pool,{staffId:'owner',orgId:'qa',siteId:'qa',email:'owner@credentials.example.test',password:'Synthetic-credential-fixture-1'},options);
const api=createPostgresRehearsalServer(pool,{schema,dataClass:'synthetic',tier:'local',aiMode:'synthetic',accessMode:'credential',publicOrigin:origin,publicBuild:await loadPublicBuild('dist')});
const handler=api.listeners('request')[0];api.removeAllListeners('request');
async function staffRedirect(res,location){
  const session=await inSchema(pool,schema,client=>insertSession(client,{id:'owner',org_id:'qa',site_id:'qa'},'staff'));
  res.writeHead(302,{'cache-control':'no-store','set-cookie':sessionCookie(session.token,session.maxSeconds,{name:'understood_pg_rehearsal'}),location});res.end();
}
api.on('request',(req,res)=>{
  const url=new URL(req.url,origin);
  if(url.pathname==='/api/qa-login' && req.method==='GET'){
    (async()=>{requireLocalRequest(req);await staffRedirect(res,'/#people/worker/worker');})().catch(()=>{res.writeHead(503);res.end('Synthetic fixture unavailable');});return;
  }
  if(url.pathname==='/api/qa-link' && req.method==='GET'){
    (async()=>{requireLocalRequest(req);const grant=await issueWorkerGrant(pool,owner,'worker',240,options);await staffRedirect(res,`/#worker-access/${grant.token}`);})().catch(()=>{res.writeHead(503);res.end('Synthetic fixture unavailable');});return;
  }
  if(url.pathname==='/api/qa-reset' && req.method==='GET'){
    (async()=>{requireLocalRequest(req);const issued=await issueWorkerCredentialSetup(pool,owner,'worker',{expectedCode:'Worker 001',confirmed:true,expiresInMinutes:60},options);
      res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({ok:true,setupCode:issued.setupCode,expiresAt:issued.setupExpiresAt}));})().catch(()=>{res.writeHead(503,{'content-type':'application/json'});res.end('{"error":"Synthetic reset unavailable"}');});return;
  }
  if(url.pathname==='/api/qa-status' && req.method==='GET'){
    (async()=>{requireLocalRequest(req);const read=async sql=>(await db.query(sql)).rows;
      const credential=(await read("SELECT login_id,state,credential_revision FROM worker_credentials WHERE worker_id='worker'"))[0]||null;
      const sessions=Number((await read("SELECT COUNT(*) AS n FROM sessions WHERE principal_type='worker' AND revoked_at IS NULL"))[0].n);
      const liveCodes=Number((await read("SELECT COUNT(*) AS n FROM worker_setup_tokens WHERE revoked_at IS NULL AND used_at IS NULL"))[0].n);
      const grants=Number((await read("SELECT COUNT(*) AS n FROM worker_grants WHERE revoked_at IS NULL"))[0].n);
      res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({credential,sessions,liveCodes,grants}));})().catch(()=>{res.writeHead(503,{'content-type':'application/json'});res.end('{"error":"Synthetic status unavailable"}');});return;
  }
  handler(req,res);
});
await new Promise((done,reject)=>{api.once('error',reject);api.listen(port,'127.0.0.1',done);});let stopping=false;
function stop(){if(stopping)return;stopping=true;clearTimeout(timeout);api.close(async()=>{await db.close();process.stdin.pause();});api.closeIdleConnections();}
const timeout=setTimeout(stop,15*60_000);process.stdin.setEncoding('utf8');process.stdin.on('data',value=>{if(value.trim()==='stop')stop();});process.once('SIGINT',stop);process.once('SIGTERM',stop);
console.log(JSON.stringify({fixture:'synthetic-worker-credentials',url:`${origin}/api/qa-login`,expiresInSeconds:900}));
