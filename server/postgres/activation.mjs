import {domainTransaction,domainAudit,requirePrincipal} from './domain.mjs';
import {reviewRequestId} from '../briefing-input.mjs';
import {activationRequestInput,sameActivationRequest} from '../activation-request-input.mjs';
import {readEntitlement} from './entitlements.mjs';

const roles=['owner','administrator'];
const iso=value=>value==null?null:new Date(value).toISOString();
const view=row=>({
  requestId:row.request_id,
  request:{note:row.note ?? null,confirmed:true},
  createdAt:iso(row.created_at),
  state:row.state,
  decidedAt:iso(row.decided_at),
  decisionRef:row.decision_ref ?? null,
  delivery:'platform_operations',
  changesApplied:false,
});

function requesterReceipt(client,session,id) {
  return client.query(`SELECT * FROM organization_activation_requests
    WHERE request_id=$1 AND org_id=$2 AND site_id=$3 AND requested_by=$4`,[id,session.org_id,session.site_id,session.principal_id])
    .then(result=>result.rows[0] ?? null);
}

export function saveActivationRequest(pool,session,input,{schema='public'}={}) {
  const value=activationRequestInput(input);
  return domainTransaction(pool,schema,async client=>{
    await requirePrincipal(client,session,'staff',roles);
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`activation-request:${session.org_id}`]);
    const old=await requesterReceipt(client,session,input.requestId);
    if(old) {
      if(!sameActivationRequest({note:old.note ?? null,confirmed:true},value))throw Error('Activation request conflict');
      return {...view(old),duplicate:true};
    }
    if((await client.query("SELECT 1 FROM organization_activation_requests WHERE org_id=$1 AND state='pending'",[session.org_id])).rows.length)
      throw Error('Activation request already pending');
    const entitlementRevision=(await readEntitlement(client,session.org_id))?.revision ?? 0;
    let row;
    try {
      row=(await client.query(`INSERT INTO organization_activation_requests
        (request_id,org_id,site_id,requested_by,note,entitlement_revision,state,created_at)
        VALUES($1,$2,$3,$4,$5,$6,'pending',clock_timestamp()) RETURNING *`,
      [input.requestId,session.org_id,session.site_id,session.principal_id,value.note,entitlementRevision])).rows[0];
    } catch(error) {
      if(error.code==='23505' && error.constraint==='organization_activation_requests_pending')throw Error('Activation request already pending');
      if(error.code==='23505')throw Error('Activation request conflict');
      throw error;
    }
    await domainAudit(client,session,'entitlement.activation_requested',input.requestId);
    return {...view(row),duplicate:false};
  });
}

export function activationRequestReceipt(pool,session,id,{schema='public'}={}) {
  try {reviewRequestId(id);} catch {throw Error('Invalid activation request');}
  return domainTransaction(pool,schema,async client=>{
    await requirePrincipal(client,session,'staff',roles);
    const row=await requesterReceipt(client,session,id);
    return row?{...view(row),found:true}:{found:false};
  });
}
