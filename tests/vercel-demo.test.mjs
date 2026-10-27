import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import gateway from '../api/gateway.mjs';
import { createVercelDemoHandler, vercelAccessMode } from '../server/vercel-demo.mjs';

async function listen(handler) {
  const server = createServer((req, res) => handler(req, res));
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return server;
}

test('a Vercel deployment uses credential sign-in unless demo is selected', async () => {
  assert.equal(vercelAccessMode({ VERCEL: '1' }), 'credential');
  assert.equal(vercelAccessMode({ VERCEL: '1', UNDERSTOOD_ACCESS_MODE: 'demo' }), 'demo');
  assert.equal(vercelAccessMode({}), 'demo');
  const { handler, config } = createVercelDemoHandler({ accessMode: 'credential', localDemo: true });
  assert.equal(config.accessMode, 'credential');
  assert.equal(config.demoSessionToken, undefined);
  const server = await listen((req, res) => handler(req, res));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const health = await (await fetch(`${origin}/api/health`)).json();
    assert.equal(health.mode, 'synthetic-credential');
    const demo = await fetch(`${origin}/api/demo/session`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: '{"principal":"maya"}' });
    assert.equal(demo.status, 404);
    const session = await (await fetch(`${origin}/api/session`)).json();
    assert.equal(session.authenticated, false);
    assert.equal(session.mode, 'synthetic-credential');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('Vercel synthetic demo gateway serves demo sessions across fresh instances without credentials', async () => {
  const server = await listen(gateway);
  const secondHandler = createVercelDemoHandler().handler;
  const second = await listen((req, res) => {
    const url = new URL(req.url, 'http://internal.invalid');
    req.url = `/api/${url.searchParams.get('understood_path') ?? ''}`;
    return secondHandler(req, res);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = (path, options = {}) => fetch(`${origin}/api/gateway?understood_path=${path}`, options);
  const post = (path, body, headers = {}) => request(path, { method: 'POST', headers: { 'content-type': 'application/json', origin, ...headers }, body: JSON.stringify(body) });
  try {
    assert.equal((await request('health')).status, 200);
    assert.equal((await post('auth/staff/login', { email: 'x@example.test', password: 'x' })).status, 404);
    assert.equal((await post('demo/session', { principal: 'maya' }, { origin: 'https://forged.example.test' })).status, 403);

    const login = await post('demo/session', { principal: 'maya' });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const session = await (await request('session', { headers: { cookie } })).json();
    assert.equal(session.authenticated, true);
    assert.equal(session.role, 'staff');
    assert.equal(session.organization, 'Cedar Works');
    assert.equal((await request('overview', { headers: { cookie } })).status, 409);
    const overview = await request('overview', { headers: { cookie, 'x-client-session-context': session.clientContext } });
    assert.equal(overview.status, 200);

    const workerLogin = await post('demo/session', { principal: 'worker-14' });
    const workerCookie = workerLogin.headers.get('set-cookie').split(';')[0];
    const workerSession = await (await request('session', { headers: { cookie: workerCookie } })).json();
    const briefings = await (await request('worker/briefings?view=all&page=1&pageSize=5', {
      headers: { cookie: workerCookie, 'x-client-session-context': workerSession.clientContext },
    })).json();
    assert.ok(Array.isArray(briefings.items));
    assert.ok(briefings.items.length > 0);

    const rewritten = await fetch(`${origin}/api/gateway?understood_path=${encodeURIComponent('worker/briefings?view=all&page=1&pageSize=5')}&view=all&page=1&pageSize=5&path=worker%2Fbriefings`, {
      headers: { cookie: workerCookie, 'x-client-session-context': workerSession.clientContext },
    });
    assert.equal(rewritten.status, 200);
    assert.ok(Array.isArray((await rewritten.json()).items));

    const secondOrigin = `http://127.0.0.1:${second.address().port}`;
    const crossInstance = await fetch(`${secondOrigin}/api/gateway?understood_path=session`, { headers: { cookie } });
    assert.equal((await crossInstance.json()).authenticated, true);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await new Promise(resolve => second.close(resolve));
  }
});
