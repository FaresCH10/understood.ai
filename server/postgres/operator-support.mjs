import {domainTransaction} from './domain.mjs';
import {requireOperatorInTransaction,operatorAudit} from './operators.mjs';
import {lockOperationsGate} from './operations-gates.mjs';
import {operatorSessionRevocationInput} from '../operator-input.mjs';

const boundedText=value=>typeof value==='string' && value.length>0 && value.length<=100 && !/[\x00-\x1f\x7f]/.test(value);

export function operatorAccountFilters(input={}) {
  if(!input || typeof input!=='object' || Array.isArray(input)
    || Object.keys(input).some(key=>!['orgId','search','principalType','state','page','pageSize'].includes(key)))throw Error('Invalid operator filters');
  const {orgId}=input,search=input.search??'',principalType=input.principalType??'all',state=input.state??'all',page=Number(input.page??1),pageSize=Number(input.pageSize??20);
  if(!boundedText(orgId) || typeof search!=='string' || search.length>100 || /[\x00-\x1f\x7f]/.test(search)
    || !['all','staff','worker'].includes(principalType) || !['all','enabled','disabled'].includes(state)
    || !Number.isInteger(page) || page<1 || page>5000 || !Number.isInteger(pageSize) || pageSize<1 || pageSize>50)
    throw Error('Invalid operator filters');
  return {orgId,search:search.trim().toLowerCase(),principalType,state,page,pageSize};
}

// References deliberately exclude staff names/email, credentials and customer content.
const accountDirectory=`SELECT id,org_id,site_id,'staff' AS principal_type,id AS reference,role,active FROM staff
  UNION ALL SELECT id,org_id,site_id,'worker',code,'worker',active FROM workers`;

export function operationsSupportAccounts(pool,identity,input,{schema='public'}={}) {
  const f=operatorAccountFilters(input);
  return domainTransaction(pool,schema,async client=>{
    await requireOperatorInTransaction(client,identity);await lockOperationsGate(client);
    const row=(await client.query(`WITH tenant AS (
      SELECT o.id,o.name,COALESCE(t.state,'active') AS state FROM organizations o
      LEFT JOIN tenant_controls t ON t.org_id=o.id WHERE o.id=$1),filtered AS (
      SELECT p.id,p.reference,p.principal_type AS "principalType",p.role,p.active AS enabled,
        p.site_id AS "siteId",s.name AS "siteName",COALESCE(l.state,'active') AS "siteState",
        COALESCE(a.state,'active') AS "admissionState"
      FROM (${accountDirectory}) p JOIN sites s ON s.id=p.site_id AND s.org_id=p.org_id
      LEFT JOIN site_lifecycle l ON l.site_id=p.site_id AND l.org_id=p.org_id
      LEFT JOIN site_access_controls a ON a.site_id=p.site_id AND a.org_id=p.org_id
      WHERE p.org_id=$1 AND (strpos(lower(p.reference),$2)>0 OR strpos(lower(s.name),$2)>0)
        AND ($3='all' OR p.principal_type=$3) AND ($4='all' OR p.active=($4='enabled'))),paged AS (
      SELECT * FROM filtered ORDER BY "principalType",lower(reference),"siteId",id LIMIT $5 OFFSET $6),observed AS (
      SELECT p.*,(SELECT COUNT(*)::int FROM sessions se WHERE se.org_id=$1 AND se.site_id=p."siteId"
        AND se.principal_type=p."principalType" AND se.principal_id=p.id
        AND se.revoked_at IS NULL AND se.expires_at>CURRENT_TIMESTAMP) AS "activeSessionCount" FROM paged p)
      SELECT t.id AS "orgId",t.name AS "tenantName",t.state AS "tenantState",CURRENT_TIMESTAMP AS "asOf",
        (SELECT COUNT(*)::int FROM filtered) AS total,
        (SELECT COALESCE(jsonb_agg(o ORDER BY o."principalType",lower(o.reference),o."siteId",o.id),'[]') FROM observed o) AS items
      FROM tenant t`,[f.orgId,f.search,f.principalType,f.state,f.pageSize,(f.page-1)*f.pageSize])).rows[0];
    if(!row)throw Error('Tenant unavailable');
    return {...row,asOf:new Date(row.asOf).toISOString(),page:f.page,pageSize:f.pageSize};
  });
}

export function revokeOperationsAccountSessions(pool,identity,input,{schema='public'}={}) {
  const value=operatorSessionRevocationInput(input);
  return domainTransaction(pool,schema,async client=>{
    const actor=await requireOperatorInTransaction(client,identity);await lockOperationsGate(client,true);
    const old=(await client.query('SELECT operator_id,request_json=$2::jsonb AS matches,result_json FROM operator_requests WHERE request_id=$1',
      [input.requestId,JSON.stringify(value)])).rows[0];
    if(old){if(old.operator_id!==actor.operator_id || !old.matches)throw Error('Operator request conflict');return {...old.result_json,duplicate:true};}
    if((await client.query('SELECT 1 FROM provider_verifications WHERE request_id=$1',[input.requestId])).rows.length)throw Error('Operator request conflict');
    const table=value.principalType==='staff'?'staff':'workers';
    if(!(await client.query(`SELECT id FROM ${table} WHERE id=$1 AND org_id=$2 AND site_id=$3`,
      [value.principalId,value.orgId,value.siteId])).rows.length)throw Error('Account unavailable');
    // Customer session creation takes the shared operations gate. The exclusive
    // gate binds this count to the subsequent revocation without reading tokens.
    const args=[value.orgId,value.siteId,value.principalType,value.principalId];
    const predicate='org_id=$1 AND site_id=$2 AND principal_type=$3 AND principal_id=$4 AND revoked_at IS NULL AND expires_at>CURRENT_TIMESTAMP';
    const count=(await client.query(`SELECT COUNT(*)::int AS count FROM sessions WHERE ${predicate}`,args)).rows[0].count;
    if(count!==value.expectedSessionCount)throw Error('Account sessions changed');
    const revoked=(await client.query(`UPDATE sessions SET revoked_at=clock_timestamp() WHERE ${predicate} RETURNING principal_id`,args)).rows.length;
    // A concurrent customer sign-out must not turn a stale observation into a
    // successful command. Throwing also rolls back this command's partial work.
    if(revoked!==value.expectedSessionCount)throw Error('Account sessions changed');
    const result={kind:value.kind,orgId:value.orgId,siteId:value.siteId,principalType:value.principalType,
      principalId:value.principalId,revokedSessionCount:revoked};
    await client.query('INSERT INTO operator_requests(request_id,operator_id,request_json,result_json) VALUES($1,$2,$3,$4)',
      [input.requestId,actor.operator_id,JSON.stringify(value),JSON.stringify(result)]);
    await operatorAudit(client,actor.operator_id,'account.sessions_revoked','customer_account',
      JSON.stringify([value.orgId,value.siteId,value.principalType,value.principalId]));
    return {...result,duplicate:false};
  });
}
