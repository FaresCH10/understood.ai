import {transaction} from './db.mjs';
import {briefingAuthority} from './preparation.mjs';
import {ensureDeletionSchema} from './deletions.mjs';
import {reverificationFilters,reverificationPage} from './reverification-input.mjs';

export function listReverificationCandidates(db,session,briefingId,input={}) {
  const filters=reverificationFilters(input);
  ensureDeletionSchema(db);
  return transaction(db,()=>{
    briefingAuthority(db,session);
    if(!db.prepare('SELECT id FROM briefings WHERE id=? AND org_id=? AND site_id=?').get(briefingId,session.org_id,session.site_id))
      throw Error('Briefing unavailable');
    const source=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='instruction_improvement_drafts'").get()
      ?db.prepare('SELECT publication_id FROM instruction_improvement_drafts WHERE corrective_briefing_id=? AND org_id=? AND site_id=?')
        .get(briefingId,session.org_id,session.site_id)?.publication_id || '':'';
    const outcome=filters.outcome==='matched' ? "t.outcome='matched'" : "t.outcome IN ('matched','clarification','unassessable')";
    const cutoff=filters.cutoff ? 'AND t.received_at<=?' : '';
    const rows=db.prepare(`SELECT w.id,w.code,w.language,t.outcome,t.received_at,p.version FROM attempts t
      JOIN assignments a ON a.id=t.assignment_id AND a.org_id=t.org_id
      JOIN publications p ON p.id=a.publication_id AND p.org_id=a.org_id AND p.site_id=a.site_id
      JOIN workers w ON w.id=a.worker_id AND w.org_id=a.org_id AND w.site_id=a.site_id
      WHERE (p.briefing_id=? OR p.id=?) AND p.org_id=? AND p.site_id=? AND p.state IN ('published','superseded')
        AND w.active=1 AND w.language_selection_required=0
        AND NOT EXISTS(SELECT 1 FROM worker_deletion_requests d WHERE d.worker_id=w.id AND d.org_id=w.org_id AND d.site_id=w.site_id)
        AND ${outcome}
        AND t.id=(SELECT t2.id FROM attempts t2
          JOIN assignments a2 ON a2.id=t2.assignment_id AND a2.org_id=t2.org_id
          JOIN publications p2 ON p2.id=a2.publication_id AND p2.org_id=a2.org_id AND p2.site_id=a2.site_id
          WHERE a2.worker_id=w.id AND a2.org_id=? AND a2.site_id=? AND (p2.briefing_id=? OR p2.id=?)
            AND p2.state IN ('published','superseded')
          ORDER BY t2.received_at DESC,t2.id DESC LIMIT 1)
        ${cutoff} ORDER BY t.received_at ASC,w.code ASC LIMIT 5001`)
      .all(briefingId,source,session.org_id,session.site_id,session.org_id,session.site_id,briefingId,source,...(filters.cutoff?[filters.cutoff]:[]));
    return reverificationPage(rows,filters,{truncated:rows.length>5000});
  });
}
