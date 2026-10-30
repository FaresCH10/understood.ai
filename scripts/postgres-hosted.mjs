import {neonEnvironment} from '../server/neon-env.mjs';
import {readFileSync,statSync} from 'node:fs';
import {productionServiceConfig} from '../server/postgres/production-admission.mjs';
import {hostedSyntheticConfig} from '../server/postgres/hosted-config.mjs';
import {createPostgresPool} from '../server/postgres/db.mjs';
import {verifyMigrations} from '../server/postgres/migrate.mjs';
import {verifyRuntimePermissions} from '../server/postgres/runtime-permissions.mjs';
import {startHostedApi,startHostedOperator} from '../server/postgres/hosted-runtime.mjs';
import {fileURLToPath} from 'node:url';
import {runRehearsalWorker as runPostgresWorker} from '../server/postgres/runtime.mjs';
import {hostedPrivateAudioStore} from '../server/private-storage.mjs';

export function hostedServiceArguments(args) {
  const mode=args[0] ?? 'api';
  if(args.length>1 || !['api','worker','operator','check','check-worker','check-operator'].includes(mode))throw Error('Select one hosted API, worker or operator command');
  return {mode,service:['worker','check-worker'].includes(mode)?'worker':['operator','check-operator'].includes(mode)?'operator':'api'};
}
async function main() {
  Object.assign(process.env,neonEnvironment(process.env));
  const {mode,service}=hostedServiceArguments(process.argv.slice(2));
  let approvalManifest;
  if(process.env.UNDERSTOOD_TIER==='production'){const path=process.env.UNDERSTOOD_RELEASE_APPROVAL_FILE;if(!path||statSync(path).size>65536)throw Error('Production approval file required');approvalManifest=JSON.parse(readFileSync(path,'utf8'));}
  const config=process.env.UNDERSTOOD_TIER==='production'?productionServiceConfig(process.env,{service,approvalManifest}):hostedSyntheticConfig(process.env,{service});
  const pool=await createPostgresPool(),storage=service==='operator'?null:hostedPrivateAudioStore(config),stop=new AbortController();let server;
  const shutdown=()=>stop.abort();process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
  try {
    if(['api','operator'].includes(mode)) {
      server=mode==='operator'?await startHostedOperator(pool,config):await startHostedApi(pool,storage,config);
      console.log(`Hosted ${config.integrationMode.toUpperCase()} PostgreSQL ${service} listening on port ${config.port}. Release data class: ${config.dataClass}.`);
      if(!stop.signal.aborted)await new Promise(resolve=>stop.signal.addEventListener('abort',resolve,{once:true}));
    }else {
      const result=await verifyMigrations(pool,{schema:config.schema});
      await verifyRuntimePermissions(pool,{schema:config.schema,profile:config.runtimeRoleProfile});
      if(['check','check-worker','check-operator'].includes(mode)){console.log(`Hosted ${config.integrationMode} ${config.runtimeRoleProfile} schema verified (${result.migrations} migrations). No storage/provider connection was tested.`);return;}
      console.log(`Hosted ${config.integrationMode.toUpperCase()} PostgreSQL worker started. Fixed verification tests are ${config.providerVerification?.metadata.testEnabled?'enabled by configuration; operator approval and quota are required':'disabled'}. Release data class: ${config.dataClass}.`);
      await runPostgresWorker(pool,storage,config,{signal:stop.signal,onError:stage=>console.error(`Hosted worker stage failed: ${stage}`)});
    }
  }finally {
    process.off('SIGINT',shutdown);process.off('SIGTERM',shutdown);
    if(server){const timer=setTimeout(()=>server.closeAllConnections(),25000);timer.unref();try{await new Promise(resolve=>server.close(resolve));}finally{clearTimeout(timer);}}
    storage?.close();await pool.end();
  }
}
if(process.argv[1] && fileURLToPath(import.meta.url)===process.argv[1])main().catch(()=>{console.error('Hosted runtime unavailable. Check release configuration, service identity, trusted proxy, verified migrations, TLS and required private storage. Secret details are not logged.');process.exitCode=1;});
