import { entitlementSummary, activationRequestSummary } from './entitlement-model.mjs';
import {pendingWorkspaceState} from './pilot-policy.mjs';

export { ensureEntitlementSchema } from './entitlement-schema.mjs';

const scope = (orgId) => {
  if (typeof orgId !== 'string' || !orgId || orgId.length > 100) throw new Error('Invalid entitlement scope');
  return orgId;
};

export function readEntitlement(db, orgId) {
  return db.prepare('SELECT * FROM organization_entitlements WHERE org_id=?').get(scope(orgId)) ?? null;
}
export function workspaceAccessState(db,orgId){
  const row=db.prepare(`SELECT e.plan,(SELECT a.state FROM organization_activation_requests a
    WHERE a.org_id=e.org_id AND a.entitlement_revision=e.revision ORDER BY a.created_at DESC,a.request_id DESC LIMIT 1) AS decision
    FROM organization_entitlements e WHERE e.org_id=?`).get(scope(orgId));
  return pendingWorkspaceState(row?.plan,row?.decision);
}

export function entitlementState(db, orgId, { now = Date.now() } = {}) {
  const row = readEntitlement(db, orgId);
  const pending = db.prepare(`SELECT * FROM organization_activation_requests
    WHERE org_id=? AND state='pending' ORDER BY created_at DESC,request_id DESC LIMIT 1`).get(scope(orgId));
  return { ...entitlementSummary(row, { now }), request: activationRequestSummary(pending) };
}

export function requireWritableEntitlement(db, orgId, { now = Date.now() } = {}) {
  const summary = entitlementSummary(readEntitlement(db, orgId), { now });
  if (!summary.writeAllowed) throw new Error('Workspace is read-only');
  return summary;
}
