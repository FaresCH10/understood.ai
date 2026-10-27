import {sameWorkerSession,validWorkerSession,type PageSession} from './session-state.ts';
import {isWorkerLanguage,type WorkerLocaleCode} from '../server/languages.mjs';

export type HelpHistoryScope={assignmentId:string;version:number;language:WorkerLocaleCode};
export type WorkerHelpCase={id:string;status:'open'|'resolved';createdAt:string;helpText:string|null;owner:string|null};
export type WorkerHelpPage={assignment:{id:string;language:string;version:number;state:string};cases:WorkerHelpCase[];total:number;page:number;pageSize:5;clientContext:string};
export class WorkerHelpHistoryError extends Error {
  readonly code:'session'|'invalid'|'unavailable';
  constructor(code:'session'|'invalid'|'unavailable'){super(code);this.code=code;}
}
const exact=(value:unknown,keys:string[]):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const identifier=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=100&&!/[\u0000-\u0020\u007f]/.test(value);
const integer=(value:unknown,min:number,max:number)=>Number.isSafeInteger(value)&&Number(value)>=min&&Number(value)<=max;
const validRead=(scope:HelpHistoryScope,page:number,context:string)=>identifier(scope.assignmentId)&&integer(scope.version,1,Number.MAX_SAFE_INTEGER)&&isWorkerLanguage(scope.language)&&integer(page,1,5000)&&/^[a-f0-9]{64}$/.test(context);

export function checkedWorkerHelpHistory(value:unknown,scope:HelpHistoryScope,page:number,context:string):WorkerHelpPage {
  const invalid=()=>{throw new WorkerHelpHistoryError('invalid');};
  if(!validRead(scope,page,context)||!exact(value,['assignment','cases','total','page','pageSize','clientContext']))return invalid();
  if(value.clientContext!==context)throw new WorkerHelpHistoryError('session');
  const assignment=value.assignment;
  if(!exact(assignment,['id','language','version','state'])||assignment.id!==scope.assignmentId||assignment.language!==scope.language||assignment.version!==scope.version
    ||!['published','superseded','withdrawn','archived'].includes(assignment.state as string)||value.page!==page||value.pageSize!==5
    ||!integer(value.total,0,Number.MAX_SAFE_INTEGER)||!Array.isArray(value.cases)||value.cases.length!==Math.min(5,Math.max(0,Number(value.total)-(page-1)*5)))return invalid();
  const ids=new Set<string>();let previous=Infinity;
  for(const row of value.cases){
    if(!exact(row,['id','status','createdAt','helpText','owner'])||!identifier(row.id)||ids.has(row.id)||!['open','resolved'].includes(row.status as string)
      ||typeof row.createdAt!=='string'||row.createdAt.length>40||!/^\d{4}-\d{2}-\d{2}T.*Z$/.test(row.createdAt)||!Number.isFinite(Date.parse(row.createdAt))
      ||Date.parse(row.createdAt)>previous||row.helpText!==null&&(typeof row.helpText!=='string'||row.helpText.length>500)
      ||row.owner!==null&&(typeof row.owner!=='string'||row.owner.length>500||/[\u0000-\u001f\u007f]/.test(row.owner)))return invalid();
    ids.add(row.id);previous=Date.parse(row.createdAt);
  }
  return value as unknown as WorkerHelpPage;
}

export async function readWorkerHelpHistory(send:typeof fetch,session:PageSession,scope:HelpHistoryScope,page:number,signal:AbortSignal,current:()=>boolean) {
  const expected={...session},selection={...scope};
  const isCurrent=()=>current()&&sameWorkerSession(expected,session)&&expected.expiresAt===session.expiresAt;
  if(!validWorkerSession(expected)||!isCurrent())throw new WorkerHelpHistoryError('session');
  if(!validRead(selection,page,expected.clientContext!))throw new WorkerHelpHistoryError('invalid');
  const response=await send(`/api/worker/briefings/${encodeURIComponent(selection.assignmentId)}/help-history?page=${page}&pageSize=5`,{
    credentials:'include',cache:'no-store',signal,headers:{'x-client-session-context':expected.clientContext!},
  });
  if(!isCurrent()||[401,403,409].includes(response.status))throw new WorkerHelpHistoryError('session');
  if(!response.ok)throw new WorkerHelpHistoryError('unavailable');
  const value=await response.json();
  if(!isCurrent())throw new WorkerHelpHistoryError('session');
  return checkedWorkerHelpHistory(value,selection,page,expected.clientContext!);
}
