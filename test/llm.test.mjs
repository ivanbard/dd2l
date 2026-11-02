import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChatGPT, responseText, verifyIdentity } from '../src/llm.mjs';
import { createUiServer } from '../src/ui-server.mjs';

const scope = 'openid resource.invoke chatgpt.tokens.use.direct';
const tokens = { access_token: 'secret-access', refresh_token: 'secret-refresh', id_token: 'signed-id', token_type: 'Bearer', expires_in: 3600, scope };
const event = data => `data: ${JSON.stringify(data)}\r\n\r\n`;
const stream = text => new Response(text, { headers: { 'Content-Type': 'text/event-stream' } });

async function fixture(t, fetchImpl) {
  const directory = await mkdtemp(join(tmpdir(), 'dd2l-llm-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  // Exercise actual Windows DPAPI storage, with no real provider credentials.
  const llm = new ChatGPT(directory, { fetchImpl, verify: async (token, id, nonce) => {
    assert.equal(token, 'signed-id'); assert.equal(id, 'oaiapp_test'); assert.ok(nonce);
    return { sub: 'student', email: 'student@example.test' };
  } });
  return { llm, directory };
}

async function connect(llm) {
  const { url } = await llm.login('http://127.0.0.1:4173/auth/callback');
  const params = new URL(url).searchParams;
  await llm.callback(new URLSearchParams({ state: params.get('state'), code: 'code', client_id: 'oaiapp_test' }));
  return params;
}

test('OAuth registers with PKCE, verifies identity, encrypts secrets and reuses host and registration', async t => {
  const calls = [];
  const { llm } = await fixture(t, async (url, options) => { calls.push([url, options]); return Response.json(tokens); });
  const params = await connect(llm);
  assert.equal(params.get('client_id'), 'dynamic_agent_client');
  assert.equal(params.get('agent_name_hint'), 'dd2l');
  assert.equal(params.get('code_challenge_method'), 'S256');
  assert.match(params.get('ext_agent_host_id'), /^urn:uuid:/);
  assert.equal(calls[0][1].body.get('client_id'), 'oaiapp_test');
  assert.equal(calls[0][1].body.get('redirect_uri'), 'http://127.0.0.1:4173/auth/callback');
  assert.equal(calls[0][1].body.get('resource'), 'https://api.openai.com/v1');
  const stored = await readFile(llm.path);
  assert.ok(!stored.includes(Buffer.from('secret-access')));
  const status = await llm.status();
  assert.equal(status.active, 'oaiapp_test');
  assert.ok(!JSON.stringify(status).includes('secret'));
  const returning = new URL((await llm.login('http://127.0.0.1:4567/auth/callback', status.active)).url).searchParams;
  assert.equal(returning.get('client_id'), status.active);
  assert.equal(returning.get('ext_agent_host_id'), params.get('ext_agent_host_id'));
  assert.equal(returning.get('agent_name_hint'), null);
  assert.equal(returning.get('id_token_hint'), 'signed-id');
  await assert.rejects(llm.callback(new URLSearchParams({ state: returning.get('state'), code: 'code', client_id: 'another' })), /did not match/);
  assert.equal((await llm.status()).active, status.active);
});

test('OAuth rejects forged state, denied consent, missing scope and invalid ID tokens', async t => {
  const { llm } = await fixture(t, async () => Response.json({ ...tokens, scope: 'openid' }));
  const params = new URL((await llm.login('http://127.0.0.1:4173/auth/callback')).url).searchParams;
  await assert.rejects(llm.callback(new URLSearchParams({ state: 'forged', code: 'code', client_id: 'oaiapp_test' })), /state/);
  await assert.rejects(llm.callback(new URLSearchParams({ state: params.get('state'), error: 'access_denied' })), /declined/);
  await assert.rejects(connect(llm), /not authorized/);
  assert.equal((await llm.status()).active, null);
  await assert.rejects(verifyIdentity('not-a-jwt', 'oaiapp_test', 'nonce'));
});

test('refresh is serialized and atomically saves rotating credentials, with no API-key fallback', async t => {
  let refreshes = 0;
  const { llm } = await fixture(t, async (url, options) => {
    if (url.endsWith('/models')) {
      assert.equal(options.headers.Authorization, 'Bearer renewed');
      return Response.json({ models: [{ slug: 'available', display_name: 'Available', visibility: 'list' }, { slug: 'hidden' }] });
    }
    if (options.body.get('grant_type') === 'refresh_token') {
      refreshes++;
      assert.equal(options.body.get('refresh_token'), 'secret-refresh');
      return Response.json({ ...tokens, access_token: 'renewed', refresh_token: 'rotated' });
    }
    return Response.json({ ...tokens, expires_in: 1 });
  });
  await connect(llm);
  const results = await Promise.all([llm.models(), llm.models()]);
  assert.equal(refreshes, 1);
  assert.deepEqual(results[0], { models: [{ id: 'available', name: 'Available' }] });
  llm.fetch = async () => new Response('', { status: 401 });
  await assert.rejects(llm.models(), /Sign in again/);
});

test('answers use public Responses with no storage or tools and require completed streaming', async t => {
  const { llm } = await fixture(t, async url => {
    if (url.endsWith('/oauth/token')) return Response.json(tokens);
    assert.equal(url, 'https://api.openai.com/v1/responses');
    return stream(event({ type: 'response.output_text.delta', delta: 'Use recursion [1].' }) + event({ type: 'response.completed' }));
  });
  await connect(llm);
  const original = llm.fetch;
  llm.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.store, false); assert.equal(body.stream, true);
    assert.equal(body.tools, undefined); assert.ok(Array.isArray(body.input));
    assert.match(body.instructions, /untrusted/);
    return original(url, options);
  };
  assert.equal((await llm.answer('How?', 'available', [{ title: 'Assignment', excerpt: 'Use recursion' }])).answer, 'Use recursion [1].');
  for (const terminal of ['response.failed', 'response.incomplete', 'error']) {
    await assert.rejects(responseText(stream(event({ type: 'response.output_text.delta', delta: 'Partial' }) + event({ type: terminal }))), /could not complete/);
  }
  await assert.rejects(responseText(stream(event({ type: 'response.output_text.delta', delta: 'Partial' }))), /did not complete/);
  const bytes = new TextEncoder().encode(event({ type: 'response.output_text.delta', delta: 'é' }) + event({ type: 'response.completed' }));
  assert.equal(await responseText(new Response(new ReadableStream({ start(c) { for (const b of bytes) c.enqueue(Uint8Array.of(b)); c.close(); } }))), 'é');
});

