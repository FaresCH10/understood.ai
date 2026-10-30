import {draftInput} from '../server/briefing-input.mjs';

export type PendingDraftCreation={requestId:string;title:string;source:string;generationLanguages?:string[]};
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
const key=(scope:string)=>`understood:draft-creation:${scope}`;
const signature=(value:PendingDraftCreation)=>JSON.stringify(draftInput(value,'create'));
export function readPendingDraftCreation(storage:Store,scope:string):PendingDraftCreation|null {
  let raw;try {raw=storage.getItem(key(scope));}catch {throw Error('Draft recovery storage is unavailable.');}
  if(raw===null)return null;
  try {if(raw.length>30000)throw Error();const value=JSON.parse(raw);signature(value);return value;}
  catch {throw Error('Saved draft request cannot be verified. Check the instruction library before creating another draft.');}
}
export function savePendingDraftCreation(storage:Store,scope:string,value:PendingDraftCreation) {
  const normalized=signature(value),old=readPendingDraftCreation(storage,scope),raw=JSON.stringify(value);
  if(raw.length>30000)throw Error('Draft recovery request exceeds the tab storage limit. No request was sent.');
  if(old && (old.requestId!==value.requestId || signature(old)!==normalized))throw Error('Resolve the saved draft request first.');
  try {storage.setItem(key(scope),raw);if(storage.getItem(key(scope))!==raw)throw Error();}
  catch {throw Error('This tab cannot retain the draft request. No request was sent.');}
}
export function clearPendingDraftCreation(storage:Store,scope:string,value:PendingDraftCreation) {
  const old=readPendingDraftCreation(storage,scope);
  if(!old || old.requestId!==value.requestId || signature(old)!==signature(value))throw Error('Saved draft request changed.');
  storage.removeItem(key(scope));if(storage.getItem(key(scope))!==null)throw Error('Draft recovery could not be cleared.');
}
export async function checkedDraftCreationResult(value:unknown,pending:PendingDraftCreation) {
  const result=value as Record<string,unknown>|null;
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(signature(pending)));
  const hash=Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');
  if(!result || result.id!==pending.requestId || result.state!=='draft' || result.revision!==1 || result.requestHash!==hash)throw Error('Draft acknowledgement does not match the saved request.');
  return pending.requestId;
}
export async function checkedDraftCreationReceipt(value:unknown,pending:PendingDraftCreation) {
  const receipt=value as {accepted?:boolean;requestId?:string;result?:unknown}|null;
  if(!receipt || receipt.requestId!==pending.requestId || typeof receipt.accepted!=='boolean')throw Error('Draft receipt does not match the saved request.');
  if(!receipt.accepted){if(receipt.result!==undefined)throw Error('Draft receipt does not match the saved request.');return null;}
  return checkedDraftCreationResult(receipt.result,pending);
}
