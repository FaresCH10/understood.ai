import {type WorkerLocaleCode} from '../server/languages.mjs';
import {regenerationInput} from '../server/regeneration-input.mjs';
export type PendingRegeneration={requestId:string;briefingId:string;body:{revision:number;language:WorkerLocaleCode;kind:'translation'|'audio';confirmed:true}};
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
const key=(scope:string)=>`understood:regeneration:${scope}`;
export function pendingRegenerationContent(value:PendingRegeneration) {
  if(!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).some(name=>!['requestId','briefingId','body'].includes(name))
    || typeof value.briefingId!=='string' || !value.briefingId || value.briefingId.length>100 || !value.body
    || typeof value.body!=='object' || Array.isArray(value.body) || 'requestId' in value.body) throw Error('Invalid pending regeneration request');
  return regenerationInput({...value.body,requestId:value.requestId});
}
export function checkedRegenerationResult(value:unknown,pending:PendingRegeneration) {
  const result=value as {id?:unknown;revision?:unknown}|null;
  if(!result || result.id!==pending.briefingId || result.revision!==pending.body.revision+1) throw Error('Regeneration acknowledgement does not match the pending request. Check its saved receipt.');
  return {id:result.id as string,revision:result.revision as number};
}
export function checkedRegenerationReceipt(value:unknown,pending:PendingRegeneration) {
  const result=value as {found?:unknown;request?:unknown}|null;
  if(!result || typeof result.found!=='boolean') throw Error('Regeneration receipt response cannot be verified.');
  if(result.found===false) {
    if(Object.keys(result).length!==1) throw Error('Regeneration receipt response cannot be verified.');
    return null;
  }
  const accepted=checkedRegenerationResult(value,pending);
  if(!result.request || typeof result.request!=='object' || Array.isArray(result.request)
    || Object.keys(result.request).sort().join(',')!=='kind,language,revision'
    || JSON.stringify(regenerationInput({...result.request,requestId:pending.requestId,confirmed:true}))!==JSON.stringify(pendingRegenerationContent(pending))) throw Error('Saved receipt does not match this pending regeneration request.');
  return accepted;
}
export function readPendingRegeneration(storage:Store,scope:string):PendingRegeneration|null {
  const raw=storage.getItem(key(scope));if(!raw) return null;
  try {
    if(new TextEncoder().encode(raw).length>2000) throw Error();
    const value=JSON.parse(raw);pendingRegenerationContent(value);return value;
  }catch {throw Error('Pending regeneration request cannot be read. Check the instruction history before creating another request.');}
}
export function savePendingRegeneration(storage:Store,scope:string,value:PendingRegeneration) {
  pendingRegenerationContent(value);const old=readPendingRegeneration(storage,scope);
  if(old && JSON.stringify(old)!==JSON.stringify(value)) throw Error('Recover the pending regeneration request first.');
  const raw=JSON.stringify(value);if(new TextEncoder().encode(raw).length>2000) throw Error('Regeneration recovery limit exceeded. No request was sent.');
  storage.setItem(key(scope),raw);if(storage.getItem(key(scope))!==raw) throw Error('This tab cannot retain the regeneration request. No request was sent.');
}
export function clearPendingRegeneration(storage:Store,scope:string,requestId:string) {
  const old=readPendingRegeneration(storage,scope);if(old && old.requestId!==requestId) throw Error('Another regeneration request is pending.');
  storage.removeItem(key(scope));if(storage.getItem(key(scope))) throw Error('Pending regeneration receipt could not be cleared.');
}
