import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {mkdtemp, readFile, writeFile, rm, readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {inspectWav} from '../server/audio.mjs';
import {NEON_STORAGE_TEST_FIELDS, neonStorageTestConfig, neonStorageClientOptions,
  checkNeonPrivateStorage} from '../server/neon-storage-test.mjs';
import {loadNeonStorageTestEnvironment, runNeonStorageCheck, importNeonStorageSettings} from '../scripts/neon-storage-check.mjs';

const P = 'UNDERSTOOD_NEON_STORAGE_TEST_';
const env = Object.fromEntries(Object.entries({ISOLATED: 'true', BUCKET: 'understood-synthetic-test',
  ENDPOINT: 'https://br-synthetic-fixture.storage.c-2.eu-central-1.aws.neon.tech', REGION: 'eu-central-1',
  ACCESS_KEY_ID: 'TEST_PRIVATE_ACCESS', SECRET_ACCESS_KEY: 'TEST_PRIVATE_SECRET'}).map(([k,v]) => [P + k,v]));
const runId = '12345678-1234-4234-8234-123456789abc';
const httpError = status => Object.assign(Error(env[P + 'SECRET_ACCESS_KEY']), {$metadata: {httpStatusCode: status}});

function fixture(settings = {}) {
  const {nonempty = false,
  losePutAck = false, loseDeleteAck = false, denyHead = false, foreignMetadata = false,
    corrupt = false, huge = false, destroyFails = false} = settings;
  const conditionalStatus = Object.hasOwn(settings, 'conditionalStatus') ? settings.conditionalStatus : 412;
  const anonymousStatus = Object.hasOwn(settings, 'anonymousStatus') ? settings.anonymousStatus : 403;
  const objects = new Map(), commands = [], anonymous = [], options = [];
  let destroyed = 0;
  const client = {
    async send(command, request) {
      commands.push(command); assert.ok(request.abortSignal instanceof AbortSignal);
      const {Key, Body, Metadata} = command.input, kind = command.constructor.name;
      assert.equal(command.input.Bucket, 'understood-synthetic-test');
      if (Key) assert.equal(Key, `understood-storage-check/${runId}/probe.wav`);
      if (kind === 'ListObjectsV2Command') return {KeyCount: nonempty ? 1 : 0, IsTruncated: false};
      if (kind === 'PutObjectCommand') {
        assert.equal(command.input.IfNoneMatch, '*'); assert.equal(command.input.ACL, undefined);
        assert.equal(command.input.CacheControl, 'private, no-store');
        assert.equal(command.input.ContentType, 'audio/wav');
        if (objects.has(Key) && conditionalStatus !== 200) throw httpError(conditionalStatus);
        inspectWav(Body);
        objects.set(Key, {bytes: Buffer.from(Body), metadata: {...Metadata}});
        if (losePutAck) throw httpError(undefined);
        return {};
      }
      if (kind === 'DeleteObjectCommand') {
        objects.delete(Key);
        if (loseDeleteAck) throw httpError(undefined);
        return {};
      }
      if (kind === 'HeadObjectCommand' && denyHead) throw httpError(403);
      const object = objects.get(Key);
      if (!object) throw httpError(404);
      const metadata = foreignMetadata ? {} : object.metadata;
      if (kind === 'HeadObjectCommand') return {ContentLength: object.bytes.length, Metadata: metadata};
      if (kind === 'GetObjectCommand') {
        const bytes = Buffer.from(object.bytes); if (corrupt) bytes[bytes.length - 1] ^= 255;
        return {Metadata: metadata, ContentLength: huge ? 100000000 : bytes.length, Body: Readable.from([bytes])};
      }
      throw Error('Unexpected command');
    },
    destroy() {destroyed++; if (destroyFails) throw Error('PRIVATE_DESTROY_ERROR');},
  };
  return {objects, commands, anonymous, options, get destroyed() {return destroyed;},
    dependencies: {runId, makeClient(config) {options.push(config); return client;},
      async readAnonymous(url, signal) {anonymous.push(url); assert.ok(signal instanceof AbortSignal); return anonymousStatus;}},
  };
}

test('Neon storage uses explicit isolated settings, HTTPS, a supported matching region and path-style S3', () => {
  const config = neonStorageTestConfig({...env, AWS_ACCESS_KEY_ID: 'IGNORED_GLOBAL_AWS'});
  assert.ok(Object.isFrozen(config)); assert.equal(config.region, 'eu-central-1');
  const options = neonStorageClientOptions(config);
  assert.equal(options.endpoint, env[P + 'ENDPOINT']); assert.equal(options.forcePathStyle, true);
  assert.equal(options.maxAttempts, 1); assert.equal(options.followRegionRedirects, false);
  assert.deepEqual(options.credentials, {accessKeyId: 'TEST_PRIVATE_ACCESS', secretAccessKey: 'TEST_PRIVATE_SECRET'});
  for (const region of ['us-east-1', 'us-east-2', 'eu-central-1', 'ap-southeast-1']) {
    assert.equal(neonStorageTestConfig({...env, [P + 'REGION']: region,
      [P + 'ENDPOINT']: `https://br-synthetic-check.storage.c-1.${region}.aws.neon.tech/`}).region, region);
  }
});

test('Neon storage rejects unacknowledged, arbitrary, plaintext, credential-bearing and mismatched targets before any client', async () => {
  const variants = [
    {[P + 'ISOLATED']: 'false'}, {[P + 'ISOLATED']: true}, {[P + 'BUCKET']: 'production-audio'},
    {[P + 'REGION']: 'auto'}, {[P + 'REGION']: 'us-east-2'}, {[P + 'ACCESS_KEY_ID']: ''},
    {[P + 'SECRET_ACCESS_KEY']: 'private\nsecret'}, {[P + 'SECRET_ACCESS_KEY']: 'x'.repeat(4097)},
  ];
  for (const endpoint of ['http://br-fixture.storage.c-1.eu-central-1.aws.neon.tech',
    env[P + 'ENDPOINT'] + '.attacker.invalid', env[P + 'ENDPOINT'] + '/bucket',
    env[P + 'ENDPOINT'] + '?credential=private', env[P + 'ENDPOINT'] + '#secret',
    env[P + 'ENDPOINT'] + ':8443', env[P + 'ENDPOINT'] + '\n',
    env[P + 'ENDPOINT'].replace('https://', 'https://private:secret@'),
    'https://127.0.0.1', 'https://ep-fixture.eu-central-1.aws.neon.tech']) variants.push({[P + 'ENDPOINT']: endpoint});
  let clients = 0;
  for (const variant of variants) await assert.rejects(checkNeonPrivateStorage({...env, ...variant}, {
    makeClient() {clients++; throw Error('Should not create client');},
  }), /configuration/);
  assert.equal(clients, 0);
  await assert.rejects(checkNeonPrivateStorage(env, {runId: '../foreign', makeClient() {clients++;}}), /identifier/);
  assert.equal(clients, 0);
});

test('isolated Neon probe checks private WAV bytes, conditional overwrite denial and guarded branch removal', async () => {
  const f = fixture(), result = await checkNeonPrivateStorage(env, f.dependencies);
  assert.equal(result.state, 'passed'); assert.equal(result.phase, 'completed');
  for (const key of ['authenticatedRead', 'anonymousReadDenied', 'conditionalOverwriteRejected', 'originalBytesPreserved']) assert.equal(result[key], true);
  assert.equal(result.cleanup, 'removed-from-current-branch'); assert.equal(f.objects.size, 0);
  assert.equal(f.destroyed, 1); assert.equal(f.anonymous.length, 1);
  assert.match(f.anonymous[0], /\/understood-synthetic-test\/understood-storage-check\//);
  assert.doesNotMatch(f.anonymous[0], /TEST_PRIVATE|[?@]/);
  assert.equal(f.commands.filter(command => command.constructor.name === 'DeleteObjectCommand').length, 1);
  for (const key of ['realData', 'applicationStorageChanged', 'irreversibleErasureVerified', 'productionReady']) assert.equal(result[key], false);
  assert.equal(result.databaseWrites, 0); assert.equal(result.aiProviderCalls, 0);
  assert.doesNotMatch(JSON.stringify(result), /TEST_PRIVATE|br-synthetic|neon\.tech|probe\.wav/);
});

test('nonempty or uncertain buckets are never written or deleted', async () => {
  const f = fixture({nonempty: true}), result = await checkNeonPrivateStorage(env, f.dependencies);
  assert.equal(result.state, 'failed'); assert.equal(result.phase, 'empty-bucket');
  assert.equal(result.cleanup, 'not-needed'); assert.equal(f.commands.length, 1); assert.equal(f.destroyed, 1);
  for (const response of [{}, {KeyCount: 0}, {KeyCount: 0, IsTruncated: true},
    {KeyCount: 0, IsTruncated: false, Contents: [{Key: 'foreign'}]},
    {KeyCount: 0, IsTruncated: false, Contents: 'unknown'}]) {
    let calls = 0;
    const r = await checkNeonPrivateStorage(env, {runId, makeClient() {return {
      async send() {calls++; return response;}, destroy() {},
    };}});
    assert.equal(r.state, 'failed'); assert.equal(calls, 1); assert.equal(r.cleanup, 'not-needed');
  }
});

test('unknown authenticated HEAD failure is not treated as a missing probe', async () => {
  const f = fixture({denyHead: true}), r = await checkNeonPrivateStorage(env, f.dependencies);
  assert.equal(r.state, 'failed'); assert.equal(r.phase, 'unique-probe');
  assert.equal(r.cleanup, 'not-needed'); assert.equal(f.objects.size, 0);
  assert.equal(f.commands.some(command => /Put|Delete/.test(command.constructor.name)), false);
});

test('public, redirected, unknown and not-found anonymous responses fail privacy proof but clean up the owned probe', async () => {
  for (const anonymousStatus of [200, 206, 301, 307, 404, 429, 500, undefined]) {
    const f = fixture({anonymousStatus}), r = await checkNeonPrivateStorage(env, f.dependencies);
    assert.equal(r.state, 'failed'); assert.equal(r.phase, 'anonymous-read');
    assert.equal(r.anonymousReadDenied, false); assert.equal(r.cleanup, 'removed-from-current-branch');
    assert.equal(f.objects.size, 0);
  }
});

test('unsupported, ignored and ambiguous conditional writes never pass compatibility', async () => {
  for (const conditionalStatus of [200, 409, 403, 501, undefined]) {
    const f = fixture({conditionalStatus}), r = await checkNeonPrivateStorage(env, f.dependencies);
    assert.equal(r.state, 'failed'); assert.equal(r.phase, 'conditional-overwrite');
    assert.equal(r.conditionalOverwriteRejected, false); assert.equal(r.originalBytesPreserved, false);
    assert.equal(r.cleanup, 'removed-from-current-branch'); assert.equal(f.objects.size, 0);
  }
});

test('lost write acknowledgement still attempts only ownership-verified cleanup, without hiding the failure', async () => {
  const f = fixture({losePutAck: true}), r = await checkNeonPrivateStorage(env, f.dependencies);
  assert.equal(r.state, 'failed'); assert.equal(r.phase, 'write');
  assert.equal(r.cleanup, 'removed-from-current-branch'); assert.equal(f.objects.size, 0);
  assert.doesNotMatch(JSON.stringify(r), /TEST_PRIVATE/);
});

test('unproven ownership blocks deletion and reports cleanup as unverified', async () => {
  const f = fixture({foreignMetadata: true}), r = await checkNeonPrivateStorage(env, f.dependencies);
  assert.equal(r.state, 'failed'); assert.equal(r.phase, 'authenticated-read');
  assert.equal(r.cleanup, 'unverified'); assert.equal(f.objects.size, 1);
  assert.equal(f.commands.some(command => command.constructor.name === 'DeleteObjectCommand'), false);
});

test('corrupt or excessive bytes fail readback and a lost cleanup acknowledgement is not success', async () => {
  for (const options of [{corrupt: true}, {huge: true}, {loseDeleteAck: true}, {destroyFails: true}]) {
    const f = fixture(options), r = await checkNeonPrivateStorage(env, f.dependencies);
    assert.equal(r.state, 'failed'); assert.equal(f.destroyed, 1);
    assert.equal(f.objects.size, 0);
    if (options.loseDeleteAck) assert.equal(r.cleanup, 'unverified');
  }
});

function envText(values = env) {return Object.entries(values).map(([key,value]) => `${key}=${value}`).join('\n') + '\n';}

test('the dedicated local loader excludes database, Gemini, AWS globals and duplicate or missing fields', async () => {
  const root = await mkdtemp(join(tmpdir(), 'understood-neon-storage-config-'));
  try {
    const path = join(root, '.env.neon-storage-test');
    await writeFile(path, envText({...env, GEMINI_API_KEY: 'UNRELATED_PRIVATE', DATABASE_URL: 'postgres://private', AWS_SECRET_ACCESS_KEY: 'UNRELATED_AWS'}));
    const parsed = loadNeonStorageTestEnvironment(root);
    assert.deepEqual(parsed, env); assert.deepEqual(Object.keys(parsed), NEON_STORAGE_TEST_FIELDS);
    for (const text of [envText() + `${P}REGION=us-east-1\n`, envText().replace(`${P}ISOLATED=true\n`, ''), 'x'.repeat(65537)]) {
      await writeFile(path, text); assert.throws(() => loadNeonStorageTestEnvironment(root));
    }
    assert.equal(await readFile(path, 'utf8'), 'x'.repeat(65537));
  } finally {await rm(root, {recursive: true, force: true});}
});

test('configuration-only CLI mode performs no network or evidence writes and confirmation is mandatory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'understood-neon-storage-cli-'));
  try {
    await writeFile(join(root, '.env.neon-storage-test'), envText());
    let calls = 0; const options = {check: async () => {calls++; throw Error('Should not run');}};
    for (const args of [[], ['--confirm-synthetic'], ['--confirm-synthetic-private-bucket', '--anything']]) await assert.rejects(runNeonStorageCheck(root, args, options));
    assert.deepEqual(await runNeonStorageCheck(root, ['--check-config'], options), {configured: true, networkRequests: 0, productionReady: false});
    assert.equal(calls, 0); assert.deepEqual(await readdir(root), ['.env.neon-storage-test']);
  } finally {await rm(root, {recursive: true, force: true});}
});

test('CLI retains passed and failed redacted evidence without modifying local settings', async () => {
  const root = await mkdtemp(join(tmpdir(), 'understood-neon-storage-evidence-'));
  try {
    await writeFile(join(root, '.env.neon-storage-test'), envText());
    const failure = await runNeonStorageCheck(root, ['--confirm-synthetic-private-bucket'], {check: async () => {throw Error(env[P + 'SECRET_ACCESS_KEY']);}});
    assert.equal(failure.passed, false);
    assert.doesNotMatch(await readFile(failure.path, 'utf8'), /TEST_PRIVATE|br-synthetic/);
    const success = await runNeonStorageCheck(root, ['--confirm-synthetic-private-bucket'], {check: async (values, {runId: id}) => {
      assert.deepEqual(values, env); return {state: 'passed', runId: id, cleanup: 'removed-from-current-branch'};
    }});
    assert.equal(success.passed, true); assert.notEqual(success.path, failure.path);
    const report = JSON.parse(await readFile(success.path, 'utf8'));
    assert.equal(report.productionReady, false); assert.equal(report.applicationStorageChanged, false);
    assert.equal(await readFile(join(root, '.env.neon-storage-test'), 'utf8'), envText());
  } finally {await rm(root, {recursive: true, force: true});}
});

test('explicit AWS field import preserves CRLF and accepts target key order', async () => {
  const root = await mkdtemp(join(tmpdir(), 'understood-neon-storage-import-order-'));
  try {
    const source = 'GEMINI_API_KEY=UNRELATED_PRIVATE\n'
      + `AWS_ENDPOINT_URL_S3=${env[P + 'ENDPOINT']}\nAWS_REGION=eu-central-1\n`
      + 'AWS_ACCESS_KEY_ID=TEST_PRIVATE_ACCESS\nAWS_SECRET_ACCESS_KEY=TEST_PRIVATE_SECRET\n';
    const values = {...env, [P + 'ENDPOINT']: '', [P + 'REGION']: '',
      [P + 'ACCESS_KEY_ID']: '', [P + 'SECRET_ACCESS_KEY']: ''};
    const ordered = [...NEON_STORAGE_TEST_FIELDS].reverse();
    const target = ordered.map(field => `${field}=${values[field]}`).join('\r\n') + '\r\n';
    await writeFile(join(root, '.env'), source);
    await writeFile(join(root, '.env.neon-storage-test'), target);
    const result = importNeonStorageSettings(root);
    assert.equal(result.imported, true);
    assert.deepEqual(loadNeonStorageTestEnvironment(root), env);
    const updated = await readFile(join(root, '.env.neon-storage-test'), 'utf8');
    assert.equal(updated.split('\r\n').length, ordered.length + 1);
    for (const field of ordered) assert.match(updated, new RegExp(`^${field}=.*\\r$`, 'm'));
    assert.doesNotMatch(JSON.stringify(result), /TEST_PRIVATE|UNRELATED|neon\.tech/);
  } finally {await rm(root, {recursive: true, force: true});}
});

test('explicit AWS field import validates a dedicated target, leaves source byte-identical and prints no secrets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'understood-neon-storage-import-'));
  try {
    const source = 'GEMINI_API_KEY=UNRELATED_PRIVATE\nDATABASE_URL=postgres://UNCHANGED\n'
      + `AWS_ENDPOINT_URL_S3=${env[P + 'ENDPOINT']}\nAWS_REGION=eu-central-1\nAWS_ACCESS_KEY_ID=TEST_PRIVATE_ACCESS\nAWS_SECRET_ACCESS_KEY=TEST_PRIVATE_SECRET\n`;
    await writeFile(join(root, '.env'), source);
    await writeFile(join(root, '.env.neon-storage-test'), envText({...env,
      [P + 'ENDPOINT']: '', [P + 'REGION']: '', [P + 'ACCESS_KEY_ID']: '', [P + 'SECRET_ACCESS_KEY']: ''}));
    const result = importNeonStorageSettings(root);
    assert.equal(result.imported, true); assert.equal(result.sourceUnchanged, true);
    assert.equal(result.networkRequests, 0); assert.equal(result.applicationStorageChanged, false);
    assert.doesNotMatch(JSON.stringify(result), /TEST_PRIVATE|UNRELATED|UNCHANGED|neon\.tech/);
    assert.deepEqual(loadNeonStorageTestEnvironment(root), env);
    assert.equal(await readFile(join(root, '.env'), 'utf8'), source);
    assert.equal((await readdir(root)).length, 2);
    assert.equal(importNeonStorageSettings(root).imported, true);
    const prior = await readFile(join(root, '.env.neon-storage-test'), 'utf8');
    for (const invalid of [source + 'AWS_REGION=us-east-1\n', source.replace('AWS_REGION=eu-central-1', 'AWS_REGION=us-east-1'),
      source.replace('TEST_PRIVATE_ACCESS', 'DIFFERENT_ACCESS'), source.replace('AWS_SECRET_ACCESS_KEY=TEST_PRIVATE_SECRET', 'AWS_SECRET_ACCESS_KEY=')]) {
      await writeFile(join(root, '.env'), invalid);
      assert.throws(() => importNeonStorageSettings(root));
      assert.equal(await readFile(join(root, '.env.neon-storage-test'), 'utf8'), prior);
      assert.equal(await readFile(join(root, '.env'), 'utf8'), invalid);
    }
  } finally {await rm(root, {recursive: true, force: true});}
});
