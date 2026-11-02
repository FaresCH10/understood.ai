const uuid=value=>typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const languageCode=value=>typeof value==='string' && /^[a-z]{2,3}(?:-[A-Za-z]{2,8})?$/.test(value);
export const feedbackFields=['title','text','question','audio','glossary'];
export function translationFeedbackInput(input) {
  if(!input || typeof input!=='object' || Array.isArray(input)
    || Object.keys(input).some(key=>!['requestId','publicationId','language','field','note'].includes(key))
    || !uuid(input.requestId) || !uuid(input.publicationId) || !languageCode(input.language) || !feedbackFields.includes(input.field)
    || typeof input.note!=='string' || input.note.trim().length<3 || input.note.length>1000) throw new Error('Invalid translation feedback');
  return {requestId:input.requestId,publicationId:input.publicationId,language:input.language,field:input.field,note:input.note.trim()};
}
export function translationFeedbackDecisionInput(input) {
  if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).some(key=>!['action','note'].includes(key))
    || !['resolved','dismissed'].includes(input.action) || typeof (input.note ?? '')!=='string' || (input.note ?? '').length>1000) throw new Error('Invalid translation feedback decision');
  return {action:input.action,note:(input.note ?? '').trim()};
}
export function translationFeedbackFilters(filters={}) {
  if(!filters || typeof filters!=='object' || Array.isArray(filters) || Object.keys(filters).some(key=>!['status','language','page','pageSize'].includes(key))) throw new Error('Invalid translation feedback filter');
  const status=filters.status ?? 'open',language=filters.language ?? '',page=Number(filters.page ?? 1),pageSize=Number(filters.pageSize ?? 20);
  if(!['all','open','resolved','dismissed'].includes(status) || (language!=='' && !languageCode(language))
    || !Number.isSafeInteger(page) || page<1 || page>5000 || !Number.isInteger(pageSize) || pageSize<1 || pageSize>100) throw new Error('Invalid translation feedback filter');
  return {status,language,page,pageSize};
}
