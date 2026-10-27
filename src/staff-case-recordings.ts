import {WORKER_LANGUAGE_CODES} from '../server/languages.mjs';
import {validStaffSession,type PageSession} from './session-state.ts';
import {staffRequestBinding} from './staff-request.ts';

export type RecordingLanguage='en'|'ar'|'ur';
export type StaffRecordingScope={caseId:string;assignmentId:string};
export type StaffRecordingPending={id:string;hash:string;bytes:number;language:RecordingLanguage};
export type StaffRecordingStatus='storing'|'received'|'failed';
export type StaffRecordingReceipt={requestId:string;caseId:string;assignmentId:string;kind:'in_person';actorId:string;actorRole:'owner'|'supervisor';language:RecordingLanguage;sha256:string;bytes:number;status:StaffRecordingStatus;createdAt:string;receivedAt:string|null;clientContext:string};
export type StaffRecordingItem={requestId:string;actorId:string;actorRole:'owner'|'supervisor';actorName:string|null;language:RecordingLanguage;status:StaffRecordingStatus;createdAt:string;receivedAt:string|null;durationSeconds:number;available:boolean};
export type StaffRecordingPage={caseId:string;page:number;pageSize:10;total:number;canRecord:boolean;items:StaffRecordingItem[];clientContext:string};
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export class StaffRecordingError extends Error{
  readonly code:'invalid'|'session'|'recovery'|'unavailable'|'conflict'|'blocked';
  constructor(code:StaffRecordingError['code']){super(code);this.code=code;}
}
const fail=(code:StaffRecordingError['code']):never=>{throw new StaffRecordingError(code);};
const exact=(value:unknown,keys:string[]):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const id=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(value);
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const digest=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const language=(value:unknown):value is RecordingLanguage=>['en','ar','ur'].includes(value as string);
const date=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const size=(value:unknown):value is number=>Number.isSafeInteger(value)&&Number(value)>=8044&&Number(value)<=2880044;
const role=(value:unknown)=>['owner','supervisor'].includes(value as string);
const pendingValid=(value:unknown):value is StaffRecordingPending=>exact(value,['id','hash','bytes','language'])&&uuid(value.id)&&digest(value.hash)&&size(value.bytes)&&language(value.language);
const scopeValid=(value:StaffRecordingScope)=>exact(value,['caseId','assignmentId'])&&id(value.caseId)&&id(value.assignmentId);
const coherent=(row:Record<string,unknown>)=>['storing','received','failed'].includes(row.status as string)&&date(row.createdAt)
  &&(row.status==='received'?date(row.receivedAt)&&row.receivedAt>=row.createdAt:row.receivedAt===null);
