import {existsSync, readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {hostedSyntheticConfig} from '../server/postgres/hosted-config.mjs';
import {loadOperatorBuild, loadPublicBuild} from '../server/public-build.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const proxyTrust = '["172.30.0.10/32"]';
const requiredFiles = [
  'Dockerfile', '.dockerignore', 'compose.yaml', 'compose.operator.yaml',
  'deploy/Caddyfile', 'deploy/Caddyfile.operator', 'deploy/caddy/customer.caddy',
  'deploy/caddy/operator.caddy', '.env.hosted', '.env.hosted.worker', '.env.operator',
  'deploy/.env.caddy', 'dist/index.html', 'dist/operator.html', 'dist/.vite/manifest.json',
];
const ownerLogins = new Set(['neondb_owner', 'understood_owner', 'postgres']);

function readEnvironment(name) {
  const path = resolve(root, name);
  if (!existsSync(path)) throw new Error(`${name} is missing; copy the matching example and fill it in`);
  const stat = readFileSync(path, 'utf8');
  if (stat.length > 65536) throw new Error(`${name} is unexpectedly large`);
  return parseEnv(stat);
}

function databaseIdentity(name, value) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${name} does not contain a valid PostgreSQL URL`); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.username) throw new Error(`${name} requires a dedicated login URL`);
  return {login: decodeURIComponent(url.username), password: decodeURIComponent(url.password), host: url.hostname};
}

function checkDeploymentFiles() {
  for (const name of requiredFiles) if (!existsSync(resolve(root, name))) throw new Error(`${name} is missing`);
  const dockerfile = readFileSync(resolve(root, 'Dockerfile'), 'utf8');
  if (/^\s*COPY\s+\.\s+/m.test(dockerfile)) throw new Error('Dockerfile must not copy the whole build context');
  if (!/^\s*COPY\s+server\s+/m.test(dockerfile)) throw new Error('Dockerfile build stage must copy server before building');
  const compose = readFileSync(resolve(root, 'compose.yaml'), 'utf8');
  if (!compose.includes(proxyTrust)) throw new Error('compose.yaml must set the reviewed proxy trust network');
  if (!compose.includes('172.30.0.10/32')) throw new Error('compose.yaml must trust only the Caddy address');
  if (!compose.includes('read_only: true')) throw new Error('compose.yaml must run application containers read-only');
  if (!compose.includes('no-new-privileges:true')) throw new Error('compose.yaml must disable privilege escalation');
  for (const name of ['deploy/caddy/customer.caddy', 'deploy/caddy/operator.caddy']) {
    const caddy = readFileSync(resolve(root, name), 'utf8');
    for (const header of ['header_up Host {host}', 'header_up X-Forwarded-Proto https',
      'header_up X-Forwarded-For {remote_host}', 'header_up -X-Forwarded-Host']) {
      if (!caddy.includes(header)) throw new Error(`${name} does not enforce the trusted-proxy contract`);
    }
  }
}

function checkBuildOutput() {
  return Promise.all([loadPublicBuild(resolve(root, 'dist')), loadOperatorBuild(resolve(root, 'dist'))]);
}

async function main() {
  checkDeploymentFiles();
  await checkBuildOutput();
  const apiFile = readEnvironment('.env.hosted');
  const workerFile = readEnvironment('.env.hosted.worker');
  const operatorFile = readEnvironment('.env.operator');
  const caddyFile = readEnvironment('deploy/.env.caddy');
  if (!caddyFile.UNDERSTOOD_CUSTOMER_HOST || caddyFile.UNDERSTOOD_CUSTOMER_HOST.includes('/')) {
    throw new Error('deploy/.env.caddy needs a bare customer hostname');
  }
  if (!workerFile.UNDERSTOOD_POSTGRES_URL) throw new Error('.env.hosted.worker needs the worker database login URL');
  const apiConfig = hostedSyntheticConfig({...apiFile, PORT: '10000',
    UNDERSTOOD_TRUSTED_PROXY_NETWORKS: proxyTrust}, {service: 'api'});
  hostedSyntheticConfig({...apiFile, ...workerFile,
    UNDERSTOOD_TRUSTED_PROXY_NETWORKS: proxyTrust}, {service: 'worker'});
  const operatorConfig = hostedSyntheticConfig({...operatorFile, PORT: '10001',
    UNDERSTOOD_TRUSTED_PROXY_NETWORKS: proxyTrust}, {service: 'operator'});
  if (operatorConfig.publicOrigin === operatorConfig.customerOrigin) throw new Error('Operator origin must differ from the customer origin');
  const caddyOrigin = new URL(`https://${caddyFile.UNDERSTOOD_CUSTOMER_HOST}`);
  if (caddyOrigin.host !== new URL(apiConfig.publicOrigin).host) {
    throw new Error('Caddy customer host must match UNDERSTOOD_PUBLIC_ORIGIN');
  }
  if (!caddyFile.UNDERSTOOD_OPERATOR_HOST
    || new URL(`https://${caddyFile.UNDERSTOOD_OPERATOR_HOST}`).host !== new URL(operatorConfig.publicOrigin).host) {
    throw new Error('Caddy operator host must match the operator public origin');
  }
  if (operatorFile.UNDERSTOOD_CUSTOMER_ORIGIN !== apiConfig.publicOrigin) {
    throw new Error('.env.operator customer origin must match the customer public origin');
  }
  if (operatorConfig.schema !== apiConfig.schema) throw new Error('Operator must use the customer staging schema');
  const api = databaseIdentity('API database URL', apiFile.UNDERSTOOD_POSTGRES_URL);
  const worker = databaseIdentity('Worker database URL', workerFile.UNDERSTOOD_POSTGRES_URL);
  const operator = databaseIdentity('Operator database URL', operatorFile.UNDERSTOOD_POSTGRES_URL);
  if (new Set([api.login, worker.login, operator.login]).size !== 3) {
    throw new Error('API, worker and operator must use different database logins');
  }
  for (const identity of [api, worker, operator]) {
    if (ownerLogins.has(identity.login)) throw new Error('Runtime services must not use owner or superuser logins');
  }
  if (new Set([api.password, worker.password, operator.password].filter(Boolean)).size < 3) {
    throw new Error('Runtime database logins must not share a password');
  }
  if (existsSync(resolve(root, '.env'))) {
    const local = readEnvironment('.env');
    const testing = local.UNDERSTOOD_NEON_TEST_URL;
    if (testing && [apiFile.UNDERSTOOD_POSTGRES_URL, workerFile.UNDERSTOOD_POSTGRES_URL,
      operatorFile.UNDERSTOOD_POSTGRES_URL].includes(testing)) {
      throw new Error('Deployment must not reuse the local Neon test URL');
    }
  }
  console.log(JSON.stringify({ready: true, networkRequests: 0, deployed: false,
    services: ['api', 'worker'], operatorConfigured: true, buildVerified: true,
    proxyTrustReviewed: true, productionReady: false}, null, 2));
}

main().catch(error => {
  console.error(`Deploy preflight failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exitCode = 1;
});
