import {domainTransaction,domainAudit,requirePrincipal} from './domain.mjs';
import {translationFeedbackInput,translationFeedbackDecisionInput,translationFeedbackFilters} from '../translation-feedback-input.mjs';

function translationText(snapshot,language,field) {
  const value=snapshot?.languages?.[language];
  if(!value || typeof value!=='object') return '';
  const text=field==='title'?value.title:field==='question'?value.question:field==='audio'?(value.speech || value.text):field==='glossary'?'':value.text;
  return typeof text==='string' ? text.slice(0,2000) : '';
}
function feedbackRow(row) {
  return {id:row.id,publicationId:row.publication_id,briefingId:row.briefing_id,briefingTitle:row.briefing_title,
    publicationState:row.publication_state,publicationVersion:row.publication_version,language:row.language,field:row.field,
    note:row.note,status:row.status,reporter:row.reporter_name || '',reportedById:row.reported_by,
    createdAt:row.reported_at instanceof Date?row.reported_at.toISOString():row.reported_at,
    resolvedBy:row.resolver_name || '',resolvedById:row.resolved_by || null,
    resolvedAt:row.resolved_at ? (row.resolved_at instanceof Date?row.resolved_at.toISOString():row.resolved_at) : null,
    resolutionNote:row.resolution_note || '',translation:translationText(row.snapshot_json,row.language,row.field)};
}
const queueQuery=`SELECT f.*,b.title AS briefing_title,p.state AS publication_state,p.version AS publication_version,p.snapshot_json,
  reporter.name AS reporter_name,resolver.name AS resolver_name
  FROM translation_feedback f JOIN briefings b ON b.id=f.briefing_id AND b.org_id=f.org_id AND b.site_id=f.site_id
  JOIN publications p ON p.id=f.publication_id AND p.org_id=f.org_id AND p.site_id=f.site_id
  LEFT JOIN staff reporter ON reporter.id=f.reported_by AND reporter.org_id=f.org_id AND reporter.site_id=f.site_id
  LEFT JOIN staff resolver ON resolver.id=f.resolved_by AND resolver.org_id=f.org_id AND resolver.site_id=f.site_id`;
export async function listTranslationFeedback(pool,session,input={}, {schema='public'}={}) {
  const {status,language,page,pageSize}=translationFeedbackFilters(input);
  return domainTransaction(pool,schema,async client=>{
    await requirePrincipal(client,session,'staff',['owner','supervisor','auditor']);
    const where="f.org_id=$1 AND f.site_id=$2 AND ($3='all' OR f.status=$3) AND ($4='' OR f.language=$4)";
    const args=[session.org_id,session.site_id,status,language];
    const total=(await client.query(`SELECT COUNT(*)::int AS n FROM translation_feedback f WHERE ${where}`,args)).rows[0].n;
    const items=(await client.query(`${queueQuery} WHERE ${where} ORDER BY f.reported_at DESC,f.id DESC LIMIT $5 OFFSET $6`,
      [...args,pageSize,(page-1)*pageSize])).rows.map(feedbackRow);
    return {items,total,page,pageSize};
  });
}
export async function reportTranslationFeedback(pool,session,input,{schema='public'}={}) {
  const value=translationFeedbackInput(input);
  return domainTransaction(pool,schema,async client=>{
    await requirePrincipal(client,session,'staff',['owner','supervisor','auditor']);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`understood:translation-feedback:${schema}:${session.org_id}:${session.site_id}:${value.publicationId}:${value.language}:${value.field}`]);
    const old=(await client.query('SELECT * FROM translation_feedback WHERE id=$1',[value.requestId])).rows[0];
    if(old) {
      if(old.org_id!==session.org_id || old.site_id!==session.site_id || old.reported_by!==session.principal_id
        || old.publication_id!==value.publicationId || old.language!==value.language || old.field!==value.field || old.note!==value.note) throw new Error('Translation feedback request conflict');
      return {...feedbackRow((await client.query(`${queueQuery} WHERE f.id=$1`,[old.id])).rows[0]),duplicate:true};
    }
    const publication=(await client.query(`SELECT p.id,p.briefing_id,p.snapshot_json,b.title AS briefing_title
      FROM publications p JOIN briefings b ON b.id=p.briefing_id AND b.org_id=p.org_id AND b.site_id=p.site_id
      WHERE p.id=$1 AND p.org_id=$2 AND p.site_id=$3 FOR SHARE`,[value.publicationId,session.org_id,session.site_id])).rows[0];
    if(!publication) throw new Error('Publication unavailable');
    const languages=publication.snapshot_json?.languages;
    if(!languages || !Object.hasOwn(languages,value.language)) throw new Error('Translation language unavailable');
    if((await client.query("SELECT 1 FROM translation_feedback WHERE org_id=$1 AND site_id=$2 AND publication_id=$3 AND language=$4 AND field=$5 AND status='open'",
      [session.org_id,session.site_id,value.publicationId,value.language,value.field])).rows.length) throw new Error('Translation feedback already open');
    await client.query('INSERT INTO translation_feedback(id,org_id,site_id,publication_id,briefing_id,language,field,note,status,reported_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,\'open\',$9)',
      [value.requestId,session.org_id,session.site_id,value.publicationId,publication.briefing_id,value.language,value.field,value.note,session.principal_id]);
    await domainAudit(client,session,'translation.feedback_reported',value.requestId);
    return {...feedbackRow((await client.query(`${queueQuery} WHERE f.id=$1`,[value.requestId])).rows[0]),duplicate:false};
  });
}
export async function decideTranslationFeedback(pool,session,id,input,{schema='public'}={}) {
  if(typeof id!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new Error('Invalid translation feedback');
  const value=translationFeedbackDecisionInput(input);
  return domainTransaction(pool,schema,async client=>{
    await requirePrincipal(client,session,'staff');
    const row=(await client.query('SELECT * FROM translation_feedback WHERE id=$1 AND org_id=$2 AND site_id=$3 FOR UPDATE',[id,session.org_id,session.site_id])).rows[0];
    if(!row) throw new Error('Translation feedback unavailable');
    if(row.status!=='open') {
      if(row.status===value.action && row.resolved_by===session.principal_id && (row.resolution_note ?? '')===value.note)
        return {...feedbackRow((await client.query(`${queueQuery} WHERE f.id=$1`,[id])).rows[0]),duplicate:true};
      throw new Error('Translation feedback already decided');
    }
    const changed=(await client.query("UPDATE translation_feedback SET status=$4,resolved_by=$5,resolved_at=clock_timestamp(),resolution_note=$6 WHERE id=$1 AND org_id=$2 AND site_id=$3 AND status='open' RETURNING id",
      [id,session.org_id,session.site_id,value.action,session.principal_id,value.note || null])).rows[0];
    if(!changed) throw new Error('Translation feedback already decided');
    await domainAudit(client,session,`translation.feedback_${value.action}`,id);
    return {...feedbackRow((await client.query(`${queueQuery} WHERE f.id=$1`,[id])).rows[0]),duplicate:false};
  });
}
