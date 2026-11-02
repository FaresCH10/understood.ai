import {createHash} from 'node:crypto';
import {draftInput} from './briefing-input.mjs';

export const improvementSampleFrom=`FROM assignments a
  JOIN workers w ON w.id=a.worker_id AND w.org_id=a.org_id AND w.site_id=a.site_id
  JOIN attempts t ON t.assignment_id=a.id AND t.org_id=a.org_id
  WHERE a.publication_id=? AND a.org_id=? AND a.site_id=? AND w.active=true
    AND NOT EXISTS(SELECT 1 FROM worker_deletion_requests d WHERE d.worker_id=w.id AND d.org_id=w.org_id AND d.site_id=w.site_id)
    AND NOT EXISTS(SELECT 1 FROM attempts newer WHERE newer.assignment_id=a.id AND newer.org_id=a.org_id
      AND (newer.received_at>t.received_at OR (newer.received_at=t.received_at AND newer.id>t.id)))
    AND t.outcome IN ('matched','clarification','unassessable')`;

export const improvementSampleQuery=`SELECT a.worker_id,a.language,t.outcome ${improvementSampleFrom}`;
export const improvementCountQuery=`SELECT count(*) AS assessed,
  COALESCE(sum(CASE WHEN t.outcome='matched' THEN 1 ELSE 0 END),0) AS matched,
  COALESCE(sum(CASE WHEN t.outcome='clarification' THEN 1 ELSE 0 END),0) AS clarification ${improvementSampleFrom}`;

export function improvementCounts(rows) {
  const assessed=rows.length,matched=rows.filter(row=>row.outcome==='matched').length,
    clarification=rows.filter(row=>row.outcome==='clarification').length;
  return {assessed,matched,clarification,matchRate:assessed?Math.round(matched/assessed*100):null};
}

export const improvementNeeded=counts=>counts.assessed>=3 && counts.clarification>=2 && counts.clarification*100>=counts.assessed*30;
export const decodeImprovementSnapshot=value=>typeof value==='string'?JSON.parse(value):value;

export function improvementDraftInput(input) {
  try {
    if(!input || Array.isArray(input) || Object.keys(input).some(key=>!['requestId','title','source'].includes(key)))throw Error();
    const content=draftInput(input,'create');
    return {requestId:input.requestId,...content,hash:createHash('sha256').update(JSON.stringify(content)).digest('hex')};
  }catch{throw Error('Invalid improvement request');}
}

export function improvementView(publication,signal,rows,followup,followupRows=[],{integrationMode='synthetic'}={}) {
  const current=improvementCounts(rows),snapshot=decodeImprovementSnapshot(publication.snapshot_json);
  const source=typeof snapshot?.source==='string' && !['[Expired]','[Deleted]'].includes(snapshot.source)?snapshot.source:null;
  const languages=[...new Set(rows.map(row=>row.language))].sort().map(language=>({language,...improvementCounts(rows.filter(row=>row.language===language))}))
    .filter(group=>group.assessed>=3);
  const instant=value=>value instanceof Date?value.toISOString():value;
  return {publicationId:publication.id,simulated:integrationMode!=='live',adapter:integrationMode==='live'?'deterministic-rules-v1':'synthetic',current,languages,
    eligible:publication.state==='published' && !!source && improvementNeeded(current),
    threshold:{minimumAssessed:3,minimumClarifications:2,clarificationPercent:30},
    signal:signal?{assessed:signal.assessed,matched:signal.matched,clarification:signal.clarification,
      matchRate:Math.round(signal.matched/signal.assessed*100),createdAt:instant(signal.created_at)}:null,
    suggestion:signal && source?{title:`Improve: ${snapshot.title || 'Instruction'}`.slice(0,120),
      source:source.replace(/([.!?])\s+(?=\S)/g,'$1\n')}:null,
    followup:followup?{briefingId:followup.corrective_briefing_id,publicationId:followup.followup_publication_id || null,
      state:followup.followup_publication_state || 'draft',counts:improvementCounts(followupRows)}:null};
}

export function improvementHttpError(error) {
  const message=error?.message;
  const status=message==='Sign in required'?401:
    ['Forbidden','Forbidden origin','Workspace is read-only','Workspace access paused','Site archived'].includes(message)?403:
    message==='Publication unavailable'?404:
    ['Invalid improvement request','Invalid JSON'].includes(message)?400:
    message==='Request too large'?413:
    ['Session context changed','Improvement not available','Improvement request conflict'].includes(message)?409:503;
  return {status,error:status===503?'Instruction improvement unavailable. Refresh to check before retrying.':message};
}
