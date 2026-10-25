import {randomUUID} from 'node:crypto';
import {transaction,NOW} from './db.mjs';
import {reviewRequestId} from './briefing-input.mjs';
import {activationRequestInput,sameActivationRequest} from './activation-request-input.mjs';
import {readEntitlement} from './entitlements.mjs';

const roles=['owner','administrator'];

function requireRequester(db,session) {
  if(session?.principal_type!=='staff' || !roles.includes(session.role))throw Error('Forbidden');
  if(!db.prepare('SELECT 1 FROM staff WHERE id=? AND org_id=? AND site_id=? AND role=? AND active=1')
    .get(session.principal_id,session.org_id,session.site_id,session.role))throw Error('Forbidden');
}

const view=row=>({
  requestId:row.request_id,
  request:{note:row.note ?? null,confirmed:true},
  createdAt:row.created_at,
  state:row.state,
  decidedAt:row.decided_at ?? null,
  decisionRef:row.decision_ref ?? null,
  delivery:'platform_operations',
  changesApplied:false,
});

function requesterReceipt(db,session,id) {
  return db.prepare(`SELECT * FROM organization_activation_requests
    WHERE request_id=? AND org_id=? AND site_id=? AND requested_by=?`)
    .get(id,session.org_id,session.site_id,session.principal_id);
}

export function saveActivationRequest(db,session,input) {
  const value=activationRequestInput(input);
  return transaction(db,()=>{
    requireRequester(db,session);
    const old=requesterReceipt(db,session,input.requestId);
    if(old) {
      if(!sameActivationRequest({note:old.note ?? null,confirmed:true},value))throw Error('Activation request conflict');
      return {...view(old),duplicate:true};
    }
    if(db.prepare("SELECT 1 FROM organization_activation_requests WHERE org_id=? AND state='pending'").get(session.org_id))
      throw Error('Activation request already pending');
    const createdAt=NOW(), entitlementRevision=readEntitlement(db,session.org_id)?.revision ?? 0;
    try {
      db.prepare(`INSERT INTO organization_activation_requests
        VALUES(?,?,?,?,?,?,'pending',?,NULL,NULL,NULL)`)
        .run(input.requestId,session.org_id,session.site_id,session.principal_id,value.note,entitlementRevision,createdAt);
    } catch(error) {
      if(/UNIQUE|constraint/i.test(String(error?.message)))throw Error('Activation request already pending');
      throw error;
    }
    db.prepare('INSERT INTO audit VALUES(?,?,?,?,?,?,?,?)')
      .run(randomUUID(),session.org_id,session.site_id,'staff',session.principal_id,'entitlement.activation_requested',input.requestId,NOW());
    return {...view(requesterReceipt(db,session,input.requestId)),duplicate:false};
  });
}

export function activationRequestReceipt(db,session,id) {
  try {reviewRequestId(id);} catch {throw Error('Invalid activation request');}
  return transaction(db,()=>{
    requireRequester(db,session);
    const row=requesterReceipt(db,session,id);
    return row?{...view(row),found:true}:{found:false};
  });
}
