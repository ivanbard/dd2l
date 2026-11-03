import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { request as httpRequest } from 'node:http';
import { createUiServer } from '../src/ui-server.mjs';
import { projectInventory, readInventory, searchInventory } from '../src/ui-data.mjs';
import { demoInventory } from '../src/ui-demo.mjs';
import { Store } from '../src/store.mjs';

test('retrieval scopes sources, ranks titles, strips HTML and labels stale data', () => {
  const inventory = demoInventory();
  assert.equal(inventory.courses.length, 3);
  assert.equal(searchInventory(inventory, 'What is my recursion assignment?').results[0].title, 'Assignment 3 · Recursion');
  assert.equal(searchInventory(inventory, 'recursion', '102').total, 0);
  assert.equal(searchInventory(inventory, 'what are we looking for today').total, 0);
  assert.ok(searchInventory(inventory, '').total >= 10);
  assert.equal(searchInventory(inventory, 'nonexistenttopic').total, 0);
  const projected = projectInventory([
    { category: 'enrollments', data: [{ OrgUnit: { Id: 1, Name: 'Course' }, Access: { CanAccess: true } }] },
    { key: 'stale', category: 'content_file', course: '1', outcome: 'failed', last_success: '2026-10-01',
      data: { Html: '<b>Memory</b><script>private-script</script>', token: 'private-token', raw: 'private-bytes' } },
    { key: 'denied', category: 'content_file', course: '1', outcome: 'denied', data: { text: 'denied-secret' } },
    { key: 'other', category: 'content_file', course: '2', outcome: 'available', data: { text: 'revoked-secret' } },
    { key: 'hidden', category: 'content', course: '1', outcome: 'available',
      data: { Modules: [{ IsHidden: true, Topics: [{ Title: 'hidden-secret' }] }] } },
  ], null);
  assert.equal(projected.sources.length, 1);
  assert.equal(projected.sources[0].text, 'Memory');
  assert.equal(projected.sources[0].stale, true);
  assert.doesNotMatch(JSON.stringify(projected), /private-|denied-secret|revoked-secret|hidden-secret/);
  const plain = projectInventory([
    { category: 'enrollments', data: [{ OrgUnit: { Id: 1 }, Access: { CanAccess: true } }] },
    { key: 'plain', category: 'content_file', course: '1', outcome: 'available', data: { text: 'A generic type List<T> and x < y.' } },
  ], null);
  assert.equal(plain.sources[0].text, 'A generic type List<T> and x < y.');
});

test('live inventory is read-only and reflects sync revocations and missing cache', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'dd2l-ui-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'inventory.sqlite');
  assert.deepEqual(readInventory(path).courses, []);
  const store = new Store(directory);
  try {
    const enrollments = { complete: true, data: [{ OrgUnit: { Id: 42, Name: 'Test course' }, Access: { CanAccess: true } }] };
    store.commit({ Identifier: 7 }, 'https://example.test', [
      { key: 'enrollments', category: 'enrollments', outcome: 'available', ...enrollments },
      { key: 'file', category: 'content_file', course: '42', outcome: 'available', data: { text: 'memory sample' } },
    ], {}, enrollments);
    const before = store.resource('file');
    assert.equal(searchInventory(readInventory(path), 'memory').total, 1);
    assert.equal(readInventory(path).sources[0].url, 'https://example.test/d2l/home/42');
    assert.deepEqual(store.resource('file'), before);
    store.commit({ Identifier: 7 }, 'https://example.test', [], {}, { complete: true, data: [] });
    assert.equal(searchInventory(readInventory(path), 'memory').total, 0);
  } finally { store.close(); }
});

test('local HTTP boundary rejects foreign sites, writes, invalid input and file traversal', async t => {
  const server = createUiServer({ demo: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const get = (path, options) => fetch(`http://127.0.0.1:${server.address().port}${path}`, options);
  const status = await get('/api/status');
  assert.equal((await status.json()).demo, true);
  assert.equal(status.headers.get('cache-control'), 'no-store');
  assert.match(status.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal((await get('/api/courses')).status, 200);
  const home = await (await get('/api/home')).json();
  assert.equal(home.demo, true);
  assert.equal(home.scope, 'demo');
  assert.equal(home.announcements[0].title, 'Midterm review session');
  assert.ok(home.sources.every(source => !('text' in source)));
  assert.equal((await get('/widgets.js')).status, 200);
  assert.equal((await get('/widget-layout.js')).status, 200);
  assert.equal((await (await get('/api/search?q=recursion')).json()).total, 1);
  assert.equal((await get('/api/search?course=999')).status, 404);
  assert.equal((await get('/api/search?course=abc')).status, 400);
  assert.equal((await get(`/api/search?q=${'a'.repeat(501)}`)).status, 400);
  for (const headers of [{ Origin: 'https://foreign.example' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    assert.equal((await get('/api/status', { headers })).status, 403);
  }
  // Fetch replaces Host; use a raw HTTP request to exercise DNS-rebinding rejection.
  const foreignHost = await new Promise((resolve, reject) => {
    const req = httpRequest(`http://127.0.0.1:${server.address().port}/api/status`, { headers: { Host: 'foreign.example' } }, res => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal(foreignHost, 403);
  assert.equal((await get('/api/status', { method: 'POST' })).status, 405);
  assert.equal((await get('/src/session.mjs')).status, 404);
  assert.equal((await get('/assets/%2e%2e%2fsrc%2fsession.mjs')).status, 404);
  assert.equal((await get('/')).status, 200);
  assert.equal((await get('/assets/logo.svg')).status, 200);
});
