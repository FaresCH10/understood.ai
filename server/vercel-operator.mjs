import {verifyMutationOrigin} from './auth.mjs';
import {send} from './http.mjs';
import {vercelTransport} from './vercel-transport.mjs';
import {pipelineStatus} from './ai/pipeline-status.mjs';
import {createPostgresPool} from './postgres/db.mjs';
import {handleOperationsRoute} from './postgres/operations-http.mjs';
import {verifyMigrations,schemaName} from './postgres/migrate.mjs';
import {verifyRuntimePermissions} from './postgres/runtime-permissions.mjs';

const operatorSecrets=/^(?:DATABASE_URL(?:_|$)|NEON_(?:AUTH|STORAGE|REALTIME|AI)|(?:GEMINI|DEEPL)_API_KEY$|UNDERSTOOD_(?:RESEND|EMAIL|PILOT|GMAIL|AUTH_MAIL|NEON_AUTH|NEON_STORAGE|R2|VAPID))/;

export async function createVercelOperatorHandler({env=process.env,pool,verify=verifyMigrations,verifyPermissions=verifyRuntimePermissions}={}) {
  if(env.UNDERSTOOD_OPERATOR_ACCESS!=='true' || !['preview','production'].includes(env.VERCEL_ENV)
    || env.UNDERSTOOD_POSTGRES_TLS!=='true' || !env.UNDERSTOOD_POSTGRES_URL
    || Object.entries(env).some(([key,value])=>value&&operatorSecrets.test(key)))throw Error('Invalid Vercel operator configuration');
  const publicOrigin=env.UNDERSTOOD_PUBLIC_ORIGIN || `https://${env.VERCEL_URL}`;
  const customer=new URL(env.UNDERSTOOD_CUSTOMER_ORIGIN);
  if(customer.protocol!=='https:' || customer.origin!==env.UNDERSTOOD_CUSTOMER_ORIGIN || customer.origin===publicOrigin)
    throw Error('Operator origin must be separate from the customer site');
  const requestAddress=vercelTransport(env,publicOrigin);
  const schema=schemaName(env.UNDERSTOOD_POSTGRES_SCHEMA);
  const ownsPool=!pool;
  pool??=await createPostgresPool({connectionString:env.UNDERSTOOD_POSTGRES_URL,tls:true});
  try {
    await verify(pool,{schema});
    await verifyPermissions(pool,{schema,profile:'operator'});
    const pipeline=pipelineStatus({});
    return async(req,res)=>{
      try {
        const address=requestAddress(req);
        const url=new URL(req.url,publicOrigin);
        if(!url.pathname.startsWith('/api/ops/'))return send(res,404,{error:'Not found'});
        if(req.method!=='GET')verifyMutationOrigin(req,{publicOrigin});
        return await handleOperationsRoute(pool,req,res,url,{schema,enabled:true,pipeline,secure:true,clientAddress:address});
      }catch(error){
        const forbidden=['Forbidden transport','Forbidden origin'].includes(error?.message);
        return send(res,forbidden?403:503,{error:forbidden?'Forbidden':'Operations are temporarily unavailable'});
      }
    };
  }catch(error){if(ownsPool)await pool.end();throw error;}
}
