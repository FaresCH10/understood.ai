import { spawn } from 'node:child_process';
import {existsSync} from 'node:fs';

// Share the same private service configuration with the API and worker.
// A provider key never changes preparation or real-data adapters. Local
// follow-ups stay off unless --credential-test (test text only).
if(existsSync('.env'))process.loadEnvFile('.env');

const credentialTest = process.argv.includes('--credential-test');
const env = {
  ...process.env,
  UNDERSTOOD_TIER: 'local',
  UNDERSTOOD_AI_MODE: 'synthetic',
  UNDERSTOOD_ACCESS_MODE: 'credential',
};
if(credentialTest && env.GEMINI_API_KEY && !env.UNDERSTOOD_CASE_FOLLOWUP_ADAPTER && (env.UNDERSTOOD_DATA_CLASS ?? 'synthetic')==='synthetic') {
  env.UNDERSTOOD_CASE_FOLLOWUP_ADAPTER='gemini';
  env.UNDERSTOOD_DATA_CLASS='synthetic';
}
if(credentialTest)console.warn(env.UNDERSTOOD_CASE_FOLLOWUP_ADAPTER==='gemini'
  ? 'Credential test mode: follow-ups go to the free Gemini tier. Type test text only, never real worker details.'
  : 'Credential test mode: follow-ups stay off (no GEMINI_API_KEY, or a non-synthetic data class is set).');
const children = [];

function stop() {
  for (const child of children) child.kill();
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);

function start(args, ipc = false) {
  const child = spawn(process.execPath, args, { stdio: ipc ? ['inherit', 'inherit', 'inherit', 'ipc'] : 'inherit', env });
  children.push(child);
  child.on('error', (error) => { console.error(error.message); stop(); process.exitCode = 1; });
  child.on('exit', (code) => { if (code) { stop(); process.exitCode = code; } });
  return child;
}

const api = start(['server/index.mjs'], true);
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('API startup timed out')), 15000);
    api.once('message', (message) => { clearTimeout(timer); message?.type === 'ready' ? resolve() : reject(new Error('API startup failed')); });
    api.once('exit', () => { clearTimeout(timer); reject(new Error('API exited before readiness')); });
    api.once('error', () => { clearTimeout(timer); reject(new Error('API could not start')); });
  });
  start(['server/worker.mjs']);
  start(['node_modules/vite/bin/vite.js']);
} catch (error) { console.error(error.message); stop(); process.exitCode = 1; }
