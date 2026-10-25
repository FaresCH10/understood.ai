const iso=value=>value instanceof Date?value.toISOString():value??null;
const array=value=>value==null?[]:typeof value==='string'?JSON.parse(value):value;
function assessment(row){
  const stored=array(row.reasons_json),legacy=!Array.isArray(stored);
  // SQLite recording assessments historically kept reasons and evidence together.
  return {assessmentReasons:legacy?stored.reasons:stored,
    assessmentEvidence:row.evidence_json===undefined?(legacy?stored.evidence:[]):array(row.evidence_json)};
}
function summary(row){
  return {id:row.id,worker:row.worker,language:row.language,title:row.title??null,reason:row.reason,status:row.status,
    created_at:iso(row.created_at),due_at:iso(row.due_at),case_due_at:iso(row.case_due_at),escalated_at:iso(row.escalated_at),
    owner_name:row.owner_name??null,owner_staff_id:row.owner_staff_id??null,assignment_id:row.assignment_id,
    publication_id:row.publication_id,version:row.version,attempt_id:row.attempt_id??null};
}
export function clarificationPageView(page,context){
  return {rows:page.rows.map(summary),total:page.total,page:page.page,pageSize:page.pageSize,ownerOptions:page.ownerOptions.map(({id,name})=>({id,name})),clientContext:context};
}
export function clarificationDetailView(row,context){
  return {...summary(row),...(row.staffCreation?{staffCreation:row.staffCreation}:{}),notes:row.notes??'',clientContext:context,
    snapshot:{source:row.snapshot.source??null,question:row.snapshot.question??null,facts:row.snapshot.facts??[],askedFacts:row.snapshot.rubric?.askedFacts??[]},
    answer_text:row.answer_text??null,outcome:row.outcome??null,recording_id:row.recording_id??null,
    ...assessment(row),
    attempts:row.attempts.map(attempt=>({id:attempt.id,answer_text:attempt.answer_text,outcome:attempt.outcome??null,
      received_at:iso(attempt.received_at),recording_id:attempt.recording_id??null,
      ...assessment(attempt)})),
    owners:row.owners.map(({id,name})=>({id,name})),helpRequest:row.helpRequest,
    canRequestRepeat:row.canRequestRepeat===true,canReview:row.canReview===true,contentExpired:row.contentExpired===true};
}
export function clarificationHttpError(error){
  const message=error?.message;
  if(message==='Sign in required')return {status:401,error:message};
  if(['Forbidden','Forbidden origin','Forbidden transport','Workspace access paused','Worker access paused','Site archived','Workspace is read-only'].includes(message))return {status:403,error:message};
  if(['Clarification unavailable','Clarification owner unavailable','Clarification action receipt unavailable','Clarification creation receipt unavailable','Clarification subject unavailable'].includes(message))return {status:404,error:message};
  if(['Session context changed','Resolution conflict','Clarification action conflict','Clarification creation conflict','Clarification selected answer changed','Clarification selected answer unavailable','Clarification answer already has a case'].includes(message))return {status:409,error:message};
  if(message==='Request too large')return {status:413,error:message};
  if(message==='Invalid case timeline page'||message==='Case timeline exceeds limit')return {status:400,error:message};
  if(['Invalid clarification action','Invalid clarification filter','Clarifications exceed limit; narrow filters','Clarification owners exceed limit','Resolution notes are required','Invalid clarification owner','Invalid JSON','Invalid clarification creation','Invalid clarification subject','Invalid clarification subject filter','Clarification subjects exceed limit'].includes(message))return {status:400,error:message};
  return {status:503,error:'Clarification operation unavailable. Check the request status before retrying.'};
}
