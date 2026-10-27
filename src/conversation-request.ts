import type {MessageSession} from './case-message-recovery.ts';
import {isWorkerLanguage,type WorkerLocaleCode} from '../server/languages.mjs';

export type ConversationFailure='session'|'invalid'|'unavailable'|'closed'|'translation'|'conflict'|'blocked'|'recovery';
export class ConversationRequestError extends Error {
  readonly code:ConversationFailure;
  constructor(code:ConversationFailure){super(code);this.code=code;}
}
export type ConversationMessage={id:string;caseId:string;language:WorkerLocaleCode;createdAt:string;author:'staff'|'worker';authorName:string;text:string;audioUrl?:string;kind?:'voice'};
export type ConversationPage={caseId:string;clientContext:string;items:ConversationMessage[];total:number;page:number;pageSize:20;status:'open'|'resolved';language:WorkerLocaleCode;canReply:boolean;canGenerate:boolean;canVoice:boolean};
export type ConversationReceipt={id:string;caseId:string;language:WorkerLocaleCode;createdAt:string;clientContext:string;status?:'queued'|'processing'|'delivered'|'failed';deliveredAt?:string|null;errorCode?:string|null};
export type ConversationOperation={kind:'page';page:number}|{kind:'message'|'followup';requestId:string;text?:string};
export function conversationComposerPolicy({worker,pendingKind,canGenerate,language,includeAudio}:{worker:boolean;pendingKind:'message'|'followup'|null;canGenerate:boolean;language:string|undefined;includeAudio:boolean}){
  const kind=pendingKind??(!worker&&canGenerate&&(language!=='en'||includeAudio)?'followup':'message');
  return {kind,limit:!worker&&kind==='followup'&&!pendingKind?500:1000} as const;
}
const identifier=(value:unknown):value is string=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(value);
const requestId=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const integer=(value:unknown,min:number,max:number)=>Number.isSafeInteger(value)&&Number(value)>=min&&Number(value)<=max;
const exact=(value:unknown,keys:string[]):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const date=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const language=(value:unknown):value is WorkerLocaleCode=>isWorkerLanguage(value);
const invalid=()=>{throw new ConversationRequestError('invalid');};
export function validConversationSession(session:MessageSession,now=Date.now()){
  return !!session&&/^[a-f0-9]{64}$/.test(session.clientContext)&&date(session.expiresAt)&&Date.parse(session.expiresAt)>now;
}

export function checkedConversationPage(value:unknown,caseId:string,page:number,context:string,worker:boolean):ConversationPage {
  if(!identifier(caseId)||!integer(page,1,5000)||!/^[a-f0-9]{64}$/.test(context)
    ||!exact(value,['caseId','clientContext','items','total','page','pageSize','status','language','canReply','canGenerate','canVoice']))return invalid();
  if(value.clientContext!==context)throw new ConversationRequestError('session');
  if(value.caseId!==caseId||value.page!==page||value.pageSize!==20||!integer(value.total,0,Number.MAX_SAFE_INTEGER)||!language(value.language)
    ||!['open','resolved'].includes(value.status as string)||typeof value.canReply!=='boolean'||typeof value.canGenerate!=='boolean'||typeof value.canVoice!=='boolean'
    ||worker&&value.canGenerate||!worker&&value.canVoice||value.canVoice&&!value.canReply||value.status==='resolved'&&value.canReply
    ||!Array.isArray(value.items)||value.items.length!==Math.min(20,Math.max(0,Number(value.total)-(page-1)*20)))return invalid();
  const ids=new Set<string>();let previous=Infinity;
  for(const row of value.items){
    if(!row||typeof row!=='object'||Array.isArray(row))return invalid();
    const keys=['id','caseId','language','createdAt','author','authorName','text',...('audioUrl' in row?['audioUrl']:[]),...('kind' in row?['kind']:[])];
    if(!exact(row,keys)||!identifier(row.id)||ids.has(row.id)||row.caseId!==caseId||row.language!==value.language||!date(row.createdAt)||Date.parse(row.createdAt)>previous
      ||!['staff','worker'].includes(row.author as string)||typeof row.authorName!=='string'||!row.authorName||row.authorName.length>500||/[\u0000-\u001f\u007f]/.test(row.authorName)
      ||typeof row.text!=='string'||!row.text||row.text.length>1000||'kind' in row&&row.kind!=='voice')return invalid();
    const base=`/api/clarifications/${encodeURIComponent(caseId)}/messages/${encodeURIComponent(row.id)}`;
    if('audioUrl' in row&&(row.audioUrl!==base+'/audio'&&row.audioUrl!==base+'/voice')
      ||row.kind==='voice'&&(row.author!=='worker'||row.audioUrl!==base+'/voice')||row.audioUrl===base+'/voice'&&row.kind!=='voice')return invalid();
    ids.add(row.id);previous=Date.parse(row.createdAt);
  }
  return value as unknown as ConversationPage;
}

