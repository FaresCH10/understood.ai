import {domainTransaction} from './domain.mjs';
import {requireOperatorInTransaction,operatorAudit} from './operators.mjs';
import {operatorEntitlementInput} from '../operator-input.mjs';
import {lockOperationsGate} from './operations-gates.mjs';
import {usageEntitlement} from '../usage.mjs';
import {entitlementSummary,activationRequestSummary} from '../entitlement-model.mjs';

const entitlementStates=['all','unmanaged','trial','active','read_only'];

function entitlementFilters(input={}) {
  if(!input || typeof input!=='object' || Array.isArray(input)
    || Object.keys(input).some(key=>!['search','state','page','pageSize'].includes(key)))throw Error('Invalid operator filters');
  const search=input.search ?? '',page=Number(input.page ?? 1),pageSize=Number(input.pageSize ?? 20),state=input.state ?? 'all';
  if(typeof search!=='string' || search.length>100 || /[\x00-\x1f\x7f]/.test(search)
    || !Number.isInteger(page) || page<1 || page>5000 || !Number.isInteger(pageSize) || pageSize<1 || pageSize>50
    || !entitlementStates.includes(state))throw Error('Invalid operator filters');
  return {search:search.trim().toLowerCase(),state,page,pageSize};
}

export function operationsEntitlements(pool,identity,input={},{schema='public'}={}) {
  const f=entitlementFilters(input);
  return domainTransaction(pool,schema,async client=>{
    await requireOperatorInTransaction(client,identity);
    const where="(strpos(lower(o.name),$1)>0 OR strpos(lower(o.id),$1)>0) AND ($2='all' OR COALESCE(e.state,'unmanaged')=$2)",args=[f.search,f.state];
    const total=(await client.query(`SELECT COUNT(*)::int AS n FROM organizations o
      LEFT JOIN organization_entitlements e ON e.org_id=o.id WHERE ${where}`,args)).rows[0].n;
    const rows=(await client.query(`SELECT o.id AS org_id,o.name,
      e.state,e.started_at,e.ends_at,e.worker_limit,e.plan,e.terms_reference,e.revision,
      r.request_id,r.site_id AS request_site_id,r.requested_by,r.note,r.entitlement_revision,r.state AS request_state,
      r.created_at AS request_created_at,r.decided_at AS request_decided_at,r.decision_ref AS request_decision_ref,
      (SELECT COUNT(*)::int FROM workers w WHERE w.org_id=o.id AND w.active=true) AS active_workers
      FROM organizations o
      LEFT JOIN organization_entitlements e ON e.org_id=o.id
      LEFT JOIN LATERAL (SELECT * FROM organization_activation_requests ar WHERE ar.org_id=o.id AND ar.state='pending'
        ORDER BY ar.created_at DESC,ar.request_id DESC LIMIT 1) r ON true
      WHERE ${where} ORDER BY lower(o.name),o.id LIMIT $3 OFFSET $4`,[...args,f.pageSize,(f.page-1)*f.pageSize])).rows;
    const now=Date.now(),items=rows.map(row=>{
      const summary=entitlementSummary(row.state===null?null:row,{now});
      const request=row.request_id?activationRequestSummary({
        request_id:row.request_id,state:row.request_state,note:row.note,entitlement_revision:row.entitlement_revision,
        created_at:row.request_created_at,decided_at:row.request_decided_at,decision_ref:row.request_decision_ref,
      }):null;
      return {orgId:row.org_id,name:row.name,
        entitlement:usageEntitlement({...summary,request},row.active_workers),
        requestedBy:row.requested_by ?? null,requestSiteId:row.request_site_id ?? null};
    });
    return {items,total,page:f.page,pageSize:f.pageSize};
  });
}

async function replay(client,actor,input,value) {
  const old=(await client.query('SELECT *,request_json=$2::jsonb AS matches FROM operator_requests WHERE request_id=$1',
    [input.requestId,JSON.stringify(value)])).rows[0];
  if(old) {
    if(old.operator_id!==actor.operator_id || !old.matches)throw Error('Operator request conflict');
    return {...old.result_json,duplicate:true};
  }
  if((await client.query('SELECT 1 FROM provider_verifications WHERE request_id=$1',[input.requestId])).rows.length)
    throw Error('Operator request conflict');
  return null;
}

function results(target) {
  return target.rowCount===1;
}

