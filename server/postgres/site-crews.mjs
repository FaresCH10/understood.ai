import {crewFilters} from '../people.mjs';
import {crewOverviewResult,crewActivityActions} from '../crew-overview.mjs';
import {readCrewPage} from './people.mjs';
import {responseRead} from './responses.mjs';
import {postgresResponseColumns as responseColumns} from '../recordings.mjs';

export async function siteCrewOverview(pool,session,input={},{schema='public'}={}) {
  const filters=crewFilters(input);
  return responseRead(pool,schema,async client=>{
    const page=await readCrewPage(client,session,filters);
    const site=(await client.query('SELECT id,name,timezone FROM sites WHERE id=$1 AND org_id=$2',[session.site_id,session.org_id])).rows[0];
    if(!site)throw Error('Forbidden');
    const contacts=(await client.query(`SELECT
      (SELECT jsonb_build_object('name',s.name,'role',s.role) FROM staff s WHERE s.id=t.primary_contact_id AND s.org_id=t.org_id
        AND s.site_id=t.site_id AND s.active AND s.role IN ('owner','supervisor')) AS primary,
      (SELECT jsonb_build_object('name',s.name,'role',s.role) FROM staff s WHERE s.id=t.deputy_contact_id AND s.org_id=t.org_id
        AND s.site_id=t.site_id AND s.active AND s.role IN ('owner','supervisor')) AS deputy
      FROM site_settings t WHERE t.site_id=$1 AND t.org_id=$2`,[session.site_id,session.org_id])).rows[0] || {primary:null,deputy:null};
    const row=(await client.query(`SELECT id,briefing_id AS "briefingId",version,snapshot_json->>'title' AS title,published_at AS "publishedAt"
      FROM publications WHERE org_id=$1 AND site_id=$2 AND state='published' ORDER BY published_at DESC,id LIMIT 1`,[session.org_id,session.site_id])).rows[0];
    const publication=row?{...row,publishedAt:row.publishedAt.toISOString()}:null;
    const responses=row?(await client.query(`SELECT a.id AS assignment_id,${responseColumns} FROM assignments a
      WHERE a.org_id=$1 AND a.site_id=$2 AND a.publication_id=$3 ORDER BY a.id LIMIT 5001`,[session.org_id,session.site_id,row.id])).rows:[];
    const audience=row?(await client.query('SELECT assignment_id,crew_id FROM publication_report_audience WHERE org_id=$1 AND site_id=$2 AND publication_id=$3',[session.org_id,session.site_id,row.id])).rows:[];
    const activity=(await client.query(`SELECT e.id,e.action,e.occurred_at,s.name AS actor,
      CASE WHEN e.action LIKE 'crew.%' THEN c.name WHEN d.id IS NULL THEN w.code ELSE NULL END AS item
      FROM audit e LEFT JOIN staff s ON e.actor_type='staff' AND s.id=e.actor_id AND s.org_id=e.org_id AND s.site_id=e.site_id
      LEFT JOIN crews c ON e.action LIKE 'crew.%' AND c.id=e.object_id AND c.org_id=e.org_id AND c.site_id=e.site_id
      LEFT JOIN workers w ON e.action LIKE 'worker.%' AND w.id=e.object_id AND w.org_id=e.org_id AND w.site_id=e.site_id
      LEFT JOIN worker_deletion_requests d ON d.worker_id=w.id AND d.org_id=w.org_id AND d.site_id=w.site_id
      WHERE e.org_id=$1 AND e.site_id=$2 AND e.action=ANY($3::text[]) ORDER BY e.occurred_at DESC,e.id DESC LIMIT 6`,
    [session.org_id,session.site_id,crewActivityActions])).rows;
    return crewOverviewResult({page,site,contacts,publication,responses,audience,activity,asOf:new Date().toISOString()});
  });
}
