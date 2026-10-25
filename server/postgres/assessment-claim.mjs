import {dispatchAllowed} from './operations-gates.mjs';
import {isWorkerLanguage} from '../languages.mjs';

export function assessmentInput(row) {
  const snapshot=row?.snapshot_json,askedFacts=snapshot?.rubric?.askedFacts;
  const question=snapshot?.languages?.[row?.language]?.question || snapshot?.question;
  if(typeof row?.answer_text!=='string' || !row.answer_text.trim() || row.answer_text.length>2000
    || typeof question!=='string' || !question.trim() || question.length>500 || !Array.isArray(askedFacts)
    || !askedFacts.length || askedFacts.length>6 || !askedFacts.every(fact=>typeof fact==='string' && fact.trim() && fact.length<=500)
    || !isWorkerLanguage(row.language) || typeof row.publication_id!=='string'
    || !Number.isInteger(row.version) || row.version<1)throw Error('Published assessment input unavailable');
  return {answer:row.answer_text,question,askedFacts,language:row.language,publicationId:row.publication_id,version:row.version};
}

// Accepted answers retain their historical version after withdrawal. New dispatch
// still requires an active worker, pending attempt and exact current job lease.
export async function currentAssessmentClaim(client,{id,org_id,site_id,token}) {
  if(!await dispatchAllowed(client,org_id,{provider:true}))return null;
  const worker=(await client.query(`SELECT w.active FROM assessment_jobs j
    JOIN assignments a ON a.id=j.assignment_id AND a.org_id=j.org_id AND a.site_id=j.site_id
    JOIN workers w ON w.id=a.worker_id AND w.org_id=a.org_id AND w.site_id=a.site_id
    WHERE j.id=$1 AND j.org_id=$2 AND j.site_id=$3 FOR SHARE OF w`,[id,org_id,site_id])).rows[0];
  if(!worker?.active)return null;
  return (await client.query(`SELECT j.id,j.org_id,j.site_id,j.assignment_id,j.attempt_id,t.answer_text,p.snapshot_json,
    a.language,a.publication_id,p.version FROM assessment_jobs j
    JOIN attempts t ON t.id=j.attempt_id AND t.org_id=j.org_id AND t.site_id=j.site_id AND t.assignment_id=j.assignment_id
    JOIN assignments a ON a.id=j.assignment_id AND a.org_id=j.org_id AND a.site_id=j.site_id
    JOIN publications p ON p.id=a.publication_id AND p.org_id=a.org_id AND p.site_id=a.site_id
    WHERE j.id=$1 AND j.org_id=$2 AND j.site_id=$3 AND j.status='processing' AND j.lease_token=$4
    AND j.lease_until>clock_timestamp() AND t.assessment_status='pending'
    AND publication_content_available(p.id)
    AND NOT EXISTS(SELECT 1 FROM text_retention_purges d WHERE d.kind='attempt' AND d.reference_id=t.id)
    FOR SHARE OF j,t,a,p`,[id,org_id,site_id,token])).rows[0] ?? null;
}
