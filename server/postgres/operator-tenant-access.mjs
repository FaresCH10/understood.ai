import {domainTransaction} from './domain.mjs';
import {requireOperatorInTransaction} from './operators.mjs';
import {lockOperationsGate} from './operations-gates.mjs';

export function tenantAccessFilters(input={}) {
  if(!input || typeof input!=='object' || Array.isArray(input)
    || Object.keys(input).some(key=>!['orgId','search','state','page','pageSize'].includes(key)))throw Error('Invalid operator filters');
  const {orgId}=input,search=input.search??'',state=input.state??'all',page=Number(input.page??1),pageSize=Number(input.pageSize??20);
  if(typeof orgId!=='string' || !orgId || orgId.length>100 || /[\x00-\x1f\x7f]/.test(orgId)
    || typeof search!=='string' || search.length>100 || /[\x00-\x1f\x7f]/.test(search)
    || !['all','enabled','disabled'].includes(state) || !Number.isInteger(page) || page<1 || page>5000
    || !Number.isInteger(pageSize) || pageSize<1 || pageSize>50)throw Error('Invalid operator filters');
  return {orgId,search:search.trim().toLowerCase(),state,page,pageSize};
}

export function operationsTenantAccess(pool,identity,input,{schema='public'}={}) {
  const f=tenantAccessFilters(input);
  return domainTransaction(pool,schema,async client=>{
    await requireOperatorInTransaction(client,identity);await lockOperationsGate(client);
    // One statement binds tenant status, page, counts and credential observations.
    const row=(await client.query(`WITH tenant AS (
      SELECT o.id,o.name,COALESCE(t.state,'active') AS state FROM organizations o
      LEFT JOIN tenant_controls t ON t.org_id=o.id WHERE o.id=$1),filtered AS (
      SELECT w.id,w.code AS reference,w.site_id AS "siteId",s.name AS "siteName",w.active AS enabled,
        COALESCE(l.state,'active') AS "siteState",COALESCE(a.state,'active') AS "admissionState"
      FROM workers w JOIN sites s ON s.id=w.site_id AND s.org_id=w.org_id
      LEFT JOIN site_lifecycle l ON l.site_id=w.site_id AND l.org_id=w.org_id
      LEFT JOIN site_access_controls a ON a.site_id=w.site_id AND a.org_id=w.org_id
      WHERE w.org_id=$1 AND (strpos(lower(w.code),$2)>0 OR strpos(lower(s.name),$2)>0)
        AND ($3='all' OR w.active=($3='enabled'))),paged AS (
      SELECT * FROM filtered ORDER BY lower(reference),id LIMIT $4 OFFSET $5),observed AS (
      SELECT p.*,
        GREATEST((SELECT MAX(g.redeemed_at) FROM worker_grants g WHERE g.org_id=$1 AND g.site_id=p."siteId"
          AND g.worker_id=p.id),(SELECT MAX(se.created_at) FROM sessions se WHERE se.org_id=$1
          AND se.site_id=p."siteId" AND se.principal_id=p.id AND se.principal_type='worker'
          AND se.access_mode='credential')) AS "lastSignInAt",
        CASE WHEN EXISTS(SELECT 1 FROM sessions se
          WHERE se.org_id=$1 AND se.site_id=p."siteId" AND se.principal_id=p.id AND se.principal_type='worker'
            AND se.access_mode='credential' AND se.revoked_at IS NULL AND se.expires_at>CURRENT_TIMESTAMP
            AND ((se.grant_id IS NOT NULL AND EXISTS(SELECT 1 FROM worker_grants g WHERE g.id=se.grant_id
              AND g.org_id=se.org_id AND g.site_id=se.site_id AND g.worker_id=se.principal_id
              AND g.redeemed_at IS NOT NULL AND g.revoked_at IS NULL AND g.expires_at>CURRENT_TIMESTAMP))
            OR (se.grant_id IS NULL AND se.credential_revision IS NOT NULL AND EXISTS(SELECT 1 FROM worker_credentials c
              WHERE c.worker_id=se.principal_id AND c.org_id=se.org_id AND c.site_id=se.site_id
              AND c.state='active' AND c.credential_revision=se.credential_revision))))
          THEN 'session_active'
          WHEN EXISTS(SELECT 1 FROM worker_grants g WHERE g.org_id=$1 AND g.site_id=p."siteId" AND g.worker_id=p.id
            AND g.redeemed_at IS NULL AND g.revoked_at IS NULL AND g.expires_at>CURRENT_TIMESTAMP) THEN 'link_available'
          ELSE 'no_current_access' END AS "credentialState"
      FROM paged p)
      SELECT t.id AS "orgId",t.name AS "tenantName",t.state AS "tenantState",CURRENT_TIMESTAMP AS "asOf",
        (SELECT COUNT(*)::int FROM filtered) AS total,
        (SELECT COALESCE(jsonb_agg(o ORDER BY lower(o.reference),o.id),'[]') FROM observed o) AS items
      FROM tenant t`,[f.orgId,f.search,f.state,f.pageSize,(f.page-1)*f.pageSize])).rows[0];
    if(!row)throw Error('Tenant unavailable');
    return {...row,asOf:new Date(row.asOf).toISOString(),page:f.page,pageSize:f.pageSize};
  });
}
