import { responseRead } from './responses.mjs';
import { requirePrincipal } from './domain.mjs';
import { publicationResponses } from './reports.mjs';
import { metricsFromResponses } from '../domain.mjs';
import { usageModel,usageEntitlement } from '../usage.mjs';
import { entitlementState } from './entitlements.mjs';
import { countActiveWorkers } from './worker-capacity.mjs';

async function readProviderAllowance(client,orgId) {
  const day=(await client.query("SELECT (clock_timestamp() AT TIME ZONE 'UTC')::date::text AS day")).rows[0].day;
  const policies=(await client.query('SELECT scope_key,enabled,max_daily_requests FROM provider_policies WHERE scope_key=ANY($1::text[])',[['global',`tenant:${orgId}`]])).rows;
  const global=policies.find(row=>row.scope_key==='global'),tenant=policies.find(row=>row.scope_key===`tenant:${orgId}`);
  const usage=(await client.query(`SELECT COALESCE(SUM(reserved_requests),0)::int AS global,
    COALESCE(SUM(reserved_requests) FILTER(WHERE org_id=$2),0)::int AS tenant
    FROM provider_operations WHERE quota_day=$1::date`,[day,orgId])).rows[0];
  const requests=(await client.query(`SELECT r.state,COUNT(*)::int AS count FROM provider_requests r
    JOIN provider_operations o ON o.id=r.operation_id WHERE o.org_id=$1 AND o.quota_day=$2::date GROUP BY r.state`,[orgId,day])).rows;
  const controls=(await client.query("SELECT jobs_paused,provider_paused FROM system_controls WHERE id='global'")).rows[0];
  const limit=tenant?.max_daily_requests ?? 0,remaining=Math.max(0,limit-usage.tenant);
  const reason=!global?.enabled || !tenant?.enabled?'quota_closed':controls?.jobs_paused?'jobs_paused':controls?.provider_paused?'provider_paused'
    :remaining===0 || usage.global>=global.max_daily_requests?'daily_allowance_exhausted':'available';
  // Global usage is admission evidence only; never project another organization's usage or operation identities.
  return {day,timezone:'UTC',resetsAt:new Date(Date.parse(`${day}T00:00:00.000Z`)+86400000).toISOString(),
    state:reason==='quota_closed'?'closed':reason==='available'?'available':reason==='daily_allowance_exhausted'?'exhausted':'paused',reason,
    limit,reserved:usage.tenant,remaining,requests:Object.fromEntries(['started','accepted','rejected','uncertain'].map(state=>[state,requests.find(row=>row.state===state)?.count ?? 0])),
    jobsPaused:Boolean(controls?.jobs_paused),providerPaused:Boolean(controls?.provider_paused),dataClass:'synthetic',billingVerified:false};
}

export function getUsage(pool, session, { schema = 'public' } = {}) {
  return responseRead(pool, schema, async (client) => {
    await requirePrincipal(client, session, 'staff', ['owner', 'administrator', 'supervisor', 'auditor']);
    const publication = (await client.query(`SELECT id,version,state FROM publications WHERE org_id=$1 AND site_id=$2 AND state='published' ORDER BY published_at DESC,id LIMIT 1`, [session.org_id, session.site_id])).rows[0] || null;
    const metrics = publication ? metricsFromResponses(await publicationResponses(client, session, publication.id)) : null;
    const entitlement=usageEntitlement(await entitlementState(client,session.org_id),await countActiveWorkers(client,session.org_id));
    return {...usageModel({ mode: 'synthetic-credential', metrics, latestPublication: publication,providerAllowance:await readProviderAllowance(client,session.org_id),entitlement }),changeRequestsAvailable:['owner','administrator','supervisor'].includes(session.role)};
  });
}
