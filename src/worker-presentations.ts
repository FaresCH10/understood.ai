import {isWorkerLanguage} from '../server/languages.mjs';
import {sameWorkerSession,validWorkerSession,type PageSession} from './session-state.ts';

export type PresentationSourceKind='instruction'|'answer';
export type PresentationStatus='ready'|'pending'|'failed';
export type PresentationState=PresentationStatus|'not_required'|'unavailable'|'deferred';
export type PresentationReason='content_expired'|'content_unavailable'|'answer_not_ready'|'translation_not_enabled'
  |'translation_failed'|'translation_invalid'|'language_capability_unavailable'|'generation_paused'|string;
export type InstructionPresentationContent={title:string;text:string;question:string|null;questionType?:'multiple-choice';choices?:{id:string;text:string}[]};
export type AnswerPresentationContent={text:string};

export type WorkerPresentationArtifact={
  id:string;sourceKind:PresentationSourceKind;sourceId:string;publicationId:string;publicationVersion:number;
  originalLanguage:string;targetLanguage:string;status:PresentationStatus;
  content:InstructionPresentationContent|AnswerPresentationContent|null;
  provider:string|null;live:boolean|null;errorCode:string|null;sourceHash:string;
  createdAt:string;readyAt:string|null;
};
export type WorkerPresentationResult={
  status:PresentationState;presentation:WorkerPresentationArtifact|null;reason:PresentationReason|null;
  originalLanguage:string;targetLanguage:string;sourceKind:PresentationSourceKind;sourceId:string;clientContext:string;
};
export type WorkerPresentationList={
  assignmentId:string;originalLanguage:string;approvedLanguage:string;
  items:WorkerPresentationArtifact[];clientContext:string;
};

export class WorkerPresentationError extends Error{
  readonly code:'session'|'invalid'|'unavailable'|'conflict';
  constructor(code:WorkerPresentationError['code']){super(code);this.code=code;}
}

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const hash=/^[a-f0-9]{64}$/;
const providerPattern=/^[a-z0-9][a-z0-9._-]{1,79}$/i;
const sourceIdentifier=/^[^\u0000-\u0020\u007f]{8,100}$/;
const identifier=/^[^\u0000-\u0020\u007f]{1,100}$/;
const exact=(value:unknown,keys:string[]):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value)
  &&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const iso=(value:unknown):value is string=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&!/[\u0000-\u0020\u007f]/.test(value);
const safeText=(value:unknown,max:number,required=true):value is string=>typeof value==='string'
  &&value.length<=max&&(!required||value.trim().length>0)&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const integer=(value:unknown,min:number,max:number)=>Number.isSafeInteger(value)&&Number(value)>=min&&Number(value)<=max;
const safeCode=(value:unknown,max=100):value is string=>typeof value==='string'&&value.trim().length>0
  &&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);

function checkedContent(kind:PresentationSourceKind,value:unknown,ready:boolean){
  if(!ready){
    if(value!==null)throw new WorkerPresentationError('invalid');
    return null;
  }
  if(kind==='instruction'){
    if((!exact(value,['title','text','question'])&&!exact(value,['title','text','question','questionType','choices']))||!safeText(value.title,120)||!safeText(value.text,5000)
      ||(value.question!==null&&!safeText(value.question,500)))throw new WorkerPresentationError('invalid');
    if('choices' in value && (value.questionType!=='multiple-choice'||!Array.isArray(value.choices)||value.choices.length!==4
      ||new Set(value.choices.map(choice=>choice?.id)).size!==4||value.choices.some(choice=>!exact(choice,['id','text'])
        ||typeof choice.id!=='string'||!/^[a-f0-9]{32}$/.test(choice.id)||!safeText(choice.text,5000))))throw new WorkerPresentationError('invalid');
    return {title:value.title,text:value.text,question:value.question,...('choices' in value?{questionType:'multiple-choice',choices:value.choices}: {})} as InstructionPresentationContent;
  }
  if(!exact(value,['text'])||!safeText(value.text,5000))throw new WorkerPresentationError('invalid');
  return {text:value.text} as AnswerPresentationContent;
}

