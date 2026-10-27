import {isWorkerLanguage} from '../server/languages.mjs';
export const processingKinds=['prepare','source_transcription','response_transcription','answer_check'] as const;
export type ProcessingKind=typeof processingKinds[number];
export const processingKindLabels:Record<ProcessingKind,string>={prepare:'Briefing preparation',source_transcription:'Source transcription',response_transcription:'Response transcription',answer_check:'Answer check'};
export type ProcessingEvent={step:number;stage:string;language:string|null;track:string|null;state:string;origin:string;errorCode:string|null;occurredAt:string};
export type ProcessingProgress={available:boolean;attempts:Array<{current:boolean;startedAt:string;events:ProcessingEvent[]}>};
export type ProcessingJob={id:string;kind:ProcessingKind;status:string;mode:'durable'|'inline-synthetic';attempts:number;revision:number|null;title:string;briefing_id:string|null;
  draft_revision:number|null;draft_state:string|null;archived_at:string|null;created_at:string;due_at:string;error:string|null;retryAvailable:boolean;
  publication_id:string|null;publication_version:number|null;assignment_id:string|null;source_request_id:string|null;own_source:boolean;sourceRetryAvailable:boolean;contentExpired:boolean;progress?:ProcessingProgress};
export type ProcessingPage={items:ProcessingJob[];total:number;page:number;pageSize:number};
const object=(value:unknown):value is Record<string,unknown>=>!!value && typeof value==='object' && !Array.isArray(value);
const reference=(value:unknown)=>typeof value==='string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const date=(value:unknown)=>typeof value==='string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString()===value;
const integer=(value:unknown)=>Number.isSafeInteger(value) && Number(value)>0;
const fields=['id','kind','status','mode','attempts','revision','title','briefing_id','draft_revision','draft_state','archived_at','created_at','due_at','error','retryAvailable',
  'publication_id','publication_version','assignment_id','source_request_id','own_source','sourceRetryAvailable','contentExpired'];
export function checkedProcessingJob(value:unknown,expectedId?:string):ProcessingJob {
  if(!object(value) || fields.some(field=>!(field in value)) || Object.keys(value).some(field=>!fields.includes(field) && field!=='progress')
    || !processingKinds.includes(value.kind as ProcessingKind) || typeof value.id!=='string' || expectedId!==undefined && value.id!==expectedId
    || !['queued','processing','ready','complete','failed','blocked'].includes(String(value.status)) || !['durable','inline-synthetic'].includes(String(value.mode))
    || !Number.isSafeInteger(value.attempts) || Number(value.attempts)<0 || Number(value.attempts)>1000000
    || typeof value.title!=='string' || !value.title.trim() || value.title.length>120 || !date(value.created_at) || !date(value.due_at)
    || value.archived_at!==null && !date(value.archived_at) || value.error!==null && (typeof value.error!=='string' || value.error.length>300)
    || ['retryAvailable','own_source','sourceRetryAvailable','contentExpired'].some(field=>typeof value[field]!=='boolean')
    || ['briefing_id','publication_id','assignment_id','source_request_id'].some(field=>value[field]!==null && !reference(value[field]))
    || ['revision','draft_revision','publication_version'].some(field=>value[field]!==null && !integer(value[field]))
    || value.draft_state!==null && !['draft','processing','ready','failed'].includes(String(value.draft_state)))throw Error('Processing status cannot be verified.');
  if(value.kind==='prepare') {
    if(!reference(value.id) || value.mode!=='durable' || !['queued','processing','ready','failed'].includes(String(value.status))
      || value.revision===null || value.briefing_id===null || value.draft_revision===null || value.draft_state===null
      || value.publication_id!==null || value.publication_version!==null || value.assignment_id!==null || value.source_request_id!==null || value.own_source || value.sourceRetryAvailable
      || value.retryAvailable && !(value.status==='failed' && value.draft_state==='failed' && value.revision===value.draft_revision && value.archived_at===null && !value.contentExpired))throw Error('Preparation identity cannot be verified.');
  }else {
    if(!value.id.startsWith(`${value.kind}:`) || !reference(value.id.slice(String(value.kind).length+1)) || value.revision!==null || value.retryAvailable
      || value.kind!=='source_transcription' && (value.source_request_id!==null || value.own_source || value.sourceRetryAvailable))throw Error('Processing identity cannot be verified.');
    if(value.kind==='source_transcription') {
      if(value.source_request_id===null || value.id!==`source_transcription:${value.source_request_id}` || value.mode!=='durable'
        || value.publication_id!==null || value.publication_version!==null || value.assignment_id!==null || value.status==='ready'
        || value.sourceRetryAvailable && (!value.own_source || !['failed','blocked'].includes(String(value.status))))throw Error('Source transcription identity cannot be verified.');
    }else if(value.publication_id===null || value.publication_version===null || value.assignment_id===null || value.briefing_id===null || value.status==='ready'
      || value.mode==='inline-synthetic' && (value.kind!=='answer_check' || value.status!=='complete'))throw Error('Published response identity cannot be verified.');
  }
  if(value.progress!==undefined && (!object(value.progress) || Object.keys(value.progress).sort().join(',')!=='attempts,available'
    || typeof value.progress.available!=='boolean' || !Array.isArray(value.progress.attempts) || value.progress.attempts.length>3
    || value.kind!=='prepare' || value.progress.available!==Boolean(value.progress.attempts.length)))throw Error('Preparation stage history cannot be verified.');
  if(value.progress)for(const attempt of (value.progress as ProcessingProgress).attempts) {
    if(!object(attempt) || Object.keys(attempt).sort().join(',')!=='current,events,startedAt' || typeof attempt.current!=='boolean' || !date(attempt.startedAt)
      || !Array.isArray(attempt.events) || attempt.events.length>200)throw Error('Preparation attempt cannot be verified.');
    for(const event of attempt.events)if(!object(event) || Object.keys(event).sort().join(',')!=='errorCode,language,occurredAt,origin,stage,state,step,track'
      || !Number.isInteger(event.step) || event.step<0 || event.step>101 || !['worker','preparation','grounding_check','translation','translation_check','speech','storage','finalization'].includes(event.stage)
      || !['started','completed','reused','failed'].includes(event.state) || !['generated','retained','override','cache','system'].includes(event.origin)
      || event.language!==null && !isWorkerLanguage(event.language) || event.track!==null && !['body','question'].includes(event.track)
      || event.errorCode!==null && (typeof event.errorCode!=='string' || !/^[a-z_]{1,80}$/.test(event.errorCode)) || !date(event.occurredAt))throw Error('Preparation stage cannot be verified.');
  }
  return value as ProcessingJob;
}
export function checkedProcessingPage(value:unknown,page:number,pageSize=20):ProcessingPage {
  if(!object(value) || Object.keys(value).sort().join(',')!=='items,page,pageSize,total' || value.page!==page || value.pageSize!==pageSize
    || !Number.isSafeInteger(value.total) || Number(value.total)<0 || !Array.isArray(value.items) || value.items.length>pageSize || value.items.length>Number(value.total))throw Error('Processing page cannot be verified.');
  const items=value.items.map(item=>checkedProcessingJob(item));
  if(new Set(items.map(item=>item.id)).size!==items.length)throw Error('Processing page identities cannot be verified.');
  return {items,total:Number(value.total),page,pageSize};
}
