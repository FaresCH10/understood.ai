import {isIP} from 'node:net';
import {neonEnvironment} from './neon-env.mjs';
import {resolveRegistrationVerification} from './registration-verification.mjs';
import {postgresHandler} from './postgres/http.mjs';
import {processOneRegistration} from './postgres/registration.mjs';
import {createPostgresPool} from './postgres/db.mjs';
import {verifyMigrations,schemaName} from './postgres/migrate.mjs';
import {neonAudioStore,hostedPrivateAudioStore} from './private-storage.mjs';
import {productionServiceConfig} from './postgres/production-admission.mjs';
import {readProductionApproval} from './postgres/production-approval.mjs';
import {verifyRuntimePermissions} from './postgres/runtime-permissions.mjs';
import {readProductionReadiness} from './postgres/production-readiness.mjs';
import {send as sendJson} from './http.mjs';
import {resolvePilotGmail} from './pilot-gmail.mjs';
import {syntheticAssessmentAdapter} from './postgres/synthetic-assessment.mjs';
import {vercelDatabaseOptions,vercelRequestsLiveMode} from './vercel-database.mjs';

// Preserve the existing synthetic application mode, but persist accounts and
// sessions in Neon. Serverless registration cannot depend on a separate worker.
export async function createVercelNeonHandler({env=process.env,pool,send,createPilotTransport,verify=verifyMigrations,verifyPermissions=verifyRuntimePermissions,approvalManifest}={}) {
  env=neonEnvironment(env);
  const hosts=new Set(['VERCEL_PROJECT_PRODUCTION_URL','VERCEL_URL','VERCEL_BRANCH_URL']
    .map(key=>env[key]).filter(Boolean));
  if(!hosts.size || [...hosts].some(host=>!(/^[a-z0-9.-]+$/.test(host))))throw Error('Invalid Vercel host configuration');
  const publicOrigin=env.UNDERSTOOD_PUBLIC_ORIGIN ?? `https://${env.VERCEL_PROJECT_PRODUCTION_URL || env.VERCEL_URL}`;
  const origin=new URL(publicOrigin);
  if(origin.origin!==publicOrigin || origin.protocol!=='https:' || !hosts.has(origin.host))throw Error('Invalid Vercel public origin');
  const schema=schemaName(env.UNDERSTOOD_POSTGRES_SCHEMA || 'understood');
  const registrationVerification=resolveRegistrationVerification(env,{available:false},publicOrigin);
  const pilotGmail=resolvePilotGmail(env,createPilotTransport);
  if(registrationVerification.provider!=='neon' || !registrationVerification.available)throw Error('Neon verification configuration required');
  const production=env.UNDERSTOOD_TIER==='production';
  // A misspelled or partially live setting must never fall back to demo dispatch.
  if(!production&&vercelRequestsLiveMode(env))throw Error('Select the approved production runtime');
  const config=production?productionServiceConfig(env,{service:'api',transport:'vercel',approvalManifest:approvalManifest??readProductionApproval(env)}):
    {tier:'local',aiMode:'synthetic',accessMode:'credential',integrationMode:'synthetic',inlineSyntheticJobs:true,dataClass:'synthetic',
      publicOrigin,remoteDemo:true,localDemo:false,demoHosts:hosts};
  const ownsPool=!pool;
  pool ??= await createPostgresPool(vercelDatabaseOptions(env));
  try {
    await verify(pool,{schema});
    if(production)await verifyPermissions(pool,{schema,profile:'application'});
    const storage=production?hostedPrivateAudioStore(config):env.UNDERSTOOD_NEON_STORAGE_ENDPOINT?neonAudioStore({
      endpoint:env.UNDERSTOOD_NEON_STORAGE_ENDPOINT,region:env.UNDERSTOOD_NEON_STORAGE_REGION,
      bucket:env.UNDERSTOOD_NEON_STORAGE_BUCKET,accessKeyId:env.UNDERSTOOD_NEON_STORAGE_ACCESS_KEY_ID,
      secretAccessKey:env.UNDERSTOOD_NEON_STORAGE_SECRET_ACCESS_KEY,
    }):undefined;
    const requestAddress=production?config.requestAddress:req=>{
      if(!hosts.has(req.headers.host) || req.headers['x-forwarded-proto']!=='https')throw Error('Forbidden transport');
      const address=req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for'];
      if(typeof address!=='string' || !isIP(address))throw Error('Forbidden transport');
      return address;
    };
    const customerHandler=postgresHandler(pool,{...(production?config:{}),config,schema,storage,requestAddress,secure:true,
      cookieName:'__Host-understood_session',backend:production?'postgres-vercel-live':'postgres-vercel-synthetic',
      mail:production?config.mail:{available:false},registrationVerification,
      // Serverless synthetic runs have no background worker: drain its own queue.
      ...(production?{}:{inlineJobs:true,inlineAssessment:syntheticAssessmentAdapter}),
      pilotDestination:pilotGmail?.destination ?? config.pilotDestination ?? null,sendPilot:pilotGmail?.send,
      dispatchRegistration:registrationId=>processOneRegistration(pool,registrationVerification,
        {schema,registrationId,throwOnFailure:true,...(send?{send}:{})}),
    });
    const handler=async(req,res)=>{
      if(production&&req.method==='GET'&&req.url==='/api/health/readiness'){
        requestAddress(req);const readiness=await readProductionReadiness(pool,config);
        return sendJson(res,readiness.status==='ready'?200:503,readiness);
      }
      return customerHandler(req,res);
    };
    return {handler,pool,config};
  }catch(error){if(ownsPool)await pool.end();throw error;}
}