function author(session:PageSession):string{
  if(!validStaffSession(session)||!role(session.staffRole))return fail('session');
  const identity=JSON.parse(session.staffScope!);if(!identity.every(id))return fail('session');return identity[2];
}
function context(value:unknown,expected:unknown){if(!digest(expected))return fail('invalid');if(value!==expected)return fail('session');}
function key(session:PageSession,scope:StaffRecordingScope){
  author(session);if(!scopeValid(scope))return fail('invalid');return `understood:staff-case-audio:${session.clientContext}:${session.staffRole}:${scope.caseId}:${scope.assignmentId}`;
}
export function readStaffRecordingPending(storage:Store,session:PageSession,scope:StaffRecordingScope):StaffRecordingPending|null{
  const name=key(session,scope);try{const raw=storage.getItem(name);if(raw===null)return null;if(raw.length>300)return fail('recovery');const value=JSON.parse(raw);if(!pendingValid(value))return fail('recovery');return value;}catch{return fail('recovery');}
}
export async function retainStaffRecording(storage:Store,session:PageSession,scope:StaffRecordingScope,requestId:string,bytes:Uint8Array,declaredLanguage:RecordingLanguage,current:()=>boolean):Promise<StaffRecordingPending>{
  const binding=staffRequestBinding(session),selection=JSON.stringify(scope),check=()=>{key(session,scope);if(!current()||staffRequestBinding(session)!==binding||JSON.stringify(scope)!==selection)return fail('session');};
  check();if(!uuid(requestId)||!(bytes instanceof Uint8Array)||!size(bytes.length)||!language(declaredLanguage))return fail('invalid');
  const snapshot=new Uint8Array(bytes),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',snapshot)),byte=>byte.toString(16).padStart(2,'0')).join('');check();
  const old=readStaffRecordingPending(storage,session,scope),next={id:requestId,hash,bytes:snapshot.length,language:declaredLanguage};
  if(old&&(['id','hash','bytes','language'] as const).some(field=>old[field]!==next[field]))return fail('recovery');const value=old??next,raw=JSON.stringify(value),name=key(session,scope);check();
  try{storage.setItem(name,raw);if(storage.getItem(name)!==raw)return fail('recovery');}catch{return fail('recovery');}check();return value;
}
export function clearStaffRecordingPending(storage:Store,session:PageSession,scope:StaffRecordingScope,expected:StaffRecordingPending,current:()=>boolean){
  if(!current())return fail('session');const name=key(session,scope),stored=readStaffRecordingPending(storage,session,scope);
  if(!stored||!pendingValid(expected)||['id','hash','bytes','language'].some(field=>stored[field as keyof StaffRecordingPending]!==expected[field as keyof StaffRecordingPending]))return fail('recovery');
  if(!current())return fail('session');try{storage.removeItem(name);if(storage.getItem(name)!==null)return fail('recovery');}catch{return fail('recovery');}
}
export function checkedStaffRecordingReceipt(value:unknown,session:PageSession,scope:StaffRecordingScope,pending:StaffRecordingPending):StaffRecordingReceipt{
  const actorId=author(session);
  if(!scopeValid(scope)||!pendingValid(pending)||!exact(value,['requestId','caseId','assignmentId','kind','actorId','actorRole','language','sha256','bytes','status','createdAt','receivedAt','clientContext']))return fail('invalid');
  context(value.clientContext,session.clientContext);
  if(value.requestId!==pending.id||value.caseId!==scope.caseId||value.assignmentId!==scope.assignmentId||value.kind!=='in_person'||value.actorId!==actorId||value.actorRole!==session.staffRole
    ||value.language!==pending.language||value.sha256!==pending.hash||value.bytes!==pending.bytes||!coherent(value))return fail('invalid');
  return value as unknown as StaffRecordingReceipt;
}
export function checkedStaffRecordingPage(value:unknown,caseId:string,page:number,expectedContext:string):StaffRecordingPage{
  if(!id(caseId)||!Number.isSafeInteger(page)||page<1||page>5000||!exact(value,['caseId','page','pageSize','total','canRecord','items','clientContext']))return fail('invalid');
  context(value.clientContext,expectedContext);
  if(value.caseId!==caseId||value.page!==page||value.pageSize!==10||!Number.isSafeInteger(value.total)||Number(value.total)<0||Number(value.total)>50000
    ||typeof value.canRecord!=='boolean'||!Array.isArray(value.items)||value.items.length!==Math.min(10,Math.max(0,Number(value.total)-(page-1)*10)))return fail('invalid');
  const seen=new Set<string>();let previous:StaffRecordingItem|null=null;
  for(const row of value.items){
    if(!exact(row,['requestId','actorId','actorRole','actorName','language','status','createdAt','receivedAt','durationSeconds','available'])||!uuid(row.requestId)||seen.has(row.requestId)||!id(row.actorId)||!role(row.actorRole)
      ||row.actorName!==null&&(typeof row.actorName!=='string'||!row.actorName.trim()||row.actorName.length>500)||!language(row.language)||!coherent(row)
      ||typeof row.durationSeconds!=='number'||!Number.isFinite(row.durationSeconds)||row.durationSeconds<.25||row.durationSeconds>90||typeof row.available!=='boolean'||row.available&&row.status!=='received')return fail('invalid');
    const item=row as unknown as StaffRecordingItem;if(previous&&(item.createdAt>previous.createdAt||item.createdAt===previous.createdAt&&item.requestId>=previous.requestId))return fail('invalid');
    seen.add(item.requestId);previous=item;
  }
  return value as unknown as StaffRecordingPage;
}
export function checkedStaffRecordingNotice(value:unknown,session:PageSession,declaredLanguage:RecordingLanguage):string|null{
  author(session);if(!language(declaredLanguage)||!exact(value,['revision','configured','notices','canWrite','recoveryScope'])||!Number.isSafeInteger(value.revision)||Number(value.revision)<0||Number(value.revision)>1000000000
    ||typeof value.configured!=='boolean'||value.canWrite!==(session.staffRole==='owner')||value.recoveryScope!==(session.staffRole==='owner'?session.staffScope:null)||!value.notices || typeof value.notices!=='object' || Array.isArray(value.notices) || Object.keys(value.notices).some(key=>!WORKER_LANGUAGE_CODES.includes(key as typeof WORKER_LANGUAGE_CODES[number])))return fail('invalid');
  const notices=value.notices as Record<string,string>;
  if(!['en','ar','ur'].every(key=>key in notices))return fail('invalid');
  for(const text of Object.values(notices)){if(typeof text!=='string'||text.length>2000||/[\u0000-\u0008\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(text)||(text!==''&&text.trim().length<20))return fail('invalid');}
  if(value.configured!==Object.values(notices).some(text=>!!text))return fail('invalid');
  return notices[declaredLanguage] || null;
}
export async function requestStaffRecording(fetcher:typeof fetch,session:PageSession,scope:StaffRecordingScope,pending:StaffRecordingPending,operation:{kind:'receipt'}|{kind:'send';bytes:Uint8Array},signal:AbortSignal,current:()=>boolean,canMutate:()=>boolean=current):Promise<StaffRecordingReceipt>{
  const identity={...session},selection={...scope},retained={...pending},binding=staffRequestBinding(session);
  const check=()=>{author(identity);if(!current()||staffRequestBinding(session)!==binding||JSON.stringify(scope)!==JSON.stringify(selection)||JSON.stringify(pending)!==JSON.stringify(retained))return fail('session');};
  check();if(!scopeValid(scope)||!pendingValid(pending)||!operation||!['receipt','send'].includes(operation.kind)||!exact(operation,operation.kind==='send'?['kind','bytes']:['kind']))return fail('invalid');
  const mutation=operation.kind==='send';let bytes:Uint8Array<ArrayBuffer>|undefined;
  if(mutation){if(!canMutate())return fail('blocked');if(!(operation.bytes instanceof Uint8Array)||operation.bytes.length!==pending.bytes)return fail('invalid');bytes=new Uint8Array(operation.bytes);
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');check();if(hash!==pending.hash)return fail('invalid');}
  const requestSignal=AbortSignal.any([signal,AbortSignal.timeout(15000)]);let response:Response,value:unknown;
  try{
    check();if(mutation&&!canMutate())return fail('blocked');if(requestSignal.aborted)return fail('unavailable');
    response=await fetcher(`/api/clarifications/${encodeURIComponent(selection.caseId)}/in-person-recordings/${retained.id}`,{method:mutation?'POST':'GET',credentials:'include',cache:'no-store',redirect:'error',signal:requestSignal,
      headers:{'x-client-session-context':identity.clientContext!,...(mutation?{'content-type':'audio/wav','x-recording-language':retained.language}:{})},...(bytes?{body:bytes}:{})});
    check();if([401,403].includes(response.status))return fail('session');value=await response.json();check();if(requestSignal.aborted)return fail('unavailable');
  }catch(error){if(error instanceof StaffRecordingError)throw error;check();return fail('unavailable');}
  if(!response.ok){if(response.status===409&&value&&typeof value==='object'&&(value as {error?:string}).error==='Session context changed')return fail('session');return fail(response.status===409?'conflict':'unavailable');}
  if(mutation&&!canMutate())return fail('blocked');return checkedStaffRecordingReceipt(value,identity,selection,retained);
}
