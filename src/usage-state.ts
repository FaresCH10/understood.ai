import {usageModel,type UsageModel,type ProviderAllowance,type UsageEntitlement} from '../server/usage.mjs';
export type {UsageEntitlement} from '../server/usage.mjs';
const keys=(row:unknown,list:string)=>!!row && typeof row==='object' && !Array.isArray(row) && Object.keys(row).sort().join(',')===list;
const count=(value:unknown):value is number=>Number.isSafeInteger(value) && (value as number)>=0;
function same(a:unknown,b:unknown):boolean {
  if(a===b)return true;
  if(Array.isArray(a) || Array.isArray(b))return Array.isArray(a) && Array.isArray(b) && a.length===b.length && a.every((value,index)=>same(value,b[index]));
  if(!a || !b || typeof a!=='object' || typeof b!=='object' || Object.keys(a).sort().join(',')!==Object.keys(b).sort().join(','))return false;
  return Object.keys(a).every(key=>same((a as Record<string,unknown>)[key],(b as Record<string,unknown>)[key]));
}
export function checkedProviderAllowance(raw:unknown):ProviderAllowance {
  const row=raw as ProviderAllowance;
  if(!keys(row,'billingVerified,dataClass,day,jobsPaused,limit,providerPaused,reason,remaining,requests,reserved,resetsAt,state,timezone')
    || row.timezone!=='UTC' || row.dataClass!=='synthetic' || row.billingVerified!==false || !/^\d{4}-\d{2}-\d{2}$/.test(row.day)
    || !Number.isFinite(Date.parse(`${row.day}T00:00:00.000Z`)) || new Date(`${row.day}T00:00:00.000Z`).toISOString().slice(0,10)!==row.day
    || row.resetsAt!==new Date(Date.parse(`${row.day}T00:00:00.000Z`)+86400000).toISOString()
    || ![row.limit,row.reserved,row.remaining].every(count) || row.remaining!==Math.max(0,row.limit-row.reserved)
    || !keys(row.requests,'accepted,rejected,started,uncertain') || !Object.values(row.requests).every(count)
    || typeof row.jobsPaused!=='boolean' || typeof row.providerPaused!=='boolean'
    || !['quota_closed','jobs_paused','provider_paused','daily_allowance_exhausted','available'].includes(row.reason)
    || row.state!==(row.reason==='quota_closed'?'closed':row.reason==='available'?'available':row.reason==='daily_allowance_exhausted'?'exhausted':'paused'))throw Error('Organization allowance cannot be verified.');
  return row;
}
const isIso=(value:unknown):value is string=>typeof value==='string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString()===value;
export function checkedEntitlement(raw:unknown):UsageEntitlement {
  const row=raw as UsageEntitlement;
  if(!keys(row,'activeWorkers,configured,daysRemaining,effectiveState,endsAt,plan,request,revision,startedAt,state,termsReference,workerLimit,writeAllowed')
    || !count(row.activeWorkers) || typeof row.configured!=='boolean' || typeof row.writeAllowed!=='boolean')throw Error('Workspace entitlement cannot be verified.');
  const request=row.request;
  if(request!==null && (!keys(request,'decidedAt,decisionRef,entitlementRevision,id,note,requestedAt,state')
    || request.state!=='pending' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request.id)
    || !(request.note===null || typeof request.note==='string' && request.note===request.note.trim() && request.note.length>=1 && request.note.length<=500 && !/[\u0000-\u001f\u007f]/.test(request.note))
    || !Number.isSafeInteger(request.entitlementRevision) || request.entitlementRevision<0 || !isIso(request.requestedAt)
    || request.decidedAt!==null || request.decisionRef!==null))throw Error('Workspace activation request cannot be verified.');
  if(row.configured===false) {
    if(row.state!=='unmanaged' || row.effectiveState!=='unmanaged' || row.writeAllowed!==true || row.startedAt!==null || row.endsAt!==null
      || row.daysRemaining!==null || row.workerLimit!==null || row.plan!==null || row.termsReference!==null || row.revision!==0 || request!==null)
      throw Error('Workspace entitlement cannot be verified.');
    return row;
  }
  if(!['trial','active','read_only'].includes(row.state) || !['trial','active','read_only'].includes(row.effectiveState)
    || row.writeAllowed!==(row.effectiveState!=='read_only') || !isIso(row.startedAt)
    || !(row.endsAt===null || isIso(row.endsAt)) || row.state==='trial' && row.endsAt===null
    || !Number.isSafeInteger(row.workerLimit) || (row.workerLimit as number)<1 || (row.workerLimit as number)>100000
    || typeof row.plan!=='string' || row.plan!==row.plan.trim() || row.plan.length<1 || row.plan.length>40
    || !(row.termsReference===null || typeof row.termsReference==='string' && row.termsReference===row.termsReference.trim() && row.termsReference.length>=1 && row.termsReference.length<=200)
    || !Number.isSafeInteger(row.revision) || row.revision<1 || request!==null && request.entitlementRevision>row.revision)
    throw Error('Workspace entitlement cannot be verified.');
  const end=row.endsAt===null?null:Date.parse(row.endsAt),now=Date.now();
  if(row.effectiveState==='read_only') {
    if(row.state!=='read_only' && (end===null || end>now+120000))throw Error('Workspace entitlement cannot be verified.');
  } else if(row.effectiveState!==row.state || end!==null && end<=now-120000)throw Error('Workspace entitlement cannot be verified.');
  if(end===null) {if(row.daysRemaining!==null)throw Error('Workspace entitlement cannot be verified.');}
  else if(!count(row.daysRemaining) || Math.abs(row.daysRemaining-Math.max(0,Math.ceil((end-now)/86400000)))>1)
    throw Error('Workspace entitlement cannot be verified.');
  return row;
}
export function checkedUsageModel(raw:unknown,mode:string|undefined,role:string|null|undefined):UsageModel {
  const row=raw as UsageModel,base='controls,denominator,entitlement,mode,period,plan,providerAllowance,publication,spend,units';
  if(!(keys(row,base) || keys(row,'changeRequestsAvailable,'+base)) || row.mode!==mode || row.mode!=='synthetic-credential'
    || !['owner','administrator','supervisor','auditor'].includes(role || '') || !Array.isArray(row.units) || row.units.length!==5
    || row.changeRequestsAvailable!==undefined && (typeof row.changeRequestsAvailable!=='boolean' || row.changeRequestsAvailable!==['owner','administrator','supervisor'].includes(role || '')))throw Error('Plan and usage cannot be verified.');
  const units=row.units,assigned=units[0]?.used;
  if(!count(assigned) || units.some(unit=>!unit || !count(unit.used) || unit.used>assigned || unit.limit!==assigned))throw Error('Briefing usage counts cannot be verified.');
  const publication=row.publication;
  if(publication!==null && (!keys(publication,'id,state,version') || typeof publication.id!=='string' || !publication.id || publication.id.length>100 || /[\x00-\x1f\x7f]/.test(publication.id)
    || !Number.isSafeInteger(publication.version) || publication.version<1 || publication.state!=='published'))throw Error('Usage publication cannot be verified.');
  const providerAllowance=row.providerAllowance===null?null:checkedProviderAllowance(row.providerAllowance);
  const entitlement=checkedEntitlement(row.entitlement);
  const expected=usageModel({mode:row.mode,metrics:{assigned,responses:units[1].used,matches:units[2].used,clarifications:units[3].used,pending:units[4].used},latestPublication:publication,providerAllowance,entitlement});
  if(row.changeRequestsAvailable!==undefined)expected.changeRequestsAvailable=row.changeRequestsAvailable;
  if(!same(row,expected))throw Error('Plan, spend and allowance evidence cannot be verified.');
  return row;
}
