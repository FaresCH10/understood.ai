import {createHash} from 'node:crypto';
import {reviewRequestId} from './briefing-input.mjs';
import {ENTITLEMENT_STATES} from './entitlement-model.mjs';

const operatorUuid=value=>typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const operatorIso=value=>value===null || typeof value==='string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString()===value;
const entitlementReasons=Object.freeze(['manual_activation','trial_extension','owner_request','pilot_review','security_review','maintenance']);
const entitlementText=(value,max)=>typeof value==='string' && value===value.trim() && value.length>=1 && value.length<=max && !/[\u0000-\u001f\u007f]/.test(value);

export function operatorContext(row) {
  return createHash('sha256').update('understood:operator-session:v1\0').update(JSON.stringify([row.token_hash,row.operator_id,new Date(row.expires_at).toISOString()])).digest('hex');
}
export function operatorControlInput(input) {
  if(!input || typeof input!=='object' || Array.isArray(input) || input.confirmed!==true || !Number.isSafeInteger(input.revision) || input.revision<0 || input.revision>1000000000)throw Error('Invalid operator command');
  reviewRequestId(input.requestId);
  if(input.kind==='tenant') {
    if(Object.keys(input).some(key=>!['requestId','kind','orgId','revision','state','reason','confirmed'].includes(key))
      || typeof input.orgId!=='string' || !input.orgId || input.orgId.length>100 || /[\x00-\x1f\x7f]/.test(input.orgId)
      || !['active','suspended'].includes(input.state) || !['pilot_review','security_review','owner_request','maintenance'].includes(input.reason))throw Error('Invalid operator command');
    return {kind:'tenant',orgId:input.orgId,revision:input.revision,state:input.state,reason:input.reason,confirmed:true};
  }
  if(input.kind!=='system' || Object.keys(input).some(key=>!['requestId','kind','revision','jobsPaused','providerPaused','confirmed'].includes(key)) || typeof input.jobsPaused!=='boolean' || typeof input.providerPaused!=='boolean')throw Error('Invalid operator command');
  return {kind:'system',revision:input.revision,jobsPaused:input.jobsPaused,providerPaused:input.providerPaused,confirmed:true};
}
export function operatorRetryInput(input) {
  if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).sort().join(',')!=='attempts,confirmed,jobId,kind,requestId'
    || input.confirmed!==true || !['preparation','assessment','export'].includes(input.kind) || typeof input.jobId!=='string' || !/^[A-Za-z0-9_-]{1,100}$/.test(input.jobId)
    || !Number.isInteger(input.attempts) || input.attempts<1 || input.attempts>100)throw Error('Invalid operator command');
  reviewRequestId(input.requestId);
  return {kind:input.kind,jobId:input.jobId,attempts:input.attempts,confirmed:true};
}
export function operatorEntitlementInput(input) {
  if(!input || typeof input!=='object' || Array.isArray(input) || input.confirmed!==true || !operatorUuid(input.requestId) || !entitlementText(input.orgId,100))
    throw Error('Invalid operator command');
  if(input.kind==='entitlement') {
    if(Object.keys(input).sort().join(',')!=='activationRequestId,confirmed,endsAt,kind,orgId,plan,reason,requestId,revision,state,termsReference,workerLimit'
      || !Number.isSafeInteger(input.revision) || input.revision<0 || input.revision>1000000000
      || !ENTITLEMENT_STATES.includes(input.state) || !operatorIso(input.endsAt) || input.state==='trial' && input.endsAt===null
      || !Number.isSafeInteger(input.workerLimit) || input.workerLimit<1 || input.workerLimit>100000
      || !entitlementText(input.plan,40) || !(input.termsReference===null || entitlementText(input.termsReference,200))
      || !entitlementReasons.includes(input.reason) || !(input.activationRequestId===null || operatorUuid(input.activationRequestId))
      || input.state==='read_only' && input.activationRequestId!==null)
      throw Error('Invalid operator command');
    return {kind:'entitlement',orgId:input.orgId,revision:input.revision,state:input.state,endsAt:input.endsAt,workerLimit:input.workerLimit,
      plan:input.plan,termsReference:input.termsReference,reason:input.reason,activationRequestId:input.activationRequestId,confirmed:true};
  }
  if(input.kind==='activation-decision') {
    if(Object.keys(input).sort().join(',')!=='activationRequestId,confirmed,decision,kind,orgId,reason,requestId'
      || input.decision!=='declined' || !operatorUuid(input.activationRequestId) || !entitlementReasons.includes(input.reason))
      throw Error('Invalid operator command');
    return {kind:'activation-decision',orgId:input.orgId,activationRequestId:input.activationRequestId,decision:'declined',reason:input.reason,confirmed:true};
  }
  throw Error('Invalid operator command');
}
export function operatorFilters(input={}) {
  if(Object.keys(input).some(key=>!['search','page','pageSize','state'].includes(key)))throw Error('Invalid operator filters');
  const search=input.search ?? '',page=Number(input.page ?? 1),pageSize=Number(input.pageSize ?? 20),state=input.state ?? 'all';
  if(typeof search!=='string' || search.length>100 || /[\x00-\x1f\x7f]/.test(search) || !Number.isInteger(page) || page<1 || page>5000 || !Number.isInteger(pageSize) || pageSize<1 || pageSize>50 || !['all','active','suspended'].includes(state))throw Error('Invalid operator filters');
  return {search:search.trim().toLowerCase(),page,pageSize,state};
}
export function operatorHttpError(error) {
  const message=error?.message;
  if(message==='Operator sign in required')return {status:401,error:message};
  if(message==='Invalid credentials')return {status:401,error:message};
  if(message==='Operator context changed')return {status:409,error:message};
  if(['Operator request conflict','Operator revision changed','Job is not retryable','Workspace access paused','Provider verification configuration changed',
    'Activation request revision changed','Activation request is closed'].includes(message))return {status:409,error:message};
  if(['Invalid operator command','Invalid operator filters','Invalid operator login','Invalid entitlement expiry','Invalid JSON','Unsupported provider stage test'].includes(message))return {status:400,error:message};
  if(message==='Request too large')return {status:413,error:message};
  if(['Tenant unavailable','Activation request unavailable'].includes(message))return {status:404,error:message};
  if(['Provider quota is closed','Provider request quota reached','Provider dispatch paused','Provider verification unavailable','Provider verification worker unavailable'].includes(message))return {status:409,error:message};
  return {status:503,error:'Operations are temporarily unavailable'};
}
