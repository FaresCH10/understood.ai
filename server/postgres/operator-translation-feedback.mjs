import {domainTransaction} from './domain.mjs';
import {requireOperatorInTransaction,operatorAudit} from './operators.mjs';
import {translationFeedbackFilters,translationFeedbackDecisionInput} from '../translation-feedback-input.mjs';
const operatorUuid=value=>typeof value==='string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);

// Only the reported issue is exposed, never publication snapshots or worker answers.
export function operationsTranslationFeedback(pool,identity,input={},options={}){
  const f=translationFeedbackFilters(input);
  return domainTransaction(pool,options.schema||'public',async client=>{
    await requireOperatorInTransaction(client,identity);
    const args=[f.status,f.language];
    const where="($1='all' OR f.status=$1) AND ($2='' OR f.language=$2)";
    const total=(await client.query(`SELECT COUNT(*)::int AS total FROM translation_feedback f WHERE ${where}`,args)).rows[0].total;
    const items=(await client.query(`SELECT f.id,f.org_id AS "orgId",o.name AS "workspace",s.name AS "site",
      f.publication_id AS "publicationId",f.language,f.field,f.note,f.status,f.reported_at AS "createdAt",
      f.resolution_note AS "resolutionNote",f.resolved_at AS "resolvedAt",f.resolved_by_operator AS "reviewerId"
      FROM translation_feedback f JOIN organizations o ON o.id=f.org_id JOIN sites s ON s.id=f.site_id AND s.org_id=f.org_id
      WHERE ${where} ORDER BY f.reported_at DESC,f.id DESC LIMIT $3 OFFSET $4`,[...args,f.pageSize,(f.page-1)*f.pageSize])).rows;
    return {items:items.map(row=>({...row,createdAt:new Date(row.createdAt).toISOString(),resolvedAt:row.resolvedAt?new Date(row.resolvedAt).toISOString():null})),total,page:f.page,pageSize:f.pageSize};
  });
}
export function decideOperationsTranslationFeedback(pool,identity,id,input,options={}){
  if(!operatorUuid(id) || !input || Object.keys(input).sort().join(',')!=='action,note,requestId' || !operatorUuid(input.requestId))throw Error('Invalid operator command');
  const value=translationFeedbackDecisionInput({action:input.action,note:input.note});
  const command={kind:'translation-feedback',id,...value};
  return domainTransaction(pool,options.schema||'public',async client=>{
    const actor=await requireOperatorInTransaction(client,identity);
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`operator-feedback:${input.requestId}`]);
    const old=(await client.query('SELECT operator_id,request_json=$2::jsonb AS matches,result_json FROM operator_requests WHERE request_id=$1',[input.requestId,JSON.stringify(command)])).rows[0];
    if(old){
      if(old.operator_id!==actor.operator_id || !old.matches)throw Error('Operator request conflict');
      return {...old.result_json,duplicate:true};
    }
    if((await client.query('SELECT 1 FROM provider_verifications WHERE request_id=$1',[input.requestId])).rows.length)throw Error('Operator request conflict');
    const row=(await client.query('SELECT id,status FROM translation_feedback WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(!row)throw Error('Translation feedback unavailable');
    if(row.status!=='open')throw Error('Translation feedback already decided');
    const result=(await client.query(`UPDATE translation_feedback SET status=$2,resolved_by_operator=$3,resolved_at=clock_timestamp(),resolution_note=$4
      WHERE id=$1 AND status='open' RETURNING id,status`,[id,value.action,actor.operator_id,value.note||null])).rows[0];
    await client.query('INSERT INTO operator_requests(request_id,operator_id,request_json,result_json) VALUES($1,$2,$3,$4)',[input.requestId,actor.operator_id,JSON.stringify(command),JSON.stringify(result)]);
    await operatorAudit(client,actor.operator_id,`translation.feedback_${value.action}`,'translation_feedback',id);
    return {...result,duplicate:false};
  });
}
