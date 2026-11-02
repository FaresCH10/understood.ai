import {randomUUID} from 'node:crypto';
import {domainTransaction,domainAudit,requirePrincipal,requireActiveBriefing} from './domain.mjs';
import {competencySettingInput,competencyFilters} from '../competency-input.mjs';

const EXPIRING_DAYS=30;
const DAY_MS=86400000;
const iso=value=>value instanceof Date ? value.toISOString() : value;

function competencyRow(row) {
  return {id:row.id,workerId:row.worker_id,workerName:row.worker_name || '',workerCode:row.worker_code,
    briefingId:row.briefing_id,briefingTitle:row.briefing_title,publicationVersion:row.publication_version,
    title:row.title,language:row.language,source:row.source,awardedAt:iso(row.awarded_at),expiresAt:iso(row.expires_at),status:row.status};
}

export async function saveCompetencySetting(pool,session,briefingId,input,{schema='public'}={}) {
  if(typeof briefingId!=='string' || !briefingId || briefingId.length>100) throw new Error('Briefing unavailable');
  const value=competencySettingInput(input);
  return domainTransaction(pool,schema,async client=>{
    await requirePrincipal(client,session,'staff');
    const row=(await client.query('SELECT revision,competency_validity_days FROM briefings WHERE id=$1 AND org_id=$2 AND site_id=$3 FOR UPDATE',
      [briefingId,session.org_id,session.site_id])).rows[0];
    if(!row) throw new Error('Briefing unavailable');
    await requireActiveBriefing(client,session,briefingId);
    if(row.revision!==value.revision) throw new Error('Draft revision changed');
    const unchanged=row.competency_validity_days===value.validityDays;
    if(!unchanged) {
      await client.query('UPDATE briefings SET competency_validity_days=$4 WHERE id=$1 AND org_id=$2 AND site_id=$3',
        [briefingId,session.org_id,session.site_id,value.validityDays]);
      await domainAudit(client,session,'briefing.competency_configured',briefingId);
    }
    return {id:briefingId,revision:row.revision,validityDays:value.validityDays,unchanged};
  });
}

export async function listCompetencies(pool,session,input={},{schema='public'}={}) {
  const {status,search,page,pageSize}=competencyFilters(input);
  return domainTransaction(pool,schema,async client=>{
    await requirePrincipal(client,session,'staff',['owner','supervisor','auditor']);
    const asOf=new Date(),cutoff=new Date(asOf.getTime()+EXPIRING_DAYS*DAY_MS);
    const counts={active:0,expiring:0,expired:0};
    for(const row of (await client.query(`SELECT CASE WHEN expires_at<=$3 THEN 'expired' WHEN expires_at<=$4 THEN 'expiring' ELSE 'active' END AS status,
      COUNT(*)::int AS n FROM worker_competencies WHERE org_id=$1 AND site_id=$2 GROUP BY status`,
    [session.org_id,session.site_id,asOf,cutoff])).rows) counts[row.status]=row.n;
    const like=`%${search.replace(/[\\%_]/g,'\\$&')}%`;
    const args=[session.org_id,session.site_id,search,like];
    const scope=status==='active' ? `c.expires_at>$${args.push(cutoff)}`
      : status==='expiring' ? `c.expires_at>$${args.push(asOf)} AND c.expires_at<=$${args.push(cutoff)}`
      : status==='expired' ? `c.expires_at<=$${args.push(asOf)}` : 'true';
    const where=`c.org_id=$1 AND c.site_id=$2 AND ${scope} AND ($3='' OR w.name ILIKE $4 ESCAPE '\\' OR w.code ILIKE $4 ESCAPE '\\' OR c.title ILIKE $4 ESCAPE '\\')`;
    const from=`FROM worker_competencies c JOIN workers w ON w.id=c.worker_id AND w.org_id=c.org_id AND w.site_id=c.site_id`;
    const total=(await client.query(`SELECT COUNT(*)::int AS n ${from} WHERE ${where}`,args)).rows[0].n;
    const order=status==='expired' ? 'c.expires_at DESC,c.id' : status==='all'
      ? 'CASE WHEN c.expires_at<=now() THEN 1 ELSE 0 END,c.expires_at ASC,c.id' : 'c.expires_at ASC,c.id';
    const pageArgs=[pageSize,(page-1)*pageSize];
    const items=(await client.query(`SELECT c.*,w.name AS worker_name,w.code AS worker_code,b.title AS briefing_title,p.version AS publication_version
      ${from} JOIN briefings b ON b.id=c.briefing_id AND b.org_id=c.org_id AND b.site_id=c.site_id
      JOIN publications p ON p.id=c.publication_id AND p.org_id=c.org_id AND p.site_id=c.site_id
      WHERE ${where} ORDER BY ${order} LIMIT $${args.length+1} OFFSET $${args.length+2}`,
    [...args,...pageArgs])).rows.map(row=>competencyRow({...row,
      status:new Date(row.expires_at)<=asOf ? 'expired' : new Date(row.expires_at)<=cutoff ? 'expiring' : 'active'}));
    return {items,total,page,pageSize,counts,asOf:asOf.toISOString()};
  });
}