export function checkedConversationReceipt(value:unknown,caseId:string,requestId:string,context:string,kind:'message'|'followup'):ConversationReceipt {
  const keys=['id','caseId','language','createdAt','clientContext',...(kind==='followup'?['status','deliveredAt','errorCode']:[])];
  if(!exact(value,keys)||!identifier(caseId)||!identifier(requestId)||!/^[a-f0-9]{64}$/.test(context))return invalid();
  if(value.clientContext!==context)throw new ConversationRequestError('session');
  if(value.caseId!==caseId||value.id!==requestId||!language(value.language)||!date(value.createdAt))return invalid();
  if(kind==='followup'&&(!['queued','processing','delivered','failed'].includes(value.status as string)
    ||value.deliveredAt!==null&&!date(value.deliveredAt)||value.status==='delivered'&&value.deliveredAt===null||value.status!=='delivered'&&value.deliveredAt!==null
    ||value.status==='delivered'&&Date.parse(value.deliveredAt as string)<Date.parse(value.createdAt as string)
    ||value.status!=='failed'&&value.errorCode!==null
    ||value.errorCode!==null&&(typeof value.errorCode!=='string'||!/^[a-z][a-z0-9_]{0,79}$/.test(value.errorCode))))return invalid();
  return value as unknown as ConversationReceipt;
}

export async function requestConversation(send:typeof fetch,session:MessageSession,caseId:string,worker:boolean,operation:ConversationOperation,
  signal:AbortSignal,current:()=>boolean,canMutate:()=>boolean=current):Promise<ConversationPage|ConversationReceipt> {
  const expected={...session};
  const isCurrent=()=>current()&&validConversationSession(expected)&&validConversationSession(session)&&expected.clientContext===session.clientContext&&expected.expiresAt===session.expiresAt;
  const assertCurrent=()=>{if(!isCurrent())throw new ConversationRequestError('session');};
  assertCurrent();if(!identifier(caseId))return invalid();
  const paging=operation?.kind==='page',mutation=!paging&&operation?.text!==undefined;
  if(paging?(!exact(operation,['kind','page'])||!integer(operation.page,1,5000))
    :(!exact(operation,['kind','requestId',...(mutation?['text']:[])])||!['message','followup'].includes(operation.kind)||!requestId(operation.requestId)
      ||worker&&operation.kind==='followup'||mutation&&(typeof operation.text!=='string'||!operation.text.trim()||operation.text.length>1000)))return invalid();
  if(mutation&&!canMutate())throw new ConversationRequestError('blocked');
  const base=`/api/clarifications/${encodeURIComponent(caseId)}`;
  const path=paging?`${base}/messages?page=${operation.page}&pageSize=20`:`${base}/${operation.kind==='followup'?'followups':'messages'}${mutation?'':'/'+encodeURIComponent(operation.requestId)}`;
  const requestSignal=AbortSignal.any([signal,AbortSignal.timeout(15000)]);
  let response:Response,value:unknown;
  try {
    assertCurrent();if(mutation&&!canMutate())throw new ConversationRequestError('blocked');
    response=await send(path,{method:mutation?'POST':'GET',credentials:'include',cache:'no-store',redirect:'error',signal:requestSignal,
      headers:{'x-client-session-context':expected.clientContext,...(mutation?{'content-type':'application/json'}:{})},
      ...(mutation?{body:JSON.stringify({requestId:operation.requestId,text:operation.text!.trim()})}:{})});
    assertCurrent();if([401,403].includes(response.status))throw new ConversationRequestError('session');
    value=await response.json();assertCurrent();
    if(requestSignal.aborted)throw new ConversationRequestError('unavailable');
  }catch(error){if(error instanceof ConversationRequestError)throw error;assertCurrent();throw new ConversationRequestError('unavailable');}
  if(!response.ok){
    const code=value&&typeof value==='object'&&!Array.isArray(value)?(value as {error?:unknown}).error:null;
    if(response.status===409&&code==='Session context changed')throw new ConversationRequestError('session');
    if(code==='Conversation is closed')throw new ConversationRequestError('closed');
    if(['Follow-up translation unavailable','Follow-up generation unavailable','Follow-up language unavailable'].includes(code as string))throw new ConversationRequestError('translation');
    if(response.status===409)throw new ConversationRequestError('conflict');
    throw new ConversationRequestError('unavailable');
  }
  if(mutation&&!canMutate())throw new ConversationRequestError('blocked');
  return paging?checkedConversationPage(value,caseId,operation.page,expected.clientContext,worker)
    :checkedConversationReceipt(value,caseId,operation.requestId,expected.clientContext,operation.kind);
}
