import {isWorkerLanguage} from '../server/languages.mjs';
import type {MessageSession} from './case-message-recovery.ts';
import type {RecordingLanguage} from './recording-notice.ts';
import {validConversationSession} from './conversation-request.ts';
import {workerRecordingNotice} from './notice-recovery.ts';

export class WorkerRecordingNoticeError extends Error {
  readonly code:'session'|'invalid'|'unavailable';
  constructor(code:WorkerRecordingNoticeError['code']){super(code);this.code=code;}
}
export async function readWorkerRecordingNotice(send:typeof fetch,session:MessageSession,language:RecordingLanguage,signal:AbortSignal,current:()=>boolean):Promise<string|null>{
  const identity={...session},requestSignal=AbortSignal.any([signal,AbortSignal.timeout(15000)]);
  const guard=()=>{if(!current()||!validConversationSession(identity)||!validConversationSession(session)||identity.clientContext!==session.clientContext||identity.expiresAt!==session.expiresAt)throw new WorkerRecordingNoticeError('session');};
  const active=()=>{if(requestSignal.aborted)throw new WorkerRecordingNoticeError('unavailable');guard();};
  active();if(!isWorkerLanguage(language))throw new WorkerRecordingNoticeError('invalid');
  let response:Response,value:unknown;
  try{
    response=await send(`/api/privacy/recording-notice?${new URLSearchParams({language})}`,{method:'GET',credentials:'include',cache:'no-store',redirect:'error',signal:requestSignal,headers:{'x-client-session-context':identity.clientContext}});
    active();if([401,403].includes(response.status))throw new WorkerRecordingNoticeError('session');
    value=await response.json();active();
  }catch(reason){if(reason instanceof WorkerRecordingNoticeError)throw reason;active();throw new WorkerRecordingNoticeError('unavailable');}
  if(!response.ok){
    if(response.status===409&&value&&typeof value==='object'&&!Array.isArray(value)&&(value as {error?:unknown}).error==='Session context changed')throw new WorkerRecordingNoticeError('session');
    throw new WorkerRecordingNoticeError('unavailable');
  }
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='configured,language,notice,revision')throw new WorkerRecordingNoticeError('invalid');
  const row=value as {revision:number;configured:boolean;notice:unknown};
  if(row.revision>1000000000||row.configured&&row.revision===0||typeof row.notice==='string'&&/[\u0000-\u0008\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(row.notice))throw new WorkerRecordingNoticeError('invalid');
  try{return workerRecordingNotice(value,language);}catch{throw new WorkerRecordingNoticeError('invalid');}
}