export function checkedWorkerPresentationArtifact(value:unknown):WorkerPresentationArtifact{
  const fail=()=>{throw new WorkerPresentationError('invalid');};
  if(!exact(value,['id','sourceKind','sourceId','publicationId','publicationVersion','originalLanguage','targetLanguage',
    'status','content','provider','live','errorCode','sourceHash','createdAt','readyAt']))return fail();
  if(typeof value.id!=='string'||!uuid.test(value.id))return fail();
  if(value.sourceKind!=='instruction'&&value.sourceKind!=='answer')return fail();
  if(value.sourceKind==='instruction'?value.sourceId!=='':!safeCode(value.sourceId)||!sourceIdentifier.test(value.sourceId))return fail();
  if(!safeCode(value.publicationId)||!identifier.test(value.publicationId))return fail();
  if(!integer(value.publicationVersion,1,Number.MAX_SAFE_INTEGER))return fail();
  if(!isWorkerLanguage(value.originalLanguage)||!isWorkerLanguage(value.targetLanguage))return fail();
  if(!['ready','pending','failed'].includes(value.status as string))return fail();
  if(typeof value.sourceHash!=='string'||!hash.test(value.sourceHash))return fail();
  if(!iso(value.createdAt))return fail();
  const ready=value.status==='ready';
  if(ready){
    if(value.provider===null||typeof value.provider!=='string'||!providerPattern.test(value.provider))return fail();
    if(typeof value.live!=='boolean'||value.errorCode!==null||!iso(value.readyAt))return fail();
  }else{
    if(value.provider!==null||value.live!==null||value.readyAt!==null)return fail();
    if(value.errorCode!==null&&!safeCode(value.errorCode))return fail();
  }
  const kind=value.sourceKind as PresentationSourceKind;
  return {...value,content:checkedContent(kind,value.content,ready)} as WorkerPresentationArtifact;
}

function checkedReason(value:unknown,status:PresentationState){
  if(value===null)return null;
  if(!safeCode(value))throw new WorkerPresentationError('invalid');
  return value;
}

export function checkedWorkerPresentationResult(value:unknown,expected:{
  clientContext:string;sourceKind:PresentationSourceKind;sourceId:string;targetLanguage:string;
}):WorkerPresentationResult{
  const fail=()=>{throw new WorkerPresentationError('invalid');};
  if(!exact(value,['status','presentation','reason','originalLanguage','targetLanguage','sourceKind','sourceId','clientContext']))return fail();
  if(!['ready','pending','failed','not_required','unavailable','deferred'].includes(value.status as string))return fail();
  if(value.clientContext!==expected.clientContext)throw new WorkerPresentationError('session');
  if(value.sourceKind!==expected.sourceKind||value.sourceId!==expected.sourceId)return fail();
  if(value.targetLanguage!==expected.targetLanguage||!isWorkerLanguage(value.originalLanguage))return fail();
  const artifact=value.presentation===null?null:checkedWorkerPresentationArtifact(value.presentation);
  const status=value.status as PresentationState;
  if(['ready','pending','failed'].includes(status)){
    if(!artifact||artifact.status!==status||artifact.sourceKind!==expected.sourceKind
      ||artifact.sourceId!==expected.sourceId||artifact.targetLanguage!==expected.targetLanguage
      ||artifact.originalLanguage!==value.originalLanguage)return fail();
  }else if(artifact!==null)return fail();
  checkedReason(value.reason,status);
  return {...value,presentation:artifact,status} as WorkerPresentationResult;
}

export function checkedWorkerPresentationList(value:unknown,expected:{
  assignmentId:string;clientContext:string;approvedLanguage:string;
}):WorkerPresentationList{
  const fail=()=>{throw new WorkerPresentationError('invalid');};
  if(!exact(value,['assignmentId','originalLanguage','approvedLanguage','items','clientContext']))return fail();
  if(value.clientContext!==expected.clientContext)throw new WorkerPresentationError('session');
  if(value.assignmentId!==expected.assignmentId)return fail();
  if(!isWorkerLanguage(value.originalLanguage)||!isWorkerLanguage(value.approvedLanguage))return fail();
  if(value.approvedLanguage!==expected.approvedLanguage)return fail();
  if(!Array.isArray(value.items)||value.items.length>10000)return fail();
  const ids=new Set<string>();
  const items=value.items.map(raw=>{
    const item=checkedWorkerPresentationArtifact(raw);
    if(ids.has(item.id))return fail();
    ids.add(item.id);
    return item;
  });
  return {...value,items} as WorkerPresentationList;
}

