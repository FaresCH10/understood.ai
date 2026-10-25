import {invitationReference,invitationIssueInput,invitationChangeInput,invitationEmailKey,invitationTokenInput} from '../server/invitation-input.mjs';
type Storage=Pick<globalThis.Storage,'getItem'|'setItem'|'removeItem'>;
export type InvitationAction='issue'|'resend'|'cancel';
export type PendingInvitation={requestId:string;id:string;action:InvitationAction;body:{name?:string;email?:string;role?:string;revision?:number;confirmed:true}};
export type InvitationPreview={organization:string;site:string;name:string;role:string;emailHint:string;expiresAt:string};
export type PendingAcceptance={requestId:string;kind:'signup'|'existing';preview:InvitationPreview};
export type InvitationRow={id:string;name:string;role:string;emailHint:string;state:string;revision:number;createdAt:string;expiresAt:string;delivery:string|null};
export type InvitationPage={items:InvitationRow[];total:number;page:number;pageSize:number;canWrite:boolean};
export {invitationLinkToken} from './invitation-link.ts';
const staffKey=(scope:string)=>`understood:invitations:${scope}`;
const acceptKey=(hash:string)=>{if(!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invitation recovery key is invalid.');return `understood:invitation-accept:${hash}`;};
export async function invitationDigest(value:string) {return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(byte=>byte.toString(16).padStart(2,'0')).join('');}
function strictObject(value:unknown,fields:string[]):value is Record<string,unknown> {return !!value && typeof value==='object' && !Array.isArray(value) && !Object.keys(value).some(key=>!fields.includes(key));}
function pendingInput(value:PendingInvitation):{name?:string;email?:string;role?:string;revision?:number} {
  if(!strictObject(value,['requestId','id','action','body']) || !strictObject(value.body,['name','email','role','revision','confirmed']) || !['issue','resend','cancel'].includes(value.action)) throw new Error('Pending invitation is invalid.');
  invitationReference(value.id);invitationReference(value.requestId);
  if(value.action==='issue' && value.id!==value.requestId) throw new Error('Pending invitation is invalid.');
  return value.action==='issue' ? invitationIssueInput({...value.body,requestId:value.requestId}) : invitationChangeInput({...value.body,requestId:value.requestId});
}
export function invitationSignature(value:PendingInvitation) {return JSON.stringify([value.id,value.action,pendingInput(value)]);}
function read<T>(storage:Storage,key:string,check:(value:T)=>unknown):T|null {
  let raw;try {raw=storage.getItem(key);}catch {throw new Error('Invitation recovery storage is unavailable.');}if(raw===null) return null;
  try {if(raw.length>4000) throw new Error();const value=JSON.parse(raw) as T;check(value);return value;}catch {throw new Error('Pending invitation cannot be verified.');}
}
function save<T>(storage:Storage,key:string,value:T,check:(value:T)=>unknown) {
  check(value);const old=read(storage,key,check),raw=JSON.stringify(value);
  if(old && JSON.stringify(check(old))!==JSON.stringify(check(value))) throw new Error('Resolve the pending invitation first.');
  try {storage.setItem(key,raw);if(storage.getItem(key)!==raw) throw new Error();}catch {throw new Error('Invitation recovery storage is unavailable. No request was sent.');}
}
function clear(storage:Storage,key:string,requestId:string) {
  const old=read<{requestId:string}>(storage,key,row=>invitationReference(row.requestId));if(old?.requestId!==requestId) throw new Error('Pending invitation changed.');
  try {storage.removeItem(key);if(storage.getItem(key)!==null) throw new Error();}catch {throw new Error('Invitation recovery storage could not be cleared.');}
}
const staffCheck=(value:PendingInvitation)=>[value.requestId,invitationSignature(value)];
export const readPendingInvitation=(storage:Storage,scope:string)=>read<PendingInvitation>(storage,staffKey(scope),staffCheck);
export const savePendingInvitation=(storage:Storage,scope:string,value:PendingInvitation)=>save(storage,staffKey(scope),value,staffCheck);
export function clearPendingInvitation(storage:Storage,scope:string,id:string,expected?:PendingInvitation) {
  if(expected){const old=readPendingInvitation(storage,scope);if(!old || JSON.stringify(staffCheck(old))!==JSON.stringify(staffCheck(expected)))throw Error('Pending invitation changed.');}
  clear(storage,staffKey(scope),id);
}
export function checkedInvitationResult(value:unknown,pending:PendingInvitation) {
  const row=value as {id:string;revision:number;state:string;delivery?:string;duplicate:boolean};pendingInput(pending);
  const revision=pending.action==='issue' ? 1 : (pending.body.revision as number)+(pending.action==='resend' ? 1 : 0);
  if(!row || row.id!==pending.id || row.revision!==revision || row.state!==(pending.action==='cancel' ? 'cancelled' : 'pending') || typeof row.duplicate!=='boolean'
    || (pending.action!=='cancel' && row.delivery!=='queued')) throw new Error('Invitation acknowledgement cannot be verified.');return row;
}
export async function checkedInvitationReceipt(value:unknown,pending:PendingInvitation) {
  const row=value as {accepted:boolean;id:string;action:string;request:unknown;result:unknown};
  if(strictObject(row,['accepted']) && row.accepted===false) return false;
  if(!strictObject(row,['accepted','id','action','request','result']) || row.accepted!==true || row.id!==pending.id || row.action!==pending.action) throw new Error('Invitation receipt does not match the saved request.');
  const normalized=pendingInput(pending),expected:Record<string,unknown>=pending.action==='issue' ? {name:normalized.name,role:normalized.role,emailHash:await invitationDigest(invitationEmailKey(normalized.email!))} : normalized;
  if(!strictObject(row.request,Object.keys(expected)) || Object.keys(expected).some(key=>(row.request as Record<string,unknown>)[key]!==expected[key])) throw new Error('Invitation receipt does not match the saved request.');
  return checkedInvitationResult(row.result,pending);
}
export function checkedInvitationPreview(value:unknown):InvitationPreview {
  const row=value as InvitationPreview;
  if(!strictObject(row,['organization','site','name','role','emailHint','expiresAt']) || [row.organization,row.site,row.name,row.emailHint,row.expiresAt].some(field=>typeof field!=='string' || field.length<1 || field.length>300)
    || !['owner','administrator','supervisor','auditor'].includes(row.role) || !Number.isFinite(Date.parse(row.expiresAt))) throw new Error('Invitation details cannot be verified.');return row;
}
export function checkedInvitationPage(value:unknown,page:number,pageSize=5):InvitationPage {
  const row=value as InvitationPage;
  if(!Number.isInteger(pageSize) || pageSize<1 || pageSize>50) throw new Error('Invitation list cannot be verified.');
  if(!strictObject(row,['items','total','page','pageSize','canWrite']) || !Array.isArray(row.items) || row.items.length>pageSize || !Number.isSafeInteger(row.total) || row.total<row.items.length || row.page!==page || row.pageSize!==pageSize || typeof row.canWrite!=='boolean') throw new Error('Invitation list cannot be verified.');
  const ids=new Set<string>();
  for(const item of row.items) {
    if(!strictObject(item,['id','name','role','emailHint','state','revision','createdAt','expiresAt','delivery']) || [item.name,item.emailHint].some(text=>typeof text!=='string' || !text.length || text.length>300) || !['owner','administrator','supervisor','auditor'].includes(item.role) || !['pending','accepted','cancelled','expired'].includes(item.state) || !Number.isSafeInteger(item.revision) || item.revision<1 || [item.createdAt,item.expiresAt].some(date=>typeof date!=='string' || !Number.isFinite(Date.parse(date))) || (item.delivery!==null && !['queued','processing','sent','ignored','failed','expired'].includes(item.delivery))) throw new Error('Invitation list cannot be verified.');
    invitationReference(item.id);if(ids.has(item.id)) throw new Error('Invitation list cannot be verified.');ids.add(item.id);
  }
  return row;
}
function acceptanceCheck(value:PendingAcceptance) {
  if(!strictObject(value,['requestId','kind','preview']) || !['signup','existing'].includes(value.kind)) throw new Error('Pending acceptance is invalid.');
  invitationReference(value.requestId);checkedInvitationPreview(value.preview);return value;
}
export async function acceptanceHash(token:string) {invitationTokenInput({token});return invitationDigest(token);}
export const readPendingAcceptance=(storage:Storage,hash:string)=>read<PendingAcceptance>(storage,acceptKey(hash),acceptanceCheck);
export const savePendingAcceptance=(storage:Storage,hash:string,value:PendingAcceptance)=>save(storage,acceptKey(hash),value,acceptanceCheck);
export const clearPendingAcceptance=(storage:Storage,hash:string,id:string)=>clear(storage,acceptKey(hash),id);
export function checkedAcceptanceResult(value:unknown,kind:'signup'|'existing') {
  const row=value as {completed:boolean;staffId:string;signInRequired:boolean;duplicate:boolean};
  if(!row || row.completed!==true || typeof row.duplicate!=='boolean' || row.signInRequired!==(kind==='signup')) throw new Error('Invitation acceptance cannot be verified.');
  invitationReference(row.staffId);return row;
}
