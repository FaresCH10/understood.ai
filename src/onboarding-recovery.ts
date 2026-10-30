import {onboardingInput,onboardingSteps,onboardingTechnical} from '../server/onboarding-input.mjs';
import {checkedWorkspaceContext} from './workspace-settings-state.ts';
import type {WorkspaceContext} from './WorkspaceSettings.tsx';

export type SetupSession={clientContext:string;expiresAt:string};
export type SetupChange={requestId:string;expiresAt:string;body:{revision:number;step:string;firstBriefingId:string|null;confirmed:true}};
export type SetupModel={revision:number;step:string;firstBriefingId:string|null;organization:WorkspaceContext['organization'];site:WorkspaceContext['site'];resources:{workers:number;activeGrants:number;firstBriefing:{id:string;title:string;state:string;publicationState:string|null}|null};technical:ReturnType<typeof onboardingTechnical>;savedTechnical:ReturnType<typeof onboardingTechnical>|null;checks:Record<string,boolean>;canWrite:boolean};
type Storage=Pick<globalThis.Storage,'getItem'|'setItem'|'removeItem'>;
const keys=(row:unknown,list:string)=>!!row && typeof row==='object' && !Array.isArray(row) && Object.keys(row).sort().join(',')===list;
const reference=(value:unknown):value is string=>typeof value==='string' && value.length>0 && value.length<=100 && !/[\x00-\x1f\x7f]/.test(value);
const key=(session:SetupSession)=>{
  if(!/^[a-f0-9]{64}$/.test(session.clientContext) || !Number.isFinite(Date.parse(session.expiresAt)) || Date.parse(session.expiresAt)<=Date.now())throw Error('Setup session cannot be verified. Saved changes are unchanged.');
  return `understood:onboarding:${session.clientContext}`;
};
export function setupSignature(value:SetupChange) {
  if(!keys(value,'body,expiresAt,requestId') || !keys(value.body,'confirmed,firstBriefingId,revision,step') || !Number.isFinite(Date.parse(value.expiresAt)))throw Error('Saved setup change cannot be verified.');
  return JSON.stringify({expiresAt:value.expiresAt,body:{requestId:value.requestId,...onboardingInput({...value.body,requestId:value.requestId})}});
}
export function readSetupChange(storage:Storage,session:SetupSession):SetupChange|null {
  const raw=storage.getItem(key(session));if(raw===null)return null;
  try {
    if(raw.length>2048)throw Error();const value=JSON.parse(raw);
    if(!keys(value,'body,expiresAt') || value.expiresAt!==session.expiresAt || !keys(value.body,'confirmed,firstBriefingId,requestId,revision,step'))throw Error();
    const body=onboardingInput(value.body),pending={requestId:value.body.requestId,expiresAt:value.expiresAt,body};setupSignature(pending);return pending;
  }catch{throw Error('Saved setup change cannot be verified. Reload or sign in again before making another change.');}
}
export function saveSetupChange(storage:Storage,session:SetupSession,value:SetupChange) {
  const raw=setupSignature(value);if(value.expiresAt!==session.expiresAt)throw Error('The original setup session changed.');
  const old=readSetupChange(storage,session);if(old && setupSignature(old)!==raw)throw Error('Recover the original setup change first.');
  storage.setItem(key(session),raw);if(storage.getItem(key(session))!==raw)throw Error('Setup recovery storage is unavailable. No request was sent.');
}
export function clearSetupChange(storage:Storage,session:SetupSession,id:string,value:SetupChange) {
  const old=readSetupChange(storage,session);if(!old || old.requestId!==id || setupSignature(old)!==setupSignature(value))throw Error('The original saved setup change was replaced.');
  storage.removeItem(key(session));if(storage.getItem(key(session))!==null)throw Error('Setup recovery storage could not be cleared.');
}
export function checkedSetupResult(raw:unknown,expected:SetupChange):number {
  setupSignature(expected);const row=raw as {revision:number;duplicate:boolean};
  if(!keys(row,'duplicate,revision') || row.revision!==expected.body.revision+1 || typeof row.duplicate!=='boolean')throw Error('Setup acknowledgement cannot be verified.');return row.revision;
}
export function checkedSetupReceipt(raw:unknown,expected:SetupChange):number|null {
  setupSignature(expected);const row=raw as {found:boolean;revision:number;request:SetupChange['body']};
  if(keys(row,'found') && row.found===false)return null;
  if(!keys(row,'found,request,revision') || row.found!==true || row.revision!==expected.body.revision+1 || !keys(row.request,'confirmed,firstBriefingId,revision,step')
    || JSON.stringify(onboardingInput({...row.request,requestId:expected.requestId}))!==JSON.stringify(onboardingInput({...expected.body,requestId:expected.requestId})))throw Error('Setup receipt cannot be verified.');
  return row.revision;
}
export function checkedSetupModel(raw:unknown,scope:string):SetupModel {
  const row=raw as SetupModel;
  if(!keys(row,'canWrite,checks,firstBriefingId,organization,resources,revision,savedTechnical,site,step,technical') || typeof row.canWrite!=='boolean'
    || !Number.isSafeInteger(row.revision) || row.revision<0 || row.revision>1000000000 || !onboardingSteps.includes(row.step)
    || row.firstBriefingId!==null && !reference(row.firstBriefingId))throw Error('Setup progress cannot be verified.');
  checkedWorkspaceContext({organization:row.organization,site:row.site,canWrite:row.canWrite,canWriteSite:row.canWrite,recoveryScope:row.canWrite?scope:null},scope);
  const technical=onboardingTechnical(),validTechnical=(value:unknown)=>keys(value,'liveReady,processing,realDataAllowed,reason') && Object.entries(technical).every(([k,v])=>(value as Record<string,unknown>)[k]===v);
  if(!validTechnical(row.technical) || row.savedTechnical!==null && !validTechnical(row.savedTechnical)
    || !keys(row.checks,'access,briefing,languages,organization,provider,supervisor,support') || Object.values(row.checks).some(value=>typeof value!=='boolean') || row.checks.provider!==false
    || !keys(row.resources,'activeGrants,firstBriefing,workers') || ![row.resources.workers,row.resources.activeGrants].every(n=>Number.isSafeInteger(n) && n>=0))throw Error('Setup readiness cannot be verified.');
  const first=row.resources.firstBriefing;
  if(first!==null && (!keys(first,'id,publicationState,state,title') || first.id!==row.firstBriefingId || !reference(first.id) || typeof first.title!=='string' || !first.title || first.title.length>160
    || typeof first.state!=='string' || !first.state || !(first.publicationState===null || typeof first.publicationState==='string' && !!first.publicationState)))throw Error('Selected setup instruction cannot be verified.');
  return row;
}
export function checkedSetupOptions(raw:unknown):{id:string;title:string}[] {
  const row=raw as {items:{id:string;title:string}[];page:number;pageSize:number;total:number};
  if(!row || row.page!==1 || row.pageSize!==20 || !Number.isSafeInteger(row.total) || row.total<0 || !Array.isArray(row.items) || row.items.length>20
    || row.items.some(item=>!reference(item?.id) || typeof item.title!=='string' || !item.title || item.title.length>160) || new Set(row.items.map(item=>item.id)).size!==row.items.length)throw Error('Setup instruction choices cannot be verified.');
  return row.items.map(({id,title})=>({id,title}));
}
