import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AccessError } from '../src/client.mjs';
import { htmlContent, readDocument } from '../src/documents.mjs';
import { classifyOverview, collectSyllabus } from '../src/syllabus.mjs';
import { Store } from '../src/store.mjs';

const missingOverview = () => classifyOverview({ outcome: 'failed', complete: false, status: 404, error: 'unavailable' });
const content = modules => ({ complete: true, data: { Modules: modules } });
const context = { le: '/d2l/api/le/1.100/42', courseId: '42' };
const responseClient = (bytes, contentType) => ({ response: async () => new Response(bytes, { headers: { 'content-type': contentType } }) });

test('HTML extraction decodes text and table sections without executing scripts; links stay metadata', () => {
  const value = htmlContent('<html><head><title>ignore</title></head><body><script>ignore()</script><h2>Grading &amp; policies</h2><table><tr><td>Labs</td><td>20%</td></tr></table><a href="https://example.org/?a=1&amp;b=2">Reference</a></body></html>');
  assert.match(value.text, /Grading & policies/);
  assert.match(value.text, /Labs\s+20%/);
  assert.doesNotMatch(value.text, /ignore/);
  assert.equal(value.links[0].url, 'https://example.org/?a=1&b=2');
});

test('PDF bytes and actual extracted text are distinct from blank or broken documents', async () => {
  const bytes = await readFile(new URL('./fixtures/syllabus.pdf', import.meta.url));
  const document = await readDocument(responseClient(bytes, 'application/pdf'), '/file');
  assert.equal(document.textStatus, 'available', document.textError);
  assert.equal(document.pages, 1);
  assert.match(document.text, /Course Syllabus/);
  assert.match(document.text, /Learning outcomes/);
  const blank = await readDocument(responseClient(await readFile(new URL('./fixtures/blank.pdf', import.meta.url)), 'application/pdf'), '/file');
  assert.equal(blank.textStatus, 'empty');
  const broken = await readDocument(responseClient('not a PDF', 'application/pdf'), '/file');
  assert.equal(broken.textStatus, 'failed');
  assert.ok(broken.base64);
  assert.equal(broken.text, null);
});

test('document read limits and body-stream failures remain explicit partial/retry outcomes', async () => {
  await assert.rejects(readDocument(responseClient(Buffer.alloc(20 * 1024 * 1024 + 1), 'text/plain'), '/file'), { code: 'partial' });
  const stream = new ReadableStream({ start(controller) { controller.error(new Error('private network detail')); } });
  const client = { response: async () => new Response(stream, { headers: { 'content-type': 'text/plain' } }) };
  await assert.rejects(readDocument(client, '/file'), error => error.code === 'retry_wait' && !error.message.includes('private'));
});

test('unset or empty overview is not syllabus success; failed content discovery stays incomplete', async () => {
  const overview = missingOverview();
  assert.equal(overview.outcome, 'not_configured');
  assert.equal(overview.complete, true);
  assert.equal(overview.status, 404);
  const result = await collectSyllabus({}, { ...context, content: content([]), overview });
  assert.equal(result.summary.result, 'unresolved');
  assert.equal(result.summary.readableSourceCount, 0);
  const empty = await collectSyllabus({}, { ...context, content: content([]), overview: { outcome: 'available', complete: true, data: { Description: { Html: '<p> </p>' }, HasAttachment: false } } });
  assert.equal(empty.summary.overview, 'empty');
  assert.equal(empty.summary.result, 'unresolved');
  const failed = await collectSyllabus({}, { ...context, content: { outcome: 'failed', complete: false }, overview });
  assert.equal(failed.summary.discoveryComplete, false);
});

test('multiple HTML pages retain parent context and distinct inline sections instead of one arbitrary file', async () => {
  const client = { response: async path => new Response(path.endsWith('/2/file') ? '<h1>Grading</h1><p>Assignments and quizzes.</p>' : '<p>Learning outcomes and course topics.</p>', { headers: { 'content-type': 'text/html' } }) };
  const result = await collectSyllabus(client, { ...context, overview: missingOverview(), content: content([{ ModuleId: 1, Title: 'Course Information',
    Description: { Html: '<p>Course information is split across the following pages.</p>' },
    Topics: [{ TopicId: 2, Title: 'Grading', ActivityType: 1 }, { TopicId: 3, Title: 'Objectives', ActivityType: 1 }] }]) });
  assert.equal(result.summary.result, 'course_information');
  assert.equal(result.summary.readableSourceCount, 3);
  assert.equal(result.summary.textCoverageComplete, true);
  const sources = result.observations.filter(item => item.category === 'syllabus_source');
  assert.match(sources.find(item => item.data?.topicId === 2).data.text, /Grading/);
  assert.deepEqual(sources.find(item => item.data?.topicId === 2).data.parents, ['Course Information']);
});

