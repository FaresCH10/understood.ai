import {readFileSync, lstatSync, writeFileSync, renameSync, unlinkSync} from 'node:fs';
import {mkdir, writeFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {NEON_STORAGE_TEST_FIELDS, neonStorageTestConfig, checkNeonPrivateStorage} from '../server/neon-storage-test.mjs';

export function loadNeonStorageTestEnvironment(root) {
  const path = resolve(root, '.env.neon-storage-test'), stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) throw Error('Private storage test file unavailable');
  const text = readFileSync(path, 'utf8');
  for (const field of NEON_STORAGE_TEST_FIELDS) {
    const count = text.split(/\r?\n/).filter(line => new RegExp(`^\\s*(?:export\\s+)?${field}\\s*=`).test(line)).length;
    if (count !== 1) throw Error('Private storage test file is ambiguous');
  }
  const parsed = parseEnv(text);
  return Object.fromEntries(NEON_STORAGE_TEST_FIELDS.map(field => [field, parsed[field]]));
}

// Explicit mechanical import only; never use ambient AWS credentials at runtime.
export function importNeonStorageSettings(root) {
  const source = resolve(root, '.env'), target = resolve(root, '.env.neon-storage-test');
  for (const path of [source, target]) {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) throw Error('Private storage import file unavailable');
  }
  const originalSource = readFileSync(source, 'utf8'), originalTarget = readFileSync(target, 'utf8');
  const parsed = parseEnv(originalSource), prior = loadNeonStorageTestEnvironment(root), updated = {...prior};
  const fields = {ENDPOINT: 'AWS_ENDPOINT_URL_S3', REGION: 'AWS_REGION',
    ACCESS_KEY_ID: 'AWS_ACCESS_KEY_ID', SECRET_ACCESS_KEY: 'AWS_SECRET_ACCESS_KEY'};
  let text = originalTarget;
  for (const [suffix, field] of Object.entries(fields)) {
    const name = 'UNDERSTOOD_NEON_STORAGE_TEST_' + suffix, value = parsed[field];
    const lines = originalSource.split(/\r?\n/).filter(line => new RegExp(`^\\s*(?:export\\s+)?${field}\\s*=`).test(line));
    if (lines.length !== 1 || !value || parseEnv(lines[0])[field] !== value
      || /[\x00-\x1f\x7f]/.test(value) || value.includes('"') && value.includes("'")) throw Error('Ambiguous private storage import');
    if (prior[name] && prior[name] !== value) throw Error('Private storage settings differ; files were not changed');
    updated[name] = value;
    const quote = value.includes('"') ? "'" : '"';
    text = text.replace(new RegExp(`^([ \\t]*(?:export[ \\t]+)?${name}[ \\t]*=)[^\\r\\n]*(\\r?\\n|$)`, 'm'),
      (_, prefix, ending) => `${prefix}${quote}${value}${quote}${ending}`);
  }
  neonStorageTestConfig(updated);
  const after = parseEnv(text), expected = {...parseEnv(originalTarget), ...updated};
  const keys = Object.keys(after).sort();
  if (keys.join('\n') !== Object.keys(expected).sort().join('\n')
    || keys.some(key => after[key] !== expected[key])) throw Error('Private storage import verification failed');
  const temporary = resolve(root, `.env.neon-storage-test.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, text, {flag: 'wx', mode: 0o600});
    if (readFileSync(source, 'utf8') !== originalSource || readFileSync(target, 'utf8') !== originalTarget) throw Error('Private configuration changed during import');
    renameSync(temporary, target);
  } finally {try {unlinkSync(temporary);} catch (error) {if (error.code !== 'ENOENT') throw error;}}
  return {imported: true, sourceUnchanged: readFileSync(source, 'utf8') === originalSource,
    networkRequests: 0, applicationStorageChanged: false};
}

export async function runNeonStorageCheck(root, args, {check = checkNeonPrivateStorage} = {}) {
  if (args.length !== 1 || !['--import-from-env', '--check-config', '--confirm-synthetic-private-bucket'].includes(args[0])) {
    throw Error('Explicit Neon storage check mode is required');
  }
  if (args[0] === '--import-from-env') return importNeonStorageSettings(root);
  const env = loadNeonStorageTestEnvironment(root);
  neonStorageTestConfig(env);
  if (args[0] === '--check-config') return {configured: true, networkRequests: 0, productionReady: false};
  const directory = resolve(root, 'artifacts');
  await mkdir(directory, {recursive: true});
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Local storage test evidence directory unavailable');
  const runId = randomUUID(), startedAt = new Date().toISOString();
  const path = resolve(directory, `neon-storage-${runId}.json`);
  const base = {runId, startedAt, productionReady: false, realData: false, applicationStorageChanged: false};
  await writeFile(path, JSON.stringify({...base, state: 'checking'}, null, 2) + '\n', {flag: 'wx'});
  let result;
  try {result = await check(env, {runId});}
  catch {result = {state: 'failed', phase: 'probe-unavailable', cleanup: 'unverified'};}
  await writeFile(path, JSON.stringify({...base, ...result, finishedAt: new Date().toISOString(),
    productionReady: false, realData: false, applicationStorageChanged: false}, null, 2) + '\n');
  return {passed: result.state === 'passed', path, productionReady: false};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await runNeonStorageCheck(process.cwd(), process.argv.slice(2));
    console.log(JSON.stringify(result));
    if (result.passed === false) process.exitCode = 1;
  } catch {
    console.error('Neon storage test settings are incomplete, invalid or ambiguous. No key was printed.');
    process.exitCode = 1;
  }
}
