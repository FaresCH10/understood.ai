import {sameWorkerSession,validWorkerSession,type PageSession} from './session-state.ts';
import {isWorkerLanguage,type WorkerLocaleCode} from '../server/languages.mjs';

export type SubmissionScope={assignmentId:string;version:number;language:WorkerLocaleCode};
export type WorkerSubmission={id:string;kind:'typed'|'audio';receivedAt:string;isLatest:boolean;answerText:string|null;outcome:'matched'|'clarification'|'unassessable'|null;recordingId:string|null;audioStatus:string|null};
export type WorkerSubmissionPage={assignment:{id:string;language:string;version:number;state:string};receipts:WorkerSubmission[];total:number;page:number;pageSize:number;clientContext:string};
export class WorkerSubmissionsError extends Error{
  readonly code:'session'|'unavailable'|'invalid';
  constructor(code:'session'|'unavailable'|'invalid'){super(code);this.code=code;}
}
const exact=(value:unknown,keys:string[]):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const identifier=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=100&&!/[\u0000-\u0020\u007f]/.test(value);
const integer=(value:unknown,min:number,max:number)=>Number.isSafeInteger(value)&&Number(value)>=min&&Number(value)<=max;
const validRead=(scope:SubmissionScope,page:number,context:string)=>identifier(scope.assignmentId)&&integer(scope.version,1,Number.MAX_SAFE_INTEGER)&&isWorkerLanguage(scope.language)&&integer(page,1,5000)&&/^[a-f0-9]{64}$/.test(context);

export function checkedWorkerSubmission(value:unknown):WorkerSubmission{
  if(!exact(value,['id','kind','receivedAt','isLatest','answerText','outcome','recordingId','audioStatus'])||!identifier(value.id)||!['typed','audio'].includes(value.kind as string)
    ||typeof value.receivedAt!=='string'||value.receivedAt.length>40||!/^\d{4}-\d{2}-\d{2}T.*Z$/.test(value.receivedAt)||!Number.isFinite(Date.parse(value.receivedAt))
    ||typeof value.isLatest!=='boolean'||value.answerText!==null&&(typeof value.answerText!=='string'||value.answerText.length>20000)
    ||value.outcome!==null&&!['matched','clarification','unassessable'].includes(value.outcome as string)
    ||value.recordingId!==null&&!identifier(value.recordingId)||value.audioStatus!==null&&!['received','processing','blocked','transcribed','failed'].includes(value.audioStatus as string)
    ||value.kind==='typed'&&(value.recordingId!==null||value.audioStatus!==null))throw new WorkerSubmissionsError('invalid');
  return value as unknown as WorkerSubmission;
}

export function checkedWorkerSubmissions(value:unknown,scope:SubmissionScope,page:number,context:string):WorkerSubmissionPage{
  const fail=()=>{throw new WorkerSubmissionsError('invalid');};
  if(!validRead(scope,page,context))return fail();
  if(!exact(value,['assignment','receipts','total','page','pageSize','clientContext']))return fail();
  if(value.clientContext!==context)throw new WorkerSubmissionsError('session');
  const assignment=value.assignment;
  if(!exact(assignment,['id','language','version','state'])||assignment.id!==scope.assignmentId||assignment.version!==scope.version||assignment.language!==scope.language||!['published','superseded','withdrawn','archived'].includes(assignment.state as string)
    ||value.page!==page||value.pageSize!==5||!integer(value.total,0,Number.MAX_SAFE_INTEGER)||!Array.isArray(value.receipts)||value.receipts.length>5||value.receipts.length>Number(value.total))return fail();
  const expected=Math.min(5,Math.max(0,Number(value.total)-(page-1)*5));
  if(value.receipts.length!==expected)return fail();
  const ids=new Set();
  for(const [index,row] of value.receipts.entries()){
    const checked=checkedWorkerSubmission(row);
    if(ids.has(checked.id)||checked.isLatest!==(page===1&&index===0))return fail();
    ids.add(checked.id);
  }
  return value as unknown as WorkerSubmissionPage;
}

export function workerSubmissionState(row:WorkerSubmission){
  if(row.outcome)return row.outcome;
  if(row.kind==='audio'){
    if(!row.recordingId)return 'unavailable';
    if(row.audioStatus==='failed')return 'audioFailed';
    if(row.audioStatus==='blocked')return 'paused';
  }
  return 'pending';
}

export async function readWorkerSubmissions(send:typeof fetch,session:PageSession,scope:SubmissionScope,page:number,signal:AbortSignal,current:()=>boolean){
  const expected={...session},selection={...scope};
  if(!validWorkerSession(expected)||!current())throw new WorkerSubmissionsError('session');
  if(!validRead(selection,page,expected.clientContext!))throw new WorkerSubmissionsError('invalid');
  const response=await send(`/api/worker/briefings/${encodeURIComponent(selection.assignmentId)}/submissions?page=${page}&pageSize=5`,{credentials:'include',cache:'no-store',signal,headers:{'x-client-session-context':expected.clientContext!}});
  if(!current()||!sameWorkerSession(expected,session)||expected.expiresAt!==session.expiresAt)throw new WorkerSubmissionsError('session');
  if([401,403,409].includes(response.status))throw new WorkerSubmissionsError('session');
  if(!response.ok)throw new WorkerSubmissionsError('unavailable');
  const value=await response.json();
  if(!current()||!sameWorkerSession(expected,session)||expected.expiresAt!==session.expiresAt)throw new WorkerSubmissionsError('session');
  return checkedWorkerSubmissions(value,selection,page,expected.clientContext!);
}