test('empty overview description can still expose a readable syllabus attachment', async () => {
  const bytes = await readFile(new URL('./fixtures/syllabus.pdf', import.meta.url));
  const client = responseClient(bytes, 'application/pdf');
  const result = await collectSyllabus(client, { ...context, content: content([]),
    overview: { outcome: 'available', complete: true, data: { Description: { Text: '' }, HasAttachment: true } } });
  assert.equal(result.summary.overview, 'empty');
  assert.equal(result.summary.result, 'explicit_sources');
  assert.equal(result.summary.readableSourceCount, 1);
  assert.equal(result.summary.explicitSourceCount, 1);
  assert.equal(result.observations.find(item => item.data?.kind === 'overview_attachment').source, `${context.le}/overview/attachment`);
});

test('hidden sources are not fetched and external links never receive school credentials', async () => {
  const calls = [];
  const client = { origin: 'https://onq.queensu.ca', get: async path => { calls.push(path); return { Url: 'https://outside.example/syllabus' }; },
    response: async () => { throw new Error('Must not fetch files or external sites'); } };
  const result = await collectSyllabus(client, { ...context, overview: missingOverview(), content: content([{ ModuleId: 1, Title: 'Course Information',
    Topics: [{ TopicId: 2, Title: 'Syllabus', ActivityType: 1, IsLocked: true }, { TopicId: 3, Title: 'External syllabus', ActivityType: 27 }] }]) });
  assert.deepEqual(calls, ['/d2l/api/le/1.100/42/content/topics/3']);
  assert.equal(result.summary.readableSourceCount, 0);
  assert.equal(result.summary.textCoverageComplete, false);
  assert.equal(result.summary.unreadLinkCount, 1);
  assert.equal(result.observations.find(item => item.data?.topicId === 3).data.links[0].status, 'external_auth_required');
});

test('syllabus document budget reports deferred candidates instead of claiming full coverage', async () => {
  let reads = 0;
  const client = { response: async () => { reads++; return new Response('Course information', { headers: { 'content-type': 'text/plain' } }); } };
  const result = await collectSyllabus(client, { ...context, overview: missingOverview(), content: content([{ ModuleId: 99, Title: 'Course Information',
    Topics: Array.from({ length: 21 }, (_, index) => ({ TopicId: index + 1, Title: `Section ${index + 1}`, ActivityType: 1 })) }]) });
  assert.equal(reads, 20);
  assert.equal(result.summary.candidateCount, 21);
  assert.equal(result.summary.limited, true);
  assert.equal(result.summary.discoveryComplete, false);
  assert.equal(result.summary.unresolvedSourceCount, 1);
});

test('expired authentication aborts syllabus retrieval instead of becoming an empty result', async () => {
  const client = { response: async () => { throw new AccessError('needs_login', 'Sign-in required.'); } };
  await assert.rejects(collectSyllabus(client, { ...context, overview: missingOverview(),
    content: content([{ ModuleId: 1, Title: 'Syllabus', Topics: [{ TopicId: 2, Title: 'Syllabus', ActivityType: 1 }] }]) }), { code: 'needs_login' });
});

test('source-level failures retain good cached text, but explicit denial and overview removal invalidate only their own data', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'dd2l-syllabus-'));
  const store = new Store(directory);
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  const enrollments = { complete: true, data: [{ OrgUnit: { Id: 42 }, Access: { CanAccess: true } }] };
  const identity = { Identifier: '7' };
  const input = { ...context, overview: missingOverview(), content: content([{ ModuleId: 1, Title: 'Syllabus', Topics: [{ TopicId: 2, Title: 'Course syllabus', ActivityType: 1 }] }]) };
  const client = responseClient('Course syllabus: grading and course policies.', 'text/plain');
  const first = await collectSyllabus(client, input);
  store.commit(identity, 'https://onq.queensu.ca', [...first.observations, { key: 'old-overview', category: 'overview', outcome: 'available', data: { Text: 'old' } }], {}, enrollments);
  const key = first.observations.find(item => item.data?.kind === 'content_file').key;
  const original = store.db.prepare('SELECT data FROM resources WHERE key=?').get(key).data;
  const restricted = structuredClone(input);
  restricted.content.data.Modules[0].Topics[0].IsLocked = true;
  store.commit(identity, 'https://onq.queensu.ca', (await collectSyllabus(client, restricted)).observations, {}, enrollments);
  assert.equal(store.db.prepare('SELECT data FROM resources WHERE key=?').get(key).data, null);
  store.commit(identity, 'https://onq.queensu.ca', first.observations, {}, enrollments);
  for (const code of ['retry_wait', 'extraction_failed', 'denied']) {
    client.response = code === 'extraction_failed' ? async () => new Response('broken PDF', { headers: { 'content-type': 'application/pdf' } }) : async () => { throw new AccessError(code, 'Read did not succeed.'); };
    const result = await collectSyllabus(client, input);
    store.commit(identity, 'https://onq.queensu.ca', result.observations, {}, enrollments);
    assert.equal(store.db.prepare('SELECT data FROM resources WHERE key=?').get(key).data, code === 'denied' ? null : original);
  }
  store.commit(identity, 'https://onq.queensu.ca', [{ ...missingOverview(), key: 'old-overview', category: 'overview' }], {}, enrollments);
  assert.equal(store.db.prepare('SELECT data FROM resources WHERE key=?').get('old-overview').data, null);
});
