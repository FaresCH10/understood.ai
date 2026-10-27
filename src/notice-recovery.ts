import type {WorkerLocaleCode} from '../server/languages.mjs';
import {recordingNoticeInput,sameNoticeRequest} from '../server/recording-notice-input.mjs';
import type {RecordingLanguage} from './recording-notice';
export type NoticeChange={requestId:string;revision:number;notices:Record<RecordingLanguage,string>;confirmed:true;scope:string};
type Storage=Pick<globalThis.Storage,'getItem'|'setItem'|'removeItem'>;
const key=(scope:string)=>`understood:recording-notice:${scope}`;
export function readPendingNotice(storage:Storage,scope:string):NoticeChange|null{
  const raw=storage.getItem(key(scope));if(raw===null)return null;
  try{if(raw.length>65000)throw Error();const value=JSON.parse(raw);recordingNoticeInput(value);if(value.scope!==scope)throw Error();return value;}
  catch{throw Error('Pending recording notice cannot be verified.');}
}
export function storePendingNotice(storage:Storage,scope:string,value:NoticeChange){
  recordingNoticeInput(value);const old=readPendingNotice(storage,scope);
  if(value.scope!==scope)throw Error('Recording notice recovery scope changed.');
  if(old && (old.requestId!==value.requestId || !sameNoticeRequest(recordingNoticeInput(old),recordingNoticeInput(value))))throw Error('Resolve the pending recording notice first.');
  const raw=JSON.stringify(value);storage.setItem(key(scope),raw);
  if(storage.getItem(key(scope))!==raw)throw Error('Notice recovery storage is unavailable. No request was sent.');
}
export function clearPendingNotice(storage:Storage,scope:string,requestId:string,expected?:NoticeChange){
  const pending=readPendingNotice(storage,scope);
  if(pending?.requestId!==requestId || expected && (!pending || pending.scope!==expected.scope || !sameNoticeRequest(recordingNoticeInput(pending),recordingNoticeInput(expected))))throw Error('Pending recording notice changed.');
  storage.removeItem(key(scope));if(storage.getItem(key(scope))!==null)throw Error('Notice recovery storage could not be cleared.');
}
export function verifyNoticeReceipt(value:unknown,pending:NoticeChange){
  const row=value as {requestId?:string;request?:unknown;revision?:number};
  const request=recordingNoticeInput(pending);
  if(!row || typeof row!=='object' || Array.isArray(row) || Object.keys(row).sort().join(',')!=='request,requestId,revision'
    || row.requestId!==pending.requestId || row.revision!==pending.revision+1 || !row.request
    || Object.keys(row.request).sort().join(',')!=='notices,revision,scope' || !sameNoticeRequest(row.request,request))throw Error('Recording notice receipt cannot be verified.');
}
export function workerRecordingNotice(value:unknown,language:WorkerLocaleCode){
  const row=value as {revision?:number;configured?:boolean;language?:string;notice?:unknown};
  if(!row || !Number.isSafeInteger(row.revision) || row.revision!<0 || typeof row.configured!=='boolean' || row.language!==language
    || (row.configured ? typeof row.notice!=='string' || row.notice.length<20 || row.notice.length>2000 : row.notice!==null))throw Error('Recording notice cannot be verified.');
  return row.notice as string|null;
}
