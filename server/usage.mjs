const unmanaged = Object.freeze({
  configured: false, state: 'unmanaged', effectiveState: 'unmanaged', writeAllowed: true,
  startedAt: null, endsAt: null, daysRemaining: null, workerLimit: null, plan: null,
  termsReference: null, revision: 0, request: null,
});

export function usageEntitlement(summary, activeWorkers = 0) {
  const value = summary ?? unmanaged;
  if (!Number.isSafeInteger(activeWorkers) || activeWorkers < 0) throw new Error('Invalid active worker count');
  return {
    activeWorkers,
    configured: value.configured,
    state: value.state,
    effectiveState: value.effectiveState,
    writeAllowed: value.writeAllowed,
    startedAt: value.startedAt,
    endsAt: value.endsAt,
    daysRemaining: value.daysRemaining,
    workerLimit: value.workerLimit,
    plan: value.plan,
    termsReference: value.termsReference,
    revision: value.revision,
    request: value.request ?? null,
  };
}

export function usageModel({ mode = 'synthetic-credential', metrics = null, latestPublication = null,providerAllowance=null,entitlement=null } = {}) {
  const values = metrics || { assigned: 0, responses: 0, matches: 0, clarifications: 0, pending: 0 };
  const synthetic = String(mode).startsWith('synthetic');
  const units = [
    { key: 'workers', label: 'Workers assigned', used: values.assigned, limit: values.assigned },
    { key: 'responses', label: 'Responses received', used: values.responses, limit: values.assigned },
    { key: 'matches', label: 'Matches', used: values.matches, limit: values.assigned },
    { key: 'clarifications', label: 'Clarifications', used: values.clarifications, limit: values.assigned },
    { key: 'pending', label: 'Pending responses', used: values.pending, limit: values.assigned },
  ].map((unit) => ({ ...unit, percent: unit.limit ? Math.min(100, Math.round(unit.used / unit.limit * 100)) : 0 }));
  return {
    mode,
    plan: { name: synthetic ? 'Synthetic pilot' : 'Configured plan', state: synthetic ? 'illustrative' : 'unverified', capabilities: ['briefings', 'worker responses', 'AI preparation'] },
    period: { label: 'Latest published briefing activity', startsAt: null, endsAt: null, reset: 'Not configured' },
    denominator: 'Assigned workers in this publication; these counts are not plan quotas.',
    units,
    spend: { estimated: { state: 'unknown', currency: 'USD', amount: null, evidence: 'No provider rate card or billable inference was used.' }, actual: { state: 'unknown', amount: null, evidence: 'Actual provider spend is unavailable until a verified provider and budget are configured.' } },
    controls: { quota: providerAllowance ? {state:'enforced',evidence:'Default-closed global and organization UTC request-slot admission policies are enforced; reservations are not invoices.'}
      : { state: 'not_configured', evidence: 'No live quota is enforced in this synthetic environment.' },
      pause: providerAllowance ? {state:'operator_managed',jobsPaused:providerAllowance.jobsPaused,providerPaused:providerAllowance.providerPaused,evidence:'Pause decisions are operator-managed. Customer access is read-only.'}
      : { state: 'unavailable', evidence: 'Provider job pause controls require a configured production integration.' } },
    publication: latestPublication ? { id: latestPublication.id, version: latestPublication.version, state: latestPublication.state } : null,
    providerAllowance,
    entitlement: entitlement ?? usageEntitlement(unmanaged),
  };
}
