import {isWorkerLanguage} from '../server/languages.mjs';
import type {ProcessingJob,ProcessingKind} from './processing-state';
export type ProviderRequest={sequence:number;cleanup:boolean;state:'started'|'accepted'|'rejected'|'uncertain';httpStatus:number|null;startedAt:string;finishedAt:string|null};
export type ProviderOperation={id:string;kind:string;model:string;dataClass:'synthetic'|'real';reservedRequests:number;startedAt:string;runId:string;runStartedAt:string;currentRun:boolean;
  provenance:{adapter:string;promptVersion:string;schemaVersion:string}|null;stage:{step:number;name:string;language:string;track:string|null}|null;resultReference:'transcription'|'assessment'|'bundle'|null;requests:ProviderRequest[]};
export type ProviderHistory={jobId:string;kind:ProcessingKind;publicationId:string|null;publicationVersion:number|null;assignmentId:string|null;supported:boolean;items:ProviderOperation[];total:number;page:number;pageSize:number};
const object=(value:unknown):value is Record<string,unknown>=>!!value && typeof value==='object' && !Array.isArray(value);
const keys=(value:Record<string,unknown>,fields:string[])=>Object.keys(value).sort().join(',')===[...fields].sort().join(',');
const reference=(value:unknown)=>typeof value==='string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const slug=(value:unknown)=>typeof value==='string' && /^[a-z0-9-]{1,80}$/.test(value);
const date=(value:unknown):value is string=>typeof value==='string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString()===value;
const kinds:Record<ProcessingKind,string[]>={prepare:['preparation'],source_transcription:['source-transcription'],response_transcription:['recording-transcription','recording-assessment'],answer_check:['typed-assessment']};
export function checkedProviderHistory(value:unknown,job:Pick<ProcessingJob,'id'|'kind'|'publication_id'|'publication_version'|'assignment_id'>,page:number,pageSize=10):ProviderHistory{
  if(!object(value) || !keys(value,['jobId','kind','publicationId','publicationVersion','assignmentId','supported','items','total','page','pageSize'])
    || value.jobId!==job.id || value.kind!==job.kind || value.publicationId!==job.publication_id || value.publicationVersion!==job.publication_version || value.assignmentId!==job.assignment_id
    || typeof value.supported!=='boolean' || !Number.isSafeInteger(value.total) || Number(value.total)<0 || value.page!==page || value.pageSize!==pageSize
    || !Array.isArray(value.items) || value.items.length>pageSize || value.items.length>Number(value.total) || !value.supported && (value.total!==0 || value.items.length!==0))throw Error('Provider history cannot be verified.');
  const items=value.items.map(item=>checkedProviderOperation(item,job.kind));
  if(new Set(items.map(item=>item.id)).size!==items.length)throw Error('Provider history identities cannot be verified.');
  return {...value,items} as ProviderHistory;
}
export function checkedProviderOperation(value:unknown,kind:ProcessingKind):ProviderOperation{
  if(!object(value) || !keys(value,['id','kind','model','dataClass','reservedRequests','startedAt','runId','runStartedAt','currentRun','provenance','stage','resultReference','requests'])
    || !reference(value.id) || !reference(value.runId) || !kinds[kind]?.includes(String(value.kind)) || typeof value.model!=='string' || !/^[a-z0-9][a-z0-9.-]{2,80}$/.test(value.model)
    || !['synthetic','real'].includes(value.dataClass as string) || !Number.isInteger(value.reservedRequests) || Number(value.reservedRequests)<1 || Number(value.reservedRequests)>64
    || !date(value.startedAt) || !date(value.runStartedAt) || value.runStartedAt>value.startedAt || typeof value.currentRun!=='boolean'
    || !Array.isArray(value.requests) || value.requests.length>Number(value.reservedRequests)
    || value.resultReference!==null && !(['preparation'].includes(String(value.kind))?['bundle']:['recording-assessment','typed-assessment'].includes(String(value.kind))?['assessment']:['transcription']).includes(String(value.resultReference)))throw Error('Provider operation cannot be verified.');
  if(value.provenance!==null && (!object(value.provenance) || !keys(value.provenance,['adapter','promptVersion','schemaVersion']) || !Object.values(value.provenance).every(slug)))throw Error('Recorded provider attribution cannot be verified.');
  if(value.dataClass==='real'&&(!object(value.provenance)||value.provenance.adapter!=='gemini-approved-v1'))throw Error('Production provider attribution cannot be verified.');
  if(value.stage!==null && (value.kind!=='preparation' || value.provenance===null || !object(value.stage) || !keys(value.stage,['step','name','language','track'])
    || !Number.isInteger(value.stage.step) || Number(value.stage.step)<1 || Number(value.stage.step)>68 || !['preparation','grounding_check','translation','translation_check','speech'].includes(String(value.stage.name))
    || !isWorkerLanguage(value.stage.language) || (value.stage.name==='speech'?!['body','question'].includes(String(value.stage.track)):value.stage.track!==null)))throw Error('Provider stage cannot be verified.');
  if(value.kind==='preparation' && value.provenance!==null && value.stage===null)throw Error('Provider stage cannot be verified.');
  for(const [index,request] of value.requests.entries()){
    if(!object(request) || !keys(request,['sequence','cleanup','state','httpStatus','startedAt','finishedAt']) || request.sequence!==index+1 || typeof request.cleanup!=='boolean'
      || !['started','accepted','rejected','uncertain'].includes(String(request.state)) || !date(request.startedAt) || request.startedAt<value.startedAt
      || request.finishedAt!==null && (!date(request.finishedAt) || request.finishedAt<request.startedAt)
      || request.state==='started' && (request.httpStatus!==null || request.finishedAt!==null)
      || request.state==='uncertain' && (request.httpStatus!==null || request.finishedAt===null)
      || ['accepted','rejected'].includes(String(request.state)) && (!Number.isInteger(request.httpStatus) || Number(request.httpStatus)<100 || Number(request.httpStatus)>599 || request.finishedAt===null
        || (request.state==='accepted')!==(Number(request.httpStatus)>=200 && Number(request.httpStatus)<300)))throw Error('Provider request receipt cannot be verified.');
  }
  return value as ProviderOperation;
}