const sameSession=(expected:PageSession,session:PageSession)=>sameWorkerSession(expected,session)&&expected.expiresAt===session.expiresAt;

async function failure(response:Response):Promise<never>{
  if([401,403].includes(response.status))throw new WorkerPresentationError('session');
  if(response.status===409||response.status===404){
    let message='';
    try{const body=await response.json();message=typeof body?.error==='string'?body.error:'';}catch {}
    if(message==='Session context changed')throw new WorkerPresentationError('session');
    if(response.status===409)throw new WorkerPresentationError('conflict');
    throw new WorkerPresentationError('unavailable');
  }
  throw new WorkerPresentationError('unavailable');
}

const sessionHeaders=(context:string)=>({'x-client-session-context':context});

export async function readWorkerPresentations(send:typeof fetch,session:PageSession,assignmentId:string,signal:AbortSignal,current:()=>boolean){
  const expected={...session},selected=assignmentId,approved=session.language;
  if(!validWorkerSession(expected)||!current()||!identifier.test(selected)||!isWorkerLanguage(approved))throw new WorkerPresentationError('session');
  let response:Response;
  try{response=await send(`/api/worker/briefings/${encodeURIComponent(selected)}/presentations`,
    {credentials:'include',cache:'no-store',signal,headers:sessionHeaders(expected.clientContext!)});}
  catch {if(signal.aborted)throw new WorkerPresentationError('session');throw new WorkerPresentationError('unavailable');}
  if(!current()||!sameSession(expected,session))throw new WorkerPresentationError('session');
  if(!response.ok)return failure(response);
  const value=await response.json().catch(()=>{throw new WorkerPresentationError('invalid');});
  if(!current()||!sameSession(expected,session))throw new WorkerPresentationError('session');
  return checkedWorkerPresentationList(value,{assignmentId:selected,clientContext:expected.clientContext!,approvedLanguage:approved!});
}

export type WorkerPresentationRequest=
  |{requestId:string;sourceKind:'instruction'}
  |{requestId:string;sourceKind:'answer';sourceId:string};

export function checkedWorkerPresentationRequest(value:unknown):WorkerPresentationRequest{
  const kind=(value as {sourceKind?:unknown}|null|undefined)?.sourceKind;
  const instruction=kind==='instruction'&&exact(value,['requestId','sourceKind']);
  const answer=kind==='answer'&&exact(value,['requestId','sourceId','sourceKind']);
  if(!instruction&&!answer)throw new WorkerPresentationError('invalid');
  const request=value as {requestId:unknown;sourceId?:unknown};
  if(typeof request.requestId!=='string'||!uuid.test(request.requestId))throw new WorkerPresentationError('invalid');
  if(instruction)return {requestId:request.requestId,sourceKind:'instruction'};
  if(typeof request.sourceId!=='string'||!sourceIdentifier.test(request.sourceId))throw new WorkerPresentationError('invalid');
  return {requestId:request.requestId,sourceKind:'answer',sourceId:request.sourceId};
}

export async function requestWorkerPresentation(send:typeof fetch,session:PageSession,assignmentId:string,input:unknown,signal:AbortSignal,current:()=>boolean){
  const expected={...session},selected=assignmentId,approved=session.language;
  if(!validWorkerSession(expected)||!current()||!identifier.test(selected)||!isWorkerLanguage(approved))throw new WorkerPresentationError('session');
  const request=checkedWorkerPresentationRequest(input);
  let response:Response;
  try{response=await send(`/api/worker/briefings/${encodeURIComponent(selected)}/presentations`,{
    method:'POST',credentials:'include',cache:'no-store',signal,
    headers:{'content-type':'application/json',...sessionHeaders(expected.clientContext!)},
    body:JSON.stringify(request),
  });}
  catch {if(signal.aborted)throw new WorkerPresentationError('session');throw new WorkerPresentationError('unavailable');}
  if(!current()||!sameSession(expected,session))throw new WorkerPresentationError('session');
  if(!response.ok)return failure(response);
  const value=await response.json().catch(()=>{throw new WorkerPresentationError('invalid');});
  if(!current()||!sameSession(expected,session))throw new WorkerPresentationError('session');
  return checkedWorkerPresentationResult(value,{clientContext:expected.clientContext!,sourceKind:request.sourceKind,
    sourceId:request.sourceKind==='answer'?request.sourceId:'',targetLanguage:approved!});
}
