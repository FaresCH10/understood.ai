import { withTransaction } from './db.mjs';
import { schemaName } from './migrate.mjs';
import {reportPublicationFilters,publicationDateBounds,reportPublicationPage,publicationModes,reportDelivery } from '../reports.mjs';
import {domainTransaction,requirePrincipal} from './domain.mjs';
import { postgresResponseColumns as responseColumns } from '../recordings.mjs';
import {reportScope,selectReport} from '../report-scope.mjs';

export async function reportActivity(client,session,publication,filters,timezone) {
  const responses=await publicationResponses(client,session,publication.id);
  const audience=(await client.query('SELECT * FROM publication_report_audience WHERE publication_id=$1 AND org_id=$2 AND site_id=$3',[publication.id,session.org_id,session.site_id])).rows;
  const send=(await client.query(`SELECT request_id,state,audience_count,delivered,undelivered,undelivered_json
    FROM instruction_sends WHERE org_id=$1 AND site_id=$2 AND publication_id=$3 ORDER BY created_at DESC,request_id LIMIT 1`,
  [session.org_id,session.site_id,publication.id])).rows[0];
  const states=send?(await client.query(`SELECT state,count(*)::int AS count FROM instruction_deliveries
    WHERE request_id=$1 AND org_id=$2 AND site_id=$3 GROUP BY state`,[send.request_id,session.org_id,session.site_id])).rows:[];
  const resolvedAssignmentIds=(await client.query(`SELECT DISTINCT c.assignment_id FROM clarifications c JOIN assignments a
    ON a.id=c.assignment_id AND a.org_id=c.org_id AND a.site_id=c.site_id
    WHERE a.org_id=$1 AND a.site_id=$2 AND a.publication_id=$3 AND c.status='resolved'`,
  [session.org_id,session.site_id,publication.id])).rows.map((row)=>row.assignment_id);
  return selectReport(responses,publication.version,filters,timezone,audience,
    {...publicationModes(publication.snapshot_json),delivery:reportDelivery(send,states),resolvedAssignmentIds});
}

export async function publicationResponses(client,session,publicationId) {
  const rows=(await client.query(`SELECT a.id AS assignment_id,w.code,a.language,${responseColumns}
    FROM assignments a JOIN workers w ON w.id=a.worker_id AND w.org_id=a.org_id AND w.site_id=a.site_id
    WHERE a.org_id=$1 AND a.site_id=$2 AND a.publication_id=$3 ORDER BY w.code,a.id LIMIT 5001`,[session.org_id,session.site_id,publicationId])).rows;
  if (rows.length>5000) throw new Error('Report exceeds export limit');
  return rows;
}

export async function listReportPublications(pool,session,input={}, {schema='public'}={}) {
  const filters=reportPublicationFilters(input);
  return domainTransaction(pool,schema,async client=>{
    await requirePrincipal(client,session,'staff',['owner','supervisor','auditor']);
    const timezone=(await client.query('SELECT timezone FROM sites WHERE id=$1 AND org_id=$2',[session.site_id,session.org_id])).rows[0].timezone;
    const args=[session.org_id,session.site_id],where=['org_id=$1','site_id=$2'],bounds=publicationDateBounds(filters);
    const bind=value=>{args.push(value);return `$${args.length}`;};
    if(filters.search)where.push(`strpos(lower(snapshot_json->>'title'),lower(${bind(filters.search)}))>0`);
    if(bounds.from)where.push(`published_at>=${bind(bounds.from)}`);
    if(bounds.through)where.push(`published_at<${bind(bounds.through)}`);
    const rows=(await client.query(`SELECT id,version,state,published_at,snapshot_json->>'title' AS title FROM publications WHERE ${where.join(' AND ')} ORDER BY published_at DESC,id DESC LIMIT 5001`,args)).rows;
    return reportPublicationPage(rows,filters,timezone);
  });
}

export async function readPublicationReport(pool, session, { publicationId, schema = 'public',filters={} } = {}) {
  const scope=reportScope(filters);
  schemaName(schema);
  if (session?.principal_type !== 'staff' || !['owner','supervisor','auditor'].includes(session.role)) throw new Error('Forbidden');
  if (publicationId !== undefined && (typeof publicationId !== 'string' || !publicationId || publicationId.length > 100)) throw new Error('Invalid publication ID');
  return withTransaction(pool, async (client) => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SELECT set_config('search_path',quote_ident($1)||',pg_catalog',true)", [schema]);
    const principal = (await client.query(`SELECT st.timezone FROM staff s JOIN sites st ON st.id=s.site_id AND st.org_id=s.org_id
      WHERE s.id=$1 AND s.org_id=$2 AND s.site_id=$3 AND s.role=$4 AND s.active=true`,
    [session.principal_id, session.org_id, session.site_id, session.role])).rows[0];
    if (!principal) throw new Error('Forbidden');
    const availablePublications = (await client.query(`SELECT id,version,state,snapshot_json->>'title' AS title
      FROM publications WHERE org_id=$1 AND site_id=$2 ORDER BY published_at DESC,id LIMIT 100`, [session.org_id, session.site_id])).rows;
    const publication = (await client.query(`SELECT id,version,snapshot_json,snapshot_json->>'title' AS title,published_at
      FROM publications WHERE org_id=$1 AND site_id=$2 AND ${publicationId ? 'id=$3' : "state='published'"}
      ORDER BY published_at DESC,id LIMIT 1`, [session.org_id, session.site_id, ...(publicationId ? [publicationId] : [])])).rows[0];
    if (publicationId && !publication) throw new Error('Publication unavailable');
    const common = { availablePublications, timezone: principal.timezone, asOf: new Date().toISOString() };
    if (!publication) return { ...common, metrics: null, rows: [] };
    const selection=await reportActivity(client,session,publication,scope,principal.timezone);
    return { ...common, publicationId: publication.id, title: publication.title, version: publication.version,
      date: publication.published_at.toISOString(),...selection };
  });
}