export async function workerCompetencies(pool,session,{schema='public'}={}) {
  return domainTransaction(pool,schema,async client=>{
    await requirePrincipal(client,session,'worker');
    const asOf=new Date(),cutoff=new Date(asOf.getTime()+EXPIRING_DAYS*DAY_MS);
    const items=(await client.query(`SELECT c.id,c.worker_id,c.briefing_id,c.publication_id,b.title AS briefing_title,p.version AS publication_version,
      c.title,c.language,c.source,c.awarded_at,c.expires_at,
      CASE WHEN c.expires_at<=$3 THEN 'expired' WHEN c.expires_at<=$4 THEN 'expiring' ELSE 'active' END AS status
      FROM worker_competencies c JOIN briefings b ON b.id=c.briefing_id AND b.org_id=c.org_id AND b.site_id=c.site_id
      JOIN publications p ON p.id=c.publication_id AND p.org_id=c.org_id AND p.site_id=c.site_id
      WHERE c.org_id=$1 AND c.site_id=$2 AND c.worker_id=$5 ORDER BY c.expires_at DESC,c.id`,
    [session.org_id,session.site_id,asOf,cutoff,session.principal_id])).rows
      .map(row=>({id:row.id,workerId:row.worker_id,briefingId:row.briefing_id,briefingTitle:row.briefing_title,publicationVersion:row.publication_version,
        title:row.title,language:row.language,source:row.source,awardedAt:iso(row.awarded_at),expiresAt:iso(row.expires_at),status:row.status}));
    return {items,asOf:asOf.toISOString()};
  });
}

export async function awardCompetency(client,{orgId,siteId,workerId,assignmentId,attemptId,source}) {
  if(!['typed','audio'].includes(source)) return null;
  const row=(await client.query(`SELECT a.worker_id,a.language,p.briefing_id,p.id AS publication_id,p.snapshot_json
    FROM attempts t JOIN assignments a ON a.id=t.assignment_id AND a.org_id=t.org_id AND a.site_id=$1
    JOIN publications p ON p.id=a.publication_id AND p.org_id=a.org_id AND p.site_id=a.site_id
    WHERE t.id=$2 AND t.org_id=$3 AND t.assignment_id=$4 AND t.outcome='matched'`,[siteId,attemptId,orgId,assignmentId])).rows[0];
  if(!row || row.worker_id!==workerId) return null;
  const config=row.snapshot_json?.competency,validityDays=config?.validityDays;
  if(!Number.isSafeInteger(validityDays) || validityDays<1 || validityDays>3650
    || typeof config.title!=='string' || !config.title.trim() || config.title.length>120) return null;
  const competencyId=randomUUID();
  const inserted=(await client.query(`INSERT INTO worker_competencies(id,org_id,site_id,worker_id,briefing_id,publication_id,assignment_id,
    attempt_id,title,language,source,awarded_at,expires_at)
    SELECT $1,$2,$3,$4,p.briefing_id,p.id,a.id,t.id,$8,a.language,$7,t.received_at,t.received_at+make_interval(days=>$9)
    FROM attempts t JOIN assignments a ON a.id=t.assignment_id AND a.org_id=t.org_id AND a.site_id=$3
    JOIN publications p ON p.id=a.publication_id AND p.org_id=a.org_id AND p.site_id=a.site_id
    WHERE t.id=$6 AND t.org_id=$2 AND t.assignment_id=$5 AND t.outcome='matched' AND a.worker_id=$4
    ON CONFLICT(assignment_id) DO NOTHING RETURNING id,expires_at`,
  [competencyId,orgId,siteId,workerId,assignmentId,attemptId,source,config.title,validityDays])).rows[0];
  return inserted ? {id:competencyId,title:config.title,expiresAt:iso(inserted.expires_at)} : null;
}
