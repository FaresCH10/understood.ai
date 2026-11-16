import {NOW,transaction} from './db.mjs';
import {metrics} from './domain.mjs';
import {historyIdentity,publicationHistoryFilters} from './publication-history-input.mjs';

function authority(db,session,briefingId) {
  historyIdentity(briefingId);
  if(session?.principal_type!=='staff' || !['owner','supervisor','auditor'].includes(session.role)
    || !db.prepare('SELECT id FROM staff WHERE id=? AND org_id=? AND site_id=? AND role=? AND active=1').get(session.principal_id,session.org_id,session.site_id,session.role))throw Error('Forbidden');
  if(session.token_hash!==undefined && !db.prepare("SELECT 1 FROM sessions WHERE token_hash=? AND principal_type='staff' AND principal_id=? AND org_id=? AND site_id=? AND revoked_at IS NULL AND expires_at>?")
    .get(session.token_hash,session.principal_id,session.org_id,session.site_id,NOW()))throw Error('Sign in required');
  if(!db.prepare('SELECT id FROM briefings WHERE id=? AND org_id=? AND site_id=?').get(briefingId,session.org_id,session.site_id))throw Error('Briefing unavailable');
}

export function listPublicationHistory(db,session,briefingId,input={}) {
  const {page,pageSize,version}=publicationHistoryFilters(input);
  return transaction(db,()=>{
    authority(db,session,briefingId);
    const where='briefing_id=? AND org_id=? AND site_id=?'+(version===null?'':' AND version=?'),args=[briefingId,session.org_id,session.site_id,...(version===null?[]:[version])];
    const total=db.prepare(`SELECT COUNT(*) AS total FROM publications WHERE ${where}`).get(...args).total;
    const items=db.prepare(`SELECT id,version,state,published_at FROM publications WHERE ${where} ORDER BY version DESC,id LIMIT ? OFFSET ?`).all(...args,pageSize,(page-1)*pageSize);
    return {briefingId,items,total,page,pageSize,version};
  });
}

export function getPublicationHistoryDetail(db,session,briefingId,publicationId) {
  historyIdentity(publicationId);
  return transaction(db,()=>{
    authority(db,session,briefingId);
    const row=db.prepare('SELECT id,version,state,published_at,snapshot_json FROM publications WHERE id=? AND briefing_id=? AND org_id=? AND site_id=?').get(publicationId,briefingId,session.org_id,session.site_id);
    if(!row)throw Error('Publication unavailable');
    return {id:row.id,briefingId,version:row.version,state:row.state,published_at:row.published_at,snapshot:JSON.parse(row.snapshot_json),sentLanguages:db.prepare('SELECT DISTINCT language FROM assignments WHERE publication_id=? AND org_id=? AND site_id=? ORDER BY language').all(row.id,session.org_id,session.site_id).map(item=>item.language),metrics:metrics(db,session.org_id,row.id),artifactAudio:null,
      withdrawal:db.prepare('SELECT reason,withdrawn_by,occurred_at FROM publication_withdrawals WHERE publication_id=? AND org_id=? AND site_id=?').get(row.id,session.org_id,session.site_id) || null};
  });
}
