import {isWorkerLanguage,type WorkerLocaleCode} from '../server/languages.mjs';
import {sameWorkerSession,validWorkerSession,type PageSession} from './session-state.ts';
import {workerRecordingNotice} from './notice-recovery.ts';
import {workerResponseState} from './worker-state.ts';
import type {RecordingScope} from './worker-audio-retry.ts';
import type {AudioDraftStore} from './worker-audio-draft.ts';
import {privateDeviceAllowed} from './worker-device-policy.ts';

export const offlineLimits={briefings:5,bytes:10*1024*1024,hours:24,audioBytes:2880044} as const;
type Language=WorkerLocaleCode;
export type OfflineNotice={revision:number;configured:boolean;language:Language;notice:string|null};
export type OfflineBriefing={responseMode?:'acknowledge';questionType?:'multiple-choice';choices?:{id:string;text:string}[];scope:RecordingScope;title:string;text:string;question:string|null;savedAt:string;expiresAt:string;answerUntil:string|null;canRecord:boolean;notice:OfflineNotice;audio:{body:string|null;question:string|null}};
export type OfflineBundle={session:PageSession;briefings:OfflineBriefing[]};
export class OfflineError extends Error {
  readonly code:'invalid'|'storage'|'session'|'limit'|'unavailable';
  constructor(code:OfflineError['code']){super(code);this.code=code;}
}
const exact=(value:unknown,keys:string)=>!!value && typeof value==='object' && !Array.isArray(value) && Object.keys(value).sort().join(',')===keys;
const iso=(value:unknown):value is string=>typeof value==='string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString()===value;
const text=(value:unknown,max:number):value is string=>typeof value==='string' && !!value.trim() && value.length<=max;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const channelName='understood:offline-cache-change';
const binding='understood:offline-context';
export function subscribeOfflineChanges(changed:()=>void){
  try {const channel=new BroadcastChannel(channelName);channel.onmessage=event=>{if(event.data==='changed')changed();};return()=>channel.close();}catch {return()=>{};}
}
function notify(){try{const channel=new BroadcastChannel(channelName);channel.postMessage('changed');channel.close();}catch {/* Reads still verify the saved revision and expiry. */}}
function transaction<T>(mode:IDBTransactionMode,work:(store:IDBObjectStore,set:(value:T)=>void)=>void):Promise<T>{
  return new Promise((resolve,reject)=>{
    let done=false,db:IDBDatabase|undefined,tx:IDBTransaction|undefined,value:T;
    const fail=()=>{if(done)return;done=true;clearTimeout(timer);try{tx?.abort();}catch{}db?.close();reject(new OfflineError('storage'));};
    const timer=setTimeout(fail,5000);let request:IDBOpenDBRequest;
    try{request=indexedDB.open('understood-worker-offline-v1',1);}catch{fail();return;}
    request.onerror=fail;request.onblocked=fail;request.onupgradeneeded=()=>request.result.createObjectStore('private');
    request.onsuccess=()=>{
      db=request.result;if(done){db.close();return;}db.onversionchange=()=>db?.close();
      try{tx=db.transaction('private',mode);tx.onabort=fail;tx.onerror=fail;tx.oncomplete=()=>{if(done)return;done=true;clearTimeout(timer);db?.close();resolve(value);};work(tx.objectStore('private'),next=>{value=next;});}catch{fail();}
    };
  });
}
export const browserOfflineStore:AudioDraftStore={
  read:()=>transaction('readonly',(store,set)=>{const request=store.get('briefings');request.onsuccess=()=>set(request.result ?? null);}),
  replace:(revision,value,allowed)=>transaction<boolean>('readwrite',(store,set)=>{
    const request=store.get('briefings');request.onsuccess=()=>{try{if(!allowed() || value && !privateDeviceAllowed(value.context) || (request.result?.revision ?? null)!==revision){set(false);return;}if(value)store.put(value,'briefings');else store.delete('briefings');set(true);}catch{store.transaction.abort();}};
  }).then(changed=>{if(changed)notify();return changed;}),
  clear:()=>transaction<void>('readwrite',(store,set)=>{store.clear();set();}).then(notify),
};
export function offlineAudioBytes(value:string){
  if(typeof value!=='string' || value.length>Math.ceil(offlineLimits.audioBytes/3)*4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value))throw new OfflineError('invalid');
  const bytes=Uint8Array.from(atob(value),char=>char.charCodeAt(0));
  if(bytes.length<46 || bytes.length>offlineLimits.audioBytes || bytes.length%2 || base64(bytes)!==value)throw new OfflineError('invalid');
  const view=new DataView(bytes.buffer),decoder=new TextDecoder();
  if(decoder.decode(bytes.slice(0,4))!=='RIFF' || decoder.decode(bytes.slice(8,16))!=='WAVEfmt ' || decoder.decode(bytes.slice(36,40))!=='data'
    || view.getUint32(4,true)!==bytes.length-8 || view.getUint32(16,true)!==16 || view.getUint16(20,true)!==1 || view.getUint16(22,true)!==1
    || view.getUint32(24,true)!==16000 || view.getUint32(28,true)!==32000 || view.getUint16(32,true)!==2 || view.getUint16(34,true)!==16 || view.getUint32(40,true)!==bytes.length-44)throw new OfflineError('invalid');
  return bytes;
}
function base64(bytes:Uint8Array){let result='';for(let i=0;i<bytes.length;i+=8192)result+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(result);}
function checkedBundle(value:unknown,now:number):OfflineBundle {
  if(!exact(value,'briefings,session'))throw new OfflineError('invalid');
  const bundle=value as OfflineBundle,session=bundle.session;
  if(!exact(session,'authenticated,clientContext,expiresAt,language,mode,role,workerId') || !validWorkerSession(session,0) || !text(session.workerId,100)
    || !Array.isArray(bundle.briefings) || !bundle.briefings.length || bundle.briefings.length>offlineLimits.briefings)throw new OfflineError('invalid');
  const ids=new Set<string>();
  for(const item of bundle.briefings){
    if(!exact(item,item.responseMode==='acknowledge'?'answerUntil,audio,canRecord,expiresAt,notice,question,responseMode,savedAt,scope,text,title':item.questionType==='multiple-choice'?'answerUntil,audio,canRecord,choices,expiresAt,notice,question,questionType,savedAt,scope,text,title':'answerUntil,audio,canRecord,expiresAt,notice,question,savedAt,scope,text,title') || !exact(item.scope,'assignmentId,language,publicationId,version')
      || !text(item.scope.assignmentId,100) || !text(item.scope.publicationId,100) || !Number.isSafeInteger(item.scope.version) || item.scope.version<1
      || !isWorkerLanguage(item.scope.language) || !text(item.title,300) || !text(item.text,20000) || (item.responseMode==='acknowledge' ? item.question!==null || item.canRecord || item.audio?.question!==null : !text(item.question,2000))
      || !iso(item.savedAt) || !iso(item.expiresAt) || Date.parse(item.savedAt)>now || Date.parse(item.expiresAt)<=Date.parse(item.savedAt)
      || Date.parse(item.expiresAt)>Math.min(Date.parse(session.expiresAt!),Date.parse(item.savedAt)+86400000)
      || item.answerUntil!==null && !iso(item.answerUntil) || typeof item.canRecord!=='boolean' || !exact(item.audio,'body,question')
      || !exact(item.notice,'configured,language,notice,revision') || ids.has(item.scope.assignmentId))throw new OfflineError('invalid');
    if(item.questionType==='multiple-choice' && (!Array.isArray(item.choices) || item.choices.length!==4 || item.canRecord || item.choices.some(choice=>!exact(choice,'id,text') || !/^[a-f0-9]{32}$/.test(choice.id) || !text(choice.text,5000)) || new Set(item.choices.map(choice=>choice.id)).size!==4))throw new OfflineError('invalid');
    try{workerRecordingNotice(item.notice,item.scope.language);}catch{throw new OfflineError('invalid');}ids.add(item.scope.assignmentId);
    for(const audio of [item.audio.body,item.audio.question])if(audio!==null)offlineAudioBytes(audio);
  }
  return bundle;
}
const aad=(revision:string,context:string)=>new TextEncoder().encode(JSON.stringify(['understood-offline-v1',revision,context]));
async function seal(bundle:OfflineBundle){
  const bytes=new TextEncoder().encode(JSON.stringify(bundle));if(bytes.length+16>offlineLimits.bytes)throw new OfflineError('limit');
  const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']),iv=crypto.getRandomValues(new Uint8Array(12)),revision=crypto.randomUUID(),context=bundle.session.clientContext!;
  return {key,iv,revision,context,ciphertext:await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(revision,context)},key,bytes)};
}
async function open(value:NonNullable<Awaited<ReturnType<AudioDraftStore['read']>>>,now:number){
  try{
    if(!exact(value,'ciphertext,context,iv,key,revision') || !uuid.test(value.revision) || !/^[a-f0-9]{64}$/.test(value.context)
      || !(value.key instanceof CryptoKey) || value.key.extractable || value.key.type!=='secret' || value.key.algorithm.name!=='AES-GCM' || (value.key.algorithm as AesKeyAlgorithm).length!==256
      || value.key.usages.slice().sort().join(',')!=='decrypt,encrypt' || !(value.iv instanceof Uint8Array) || value.iv.length!==12 || !(value.ciphertext instanceof ArrayBuffer)
      || value.ciphertext.byteLength<16 || value.ciphertext.byteLength>offlineLimits.bytes)throw Error();
    const raw=await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(value.iv),additionalData:aad(value.revision,value.context)},value.key,value.ciphertext);
    const bundle=checkedBundle(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)),now);
    if(bundle.session.clientContext!==value.context)throw Error();return bundle;
  }catch{throw new OfflineError('invalid');}
}
export async function readOfflineBundle(store:AudioDraftStore=browserOfflineStore,current:()=>boolean=()=>true,now=Date.now):Promise<OfflineBundle|null>{
  const guard=()=>{if(!current())throw new OfflineError('session');return true;};
  try{
    guard();const envelope=await store.read();guard();if(!envelope)return null;
    const bundle=await open(envelope,now());guard();
    const remaining=validWorkerSession(bundle.session,now())?bundle.briefings.filter(item=>Date.parse(item.expiresAt)>now()):[];
    if(remaining.length!==bundle.briefings.length){
      const next=remaining.length?await seal({...bundle,briefings:remaining}):null;guard();
      if(!await store.replace(envelope.revision,next,guard))throw new OfflineError('storage');guard();
      if(!remaining.length)return null;
    }
    return {...bundle,briefings:remaining};
  }catch(error){if(error instanceof OfflineError)throw error;throw new OfflineError('storage');}
}
export async function saveOfflineBriefing(session:PageSession,item:OfflineBriefing,consent:boolean,current:()=>boolean=()=>true,store:AudioDraftStore=browserOfflineStore,now=Date.now){
  const expected={authenticated:true,role:'worker',clientContext:session.clientContext!,expiresAt:session.expiresAt!,workerId:session.workerId!,language:session.language!,mode:session.mode!};
  const captured=structuredClone(item),guard=()=>{if(!current() || !sameWorkerSession(expected,session,now()) || expected.expiresAt!==session.expiresAt)throw new OfflineError('session');return true;};
  try{
    guard();if(consent!==true)throw new OfflineError('invalid');checkedBundle({session:expected,briefings:[captured]},now());
    if(Date.parse(captured.expiresAt)<=now())throw new OfflineError('session');
    const envelope=await store.read();guard();let briefings:OfflineBriefing[]=[];
    if(envelope){const previous=await open(envelope,now());guard();if(!sameWorkerSession(expected,previous.session,now()) || previous.session.expiresAt!==expected.expiresAt)throw new OfflineError('session');briefings=previous.briefings.filter(value=>value.scope.assignmentId!==captured.scope.assignmentId && Date.parse(value.expiresAt)>now());}
    briefings.push(captured);if(briefings.length>offlineLimits.briefings)throw new OfflineError('limit');
    const value=await seal({session:expected,briefings});guard();if(!await store.replace(envelope?.revision ?? null,value,guard))throw new OfflineError('storage');guard();
    const saved=await store.read();guard();if(saved?.revision!==value.revision)throw new OfflineError('storage');await open(saved,now());guard();return captured;
  }catch(error){if(error instanceof OfflineError)throw error;throw new OfflineError('storage');}
}
export async function clearOfflineBriefings(context?:string,store:AudioDraftStore=browserOfflineStore){
  try{const value=await store.read();if(!value || context && value.context!==context)return;if(!await store.replace(value.revision,null,()=>true))throw Error();const after=await store.read();if(after && (!context || after.context===context))throw Error();}catch{throw new OfflineError('storage');}
}
// The tab lease is not authentication. It prevents another/new tab from reopening a saved identity.
export function bindOfflineSession(session:PageSession,storage:Pick<Storage,'setItem'|'getItem'|'removeItem'>=sessionStorage,now=Date.now){
  if(validWorkerSession(session,now())){storage.setItem(binding,session.clientContext!);if(storage.getItem(binding)!==session.clientContext)throw new OfflineError('storage');}
  else{storage.removeItem(binding);if(storage.getItem(binding)!==null)throw new OfflineError('storage');}
}
export async function readBoundOfflineBundle(store:AudioDraftStore=browserOfflineStore,storage:Pick<Storage,'getItem'>=sessionStorage,current:()=>boolean=()=>true,now=Date.now){
  const context=storage.getItem(binding);if(!context)return null;
  if(store===browserOfflineStore && !privateDeviceAllowed(context))return null;
  const guard=()=>current() && storage.getItem(binding)===context && (store!==browserOfflineStore || privateDeviceAllowed(context));
  const bundle=await readOfflineBundle(store,guard,now);if(bundle?.session.clientContext!==context)return null;return bundle;
}
export async function reconcileOfflineSession(session:PageSession){
  bindOfflineSession(session);const envelope=await browserOfflineStore.read();
  if(envelope && (!validWorkerSession(session) || envelope.context!==session.clientContext)){await clearOfflineBriefings();return;}
  if(envelope){const bundle=await readOfflineBundle();if(bundle && (!sameWorkerSession(session,bundle.session) || bundle.session.expiresAt!==session.expiresAt))await clearOfflineBriefings();}
}
async function bounded(response:Response,limit:number){
  const reader=response.body?.getReader();if(!reader)throw new OfflineError('invalid');let length=0;const chunks:Uint8Array[]=[];
  try{while(true){const next=await reader.read();if(next.done)break;length+=next.value.length;if(length>limit)throw new OfflineError('limit');chunks.push(next.value);}}catch(error){await reader.cancel().catch(()=>{});throw error;}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
export async function fetchOfflineBriefing(send:typeof fetch,session:PageSession,scope:RecordingScope,current:()=>boolean=()=>true,now=Date.now):Promise<OfflineBriefing>{
  const expected={...session},guard=()=>{if(!current() || !sameWorkerSession(expected,session,now()) || expected.expiresAt!==session.expiresAt)throw new OfflineError('session');};
  async function get(path:string,limit=100000){guard();const response=await send(path,{credentials:'include',cache:'no-store',signal:AbortSignal.timeout(15000),headers:{'x-client-session-context':expected.clientContext!}});if(!response.ok)throw new OfflineError([401,403,409,410].includes(response.status)?'session':'unavailable');const bytes=await bounded(response,limit);guard();return {response,bytes};}
  async function json(path:string){const {bytes}=await get(path);try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new OfflineError('invalid');}}
  async function identity(){const value=await json('/api/session');if(!sameWorkerSession(expected,value,now()) || value.expiresAt!==expected.expiresAt)throw new OfflineError('session');}
  const path=`/api/worker/briefings/${encodeURIComponent(scope.assignmentId)}`;
  function detail(value:any){if(!value || value.id!==scope.assignmentId || value.publicationId!==scope.publicationId || value.version!==scope.version || value.language!==scope.language || value.state!=='published'
    || value.dueAt!=null && !iso(value.dueAt) || value.repeatRequest && (!iso(value.repeatRequest.dueAt) || !text(value.repeatRequest.id,100)))throw new OfflineError('session');return value;}
  try{
    guard();await identity();const value=detail(await json(path)),audio:OfflineBriefing['audio']={body:null,question:null};
    for(const part of ['body','question'] as const){
      if(!value.speechUrls?.[part])continue;if(value.speechUrls[part]!==`${path}/speech/${part}`)throw new OfflineError('invalid');
      const {response,bytes}=await get(value.speechUrls[part],offlineLimits.audioBytes);if(response.headers.get('content-type')?.split(';')[0]!=='audio/wav')throw new OfflineError('invalid');
      audio[part]=base64(bytes);offlineAudioBytes(audio[part]);
    }
    const notice=value.responseMode==='acknowledge' || value.content?.questionType==='multiple-choice'?{revision:0,configured:false,language:scope.language,notice:null}:await json(`/api/privacy/recording-notice?${new URLSearchParams({language:scope.language})}`);workerRecordingNotice(notice,scope.language);
    const last=detail(await json(path));if(last.responseMode!==value.responseMode || JSON.stringify(last.content)!==JSON.stringify(value.content) || (last.repeatRequest?.id ?? null)!==(value.repeatRequest?.id ?? null))throw new OfflineError('session');await identity();guard();
    const savedAt=new Date(now()).toISOString(),expiresAt=new Date(Math.min(Date.parse(expected.expiresAt!),now()+86400000)).toISOString();
    const item:OfflineBriefing={scope:{...scope},title:last.content?.title,text:last.content?.text,question:last.responseMode==='acknowledge'?null:last.content?.question,savedAt,expiresAt,answerUntil:last.repeatRequest?.dueAt ?? last.dueAt ?? null,canRecord:last.responseMode!=='acknowledge' && last.content?.questionType!=='multiple-choice' && workerResponseState(last,now()).canRespond,
      ...(last.responseMode==='acknowledge'?{responseMode:'acknowledge' as const}:{}),
      ...(last.content?.questionType==='multiple-choice'?{questionType:'multiple-choice',choices:last.content.choices}:{}),
      notice:{revision:notice.revision,configured:notice.configured,language:scope.language,notice:notice.notice},audio};
    checkedBundle({session:{authenticated:true,role:'worker',workerId:expected.workerId,language:expected.language,mode:expected.mode,clientContext:expected.clientContext,expiresAt:expected.expiresAt},briefings:[item]},now());return item;
  }catch(error){if(error instanceof OfflineError)throw error;throw new OfflineError('unavailable');}
}
export class BootstrapSessionError extends Error{readonly offline:boolean;readonly status:number|null;constructor(offline:boolean,status:number|null=null){super('Session unavailable');this.offline=offline;this.status=status;}}
export async function fetchBootstrapSession(send:typeof fetch,signal:AbortSignal){
  let response:Response;try{response=await send('/api/session',{credentials:'include',cache:'no-store',signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])});}catch(error){throw new BootstrapSessionError(error instanceof TypeError || error instanceof DOMException && error.name==='TimeoutError');}
  if(!response.ok)throw new BootstrapSessionError(response.status>=500 && response.status<=599,response.status);
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await bounded(response,100000)));}catch{throw new BootstrapSessionError(false);}
}
