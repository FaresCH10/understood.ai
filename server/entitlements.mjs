import { entitlementSummary, activationRequestSummary } from './entitlement-model.mjs';

export { ensureEntitlementSchema } from './entitlement-schema.mjs';

const scope = (orgId) => {
  if (typeof orgId !== 'string' || !orgId || orgId.length > 100) throw new Error('Invalid entitlement scope');
  return orgId;
};

export function readEntitlement(db, orgId) {
  return db.prepare('SELECT * FROM organization_entitlements WHERE org_id=?').get(scope(orgId)) ?? null;
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
