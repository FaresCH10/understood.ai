import {randomUUID} from 'node:crypto';
import {NOW,transaction} from './db.mjs';
import {briefingAuthority,briefingAudit,assertBriefingActive} from './preparation.mjs';
import {competencySettingInput,competencyFilters} from './competency-input.mjs';
import {requireWorkerSiteAccess} from './site-access.mjs';

const EXPIRING_DAYS=30;
const DAY_MS=86400000;
const id=value=>typeof value==='string' && value.length>0 && value.length<=100;

function readAuthority(db,session) {
  if(session?.principal_type!=='staff' || !['owner','supervisor','auditor'].includes(session.role)
    || !db.prepare('SELECT id FROM staff WHERE id=? AND org_id=? AND site_id=? AND role=? AND active=1')
      .get(session.principal_id,session.org_id,session.site_id,session.role)) throw new Error('Forbidden');
}

function workerAuthority(db,session) {
  if(session?.principal_type!=='worker') throw new Error('Forbidden');
  requireWorkerSiteAccess(db,session.org_id,session.site_id);
  if(!db.prepare('SELECT 1 FROM workers WHERE id=? AND org_id=? AND site_id=? AND active=1')
    .get(session.principal_id,session.org_id,session.site_id)) throw new Error('Forbidden');
}

function competencyRow(row) {
  return {id:row.id,workerId:row.worker_id,workerName:row.worker_name || '',workerCode:row.worker_code,
    briefingId:row.briefing_id,briefingTitle:row.briefing_title,publicationVersion:row.publication_version,
    title:row.title,language:row.language,source:row.source,awardedAt:row.awarded_at,expiresAt:row.expires_at,status:row.status};
}

export function saveCompetencySetting(db,session,briefingId,input) {
  if(!id(briefingId)) throw new Error('Briefing unavailable');
  const value=competencySettingInput(input);
  return transaction(db,()=>{
    briefingAuthority(db,session);
    const row=db.prepare('SELECT revision,competency_validity_days FROM briefings WHERE id=? AND org_id=? AND site_id=?')
      .get(briefingId,session.org_id,session.site_id);
    if(!row) throw new Error('Briefing unavailable');
    assertBriefingActive(db,session,briefingId);
    if(row.revision!==value.revision) throw new Error('Draft revision changed');
    const unchanged=row.competency_validity_days===value.validityDays;
    if(!unchanged) {
      db.prepare('UPDATE briefings SET competency_validity_days=? WHERE id=? AND org_id=? AND site_id=?')
        .run(value.validityDays,briefingId,session.org_id,session.site_id);
      briefingAudit(db,session,'briefing.competency_configured',briefingId);
    }
    return {id:briefingId,revision:row.revision,validityDays:value.validityDays,unchanged};
  });
}

export function listCompetencies(db,session,input={}) {
  const {status,search,page,pageSize}=competencyFilters(input);
  return transaction(db,()=>{
    readAuthority(db,session);
    const now=NOW(),cutoff=new Date(Date.parse(now)+EXPIRING_DAYS*DAY_MS).toISOString();
    const scope='c.org_id=? AND c.site_id=?';
    const counts={active:0,expiring:0,expired:0};
    for(const row of db.prepare(`SELECT CASE WHEN expires_at<=? THEN 'expired' WHEN expires_at<=? THEN 'expiring' ELSE 'active' END AS status,
      COUNT(*) AS n FROM worker_competencies WHERE org_id=? AND site_id=? GROUP BY status`).all(now,cutoff,session.org_id,session.site_id))
      counts[row.status]=row.n;
    const like=`%${search.replace(/[\\%_]/g,'\\$&')}%`;
    const searchSql="(?='' OR w.name LIKE ? ESCAPE '\\' OR w.code LIKE ? ESCAPE '\\' OR c.title LIKE ? ESCAPE '\\')";
    const statusSql=status==='active' ? 'c.expires_at>?' : status==='expiring' ? 'c.expires_at>? AND c.expires_at<=?' : status==='expired' ? 'c.expires_at<=?' : '1=1';
    const statusArgs=status==='active' ? [cutoff] : status==='expiring' ? [now,cutoff] : status==='expired' ? [now] : [];
    const where=`${scope} AND ${statusSql} AND ${searchSql}`;
    const args=[session.org_id,session.site_id,...statusArgs,search,like,like,like];
    const total=db.prepare(`SELECT COUNT(*) AS n FROM worker_competencies c
      JOIN workers w ON w.id=c.worker_id AND w.org_id=c.org_id AND w.site_id=c.site_id WHERE ${where}`).get(...args).n;
    const order=status==='expired' ? 'c.expires_at DESC,c.id' : status==='all'
      ? 'CASE WHEN c.expires_at<=? THEN 1 ELSE 0 END,c.expires_at ASC,c.id' : 'c.expires_at ASC,c.id';
    const orderArgs=status==='all' ? [now] : [];
    const items=db.prepare(`SELECT c.*,w.name AS worker_name,w.code AS worker_code,b.title AS briefing_title,p.version AS publication_version,
      CASE WHEN c.expires_at<=? THEN 'expired' WHEN c.expires_at<=? THEN 'expiring' ELSE 'active' END AS status
      FROM worker_competencies c JOIN workers w ON w.id=c.worker_id AND w.org_id=c.org_id AND w.site_id=c.site_id
      JOIN briefings b ON b.id=c.briefing_id AND b.org_id=c.org_id AND b.site_id=c.site_id
      JOIN publications p ON p.id=c.publication_id AND p.org_id=c.org_id AND p.site_id=c.site_id
      WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`)
      .all(now,cutoff,...args,...orderArgs,pageSize,(page-1)*pageSize).map(competencyRow);
    return {items,total,page,pageSize,counts,asOf:now};
  });
}

