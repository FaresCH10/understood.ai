import {isIP} from 'node:net';
import {neonEnvironment} from './neon-env.mjs';
import {resolveRegistrationVerification} from './registration-verification.mjs';
import {postgresHandler} from './postgres/http.mjs';
import {processOneRegistration} from './postgres/registration.mjs';
import {createPostgresPool} from './postgres/db.mjs';
import {verifyMigrations,schemaName} from './postgres/migrate.mjs';
import {neonAudioStore} from './private-storage.mjs';

// Preserve the existing synthetic application mode, but persist accounts and
// sessions in Neon. Serverless registration cannot depend on a separate worker.
export async function createVercelNeonHandler({env=process.env,pool,send,verify=verifyMigrations}={}) {
  env=neonEnvironment(env);
  const hosts=new Set(['VERCEL_PROJECT_PRODUCTION_URL','VERCEL_URL','VERCEL_BRANCH_URL']
    .map(key=>env[key]).filter(Boolean));
  if(!hosts.size || [...hosts].some(host=>!(/^[a-z0-9.-]+$/.test(host))))throw Error('Invalid Vercel host configuration');
  const publicOrigin=env.UNDERSTOOD_PUBLIC_ORIGIN ?? `https://${env.VERCEL_PROJECT_PRODUCTION_URL || env.VERCEL_URL}`;
  const origin=new URL(publicOrigin);
  if(origin.origin!==publicOrigin || origin.protocol!=='https:' || !hosts.has(origin.host))throw Error('Invalid Vercel public origin');
  const schema=schemaName(env.UNDERSTOOD_POSTGRES_SCHEMA || 'understood');
  const registrationVerification=resolveRegistrationVerification(env,{available:false},publicOrigin);
  if(registrationVerification.provider!=='neon' || !registrationVerification.available)throw Error('Neon verification configuration required');
  const ownsPool=!pool;
  pool ??= await createPostgresPool({connectionString:env.DATABASE_URL,tls:true});
  try {
    await verify(pool,{schema});
    const storage=env.UNDERSTOOD_NEON_STORAGE_ENDPOINT?neonAudioStore({
      endpoint:env.UNDERSTOOD_NEON_STORAGE_ENDPOINT,region:env.UNDERSTOOD_NEON_STORAGE_REGION,
      bucket:env.UNDERSTOOD_NEON_STORAGE_BUCKET,accessKeyId:env.UNDERSTOOD_NEON_STORAGE_ACCESS_KEY_ID,
      secretAccessKey:env.UNDERSTOOD_NEON_STORAGE_SECRET_ACCESS_KEY,
    }):undefined;
    const config={tier:'local',aiMode:'synthetic',accessMode:'credential',integrationMode:'synthetic',dataClass:'synthetic',
      publicOrigin,remoteDemo:true,localDemo:false,demoHosts:hosts};
    const requestAddress=req=>{
      if(!hosts.has(req.headers.host) || req.headers['x-forwarded-proto']!=='https')throw Error('Forbidden transport');
      const address=req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for'];
      if(typeof address!=='string' || !isIP(address))throw Error('Forbidden transport');
      return address;
    };
    const handler=postgresHandler(pool,{config,schema,storage,requestAddress,secure:true,
      cookieName:'__Host-understood_session',backend:'postgres-vercel-synthetic',
      mail:{available:false},registrationVerification,
      dispatchRegistration:registrationId=>processOneRegistration(pool,registrationVerification,
        {schema,registrationId,throwOnFailure:true,...(send?{send}:{})}),
    });
    return {handler,pool,config};
  }catch(error){if(ownsPool)await pool.end();throw error;}
}
