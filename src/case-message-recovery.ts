import {isWorkerLanguage} from '../server/languages.mjs';
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export type MessageSession={clientContext:string;expiresAt:string};
export type PendingMessage={id:string;hash:string;kind?:'followup'|'deadline'|'disagree'};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const digest=/^[a-f0-9]{64}$/;
const key=(session:MessageSession,caseId:string,namespace:'message'|'review')=>`understood:case-${namespace}:${session.clientContext}:${caseId}`;
function valid(session:MessageSession,caseId:string) {
  if(!digest.test(session.clientContext) || !Number.isFinite(Date.parse(session.expiresAt)) || Date.parse(session.expiresAt)<=Date.now()
    || !/^[a-zA-Z0-9_-]{1,100}$/.test(caseId))throw Error('Conversation session unavailable.');
}
export function readPendingMessage(storage:Store,session:MessageSession,caseId:string,namespace:'message'|'review'='message'):PendingMessage|null {
  valid(session,caseId);const raw=storage.getItem(key(session,caseId,namespace));if(raw===null)return null;
  if(raw.length>200)throw Error('Conversation recovery cannot be verified.');
  const value=JSON.parse(raw);
  if(!value || !['hash,id','hash,id,kind'].includes(Object.keys(value).sort().join(',')) || !uuid.test(value.id) || !digest.test(value.hash)
    || (namespace==='message'?('kind' in value && value.kind!=='followup'):!['deadline','disagree'].includes(value.kind)))throw Error('Conversation recovery cannot be verified.');return value;
}
export async function retainMessage(storage:Store,session:MessageSession,caseId:string,text:string,kind:'message'|'followup'|'deadline'|'disagree'='message',namespace:'message'|'review'='message',current:()=>boolean=()=>true) {
  const expected={...session},assertCurrent=()=>{valid(session,caseId);if(!current()||session.clientContext!==expected.clientContext||session.expiresAt!==expected.expiresAt)throw Error('Conversation session unavailable.');};
  assertCurrent();if(!text.trim() || text.length>1000)throw Error('Invalid conversation request');
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text.trim()));
  assertCurrent();const hash=Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');
  const old=readPendingMessage(storage,session,caseId,namespace);
  if(!(namespace==='message'?['message','followup']:['deadline','disagree']).includes(kind) || old && (old.hash!==hash || (old.kind || 'message')!==kind))throw Error('Check the pending receipt, or retry the exact original message.');
  const value:PendingMessage=old || {id:crypto.randomUUID(),hash,...(kind!=='message'?{kind}:{})},raw=JSON.stringify(value);assertCurrent();storage.setItem(key(session,caseId,namespace),raw);
  if(storage.getItem(key(session,caseId,namespace))!==raw)throw Error('Conversation recovery storage unavailable. Nothing was sent.');return value;
}
export function clearPendingMessage(storage:Store,session:MessageSession,caseId:string,id:string,namespace:'message'|'review'='message') {
  if(readPendingMessage(storage,session,caseId,namespace)?.id!==id)throw Error('Conversation receipt changed.');
  storage.removeItem(key(session,caseId,namespace));if(storage.getItem(key(session,caseId,namespace))!==null)throw Error('Conversation recovery could not be cleared.');
}
export function checkedMessageReceipt(value:unknown,caseId:string,id:string) {
  const row=value as {id:string;caseId:string;language:string;createdAt:string};
  if(!row || row.id!==id || row.caseId!==caseId || !isWorkerLanguage(row.language) || typeof row.createdAt!=='string'
    || !Number.isFinite(Date.parse(row.createdAt)))throw Error('Conversation acknowledgement cannot be verified.');return row;
}
