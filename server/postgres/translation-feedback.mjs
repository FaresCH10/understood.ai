import {domainTransaction,domainAudit,requirePrincipal} from './domain.mjs';
import {translationFeedbackInput,translationFeedbackDecisionInput,translationFeedbackFilters} from '../translation-feedback-input.mjs';

function translationText(snapshot,language,field) {
  const value=snapshot?.languages?.[language] ?? snapshot?.deliveredTranslation;
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
const queueQuery=`SELECT f.*,b.title AS briefing_title,p.state AS publication_state,p.version AS publication_version,p.snapshot_json || jsonb_build_object('deliveredTranslation',(SELECT d.content_json FROM instruction_deliveries d JOIN instruction_sends snd ON snd.request_id=d.request_id AND snd.org_id=d.org_id AND snd.site_id=d.site_id WHERE snd.publication_id=f.publication_id AND d.org_id=f.org_id AND d.site_id=f.site_id AND d.language=f.language AND d.state='available' ORDER BY d.assignment_id LIMIT 1)) AS snapshot_json,
  reporter.name AS reporter_name,resolver.name AS resolver_name
  FROM translation_feedback f JOIN briefings b ON b.id=f.briefing_id AND b.org_id=f.org_id AND b.site_id=f.site_id
  JOIN publications p ON p.id=f.publication_id AND p.org_id=f.org_id AND p.site_id=f.site_id
  LEFT JOIN staff reporter ON reporter.id=f.reported_by AND reporter.org_id=f.org_id AND reporter.site_id=f.site_id
  LEFT JOIN staff resolver ON resolver.id=f.resolved_by AND resolver.org_id=f.org_id AND resolver.site_id=f.site_id`;
export async function listTranslationFeedback(pool,session,input={}, {schema='public'}={}) {
  throw new Error('Forbidden');
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
    if(!languages?.[value.language] && !(await client.query(`SELECT 1 FROM instruction_deliveries d JOIN instruction_sends s ON s.request_id=d.request_id AND s.org_id=d.org_id AND s.site_id=d.site_id WHERE s.publication_id=$1 AND d.org_id=$2 AND d.site_id=$3 AND d.language=$4 AND d.state='available'`,[value.publicationId,session.org_id,session.site_id,value.language])).rows.length)throw new Error('Translation language unavailable');
    if((await client.query("SELECT 1 FROM translation_feedback WHERE org_id=$1 AND site_id=$2 AND publication_id=$3 AND language=$4 AND field=$5 AND status='open'",
      [session.org_id,session.site_id,value.publicationId,value.language,value.field])).rows.length) throw new Error('Translation feedback already open');
    await client.query('INSERT INTO translation_feedback(id,org_id,site_id,publication_id,briefing_id,language,field,note,status,reported_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,\'open\',$9)',
      [value.requestId,session.org_id,session.site_id,value.publicationId,publication.briefing_id,value.language,value.field,value.note,session.principal_id]);
    await domainAudit(client,session,'translation.feedback_reported',value.requestId);
    return {...feedbackRow((await client.query(`${queueQuery} WHERE f.id=$1`,[value.requestId])).rows[0]),duplicate:false};
  });
}
export async function decideTranslationFeedback(pool,session,id,input,{schema='public'}={}) {
  throw new Error('Forbidden');
}
