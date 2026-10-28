import { openDatabase } from './db.mjs';
import { createAppHandler } from './index.mjs';

const hostsFromEnv = () => new Set(['VERCEL_URL', 'VERCEL_BRANCH_URL', 'VERCEL_PROJECT_PRODUCTION_URL']
  .map(key => process.env[key]).filter(Boolean)
  .concat((process.env.UNDERSTOOD_DEMO_HOSTS ?? '').split(',').map(host => host.trim()).filter(Boolean)));

export function vercelAccessMode() {
  return 'credential';
}

export function createVercelDemoHandler({ localDemo = process.env.VERCEL !== '1', audioRoot = '/tmp/understood-private-audio' } = {}) {
  const db = openDatabase(':memory:');
  const hosts = hostsFromEnv();
  const config = Object.freeze({
    tier: 'local',
    aiMode: 'synthetic',
    accessMode: 'credential',
    publicOrigin: localDemo ? 'http://localhost' : `https://${[...hosts][0] ?? 'invalid.local'}`,
    remoteDemo: true,
    localDemo,
    demoHosts: hosts,
    cookieOptions: { name: 'understood_session', secure: !localDemo },
  });
  const handler = createAppHandler(db, { config, audioRoot, mail: { available: false } });
  return { handler, db, config };
}
