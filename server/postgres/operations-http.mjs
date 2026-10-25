import {send,readJson} from '../http.mjs';
import {sessionCookie,clearSessionCookie} from '../auth.mjs';
import {operatorHttpError} from '../operator-input.mjs';
import {OPERATOR_COOKIE,HOSTED_OPERATOR_COOKIE,authenticateOperator,requireOperator,operatorSession,revokeOperator} from './operators.mjs';
import {operationsOverview,operationsTenants,operationsAudit,saveOperatorControl,operatorReceipt,operationsJobs,retryOperationsJob} from './operations.mjs';
import {readProviderControls,saveProviderPolicy,runProviderVerification} from './provider-controls.mjs';
import {operationsTenantAccess} from './operator-tenant-access.mjs';
import {operationsEntitlements,saveOperatorEntitlement,saveActivationDecision} from './entitlement-operations.mjs';

export async function handleOperationsRoute(pool,req,res,url,{enabled=false,schema='public',providerVerification,workerVerification=false,pipeline,secure=false,clientAddress=req.socket.remoteAddress}={}) {
  const path=url.pathname;
  if(!path.startsWith('/api/ops/'))return false;
  try {
    if(!enabled) {
      send(res,path==='/api/ops/session' && req.method==='GET'?200:404,
        path==='/api/ops/session' && req.method==='GET'?{available:false,authenticated:false}:{error:'Not found'});
      return true;
    }
    const cookieName=secure?HOSTED_OPERATOR_COOKIE:OPERATOR_COOKIE,options={schema,cookieName};
    if(path==='/api/ops/login' && req.method==='POST') {
      if(url.search)throw Error('Invalid operator login');
      const login=await authenticateOperator(pool,await readJson(req,4096),clientAddress,options);
      send(res,200,operatorSession(login.session),{'set-cookie':sessionCookie(login.token,login.maxSeconds,{name:cookieName,secure})});return true;
    }
    if(path==='/api/ops/session' && req.method==='GET') {
      if(url.search)throw Error('Invalid operator filters');
      try {send(res,200,operatorSession(await requireOperator(pool,req,{...options,context:false})));}
      catch(error){if(error.message!=='Operator sign in required')throw error;send(res,200,{available:true,authenticated:false});}
      return true;
    }
    const actor=await requireOperator(pool,req,options);
    if(path==='/api/ops/logout' && req.method==='POST') {
      if(url.search)throw Error('Invalid operator command');
      await revokeOperator(pool,actor,options);send(res,200,{ok:true},{'set-cookie':clearSessionCookie({name:cookieName,secure})});return true;
    }
    if(path==='/api/ops/overview' && req.method==='GET') {
      if(url.search)throw Error('Invalid operator filters');
      send(res,200,await operationsOverview(pool,actor,options));return true;
    }
    if(path==='/api/ops/tenants' && req.method==='GET') {
      send(res,200,await operationsTenants(pool,actor,Object.fromEntries(url.searchParams),options));return true;
    }
    if(path==='/api/ops/tenant-access' && req.method==='GET') {
      if(new Set(url.searchParams.keys()).size!==[...url.searchParams.keys()].length)throw Error('Invalid operator filters');
      send(res,200,await operationsTenantAccess(pool,actor,Object.fromEntries(url.searchParams),options));return true;
    }
    if(path==='/api/ops/jobs' && req.method==='GET') {
      send(res,200,await operationsJobs(pool,actor,Object.fromEntries(url.searchParams),options));return true;
    }
    if(path==='/api/ops/providers' && req.method==='GET') {
      send(res,200,await readProviderControls(pool,actor,providerVerification,Object.fromEntries(url.searchParams),{...options,pipeline,workerVerification}));return true;
    }
    if(path==='/api/ops/providers/policy' && req.method==='POST') {
      if(url.search)throw Error('Invalid operator command');
      const body=await readJson(req,4096),result=await saveProviderPolicy(pool,actor,body,options);
      send(res,200,{requestId:body.requestId,clientContext:operatorSession(actor).clientContext,...result});return true;
    }
    if(path==='/api/ops/providers/verify' && req.method==='POST') {
      if(url.search)throw Error('Invalid operator command');
      const body=await readJson(req,4096),result=await runProviderVerification(pool,actor,body,providerVerification,{...options,workerVerification,expectedFingerprint:req.headers['x-verification-config']});
      send(res,200,{requestId:body.requestId,clientContext:operatorSession(actor).clientContext,...result});return true;
    }
    if(path==='/api/ops/jobs/retry' && req.method==='POST') {
      if(url.search)throw Error('Invalid operator command');
      const body=await readJson(req,4096),result=await retryOperationsJob(pool,actor,body,options);
      send(res,200,{requestId:body.requestId,clientContext:operatorSession(actor).clientContext,...result});return true;
    }
    if(path==='/api/ops/entitlements' && req.method==='GET') {
      if(new Set(url.searchParams.keys()).size!==[...url.searchParams.keys()].length)throw Error('Invalid operator filters');
      send(res,200,await operationsEntitlements(pool,actor,Object.fromEntries(url.searchParams),options));return true;
    }
    if(path==='/api/ops/entitlements' && req.method==='POST') {
      if(url.search)throw Error('Invalid operator command');
      const body=await readJson(req,4096),result=await saveOperatorEntitlement(pool,actor,body,options);
      send(res,200,{requestId:body.requestId,clientContext:operatorSession(actor).clientContext,...result});return true;
    }
    if(path==='/api/ops/entitlements/decision' && req.method==='POST') {
      if(url.search)throw Error('Invalid operator command');
      const body=await readJson(req,4096),result=await saveActivationDecision(pool,actor,body,options);
      send(res,200,{requestId:body.requestId,clientContext:operatorSession(actor).clientContext,...result});return true;
    }
    if(path==='/api/ops/audit' && req.method==='GET') {
      if([...url.searchParams.keys()].some(key=>!['page','pageSize'].includes(key)))throw Error('Invalid operator filters');
      send(res,200,await operationsAudit(pool,actor,Object.fromEntries(url.searchParams),options));return true;
    }
    if(path==='/api/ops/controls' && req.method==='POST') {
      if(url.search)throw Error('Invalid operator command');
      const body=await readJson(req,4096),result=await saveOperatorControl(pool,actor,body,options);
      send(res,200,{requestId:body.requestId,clientContext:operatorSession(actor).clientContext,...result});return true;
    }
    const receipt=path.match(/^\/api\/ops\/receipts\/([a-f0-9-]{36})$/i);
    if(receipt && req.method==='GET') {
      if(url.search)throw Error('Invalid operator command');
      send(res,200,{requestId:receipt[1],clientContext:operatorSession(actor).clientContext,...await operatorReceipt(pool,actor,receipt[1],options)});return true;
    }
    send(res,404,{error:'Not found'});
  }catch(error){const result=operatorHttpError(error);send(res,result.status,{error:result.error});}
  return true;
}
