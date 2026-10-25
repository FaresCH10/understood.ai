import {bundleHash} from './ai/prepared-bundle.mjs';
export {schedulePublicationInput as scheduleInput} from './briefing-input.mjs';

export function schedulePage(input={}) {
  if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).some(key=>key!=='page')) throw Error('Invalid schedule page');
  const page=Number(input.page ?? 1);if(!Number.isSafeInteger(page) || page<1 || page>5000) throw Error('Invalid schedule page');return page;
}
export function scheduleCancel(input) {
  if(!input || input.confirmed!==true || Object.keys(input).length!==1) throw Error('Confirm schedule cancellation');
}
export const scheduleHash=bundleHash;
export function scheduledContentHash(value,modes={}) {
  const responseMode=modes?.responseMode ?? 'question',deliveryMode=modes?.deliveryMode ?? 'both';
  return scheduleHash({...value,responseMode,deliveryMode});
}
export function scheduleReceipt(row) {
  const request=typeof row.request_json==='string'?JSON.parse(row.request_json):row.request_json;
  const date=value=>value instanceof Date?value.toISOString():value;
  return {id:row.id,revision:request.revision,version:request.nextVersion,recipientCount:request.workerIds.length,
    publishAt:request.publishAt,dueAt:request.dueAt,reminderMinutes:request.reminderMinutes || 0,state:row.state,publicationId:row.publication_id,
    error:row.error,createdAt:date(row.created_at),finishedAt:date(row.finished_at),attempts:row.attempts,retryAt:date(row.retry_at)};
}
// Never persist raw database/provider errors in a customer-visible schedule.
export function scheduleFailure(error) {
  const message=error?.message;
  if(['Forbidden','Scheduled authority changed','Sign in required'].includes(message))return 'Publication authority changed';
  if(['Draft revision changed','Draft version changed','Scheduled content changed','Glossary dependency changed','Briefing is not technically ready','Briefing is archived','Briefing unavailable'].includes(message))return 'Scheduled draft changed or is unavailable';
  if(['Recipient unavailable','Recipient language is unavailable','Recipient language not selected','Scheduled recipient language changed'].includes(message))return 'Scheduled recipients changed or are unavailable';
  if(message==='Deadline must be in the future')return 'Response deadline passed before publication';
  return null;
}
export function scheduleHttpError(error) {
  const message=error?.message;
  if(['Forbidden','Forbidden origin','Workspace is read-only'].includes(message))return {status:403,error:message};
  if(message==='Sign in required')return {status:401,error:message};
  if(['Schedule unavailable','Briefing unavailable'].includes(message))return {status:404,error:message};
  if(['Schedule request conflict','A publication schedule is already pending','Schedule is already closed','Draft revision changed'].includes(message))return {status:409,error:message};
  if(['Invalid publication schedule','Invalid schedule page','Invalid publication request','Invalid deadline','Invalid deadline reminder','Invalid JSON','Confirm schedule cancellation',
    'Scheduled publication must be in the future','Deadline must follow scheduled publication','Deadline must be in the future','Briefing is not technically ready',
    'Recipient unavailable','Recipient language is unavailable','Recipient language not selected','Briefing is archived','Glossary dependency changed','Live publication artifact verification is unavailable'].includes(message))return {status:400,error:message};
  return {status:message==='Request too large'?413:503,error:'Publication scheduling unavailable. Refresh schedules before retrying.'};
}