export function saveOperatorEntitlement(pool,identity,input,{schema='public'}={}) {
  const value=operatorEntitlementInput(input);
  return domainTransaction(pool,schema,async client=>{
    const actor=await requireOperatorInTransaction(client,identity);await lockOperationsGate(client,true);
    const old=await replay(client,actor,input,value);if(old)return old;
    if(value.endsAt!==null && Date.parse(value.endsAt)<=Date.now())throw Error('Invalid entitlement expiry');
    if(!(await client.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[value.orgId])).rows.length)throw Error('Tenant unavailable');
    const current=(await client.query('SELECT * FROM organization_entitlements WHERE org_id=$1 FOR UPDATE',[value.orgId])).rows[0];
    if((current?.revision ?? 0)!==value.revision)throw Error('Operator revision changed');
    let activation=null;
    if(value.activationRequestId) {
      activation=(await client.query(`SELECT * FROM organization_activation_requests WHERE request_id=$1 AND org_id=$2 FOR UPDATE`,
        [value.activationRequestId,value.orgId])).rows[0];
      if(!activation || activation.state!=='pending')throw Error('Activation request unavailable');
    }else if(value.state!=='read_only') {
      activation=(await client.query(`SELECT * FROM organization_activation_requests WHERE org_id=$1 AND state='pending'
        ORDER BY created_at DESC,request_id DESC LIMIT 1 FOR UPDATE`,[value.orgId])).rows[0] ?? null;
    }
    const revision=value.revision+1,startedAt=current?.started_at ?? new Date();
    if(current) {
      await client.query(`UPDATE organization_entitlements SET state=$2,started_at=$3,ends_at=$4,worker_limit=$5,plan=$6,
        terms_reference=$7,revision=$8,updated_by=$9,updated_at=clock_timestamp() WHERE org_id=$1`,
      [value.orgId,value.state,startedAt,value.endsAt,value.workerLimit,value.plan,value.termsReference,revision,actor.operator_id]);
    }else {
      await client.query(`INSERT INTO organization_entitlements
        (org_id,state,started_at,ends_at,worker_limit,plan,terms_reference,revision,updated_by,updated_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,clock_timestamp())`,
      [value.orgId,value.state,startedAt,value.endsAt,value.workerLimit,value.plan,value.termsReference,revision,actor.operator_id]);
    }
    await client.query(`INSERT INTO organization_entitlement_transitions
      (org_id,revision,state,started_at,ends_at,worker_limit,plan,terms_reference,reason,actor_type,actor_id,request_id,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'operator',$10,$11,clock_timestamp())`,
    [value.orgId,revision,value.state,startedAt,value.endsAt,value.workerLimit,value.plan,value.termsReference,value.reason,actor.operator_id,input.requestId]);
    if(activation) {
      const changed=await client.query(`UPDATE organization_activation_requests SET state='accepted',decided_at=clock_timestamp(),
        decided_by=$3,decision_ref=$4 WHERE request_id=$1 AND org_id=$2 AND state='pending'`,
      [activation.request_id,value.orgId,actor.operator_id,input.requestId]);
      if(!results(changed))throw Error('Activation request is closed');
    }
    const result={kind:'entitlement',orgId:value.orgId,revision,state:value.state,endsAt:value.endsAt,workerLimit:value.workerLimit,
      plan:value.plan,termsReference:value.termsReference,activationRequestId:activation?.request_id ?? null};
    await operatorAudit(client,actor.operator_id,`entitlement.${value.state}`,'organization',value.orgId);
    if(activation)await operatorAudit(client,actor.operator_id,'activation.accepted','organization_activation_request',activation.request_id);
    await client.query('INSERT INTO operator_requests(request_id,operator_id,request_json,result_json) VALUES($1,$2,$3,$4)',
      [input.requestId,actor.operator_id,JSON.stringify(value),JSON.stringify(result)]);
    return {...result,duplicate:false};
  });
}

export function saveActivationDecision(pool,identity,input,{schema='public'}={}) {
  const value=operatorEntitlementInput(input);
  return domainTransaction(pool,schema,async client=>{
    const actor=await requireOperatorInTransaction(client,identity);await lockOperationsGate(client,true);
    const old=await replay(client,actor,input,value);if(old)return old;
    const request=(await client.query(`SELECT * FROM organization_activation_requests WHERE request_id=$1 AND org_id=$2 FOR UPDATE`,
      [value.activationRequestId,value.orgId])).rows[0];
    if(!request)throw Error('Activation request unavailable');
    if(request.state!=='pending')throw Error('Activation request is closed');
    const changed=await client.query(`UPDATE organization_activation_requests SET state='declined',decided_at=clock_timestamp(),
      decided_by=$3,decision_ref=$4 WHERE request_id=$1 AND org_id=$2 AND state='pending'`,
    [request.request_id,value.orgId,actor.operator_id,input.requestId]);
    if(!results(changed))throw Error('Activation request is closed');
    const result={kind:'activation-decision',orgId:value.orgId,activationRequestId:request.request_id,state:'declined'};
    await operatorAudit(client,actor.operator_id,'activation.declined','organization_activation_request',request.request_id);
    await client.query('INSERT INTO operator_requests(request_id,operator_id,request_json,result_json) VALUES($1,$2,$3,$4)',
      [input.requestId,actor.operator_id,JSON.stringify(value),JSON.stringify(result)]);
    return {...result,duplicate:false};
  });
}
