import {assertProductionAdmission} from './production-admission.mjs';
import {createServer} from 'node:http';
import {send} from '../http.mjs';
import {verifyMutationOrigin} from '../auth.mjs';
import {pipelineStatus} from '../ai/pipeline-status.mjs';
import {handleOperationsRoute} from './operations-http.mjs';
import {withPostgresClient} from './db.mjs';

// Hosted startup verifies the dedicated column profile before this boundary listens.
export function createPostgresOperatorServer(pool,{config,publicBuild}={}) {
  if(config?.tier==='production')assertProductionAdmission(config);
  if(config?.service!=='operator' || config.runtimeRoleProfile!=='operator' || config.operatorAccess!==true
    || !(config.tier==='staging'&&config.dataClass==='synthetic'&&config.integrationMode==='synthetic'&&config.aiMode==='synthetic'||config.tier==='production'&&config.dataClass==='real'&&config.integrationMode==='live'&&config.aiMode==='live')
    || config.accessMode!=='credential' || !config.customerOrigin || config.customerOrigin===config.publicOrigin
    || config.storageConfig || config.providerVerification!==undefined || config.storageChecks!==false || config.mail?.available!==false || config.pilotDestination!==null
    || typeof config.requestAddress!=='function' || typeof publicBuild!=='function' || typeof pool?.connect!=='function')
    throw Error('Invalid isolated operator HTTP service');
  const pipeline=pipelineStatus({});
  return createServer(async(req,res)=>{
    try {
      if(req.url==='/api/health' && req.method==='GET' && req.headers['x-forwarded-proto']===undefined) {
        await withPostgresClient(pool,client=>client.query('SELECT 1'));
        return send(res,200,{status:'ok',mode:`${config.aiMode}-credential`,backend:`postgres-operator-${config.aiMode}`});
      }
      const address=config.requestAddress(req);
      res.setHeader('strict-transport-security','max-age=31536000');
      const url=new URL(req.url || '/',config.publicOrigin),path=url.pathname;
      if(!path.startsWith('/api/'))return publicBuild(req,res,url);
      if(path==='/api/health' && req.method==='GET' && !url.search) {
        await withPostgresClient(pool,client=>client.query('SELECT 1'));
        return send(res,200,{status:'ok',mode:`${config.aiMode}-credential`,backend:`postgres-operator-${config.aiMode}`});
      }
      if(!path.startsWith('/api/ops/'))return send(res,404,{error:'Not found'});
      if(req.method!=='GET')verifyMutationOrigin(req,config);
      await handleOperationsRoute(pool,req,res,url,{schema:config.schema,enabled:true,workerVerification:true,secure:true,clientAddress:address,pipeline});
    }catch(error) {
      const forbidden=['Forbidden transport','Forbidden origin'].includes(error?.message);
      send(res,forbidden?403:503,{error:forbidden?'Forbidden':'Operations are temporarily unavailable'});
    }
  });
}
