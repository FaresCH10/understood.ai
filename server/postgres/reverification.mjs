import {domainTransaction,requirePrincipal} from './domain.mjs';
import {reverificationFilters,reverificationPage} from '../reverification-input.mjs';

export async function listReverificationCandidates(pool,session,briefingId,input={},{schema='public'}={}) {
  const filters=reverificationFilters(input);
  if(typeof briefingId!=='string' || !briefingId || briefingId.length>100) throw Error('Briefing unavailable');
  return domainTransaction(pool,schema,async client=>{
    await requirePrincipal(client,session,'staff');
    const briefing=(await client.query('SELECT id FROM briefings WHERE id=$1 AND org_id=$2 AND site_id=$3',
      [briefingId,session.org_id,session.site_id])).rows[0];
    if(!briefing) throw Error('Briefing unavailable');
    const source=(await client.query('SELECT publication_id FROM instruction_improvement_drafts WHERE corrective_briefing_id=$1 AND org_id=$2 AND site_id=$3',
      [briefingId,session.org_id,session.site_id])).rows[0]?.publication_id || '';
    const outcome=filters.outcome==='matched' ? "t.outcome='matched'" : "t.outcome IN ('matched','clarification','unassessable')";
    const args=[briefingId,session.org_id,session.site_id,session.org_id,session.site_id,briefingId,source];
    if(filters.cutoff)args.push(filters.cutoff);
    const cutoff=filters.cutoff ? `AND t.received_at<=$${args.length}::timestamptz` : '';
    const rows=(await client.query(`SELECT w.id,w.code,w.language,t.outcome,t.received_at,p.version FROM attempts t
      JOIN assignments a ON a.id=t.assignment_id AND a.org_id=t.org_id AND a.site_id=t.site_id
      JOIN publications p ON p.id=a.publication_id AND p.org_id=a.org_id AND p.site_id=a.site_id
      JOIN workers w ON w.id=a.worker_id AND w.org_id=a.org_id AND w.site_id=a.site_id
      WHERE (p.briefing_id=$1 OR p.id=$7) AND p.org_id=$2 AND p.site_id=$3 AND p.state IN ('published','superseded')
        AND w.active=true AND w.language_selection_required=false
        AND NOT EXISTS(SELECT 1 FROM worker_deletion_requests d WHERE d.worker_id=w.id AND d.org_id=w.org_id AND d.site_id=w.site_id)
        AND ${outcome}
        AND t.id=(SELECT t2.id FROM attempts t2
          JOIN assignments a2 ON a2.id=t2.assignment_id AND a2.org_id=t2.org_id AND a2.site_id=t2.site_id
          JOIN publications p2 ON p2.id=a2.publication_id AND p2.org_id=a2.org_id AND p2.site_id=a2.site_id
          WHERE a2.worker_id=w.id AND a2.org_id=$4 AND a2.site_id=$5 AND (p2.briefing_id=$6 OR p2.id=$7)
            AND p2.state IN ('published','superseded')
          ORDER BY t2.received_at DESC,t2.id DESC LIMIT 1)
        ${cutoff} ORDER BY t.received_at ASC,w.code ASC LIMIT 5001`,args)).rows;
    return reverificationPage(rows,filters,{truncated:rows.length>5000});
  });
}