test('logout removes tokens and reports failed remote revocation, retaining registration', async t => {
  const { llm } = await fixture(t, async () => Response.json(tokens));
  await connect(llm);
  llm.fetch = async () => { throw new Error('offline'); };
  assert.match((await llm.logout()).message, /revocation was not confirmed/);
  const status = await llm.status();
  assert.equal(status.active, null);
  assert.equal(status.accounts[0].connected, false);
  await assert.rejects(llm.models(), /Settings first/);
});

test('AI HTTP writes require local JSON origin, bounded input and explicit coursework consent', async t => {
  let calls = 0;
  const server = createUiServer({ llm: { login: async () => { calls++; return { url: 'https://auth.openai.com' }; }, callback: async () => { throw new Error('secret'); } } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, headers = { Origin: origin, 'Content-Type': 'application/json' }) => fetch(origin + path, { method: 'POST', headers, body: JSON.stringify(body) });
  assert.equal((await post('/api/llm/login', {})).status, 200);
  assert.equal(calls, 1);
  assert.equal((await post('/api/llm/login', {}, { Origin: 'https://foreign.example', 'Content-Type': 'application/json' })).status, 403);
  assert.equal((await post('/api/llm/login', {}, { 'Content-Type': 'application/json' })).status, 403);
  assert.equal((await post('/api/llm/login', { id: {} })).status, 400);
  assert.equal((await post('/api/llm/login', { id: 'a'.repeat(9000) })).status, 413);
  assert.equal((await post('/api/llm/answer', { q: 'question', model: 'available' })).status, 400);
  assert.equal((await post('/api/llm/answer', { q: 'question', model: 'available', course: 'invalid', consent: true })).status, 400);
  const response = await fetch(`${origin}/auth/callback?state=forged`, { headers: { 'Sec-Fetch-Site': 'cross-site' } });
  assert.equal(response.status, 400);
  assert.doesNotMatch(await response.text(), /secret/);
  assert.equal(calls, 1);
});

test('sign-in callback renders themed success, returning and failure pages without reflecting OAuth input', async t => {
  const server = createUiServer({ llm: { callback: async params => {
    if (params.get('state') === 'failed') throw new Error('private error');
    return { first: params.get('state') === 'first' };
  } } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const [state, status, heading] of [['first', 200, "You're using your ChatGPT plan"], ['returning', 200, 'ChatGPT connected'], ['failed', 400, 'Sign-in did not complete']]) {
    const response = await fetch(`${origin}/auth/callback?state=${state}&code=do-not-reflect`, { headers: { 'Sec-Fetch-Site': 'cross-site' } });
    const html = await response.text();
    assert.equal(response.status, status);
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.match(html, /href="\/style.css"/);
    assert.match(html, /name="viewport"/);
    assert.ok(html.includes(`<h1 id="auth-heading">${heading}</h1>`));
    assert.match(html, /class="auth-return" href="\/"/);
    assert.doesNotMatch(html, /do-not-reflect|private error/);
    assert.equal(html.includes('Manage usage in ChatGPT'), status === 200);
  }
});
