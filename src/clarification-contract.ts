import {isWorkerLanguage,type WorkerLocaleCode} from '../server/languages.mjs';
export type ClarificationSummary={id:string;worker:string;language:WorkerLocaleCode;title:string|null;reason:string;status:'open'|'resolved';created_at:string;due_at:string|null;case_due_at:string|null;escalated_at:string|null;owner_name:string|null;owner_staff_id:string|null;assignment_id:string;publication_id:string;version:number;attempt_id:string|null};
export type ClarificationEvidence={factIndex:number;quote:string};
export type ClarificationAttempt={id:string;answer_text:string;outcome:'matched'|'clarification'|'unassessable'|null;received_at:string;recording_id:string|null;assessmentReasons:string[];assessmentEvidence:ClarificationEvidence[]};
export type ClarificationPage={rows:ClarificationSummary[];total:number;page:number;pageSize:number;ownerOptions:{id:string;name:string}[];clientContext:string};
export type ClarificationDetail=ClarificationSummary&{staffCreation?:{actorId:string;actorName:string;createdAt:string};notes:string;clientContext:string;snapshot:{source:string|null;question:string|null;facts:string[];askedFacts:string[]};answer_text:string|null;outcome:ClarificationAttempt['outcome'];recording_id:string|null;assessmentReasons:string[];assessmentEvidence:ClarificationEvidence[];attempts:ClarificationAttempt[];owners:{id:string;name:string}[];helpRequest:{text:string;createdAt:string}|null;canRequestRepeat:boolean;canReview:boolean;contentExpired:boolean};
export type ClarificationActionKind='assign'|'resolve';
export type ClarificationActionReceipt={requestId:string;caseId:string;kind:ClarificationActionKind;requestHash:string;effect:'applied'|'unchanged'|'rejected';status:'open'|'resolved';ownerId:string|null;reasonCode:'owner_changed'|'owner_unavailable'|'case_resolved'|'resolution_conflict'|null;createdAt:string;clientContext:string};
export class ClarificationContractError extends Error {
  readonly code:'invalid'|'session';
  constructor(code:'invalid'|'session'){super(code);this.code=code;}
}
const invalid=()=>{throw new ClarificationContractError('invalid');};
const exact=(value:unknown,keys:string[]):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const id=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(value);
const digest=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const text=(value:unknown,max:number,empty=false):value is string=>typeof value==='string'&&value.length<=max&&(empty||!!value.trim());
const date=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const nullable=(value:unknown,check:(value:unknown)=>boolean)=>value===null||check(value);
const integer=(value:unknown,min:number,max:number)=>Number.isSafeInteger(value)&&Number(value)>=min&&Number(value)<=max;
const outcome=(value:unknown)=>value===null||['matched','clarification','unassessable'].includes(value as string);
const summaryKeys=['id','worker','language','title','reason','status','created_at','due_at','case_due_at','escalated_at','owner_name','owner_staff_id','assignment_id','publication_id','version','attempt_id'];
function summary(row:Record<string,unknown>){
  return id(row.id)&&text(row.worker,200)&&isWorkerLanguage(row.language)&&nullable(row.title,value=>text(value,120))&&text(row.reason,4000,true)
    &&['open','resolved'].includes(row.status as string)&&date(row.created_at)&&nullable(row.due_at,date)&&nullable(row.case_due_at,date)&&nullable(row.escalated_at,date)
    &&nullable(row.owner_name,value=>text(value,500))&&nullable(row.owner_staff_id,id)&&!(row.owner_staff_id===null&&row.owner_name!==null)
    &&id(row.assignment_id)&&id(row.publication_id)&&integer(row.version,1,Number.MAX_SAFE_INTEGER)&&nullable(row.attempt_id,id);
}
function reasons(value:unknown){return Array.isArray(value)&&value.length<=20&&value.every(item=>text(item,500));}
function evidence(value:unknown){return Array.isArray(value)&&value.length<=12&&value.every(row=>exact(row,['factIndex','quote'])&&integer(row.factIndex,0,5)&&text(row.quote,300));}
function checkContext(value:unknown,expected:string){
  if(!digest(expected))return invalid();if(value!==expected)throw new ClarificationContractError('session');
}
export function checkedClarificationPage(value:unknown,page:number,pageSize:number,context:string):ClarificationPage{
  if(!integer(page,1,5000)||!integer(pageSize,1,50)||!exact(value,['rows','total','page','pageSize','ownerOptions','clientContext']))return invalid();
  checkContext(value.clientContext,context);
  if(value.page!==page||value.pageSize!==pageSize||!integer(value.total,0,5000)||!Array.isArray(value.rows)||value.rows.length!==Math.min(pageSize,Math.max(0,Number(value.total)-(page-1)*pageSize))||!Array.isArray(value.ownerOptions)||value.ownerOptions.length>5000)return invalid();
  const ids=new Set<string>();let previous=Infinity;
  for(const row of value.rows){if(!exact(row,summaryKeys)||!summary(row)||ids.has(row.id as string)||Date.parse(row.created_at as string)>previous)return invalid();ids.add(row.id as string);previous=Date.parse(row.created_at as string);}
  const owners=new Set<string>();for(const row of value.ownerOptions){if(!exact(row,['id','name'])||!id(row.id)||owners.has(row.id)||!text(row.name,500))return invalid();owners.add(row.id);}
  return value as unknown as ClarificationPage;
}
export function checkedClarificationDetail(value:unknown,caseId:string,context:string):ClarificationDetail{
  const keys=[...summaryKeys,'notes','clientContext','snapshot','answer_text','outcome','recording_id','assessmentReasons','assessmentEvidence','attempts','owners','helpRequest','canRequestRepeat','canReview','contentExpired',...(value&&typeof value==='object'&&Object.hasOwn(value,'staffCreation')?['staffCreation']:[])];
  if(!id(caseId)||!exact(value,keys))return invalid();checkContext(value.clientContext,context);
  if(value.id!==caseId||!summary(value)||!text(value.notes,1000,true)||!nullable(value.answer_text,v=>text(v,20000,true))||!outcome(value.outcome)||!nullable(value.recording_id,id)
    ||!reasons(value.assessmentReasons)||!evidence(value.assessmentEvidence)||!exact(value.snapshot,['source','question','facts','askedFacts'])
    ||!nullable(value.snapshot.source,v=>text(v,20000,true))||!nullable(value.snapshot.question,v=>text(v,500))
    ||!Array.isArray(value.snapshot.facts)||value.snapshot.facts.length>12||!value.snapshot.facts.every(v=>text(v,500))
    ||!Array.isArray(value.snapshot.askedFacts)||value.snapshot.askedFacts.length>6||!value.snapshot.askedFacts.every(v=>text(v,500))
    ||!['canRequestRepeat','canReview','contentExpired'].every(key=>typeof value[key]==='boolean')
    ||!Array.isArray(value.attempts)||value.attempts.length>100||!Array.isArray(value.owners)||value.owners.length>5000)return invalid();
  const attempts=new Set<string>();let previous=Infinity;
  for(const row of value.attempts){
    if(!exact(row,['id','answer_text','outcome','received_at','recording_id','assessmentReasons','assessmentEvidence'])||!id(row.id)||attempts.has(row.id)||!text(row.answer_text,20000,true)||!outcome(row.outcome)
      ||!date(row.received_at)||Date.parse(row.received_at)>previous||!nullable(row.recording_id,id)||!reasons(row.assessmentReasons)||!evidence(row.assessmentEvidence))return invalid();
    attempts.add(row.id);previous=Date.parse(row.received_at);
  }
  const owners=new Set<string>();for(const row of value.owners){if(!exact(row,['id','name'])||!id(row.id)||owners.has(row.id)||!text(row.name,500))return invalid();owners.add(row.id);}
  if(value.helpRequest!==null&&(!exact(value.helpRequest,['text','createdAt'])||!text(value.helpRequest.text,500)||!date(value.helpRequest.createdAt)))return invalid();
  if(value.staffCreation!==undefined&&(!exact(value.staffCreation,['actorId','actorName','createdAt'])||!id(value.staffCreation.actorId)||!text(value.staffCreation.actorName,500)||!date(value.staffCreation.createdAt)||value.staffCreation.createdAt!==value.created_at||value.helpRequest!==null))return invalid();
  return value as unknown as ClarificationDetail;
}
export function checkedClarificationActionReceipt(value:unknown,caseId:string,pending:{id:string;hash:string;kind:ClarificationActionKind},context:string):ClarificationActionReceipt{
  if(!exact(value,['requestId','caseId','kind','requestHash','effect','status','ownerId','reasonCode','createdAt','clientContext'])||!id(caseId)||!digest(pending.hash))return invalid();checkContext(value.clientContext,context);
  if(value.requestId!==pending.id||value.caseId!==caseId||value.kind!==pending.kind||value.requestHash!==pending.hash||!['applied','unchanged','rejected'].includes(value.effect as string)
    ||!['open','resolved'].includes(value.status as string)||!nullable(value.ownerId,id)||!date(value.createdAt)
    ||(value.effect==='rejected'?!['owner_changed','owner_unavailable','case_resolved','resolution_conflict'].includes(value.reasonCode as string):value.reasonCode!==null)
    ||value.kind==='resolve'&&value.effect!=='rejected'&&value.status!=='resolved'
    ||value.kind==='resolve'&&value.reasonCode!==null&&value.reasonCode!=='resolution_conflict'
    ||value.kind==='assign'&&value.reasonCode==='resolution_conflict')return invalid();
  return value as unknown as ClarificationActionReceipt;
}
