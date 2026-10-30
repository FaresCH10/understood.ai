import {type WorkerLocaleCode} from '../server/languages.mjs';
import {reviewInput} from '../server/briefing-input.mjs';
export type TranslationEdits=Partial<Record<Exclude<WorkerLocaleCode,'en'>,{title:string;text:string;question:string}>>;
export type PendingReview={requestId:string;briefingId:string;body:{revision:number;question:string;facts:string[];askedFacts:string[];translations?:TranslationEdits;confirmed:true}};
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
const key=(scope:string)=>`understood:review:${scope}`;
export function pendingReviewContent(value:PendingReview) {
  if(typeof value.briefingId!=='string' || !value.briefingId || value.briefingId.length>100 || !value.body || 'requestId' in value.body) throw new Error('Invalid pending review request');
  return reviewInput({...value.body,requestId:value.requestId});
}
export function checkedReviewResult(value:unknown,pending:PendingReview):{id:string;revision:number} {
  const result=value as {id?:unknown;revision?:unknown}|null;
  if(!result || result.id!==pending.briefingId || result.revision!==pending.body.revision+1) throw new Error('Review acknowledgement does not match the pending request. Check its saved receipt.');
  return {id:result.id as string,revision:result.revision as number};
}
export function readPendingReview(storage:Store,scope:string):PendingReview|null {
  const raw=storage.getItem(key(scope));if(!raw) return null;
  try {
    if(new TextEncoder().encode(raw).length>100000) throw new Error();
    const value=JSON.parse(raw) as PendingReview;
    if(!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).some(name=>!['requestId','briefingId','body'].includes(name))
      || typeof value.briefingId!=='string' || !value.briefingId || value.briefingId.length>100 || !value.body || typeof value.body!=='object' || Array.isArray(value.body) || 'requestId' in value.body) throw new Error();
    pendingReviewContent(value);return value;
  } catch {throw new Error('Pending review request cannot be read. Check the instruction history before creating another review.');}
}
export function savePendingReview(storage:Store,scope:string,value:PendingReview) {
  pendingReviewContent(value);
  const old=readPendingReview(storage,scope);
  if(old && JSON.stringify(old)!==JSON.stringify(value)) throw new Error('Recover the pending review request first.');
  const raw=JSON.stringify(value);if(new TextEncoder().encode(raw).length>100000) throw new Error('Review request exceeds the local recovery limit. No request was sent.');
  storage.setItem(key(scope),raw);if(storage.getItem(key(scope))!==raw) throw new Error('This tab cannot retain the review request. No request was sent.');
}
export function clearPendingReview(storage:Store,scope:string,id:string) {
  const old=readPendingReview(storage,scope);if(old && old.requestId!==id) throw new Error('Another review request is pending.');
  storage.removeItem(key(scope));if(storage.getItem(key(scope))) throw new Error('Pending review receipt could not be cleared.');
}