export function workerCompetencies(db,session) {
  return transaction(db,()=>{
    workerAuthority(db,session);
    const now=NOW(),cutoff=new Date(Date.parse(now)+EXPIRING_DAYS*DAY_MS).toISOString();
    const items=db.prepare(`SELECT c.id,c.worker_id,c.briefing_id,c.publication_id,b.title AS briefing_title,p.version AS publication_version,
      c.title,c.language,c.source,c.awarded_at,c.expires_at,
      CASE WHEN c.expires_at<=? THEN 'expired' WHEN c.expires_at<=? THEN 'expiring' ELSE 'active' END AS status
      FROM worker_competencies c JOIN briefings b ON b.id=c.briefing_id AND b.org_id=c.org_id AND b.site_id=c.site_id
      JOIN publications p ON p.id=c.publication_id AND p.org_id=c.org_id AND p.site_id=c.site_id
      WHERE c.org_id=? AND c.site_id=? AND c.worker_id=? ORDER BY c.expires_at DESC,c.id`).all(now,cutoff,session.org_id,session.site_id,session.principal_id)
      .map(row=>({id:row.id,workerId:row.worker_id,briefingId:row.briefing_id,briefingTitle:row.briefing_title,publicationVersion:row.publication_version,
        title:row.title,language:row.language,source:row.source,awardedAt:row.awarded_at,expiresAt:row.expires_at,status:row.status}));
    return {items,asOf:now};
  });
}

export function awardCompetency(db,{orgId,siteId,workerId,assignmentId,attemptId,source}) {
  if(!['typed','audio'].includes(source)) return null;
  const row=db.prepare(`SELECT t.received_at,a.publication_id,a.worker_id,a.site_id,a.language,p.briefing_id,p.snapshot_json
    FROM attempts t JOIN assignments a ON a.id=t.assignment_id AND a.org_id=t.org_id AND a.site_id=?
    JOIN publications p ON p.id=a.publication_id AND p.org_id=a.org_id AND p.site_id=a.site_id
    WHERE t.id=? AND t.org_id=? AND t.assignment_id=? AND t.outcome='matched'`).get(siteId,attemptId,orgId,assignmentId);
  if(!row || row.worker_id!==workerId || row.site_id!==siteId) return null;
  const snapshot=JSON.parse(row.snapshot_json),config=snapshot?.competency;
  const validityDays=config?.validityDays;
  if(!Number.isSafeInteger(validityDays) || validityDays<1 || validityDays>3650
    || typeof config.title!=='string' || !config.title.trim() || config.title.length>120) return null;
  const awardedAt=row.received_at,expiresAt=new Date(Date.parse(awardedAt)+validityDays*DAY_MS).toISOString(),competencyId=randomUUID();
  const changed=db.prepare(`INSERT INTO worker_competencies(id,org_id,site_id,worker_id,briefing_id,publication_id,assignment_id,attempt_id,
    title,language,source,awarded_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(assignment_id) DO NOTHING`)
    .run(competencyId,orgId,siteId,workerId,row.briefing_id,row.publication_id,assignmentId,attemptId,
      config.title,row.language,source,awardedAt,expiresAt).changes;
  return changed ? {id:competencyId,title:config.title,expiresAt} : null;
}
