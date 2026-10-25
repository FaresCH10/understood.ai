export const ENTITLEMENT_STATES = Object.freeze(['trial', 'active', 'read_only']);
export const ENTITLEMENT_ACTOR_TYPES = Object.freeze(['operator', 'system', 'registration']);

const iso = (value) => value == null ? null : value instanceof Date ? value.toISOString() : String(value);

export function entitlementSummary(row, { now = Date.now() } = {}) {
  if (!row) {
    return {
      configured: false, state: 'unmanaged', effectiveState: 'unmanaged', writeAllowed: true,
      startedAt: null, endsAt: null, daysRemaining: null, workerLimit: null, plan: null,
      termsReference: null, revision: 0,
    };
  }
  const startedAt = iso(row.started_at), endsAt = iso(row.ends_at);
  const end = endsAt === null ? null : Date.parse(endsAt);
  if (end !== null && !Number.isFinite(end)) throw new Error('Entitlement date is invalid');
  const expired = end !== null && end <= now;
  const effectiveState = row.state === 'read_only' || expired ? 'read_only' : row.state;
  return {
    configured: true, state: row.state, effectiveState, writeAllowed: effectiveState !== 'read_only',
    startedAt, endsAt, daysRemaining: end === null ? null : Math.max(0, Math.ceil((end - now) / 86400000)),
    workerLimit: row.worker_limit, plan: row.plan, termsReference: row.terms_reference ?? null,
    revision: row.revision,
  };
}

export function assertWorkerCapacity(summary, activeWorkers, additional = 1) {
  if (summary.workerLimit === null) return;
  if (!Number.isInteger(activeWorkers) || activeWorkers < 0 || !Number.isInteger(additional) || additional < 1)
    throw new Error('Invalid worker count');
  if (activeWorkers + additional > summary.workerLimit)
    throw new Error(`Worker capacity reached (${summary.workerLimit} active workers). Disable a worker or ask your administrator to raise the limit.`);
}

export function activationRequestSummary(row) {
  if (!row) return null;
  return {
    id: row.request_id, state: row.state, note: row.note ?? null,
    entitlementRevision: row.entitlement_revision, requestedAt: iso(row.created_at),
    decidedAt: iso(row.decided_at), decisionRef: row.decision_ref ?? null,
  };
}
