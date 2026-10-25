import {readEntitlement} from './entitlements.mjs';
import {entitlementSummary,assertWorkerCapacity} from '../entitlement-model.mjs';

export async function countActiveWorkers(client,orgId) {
  return (await client.query('SELECT count(*)::int AS n FROM workers WHERE org_id=$1 AND active=true',[orgId])).rows[0].n;
}

export async function requireWorkerCapacity(client,orgId,additional=1) {
  const initial=entitlementSummary(await readEntitlement(client,orgId));
  if(initial.workerLimit===null) return initial;
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended(
    coalesce(current_schema(),'')||':worker-capacity:'||$1,0))`,[orgId]);
  const summary=entitlementSummary(await readEntitlement(client,orgId));
  if(summary.workerLimit===null) return summary;
  assertWorkerCapacity(summary,await countActiveWorkers(client,orgId),additional);
  return summary;
}
