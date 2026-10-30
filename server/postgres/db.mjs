import { readFileSync } from 'node:fs';

const connectionStates = new WeakMap(), leases = new WeakMap(), guardedPools = new WeakMap();
function connectionState(client) {
  let state = connectionStates.get(client);
  if (!state) {
    state = { failed: false, pools: new Set() };
    connectionStates.set(client, state);
    // Keep one listener for the socket lifetime, including late errors after release.
    client.on?.('error', () => { state.failed = true; for (const pool of state.pools) pool.failed = true; });
    client.on?.('end', () => { state.failed = true; });
  }
  return state;
}
function connectionLost() {
  return Object.assign(new Error('PostgreSQL connection lost; operation outcome must be reconciled'), { code: 'UNDERSTOOD_PG_CONNECTION_LOST' });
}
export function guardPostgresPool(pool) {
  if (!guardedPools.has(pool)) {
    const state = { failed: false };
    guardedPools.set(pool, state);
    pool.on?.('connect', client => { connectionState(client).pools.add(state); });
    pool.on?.('error', () => { state.failed = true; });
  }
  return pool;
}
export function assertPostgresPoolHealthy(pool) {
  if (guardedPools.get(pool)?.failed) throw connectionLost();
}
export async function acquirePostgresClient(pool) {
  guardPostgresPool(pool);
  const client = await pool.connect(), state = connectionState(client);
  state.pools.add(guardedPools.get(pool));
  let released = false;
  const healthy = () => {
    if (released) throw new Error('PostgreSQL lease already released');
    if (state.failed) throw connectionLost();
  };
  const lease = new Proxy(client, { get(target, key) {
    if (key === 'query') return async (...args) => {
      healthy();
      let result;
      try { result = await target.query(...args); } catch (error) { if (state.failed) throw connectionLost(); throw error; }
      healthy();
      return result;
    };
    if (key === 'release') return error => {
      if (released) throw new Error('PostgreSQL lease already released');
      released = true;
      target.release(state.failed || error || undefined);
    };
    const value = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  leases.set(lease, healthy);
  try { healthy(); } catch (error) { lease.release(true); throw error; }
  return lease;
}
export function assertPostgresClientHealthy(client) {
  const healthy = leases.get(client);
  if (!healthy) throw new Error('PostgreSQL guarded lease required');
  healthy();
}
export async function withPostgresClient(pool, fn) {
  const client = await acquirePostgresClient(pool);
  try {
    const result = await fn(client);
    assertPostgresClientHealthy(client);
    return result;
  } finally { client.release(); }
}

export async function createPostgresPool({ connectionString = process.env.UNDERSTOOD_POSTGRES_URL || process.env.DATABASE_URL,
  tls = process.env.UNDERSTOOD_POSTGRES_TLS === 'true' || (!process.env.UNDERSTOOD_POSTGRES_URL && !!process.env.DATABASE_URL), caFile = process.env.UNDERSTOOD_POSTGRES_CA_FILE } = {}) {
  if (!connectionString) throw new Error('UNDERSTOOD_POSTGRES_URL is required');
  let url;
  try { url = new URL(connectionString); } catch { throw new Error('Invalid PostgreSQL connection URL'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname) throw new Error('Invalid PostgreSQL connection URL');
  if(!process.env.UNDERSTOOD_POSTGRES_URL && connectionString===process.env.DATABASE_URL && ['require','verify-full'].includes(url.searchParams.get('sslmode'))) {
    url.searchParams.delete('sslmode');connectionString=url.href;
  }
  if (['sslmode', 'sslcert', 'sslkey', 'sslrootcert'].some((key) => url.searchParams.has(key))) {
    throw new Error('Configure PostgreSQL TLS outside the connection URL');
  }
  const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname);
  if (!local && !tls) throw new Error('TLS is required for a nonlocal PostgreSQL connection');
  const module = await import('pg');
  const Pool = module.Pool ?? module.default.Pool;
  return guardPostgresPool(new Pool({
    connectionString,
    ssl: tls ? { rejectUnauthorized: true, ...(caFile ? { ca: readFileSync(caFile, 'utf8') } : {}) } : false,
    max: 8,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000,
  }));
}

export async function withTransaction(pool, fn) {
  const client = await acquirePostgresClient(pool);
  let begun = false, discard = true;
  try {
    await client.query('BEGIN');
    begun = true; discard = false;
    const result = await fn(client);
    discard = true;
    await client.query('COMMIT');
    discard = false;
    return result;
  } catch (error) {
    if (begun) {
      try { await client.query('ROLLBACK'); } catch (rollbackError) { discard = true; error.cause = rollbackError; }
    }
    throw error;
  } finally {
    client.release(discard || undefined);
  }
}
