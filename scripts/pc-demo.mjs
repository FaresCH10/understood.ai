import {readFileSync} from 'node:fs';
import {resolve,isAbsolute} from 'node:path';
import {parseEnv} from 'node:util';
import {createPostgresPool} from '../server/postgres/db.mjs';
import {verifyMigrations} from '../server/postgres/migrate.mjs';
import {verifyRuntimePermissions} from '../server/postgres/runtime-permissions.mjs';
import {createPostgresHostedServer} from '../server/postgres/http.mjs';
import {runRehearsalWorker} from '../server/postgres/runtime.mjs';
import {localAudioStore} from '../server/private-storage.mjs';
import {pcDemoConfig} from '../server/postgres/pc-demo-config.mjs';

async function main(){
  const service=process.argv[2],file=resolve(process.argv[3] ?? 'artifacts/pc-demo/runtime.json');
  const saved=JSON.parse(readFileSync(file,'utf8'));
  if(saved.mailSecretPath && !isAbsolute(saved.mailSecretPath))throw Error('Mail secret path must be absolute');
  const mailEnv=saved.mailSecretPath?parseEnv(readFileSync(saved.mailSecretPath,'utf8')):{};
  const config=pcDemoConfig(saved,{service,mailEnv});
  const pool=await createPostgresPool({connectionString:saved[service==='api'?'apiUrl':'workerUrl'],tls:true,caFile:saved.caFile});
  pool.on('error',()=>console.error('PC demo database connection unavailable'));
  const storage=localAudioStore(config.audioRoot),stop=new AbortController();let server;
  process.once('SIGINT',()=>stop.abort());process.once('SIGTERM',()=>stop.abort());
  try {
    await verifyMigrations(pool,{schema:config.schema});
    await verifyRuntimePermissions(pool,{schema:config.schema,profile:config.runtimeRoleProfile});
    if(service==='worker'){
      console.log(`PC synthetic worker started; external AI and push disabled; email ${config.mail.available?'enabled':'disabled'}.`);
      await runRehearsalWorker(pool,storage,config,{signal:stop.signal,intervalMs:1500,onError:stage=>console.error(`PC demo task unavailable: ${stage}`)});
    }else{
      server=createPostgresHostedServer(pool,{config,storage,publicBuild:(_req,res)=>{res.writeHead(404);res.end();}});
      server.headersTimeout=15000;server.requestTimeout=30000;server.maxHeadersCount=100;
      await new Promise((done,reject)=>{server.once('error',reject);server.listen(config.port,'127.0.0.1',done);});
      console.log(`PC synthetic API listening on loopback port ${config.port}.`);
      await new Promise(done=>stop.signal.addEventListener('abort',done,{once:true}));
    }
  }finally{if(server){server.closeAllConnections();await new Promise(done=>server.close(done));}await pool.end();}
}
main().catch(error=>{console.error('PC demo stopped:',error.message?.replace(/postgres(?:ql)?:\/\/[^\s]+/gi,'[redacted]'));process.exitCode=1;});
