import { entitlementSummary, activationRequestSummary } from '../entitlement-model.mjs';

const scope = (orgId) => {
  if (typeof orgId !== 'string' || !orgId || orgId.length > 100) throw new Error('Invalid entitlement scope');
  return orgId;
};

export async function readEntitlement(client, orgId, { lock = false } = {}) {
  const row = (await client.query(`SELECT * FROM organization_entitlements WHERE org_id=$1${lock ? ' FOR UPDATE' : ''}`,
    [scope(orgId)])).rows[0];
  return row ?? null;
}

export async function entitlementState(client, orgId, { now = Date.now() } = {}) {
  const row = await readEntitlement(client, orgId);
  const pending = (await client.query(`SELECT * FROM organization_activation_requests
    WHERE org_id=$1 AND state='pending' ORDER BY created_at DESC,request_id DESC LIMIT 1`, [scope(orgId)])).rows[0];
  return { ...entitlementSummary(row, { now }), request: activationRequestSummary(pending) };
}

export async function requireWritableEntitlement(client, orgId, { now = Date.now(), lock = false } = {}) {
  const summary = entitlementSummary(await readEntitlement(client, orgId, { lock }), { now });
  if (!summary.writeAllowed) throw new Error('Workspace is read-only');
  return summary;
}
