export type PushAdapterMode='disabled'|'synthetic'|'webpush';
export type PushDeviceRegistration={id:string;createdAt:string;updatedAt:string;lastSeenAt:string};
export type PushStatus={adapter:PushAdapterMode;configured:boolean;publicKey:string|null;subscriptions:PushDeviceRegistration[]};
export type PushCapability='supported'|'unsupported';

const idPattern=/^[a-f0-9-]{36}$/,contextPattern=/^[a-f0-9]{64}$/,registrationKey='understood:push-registration';
const timestamp=(value:unknown):value is string=>typeof value==='string' && value.length<=40 && Number.isFinite(Date.parse(value));
function invalid():never{throw Error('Push is not configured correctly.');}

export function checkedPushStatus(value:unknown):PushStatus {
  if(!value || typeof value!=='object' || Array.isArray(value))invalid();
  const status=value as Record<string,unknown>;
  if(!['disabled','synthetic','webpush'].includes(status.adapter as string) || typeof status.configured!=='boolean'
    || !(status.publicKey===null || typeof status.publicKey==='string') || !Array.isArray(status.subscriptions))invalid();
  const subscriptions=status.subscriptions.map(item=>{
    if(!item || typeof item!=='object' || Array.isArray(item))invalid();
    const row=item as Record<string,unknown>;
    if(!idPattern.test(row.id as string) || !timestamp(row.createdAt) || !timestamp(row.updatedAt) || !timestamp(row.lastSeenAt))invalid();
    return {id:row.id as string,createdAt:row.createdAt,updatedAt:row.updatedAt,lastSeenAt:row.lastSeenAt};
  });
  if(subscriptions.length>10 || status.adapter!=='webpush' && status.publicKey!==null
    || status.adapter==='webpush' && status.configured && typeof status.publicKey!=='string')invalid();
  return {adapter:status.adapter as PushAdapterMode,configured:status.configured,publicKey:status.publicKey as string|null,subscriptions};
}
export function checkedPushSubscriptionId(value:unknown):string {
  if(!value || typeof value!=='object' || Array.isArray(value) || !idPattern.test((value as Record<string,unknown>).id as string))invalid();
  return (value as {id:string}).id;
}
export function pushCapability(environment:{serviceWorker:boolean;pushManager:boolean;notification:boolean;secure:boolean}):PushCapability {
  return environment.serviceWorker && environment.pushManager && environment.notification && environment.secure?'supported':'unsupported';
}
export function browserPushCapability():PushCapability {
  if(typeof window==='undefined' || typeof navigator==='undefined')return 'unsupported';
  return pushCapability({serviceWorker:'serviceWorker' in navigator,pushManager:'PushManager' in window,notification:'Notification' in window,secure:window.isSecureContext});
}
export function pushApplicationServerKey(value:string):Uint8Array<ArrayBuffer> {
  if(typeof value!=='string' || value.length<4 || value.length>200 || !/^[A-Za-z0-9_-]+={0,2}$/.test(value))invalid();
  const raw=value.replace(/=+$/,''),padded=raw.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-raw.length%4)%4);
  let binary:string;
  try {binary=atob(padded);}catch{invalid();}
  const bytes=new Uint8Array(binary.length);
  for(let index=0;index<binary.length;index++)bytes[index]=binary.charCodeAt(index);
  if(bytes.length!==65 || bytes[0]!==4)invalid();
  return bytes;
}
function sameKey(existing:PushSubscriptionOptions['applicationServerKey'],key:Uint8Array):boolean {
  if(!existing)return true;
  const bytes=new Uint8Array(existing as ArrayBuffer);
  return bytes.length===key.length && bytes.every((value,index)=>value===key[index]);
}
function registrationContext(context:string) {
  if(!contextPattern.test(context))throw Error('Push registration cannot be verified for this session.');
  return context;
}
export function readRememberedPushId(storage:Pick<Storage,'getItem'>,context:string):string|null {
  try {
    if(!contextPattern.test(context))return null;
    const raw=storage.getItem(registrationKey);if(!raw || raw.length>200)return null;
    const value=JSON.parse(raw);
    return value && Object.keys(value).sort().join(',')==='context,id' && value.context===context && idPattern.test(value.id)?value.id:null;
  }catch{return null;}
}
function rememberPushId(storage:Pick<Storage,'setItem'>,context:string,id:string) {
  try {storage.setItem(registrationKey,JSON.stringify({context:registrationContext(context),id}));}catch{}
}
function forgetPushId(storage:Pick<Storage,'getItem'|'removeItem'>,context:string) {
  try {if(readRememberedPushId(storage,context))storage.removeItem(registrationKey);}catch{}
}
export async function subscribeBrowserPush(publicKey:string,context:string,request:(body:unknown)=>Promise<unknown>):Promise<string> {
  if(browserPushCapability()!=='supported')throw Error('Push notifications are not supported by this browser or connection. In-app notifications remain available.');
  registrationContext(context);
  const permission=await Notification.requestPermission();
  if(permission!=='granted')throw Object.assign(Error(permission==='denied'
    ?'Push permission is blocked. You can re-enable it in this browser’s notification settings. In-app notifications remain available.'
    :'Push permission was not granted. In-app notifications remain available.'),{code:'permission'});
  const registration=await navigator.serviceWorker.getRegistration('/');
  if(!registration?.active)throw Error('Push is unavailable until the installed app has finished loading. In-app notifications remain available.');
  const key=pushApplicationServerKey(publicKey);
  let subscription=await registration.pushManager.getSubscription();
  if(subscription && !sameKey(subscription.options?.applicationServerKey,key)) {
    await subscription.unsubscribe();subscription=null;
  }
  subscription ??= await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
  const saved=subscription.toJSON();
  if(typeof saved.endpoint!=='string' || !saved.keys?.p256dh || !saved.keys.auth)throw Error('This browser could not create a usable push registration.');
  const id=checkedPushSubscriptionId(await request({endpoint:saved.endpoint,expirationTime:saved.expirationTime ?? null,keys:{p256dh:saved.keys.p256dh,auth:saved.keys.auth}}));
  rememberPushId(sessionStorage,context,id);
  return id;
}
export async function removeBrowserPush(id:string,context:string,revoke:(id:string)=>Promise<unknown>):Promise<void> {
  if(!idPattern.test(id))throw Error('Invalid push registration.');
  await revoke(id);
  if(readRememberedPushId(sessionStorage,context)!==id)return;
  forgetPushId(sessionStorage,context);
  try {
    const registration=await navigator.serviceWorker.getRegistration('/');
    const subscription=await registration?.pushManager.getSubscription();
    if(subscription)await subscription.unsubscribe();
  }catch{}
}
