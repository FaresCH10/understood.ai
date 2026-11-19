import {isPendingWorkspacePlan} from '../pilot-policy.mjs';

// A signed, current sandbox receipt permits browsing only. It never changes an
// entitlement or grants provider spending authority.
export async function sandboxDashboardAccess(client,orgId){
  return (await client.query(`SELECT EXISTS(
    SELECT 1 FROM subscription_allowance_grants g
    JOIN subscription_checkouts c ON c.request_id=g.request_id AND c.org_id=g.org_id
    JOIN organization_entitlements e ON e.org_id=g.org_id
    WHERE g.org_id=$1 AND g.funding_state='sandbox_only' AND c.environment='sandbox'
      AND c.state='completed' AND c.transaction_id=g.transaction_id
      AND e.state='read_only' AND e.plan=g.plan||'_pending'
      AND (e.ends_at IS NULL OR e.ends_at>clock_timestamp())
      AND NOT EXISTS(SELECT 1 FROM organization_activation_requests a
        WHERE a.org_id=e.org_id AND a.entitlement_revision=e.revision AND a.state='declined')
      AND g.period_start<=clock_timestamp() AND g.period_end>clock_timestamp()
  ) AS available`,[orgId])).rows[0].available===true;
}

export async function sessionSandboxDashboard(client,session){
  return session.principal_type==='staff'&&isPendingWorkspacePlan(session.workspace_plan)
    &&await sandboxDashboardAccess(client,session.org_id);
}

export function sandboxDashboardReadAllowed(path,method){
  // Some GET endpoints drain provider queues. Do not expose them in a preview.
  return method==='GET'&&!/^\/api\/(?:source-audio|processing|worker|exports)(?:\/|$)/.test(path)
    &&!/^\/api\/(?:reports\/exports|instructions\/sends)(?:\/|$)/.test(path);
}
