import {sourceAudioMetadata} from '../server/briefing-input.mjs';
import {checkSourceAudio,type PreparedSourceAudio} from './source-audio.ts';

export type SourceUploadSession={clientContext:string;expiresAt:string};
type Metadata=ReturnType<typeof sourceAudioMetadata>;
export type PendingSourceUpload=Metadata & SourceUploadSession & {sha256:string;bytes:number;durationSeconds:number;originalSha256:string;originalBytes:number;requestHash:string};
export type SourceUploadReceipt={found:boolean;requestId:string;status?:'storing'|'received'|'processing'|'transcribed'|'failed'|'blocked';receivedAt?:string|null;briefingId?:string|null;audioStatus?:'cleanup_pending'|'removed'};
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
const hashPattern=/^[a-f0-9]{64}$/;
const iso=(value:unknown):value is string=>typeof value==='string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString()===value;
const key=(session:SourceUploadSession)=>`understood:source-upload:${session.clientContext}`;
const metadata=(value:Metadata)=>sourceAudioMetadata({requestId:value.requestId,title:value.title,originalType:value.originalType,
  ...(value.generationLanguages!==undefined?{generationLanguages:value.generationLanguages}:{})});
function content(value:PendingSourceUpload) {
  const normalized=metadata(value);
  return {title:normalized.title,originalType:normalized.originalType,...(normalized.generationLanguages!==undefined?{generationLanguages:normalized.generationLanguages}:{}),
    sha256:value.sha256,bytes:value.bytes,durationSeconds:value.durationSeconds,originalSha256:value.originalSha256,originalBytes:value.originalBytes};
}
const hash=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes))),byte=>byte.toString(16).padStart(2,'0')).join('');
const intentHash=(value:PendingSourceUpload)=>hash(new TextEncoder().encode(JSON.stringify(content(value))));
function checkedSession(session:SourceUploadSession,now=Date.now()) {
  if(!session || !hashPattern.test(session.clientContext) || !iso(session.expiresAt) || Date.parse(session.expiresAt)<=now)
    throw Error('The source upload session has ended.');
}
function checkedPending(value:PendingSourceUpload,session:SourceUploadSession) {
  checkedSession(session);
  if(!value || typeof value!=='object')throw Error('Saved source upload cannot be verified.');
  metadata(value);
  if(!value || Object.keys(value).some(field=>!['requestId','title','originalType','generationLanguages','clientContext','expiresAt','sha256','bytes','durationSeconds','originalSha256','originalBytes','requestHash'].includes(field))
    || value.clientContext!==session.clientContext || value.expiresAt!==session.expiresAt
    || ![value.sha256,value.originalSha256,value.requestHash].every(item=>typeof item==='string' && hashPattern.test(item))
    || !Number.isSafeInteger(value.bytes) || value.bytes<8044 || value.bytes>2880044 || value.bytes%2
    || value.durationSeconds!==(value.bytes-44)/32000 || !Number.isSafeInteger(value.originalBytes) || value.originalBytes<1 || value.originalBytes>10485760)
    throw Error('Saved source upload cannot be verified.');
  return value;
}
export async function prepareSourceUpload(audio:PreparedSourceAudio,input:Omit<Metadata,'originalType'>,session:SourceUploadSession):Promise<PendingSourceUpload> {
  checkedSession(session);checkSourceAudio(audio.original);
  const normalized=metadata({...input,originalType:audio.original.type || 'application/octet-stream'}),bytes=await audio.recording.bytes();
  if(bytes.length!==audio.byteLength || audio.durationSeconds!==(bytes.length-44)/32000)throw Error('Source audio changed.');
  const pending={...normalized,clientContext:session.clientContext,expiresAt:session.expiresAt,sha256:await hash(bytes),bytes:bytes.length,durationSeconds:audio.durationSeconds,
    originalSha256:await hash(new Uint8Array(await audio.original.arrayBuffer())),originalBytes:audio.original.size,requestHash:''};
  pending.requestHash=await intentHash(pending);checkedPending(pending,session);
  if(pending.generationLanguages)Object.freeze(pending.generationLanguages);
  return Object.freeze(pending);
}
export function readPendingSourceUpload(storage:Store,session:SourceUploadSession):PendingSourceUpload|null {
  checkedSession(session);
  let raw;try {raw=storage.getItem(key(session));}catch {throw Error('Source receipt storage is unavailable.');}
  if(raw===null)return null;
  try {if(raw.length>4096)throw Error();return checkedPending(JSON.parse(raw),session);}
  catch {throw Error('Saved source upload cannot be verified. Check the instruction library before creating another upload.');}
}
export function savePendingSourceUpload(storage:Store,session:SourceUploadSession,pending:PendingSourceUpload) {
  checkedPending(pending,session);const old=readPendingSourceUpload(storage,session),raw=JSON.stringify(pending);
  if(raw.length>4096 || (old && JSON.stringify(old)!==raw))throw Error('Resolve the saved source upload first.');
  try {storage.setItem(key(session),raw);if(storage.getItem(key(session))!==raw)throw Error();}
  catch {throw Error('This tab cannot retain the source receipt reference. No upload was sent.');}
}
export function clearPendingSourceUpload(storage:Store,session:SourceUploadSession,pending:PendingSourceUpload) {
  const old=readPendingSourceUpload(storage,session);
  if(!old || JSON.stringify(old)!==JSON.stringify(pending))throw Error('Saved source upload changed.');
  storage.removeItem(key(session));if(storage.getItem(key(session))!==null)throw Error('Source receipt reference could not be cleared.');
}
export async function checkedSourceUploadReceipt(value:unknown,pending:PendingSourceUpload,lookup=true):Promise<SourceUploadReceipt> {
  checkedPending(pending,pending);
  if(await intentHash(pending)!==pending.requestHash)throw Error('Saved source upload hash does not match its intent.');
  const receipt=value as Record<string,unknown>|null;
  const invalid=()=>Error('Source receipt does not match the saved upload.');
  if(!receipt || receipt.requestId!==pending.requestId || (lookup && typeof receipt.found!=='boolean'))throw invalid();
  if(lookup && receipt.found===false) {
    if(Object.keys(receipt).some(field=>!['found','requestId'].includes(field)))throw invalid();
    return {found:false,requestId:pending.requestId};
  }
  const allowed=['requestId','requestHash','status','receivedAt','briefingId','audioStatus',...(lookup?['found']:['duplicate'])];
  if(Object.keys(receipt).some(field=>!allowed.includes(field)) || receipt.requestHash!==pending.requestHash
    || !['storing','received','processing','transcribed','failed','blocked'].includes(String(receipt.status))
    || (receipt.status==='storing'?receipt.receivedAt!==null:!iso(receipt.receivedAt))
    || (receipt.status==='transcribed'?receipt.briefingId!==pending.requestId:receipt.briefingId!==null)
    || (receipt.audioStatus!==undefined && !['cleanup_pending','removed'].includes(String(receipt.audioStatus)))
    || (!lookup && (receipt.status==='storing' || typeof receipt.duplicate!=='boolean')))throw invalid();
  return {found:true,requestId:pending.requestId,status:receipt.status as SourceUploadReceipt['status'],receivedAt:receipt.receivedAt as string|null,briefingId:receipt.briefingId as string|null,...(receipt.audioStatus?{audioStatus:receipt.audioStatus as SourceUploadReceipt['audioStatus']}:{})};
}
export class SourceUploadError extends Error {
  status?:number;
  constructor(message:string,status?:number){super(message);this.status=status;}
}
async function responseValue(response:Response) {
  let value;try {value=await response.json();}catch {throw new SourceUploadError('Source upload outcome is not confirmed.');}
  if(!response.ok)throw new SourceUploadError(value?.error || 'Source upload unavailable.',response.status);
  return value;
}
export async function checkSourceUpload(pending:PendingSourceUpload,fetchImpl=fetch,signal?:AbortSignal) {
  checkedPending(pending,pending);
  const response=await fetchImpl(`/api/source-audio/${encodeURIComponent(pending.requestId)}`,{credentials:'include',cache:'no-store',signal,
    headers:{'x-client-session-context':pending.clientContext}});
  return checkedSourceUploadReceipt(await responseValue(response),pending);
}
export async function sendSourceUpload(pending:PendingSourceUpload,audio:PreparedSourceAudio,fetchImpl=fetch,signal?:AbortSignal) {
  checkedPending(pending,pending);
  const prepared=await prepareSourceUpload(audio,metadata(pending),pending);
  if(JSON.stringify(prepared)!==JSON.stringify(pending))throw Error('Choose the exact original audio file for this saved upload. Nothing was sent.');
  const info=new TextEncoder().encode(JSON.stringify(metadata(pending))),bytes=await audio.recording.bytes(),prefix=new Uint8Array(8);
  new DataView(prefix.buffer).setUint32(0,info.length,true);new DataView(prefix.buffer).setUint32(4,bytes.length,true);
  const body=new Blob([prefix,info,new Uint8Array(bytes),audio.original],{type:'application/octet-stream'});
  checkedSession(pending);signal?.throwIfAborted();
  const response=await fetchImpl('/api/source-audio',{method:'POST',credentials:'include',cache:'no-store',signal,
    headers:{'content-type':'application/octet-stream','x-client-session-context':pending.clientContext},body});
  return checkedSourceUploadReceipt(await responseValue(response),pending,false);
}
