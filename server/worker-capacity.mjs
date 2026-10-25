import {readEntitlement} from './entitlements.mjs';
import {entitlementSummary,assertWorkerCapacity} from './entitlement-model.mjs';

export function countActiveWorkers(db,orgId) {
  return db.prepare('SELECT COUNT(*) AS n FROM workers WHERE org_id=? AND active=1').get(orgId).n;
}

export function requireWorkerCapacity(db,orgId,additional=1) {
  const summary=entitlementSummary(readEntitlement(db,orgId));
  if(summary.workerLimit===null) return summary;
  assertWorkerCapacity(summary,countActiveWorkers(db,orgId),additional);
  return summary;
}
