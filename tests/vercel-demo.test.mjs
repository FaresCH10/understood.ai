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

test('a Vercel deployment uses credential sign-in and never demo profiles', async () => {
  assert.equal(vercelAccessMode({ VERCEL: '1' }), 'credential');
  assert.equal(vercelAccessMode({ VERCEL: '1', UNDERSTOOD_ACCESS_MODE: 'demo' }), 'credential');
  assert.equal(vercelAccessMode({}), 'credential');
  const { handler, config } = createVercelDemoHandler({ localDemo: true });
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

test('Vercel credential gateway exposes staff login and 404s demo sessions', async () => {
  const server = await listen(gateway);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = (path, options = {}) => fetch(`${origin}/api/gateway?understood_path=${path}`, options);
  const post = (path, body, headers = {}) => request(path, { method: 'POST', headers: { 'content-type': 'application/json', origin, ...headers }, body: JSON.stringify(body) });
  try {
    assert.equal((await request('health')).status, 200);
    assert.equal((await (await request('health')).json()).mode, 'synthetic-credential');
    assert.equal((await post('demo/session', { principal: 'maya' })).status, 404);
    const login = await post('auth/staff/login', { email: 'x@example.test', password: 'x' });
    assert.equal(login.status, 401);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
