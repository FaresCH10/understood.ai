import {requirePrincipal} from './domain.mjs';
import {responseRead} from './responses.mjs';
import {publicationResponses} from './reports.mjs';
import {metricsFromResponses} from '../domain.mjs';
import {staffArtifactUrls} from './generated-audio.mjs';
import {historyIdentity,publicationHistoryFilters} from '../publication-history-input.mjs';

async function authority(client,session,briefingId) {
  await requirePrincipal(client,session,'staff',['owner','supervisor','auditor']);
  if(!(await client.query('SELECT id FROM briefings WHERE id=$1 AND org_id=$2 AND site_id=$3',[briefingId,session.org_id,session.site_id])).rows.length)throw Error('Briefing unavailable');
}

export function listPublicationHistory(pool,session,briefingId,input={}, {schema='public'}={}) {
  historyIdentity(briefingId);const {page,pageSize,version}=publicationHistoryFilters(input);
  return responseRead(pool,schema,async client=>{
    await authority(client,session,briefingId);
    const where='briefing_id=$1 AND org_id=$2 AND site_id=$3 AND ($4::int IS NULL OR version=$4)',args=[briefingId,session.org_id,session.site_id,version];
    const total=(await client.query(`SELECT COUNT(*)::int AS total FROM publications WHERE ${where}`,args)).rows[0].total;
    const items=(await client.query(`SELECT id,version,state,published_at FROM publications WHERE ${where} ORDER BY version DESC,id LIMIT $5 OFFSET $6`,[...args,pageSize,(page-1)*pageSize])).rows.map(row=>({...row,published_at:row.published_at instanceof Date?row.published_at.toISOString():row.published_at}));
    return {briefingId,items,total,page,pageSize,version};
  });
}

export function getPublicationHistoryDetail(pool,session,briefingId,publicationId,{schema='public'}={}) {
  historyIdentity(briefingId);historyIdentity(publicationId);
  return responseRead(pool,schema,async client=>{
    await authority(client,session,briefingId);
    const row=(await client.query(`SELECT p.id,p.version,p.state,p.published_at,p.snapshot_json AS snapshot,
      CASE WHEN w.publication_id IS NULL THEN NULL ELSE jsonb_build_object('reason',w.reason,'withdrawn_by',w.withdrawn_by,'occurred_at',w.occurred_at) END AS withdrawal
      FROM publications p LEFT JOIN publication_withdrawals w ON w.publication_id=p.id AND w.org_id=p.org_id AND w.site_id=p.site_id
      WHERE p.id=$1 AND p.briefing_id=$2 AND p.org_id=$3 AND p.site_id=$4`,[publicationId,briefingId,session.org_id,session.site_id])).rows[0];
    if(!row)throw Error('Publication unavailable');
    return {...row,briefingId,published_at:row.published_at instanceof Date?row.published_at.toISOString():row.published_at,
      sentLanguages:(await client.query('SELECT DISTINCT language FROM assignments WHERE publication_id=$1 AND org_id=$2 AND site_id=$3 ORDER BY language',[row.id,session.org_id,session.site_id])).rows.map(item=>item.language),
      metrics:metricsFromResponses(await publicationResponses(client,session,row.id)),artifactAudio:await staffArtifactUrls(client,session,briefingId,row.id,row.snapshot)};
  });
}
