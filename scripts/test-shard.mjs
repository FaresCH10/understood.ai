import {readdirSync, statSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export function parseShard(value) {
  const match = /^([1-9][0-9]*)\/([1-9][0-9]*)$/.exec(value ?? '');
  if (!match) throw new Error('Use SHARD/TOTAL, for example 1/4');
  const index = Number(match[1]), total = Number(match[2]);
  if (index > total || total > 16) throw new Error('Invalid shard range');
  return {index, total};
}

export function shardFiles(files, index, total) {
  if (!Number.isInteger(index) || !Number.isInteger(total) || index < 1 || index > total || total < 1) {
    throw new Error('Invalid shard range');
  }
  const weighted = files.map(file => ({file, bytes: statSync(file).size}))
    .sort((left, right) => right.bytes - left.bytes || left.file.localeCompare(right.file));
  const shards = Array.from({length: total}, () => ({files: [], bytes: 0}));
  for (const item of weighted) {
    const target = shards.reduce((smallest, shard) => shard.bytes < smallest.bytes ? shard : smallest);
    target.files.push(item.file);
    target.bytes += item.bytes;
  }
  return shards[index - 1].files.sort();
}

function main() {
  const {index, total} = parseShard(process.argv[2]);
  const files = readdirSync('tests').filter(name => name.endsWith('.test.mjs')).map(name => resolve('tests', name));
  const selected = shardFiles(files, index, total);
  if (!selected.length) throw new Error('Shard contains no tests');
  const concurrency = Number(process.env.TEST_CONCURRENCY ?? 2);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error('TEST_CONCURRENCY must be 1-8');
  const timeout = Number(process.env.TEST_TIMEOUT ?? 300000);
  if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 900000) throw new Error('TEST_TIMEOUT must be 1000-900000');
  console.log(`Test shard ${index}/${total}: ${selected.length} files, concurrency ${concurrency}`);
  const child = spawn(process.execPath, ['--test', `--test-timeout=${timeout}`, `--test-concurrency=${concurrency}`, ...selected], {stdio: 'inherit'});
  child.on('error', () => { process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
