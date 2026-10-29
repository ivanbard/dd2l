import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccessError, BrightspaceClient, SCHOOL, apiUrl, request, readJson } from '../src/client.mjs';
import { Session, protect } from '../src/session.mjs';
import { Store, lock, withoutCredentials } from '../src/store.mjs';
import { Connector, sync } from '../src/connector.mjs';

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });
const identity = { Identifier: '7', UniqueName: 'private-user' };
const enrollment = { OrgUnit: { Id: 42, Name: 'Private course' }, Access: { CanAccess: true, IsActive: true } };
const credentials = () => ({ origin: SCHOOL, identity, csrf: 'fake-xsrf',
  cookies: [{ name: 'session', value: 'fake-cookie', domain: 'onq.queensu.ca', path: '/', expires: -1 }],
  token: 'old-token', expiresAt: Date.now() + 3600_000 });
const memoryCrypt = async bytes => bytes;

async function temporary(t) {
  const directory = await mkdtemp(join(tmpdir(), 'dd2l-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('credentials cannot be sent to a different origin, non-API path, or redirected host', async () => {
  for (const path of ['https://evil.example/d2l/api/le/1/a', '//evil.example/d2l/api/a', '/d2l/home', '/d2l/api/../home']) {
    assert.throws(() => apiUrl(SCHOOL, path), { code: 'invalid_link' });
  }
  let calls = 0;
  const client = new BrightspaceClient({ token: async () => 'secret' }, { fetchImpl: async (url, options) => {
    calls++;
    assert.equal(new URL(url).origin, SCHOOL);
    assert.equal(options.redirect, 'manual');
    return new Response(null, { status: 302, headers: { location: 'https://evil.example/d2l/api/steal' } });
  } });
  await assert.rejects(client.get('/d2l/api/a'), { code: 'redirect' });
  assert.equal(calls, 1);
  await assert.rejects(client.get('https://evil.example/d2l/api/a'), { code: 'invalid_link' });
  assert.equal(calls, 1);
});

test('valid JSON, login HTML, malformed HTML, denials and throttling stay distinct', async () => {
  assert.deepEqual(await readJson(json([])), []);
  await assert.rejects(readJson(new Response('<script>/d2l/login?sessionExpired=1</script>', { headers: { 'content-type': 'text/html' } })), { code: 'needs_login' });
  await assert.rejects(readJson(new Response('maintenance', { headers: { 'content-type': 'text/html' } })), { code: 'invalid_response' });
  assert.deepEqual(await readJson(json({ description: '/d2l/login?sessionExpired=1' })), { description: '/d2l/login?sessionExpired=1' });
  for (const [status, code] of [[401, 'needs_login'], [403, 'denied'], [404, 'unavailable'], [429, 'retry_wait'], [503, 'retry_wait']]) {
    await assert.rejects(request(SCHOOL, {}, async () => json({}, status, { 'retry-after': '120' })), error => {
      assert.equal(error.code, code);
      assert.equal(error.status, status);
      if (status === 429) assert.equal(error.retryAfter, 120_000);
      return true;
    });
  }
});

test('bookmark collections include every page and report loops/invalid continuation as partial', async () => {
  const client = new BrightspaceClient({ token: async () => 'token' }, { fetchImpl: async url => {
    const bookmark = new URL(url).searchParams.get('bookmark');
    return json(bookmark ? { Items: [2], PagingInfo: { HasMoreItems: false } } : { Items: [1], PagingInfo: { HasMoreItems: true, Bookmark: 'a&b' } });
  } });
  assert.deepEqual(await client.collection('/d2l/api/items/?x=1'), { data: [1, 2], pages: 2, complete: true });
  client.fetch = async () => json({ Items: [1], PagingInfo: { HasMoreItems: true, Bookmark: 'same' } });
  const loop = await client.collection('/d2l/api/items/');
  assert.equal(loop.complete, false);
  assert.equal(loop.pages, 2);
  client.fetch = async () => json({ Items: [1], PagingInfo: { HasMoreItems: true } });
  assert.equal((await client.collection('/d2l/api/items/')).complete, false);
  client.fetch = async () => json({ Items: [] });
  const malformed = await client.collection('/d2l/api/items/');
  assert.equal(malformed.complete, false);
  assert.equal(malformed.error, 'invalid_response');
});

test('object pagination rejects hostile next links and preserves earlier pages on network failure', async () => {
  const client = new BrightspaceClient({ token: async () => 'token' }, { fetchImpl: async () =>
    json({ Objects: [1], Next: 'https://evil.example/d2l/api/next' }) });
  const result = await client.collection('/d2l/api/items/');
  assert.equal(result.complete, false);
  assert.equal(result.error, 'invalid_link');
  let calls = 0;
  client.fetch = async () => {
    if (calls++) throw new Error('network');
    return json({ Objects: [1], Next: '/d2l/api/items/?bookmark=2' });
  };
  const interrupted = await client.collection('/d2l/api/items/');
  assert.deepEqual(interrupted.data, [1]);
  assert.equal(interrupted.error, 'retry_wait');
  assert.equal(interrupted.complete, false);
});

test('concurrent rejected API tokens share one renewal; saved session works after restart', async t => {
  const directory = await temporary(t);
  let renewals = 0;
  const fetchImpl = async (url, options) => {
    if (new URL(url).pathname.endsWith('/token')) {
      renewals++;
      await new Promise(resolve => setTimeout(resolve, 10));
      assert.equal(options.headers.cookie, 'session=fake-cookie');
      assert.equal(options.headers['x-csrf-token'], 'fake-xsrf');
      return json({ access_token: 'new-token', expires_in: 3600 });
    }
    return options.headers.authorization === 'Bearer old-token' ? json({}, 401) : json({ ok: true });
  };
  const session = new Session(directory, { fetchImpl, crypt: memoryCrypt });
  await session.save(credentials());
  const client = new BrightspaceClient(session, { fetchImpl });
  assert.deepEqual(await Promise.all([client.get('/d2l/api/a'), client.get('/d2l/api/b')]), [{ ok: true }, { ok: true }]);
  assert.equal(renewals, 1);
  const restarted = new Session(directory, { fetchImpl, crypt: memoryCrypt });
  assert.equal(await restarted.token(), 'new-token');
  assert.equal(renewals, 1);
});

test('temporary renewal failures preserve the saved session', async t => {
  const directory = await temporary(t);
  const session = new Session(directory, { fetchImpl: async () => json({}, 503), crypt: memoryCrypt });
  await session.save({ ...credentials(), expiresAt: 0 });
  const before = await readFile(session.path);
  await assert.rejects(session.token(), { code: 'retry_wait' });
  assert.deepEqual(await readFile(session.path), before);
});

test('Windows DPAPI protects the session and permits this user to unlock it', { skip: process.platform !== 'win32' }, async t => {
  const directory = await temporary(t);
  const plain = Buffer.from('dd2l-dpapi-test-only');
  const encrypted = await protect(plain);
  assert.equal(encrypted.includes(plain), false);
  assert.deepEqual(await protect(encrypted, true), plain);
  const session = new Session(directory);
  await session.save(credentials());
  assert.equal((await readFile(session.path)).includes(Buffer.from('fake-cookie')), false);
  assert.deepEqual((await new Session(directory).load()).identity, identity);
});

test('partial/failed reads retain last good data; explicit denials clear it; accounts cannot mix', async t => {
  let store;
  t.after(() => store?.close());
  store = new Store(await temporary(t));
  const observation = { key: 'grades', course: '42', category: 'grades', source: '/d2l/api/grades/?window=original', outcome: 'available', complete: true, data: [90] };
  const enrollments = { complete: true, data: [enrollment] };
  store.commit(identity, SCHOOL, [observation], {}, enrollments);
  for (const outcome of ['partial', 'failed', 'available']) {
    store.commit(identity, SCHOOL, [{ ...observation, source: '/d2l/api/grades/?window=new', outcome, complete: false, data: [] }], {}, enrollments);
    assert.equal(store.db.prepare('SELECT data FROM resources').get().data, '[90]');
    assert.equal(store.db.prepare('SELECT last_source FROM resources').get().last_source, observation.source);
  }
  await assert.rejects(async () => store.commit({ Identifier: 8 }, SCHOOL, [], {}, enrollments), /another school account/);
  store.commit(identity, SCHOOL, [{ ...observation, outcome: 'denied', data: undefined }], {}, enrollments);
  assert.equal(store.db.prepare('SELECT data FROM resources').get().data, null);
});

test('only a complete enrollment read invalidates access; unknown access does not delete cached data', async t => {
  let store;
  t.after(() => store?.close());
  store = new Store(await temporary(t));
  const observation = { key: 'content', course: '42', category: 'content', outcome: 'available', data: { original: true } };
  store.commit(identity, SCHOOL, [observation], {}, { complete: true, data: [enrollment] });
  store.commit(identity, SCHOOL, [], {}, { complete: false, data: [] });
  assert.ok(store.db.prepare('SELECT data FROM resources').get().data);
  store.commit(identity, SCHOOL, [], {}, { complete: true, data: [{ OrgUnit: { Id: 42 } }] });
  assert.ok(store.db.prepare('SELECT data FROM resources').get().data);
  store.commit(identity, SCHOOL, [], {}, { complete: true, data: [] });
  assert.equal(store.db.prepare('SELECT data FROM resources').get().data, null);
  assert.equal(store.db.prepare('SELECT observation FROM resources').get().observation.includes('original'), false);
});

test('stored observations strip credential query parameters but preserve original field names', () => {
  const safe = withoutCredentials({ Url: '/content/file?d2lSessionVal=secret&x=1', access_token: 'secret', Nested: { Text: 'reading' } });
  assert.equal(JSON.stringify(safe).includes('secret'), false);
  assert.deepEqual(Object.keys(safe), ['Url', 'access_token', 'Nested']);
  assert.equal(safe.Nested.Text, 'reading');
});

function fakeBrightspace() {
  let failContent = false;
  const fetchImpl = async (url, options) => {
    const path = new URL(url).pathname;
    if (path === '/d2l/api/versions/') return json([{ ProductCode: 'lp', LatestVersion: '1.64' }, { ProductCode: 'le', LatestVersion: '1.100' }]);
    assert.equal(options.headers.authorization, 'Bearer old-token');
    if (path.endsWith('/users/whoami')) return json(identity);
    if (path.includes('/enrollments/myenrollments/')) return json({ Items: [enrollment], PagingInfo: { HasMoreItems: false } });
    if (path.endsWith('/content/toc')) {
      if (failContent) throw new Error('offline');
      return json({ Modules: [{ Title: 'Private module', Topics: [{ TopicId: 3, ActivityType: 1, TypeIdentifier: 'File', Title: 'Private reading' }] }], OriginalField: 'retained' });
    }
    if (path.endsWith('/content/topics/3/file')) return new Response('Private reading body', { headers: { 'content-type': 'text/plain' } });
    if (path.endsWith('/dropbox/folders/')) return json([{ Id: 11, Name: 'Private assignment' }]);
    if (path.endsWith('/discussions/forums/')) return json([{ ForumId: 12 }]);
    if (path.endsWith('/topics/')) return json([{ TopicId: 13 }]);
    if (path.endsWith('/overview')) return json({ Description: { Text: 'Private syllabus' } });
    if (path.endsWith('/feedback/user/7')) return json({ Feedback: 'Private feedback' });
    if (path.endsWith('/dropbox/folders/11')) return json({ Id: 11, Rubrics: [] });
    if (path.endsWith('/calendar/events/myEvents/')) {
      assert.ok(new URL(url).searchParams.get('startDateTime'));
      return json({ Objects: [], Next: null });
    }
    return json([]);
  };
  return { fetchImpl, failContent: () => { failContent = true; } };
}

test('direct audit traverses a course, retains private source data, and produces a structural summary', async t => {
  let store;
  t.after(() => store?.close());
  const directory = await temporary(t);
  store = new Store(directory);
  const fake = fakeBrightspace();
  const session = new Session(directory, { crypt: memoryCrypt });
  session.value = credentials();
  const connector = new Connector(new BrightspaceClient(session, { fetchImpl: fake.fetchImpl }), store);
  const summary = await connector.audit({ course: '42', from: '2026-09-01T00:00:00Z', to: '2027-01-01T00:00:00Z' });
  assert.equal(summary.complete, true);
  assert.equal(summary.courseCount, 1);
  assert.equal(summary.syllabus.readableSourceCount, 1);
  assert.ok(summary.resources.find(item => item.category === 'content_file'));
  assert.ok(summary.resources.find(item => item.category === 'discussion_posts'));
  assert.equal(JSON.stringify(summary).includes('Private'), false);
  assert.equal(JSON.stringify(summary).includes('private-user'), false);
  const saved = store.db.prepare("SELECT data FROM resources WHERE category='content'").get().data;
  assert.equal(JSON.parse(saved).OriginalField, 'retained');
  fake.failContent();
  const interrupted = await connector.audit({ course: '42' });
  assert.equal(interrupted.complete, false);
  assert.equal(interrupted.resources.find(item => item.category === 'content').error, 'retry_wait');
  assert.equal(store.db.prepare("SELECT data FROM resources WHERE category='content'").get().data, saved);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS count FROM resources WHERE category='calendar'").get().count, 1);
  await assert.rejects(connector.audit({ course: '42/../../users' }), /numeric Brightspace ID/);
  await assert.rejects(connector.audit({ from: 'bad-date', to: 'yesterday' }), /Calendar window/);
});

test('sync awaits report persistence, backs off, and stops when login is required', async () => {
  const updates = [];
  const states = [];
  let calls = 0;
  const connector = { store: { getMeta: () => null, meta: (_key, value) => states.push(value.state) }, audit: async () => {
    if (calls++ === 0) throw new AccessError('retry_wait', 'Temporary failure', { retryAfter: 120_000 });
    throw new AccessError('needs_login', 'Sign in again.');
  } };
  await assert.rejects(sync(connector, {}, {
    onUpdate: async value => { await Promise.resolve(); updates.push(value.state); },
    wait: async delay => { assert.equal(delay, 120_000); assert.deepEqual(updates, ['retry_wait']); },
  }), { code: 'needs_login' });
  assert.deepEqual(states, ['syncing', 'retry_wait', 'syncing', 'needs_login']);
  assert.equal(calls, 2);
});

test('worker lock prevents overlapping commands and recovers a dead process lock', async t => {
  const directory = await temporary(t);
  const release = await lock(directory);
  await assert.rejects(lock(directory), /Another dd2l command/);
  await release();
  await writeFile(join(directory, 'worker.lock'), JSON.stringify({ pid: 2147483647, id: 'dead' }));
  const recovered = await lock(directory);
  await recovered();
});

for (const targetSource of ['membership', 'own_submission', 'unresolved']) {
  test(`group feedback uses ${targetSource} evidence and never guesses a user/category ID`, async t => {
    let store;
    t.after(() => store?.close());
    const directory = await temporary(t);
    store = new Store(directory);
    const fake = fakeBrightspace();
    const calls = [];
    const rubric = { RubricId: 50, CriteriaGroups: [{ Criteria: [{ CriterionId: 51 }], Levels: [{ LevelId: 52 }] }] };
    const folder = { Id: 12, DropboxType: 1, GroupTypeId: 99, GradeItemId: 90, Assessment: { Rubrics: [rubric] } };
    const fetchImpl = async (url, options) => {
      const path = new URL(url).pathname;
      calls.push(path);
      if (path.endsWith('/dropbox/folders/')) return json([{ Id: 11, DropboxType: 2 }, folder]);
      if (path.endsWith('/grades/values/myGradeValues/')) return json([{ GradeObjectIdentifier: '90', PointsNumerator: 0 }]);
      if (path.endsWith('/42/groups/')) return targetSource === 'own_submission' ? json({}, 403) :
        json([{ GroupCategoryId: targetSource === 'unresolved' ? 100 : 99, GroupId: 55 }]);
      if (path.endsWith('/dropbox/folders/12')) return json(folder);
      if (path.endsWith('/12/submissions/mysubmissions/')) return targetSource === 'own_submission' ?
        json([{ Entity: { EntityType: 'Group', EntityId: 55 }, Submissions: [] }]) : json({}, 403);
      if (path.endsWith('/12/feedback/group/55')) return json({ Score: 0, Feedback: { Text: 'Private group feedback' }, RubricAssessments: [{ RubricId: 50 }] });
      assert.ok(!path.includes('/12/feedback/'), 'Must not use a user ID, category ID, or ambiguous group.');
      assert.ok(!path.includes('/rubrics/') || !new URL(url).searchParams.has('objectId') || new URL(url).searchParams.get('objectId') !== '12', 'Embedded complete rubric data does not need another API request.');
      return fake.fetchImpl(url, options);
    };
    const session = new Session(directory, { crypt: memoryCrypt });
    session.value = credentials();
    const connector = new Connector(new BrightspaceClient(session, { fetchImpl }), store);
    const summary = await connector.audit({ course: '42' });
    const feedback = summary.resources.find(item => item.category === 'own_feedback');
    assert.equal(feedback.outcome, targetSource === 'unresolved' ? 'unknown' : 'available');
    assert.equal(calls.some(path => path.endsWith('/feedback/group/55')), targetSource !== 'unresolved');
    const saved = store.db.prepare("SELECT data FROM resources WHERE category='rubrics'").get();
    assert.deepEqual(JSON.parse(saved.data), [rubric]);
    assert.equal(summary.resources.find(item => item.category === 'rubrics').count, 1);
    assert.equal(JSON.stringify(summary).includes('Private group feedback'), false);
    if (targetSource !== 'unresolved') assert.equal(JSON.parse(store.db.prepare("SELECT data FROM resources WHERE category='own_feedback'").get().data).Score, 0);
  });
}

test('audit prioritizes graded/rubric assignments then traverses the rest, preserving a real 403', async t => {
  let store;
  t.after(() => store?.close());
  const directory = await temporary(t);
  store = new Store(directory);
  const fake = fakeBrightspace();
  const folders = [{ Id: 11 }, { Id: 12, GradeItemId: 90 }, { Id: 13, Assessment: { Rubrics: [{ RubricId: 50 }] } }];
  const fetchImpl = async (url, options) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/dropbox/folders/')) return json(folders);
    if (path.endsWith('/grades/values/myGradeValues/')) return json([{ GradeObjectIdentifier: 90, PointsNumerator: 10 }]);
    if (path.endsWith('/folders/12')) return json(folders[1]);
    if (path.endsWith('/folders/13')) return json(folders[2]);
    if (path.endsWith('/12/feedback/user/7')) return json({ Score: 10 });
    if (path.endsWith('/13/feedback/user/7')) return json({}, 403);
    return fake.fetchImpl(url, options);
  };
  const session = new Session(directory, { crypt: memoryCrypt });
  session.value = credentials();
  const summary = await new Connector(new BrightspaceClient(session, { fetchImpl }), store).audit({ course: '42' });
  assert.equal(summary.resources.filter(item => item.category === 'assignment_detail').length, 3);
  assert.deepEqual(summary.resources.filter(item => item.category === 'own_feedback').map(item => item.outcome), ['available', 'denied', 'available']);
  const rubrics = store.db.prepare("SELECT key,data FROM resources WHERE category='rubrics'").all();
  assert.equal(rubrics.length, 3);
  assert.ok(rubrics.some(row => row.key.includes('objectId=12') && row.data === '[]'));
  assert.ok(rubrics.some(row => row.key.includes('/folders/13/assessment/rubrics')));
});

test('assignment traversal resumes past the first batch and does not keep sampling the same folders', async t => {
  let store; t.after(() => store?.close()); store = new Store(await temporary(t));
  const fake = fakeBrightspace(), visited = [];
  const folders = Array.from({ length: 30 }, (_, index) => ({ Id: index + 1 }));
  const fetchImpl = async (url, options) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/dropbox/folders/')) return json(folders);
    const match = path.match(/\/dropbox\/folders\/(\d+)$/);
    if (match) { visited.push(Number(match[1])); return json({ Id: Number(match[1]) }); }
    return fake.fetchImpl(url, options);
  };
  const session = new Session('', { crypt: memoryCrypt }); session.value = credentials();
  const connector = new Connector(new BrightspaceClient(session, { fetchImpl }), store);
  const first = await connector.audit({ course: '42' });
  assert.equal(first.traversal.assignments.processed, 25);
  await connector.audit({ course: '42' });
  assert.deepEqual([...new Set(visited)].sort((a, b) => a - b), folders.map(folder => folder.Id));
  assert.equal(store.getMeta('cursor:42:assignments:'), 0);
});

test('all-course passes advance five at a time without changing the pinned sync course', async () => {
  const metadata = new Map([['selected_course', 'pinned']]);
  const store = { getMeta: key => metadata.get(key), meta: (key, value) => metadata.set(key, value) };
  const connector = new Connector({}, store);
  connector.courses = async () => ({ enrollments: { complete: true, data: Array.from({ length: 7 }, (_, i) => ({ OrgUnit: { Id: i + 1 }, Access: { CanAccess: true } })) } });
  const visited = [];
  connector.audit = async ({ course }) => { visited.push(course); store.meta('selected_course', course); return { complete: true }; };
  const first = await connector.auditAll({});
  assert.equal(first.coursesProcessed, 5); assert.equal(first.nextCourseOffset, 5);
  await connector.auditAll({});
  assert.deepEqual(visited, ['1', '2', '3', '4', '5', '6', '7']);
  assert.equal(store.getMeta('selected_course'), 'pinned');
});

test('rate limiting aborts traversal immediately and preserves the prior snapshot/checkpoint', async t => {
  let store; t.after(() => store?.close()); store = new Store(await temporary(t));
  const fake = fakeBrightspace(); const calls = [];
  const session = new Session('', { crypt: memoryCrypt }); session.value = credentials();
  const connector = new Connector(new BrightspaceClient(session, { fetchImpl: fake.fetchImpl }), store);
  await connector.audit({ course: '42' });
  const before = store.resource('/d2l/api/le/1.100/42/content/toc');
  connector.client.fetch = async (url, options) => {
    const path = new URL(url).pathname; calls.push(path);
    return path.endsWith('/content/toc') ? json({}, 429, { 'retry-after': '120' }) : fake.fetchImpl(url, options);
  };
  await assert.rejects(connector.audit({ course: '42' }), error => error.code === 'retry_wait' && error.retryAfter === 120_000);
  assert.equal(calls.some(path => path.endsWith('/dropbox/folders/')), false);
  assert.deepEqual(store.resource(before.key).data, before.data);
});

test('recurring events retain server-provided occurrences and quiz attempts are scoped to the current user', async t => {
  let store; t.after(() => store?.close()); store = new Store(await temporary(t));
  const fake = fakeBrightspace(); const paths = [];
  const occurrence = { CalendarEventId: 90, StartDateTime: '2026-11-01T17:00:00Z', EndDateTime: '2026-11-01T18:00:00Z' };
  const fetchImpl = async (url, options) => {
    const parsed = new URL(url); paths.push(parsed.pathname);
    if (parsed.pathname.endsWith('/calendar/events/myEvents/')) return json({ Objects: [{ CalendarEventId: 90, IsRecurring: true }], Next: null });
    if (parsed.pathname.endsWith('/calendar/event/90/occurrences')) return json({ EventDataInfo: { CalendarEventId: 90 }, Occurrences: [occurrence] });
    if (parsed.pathname.endsWith('/quizzes/')) return json([{ QuizId: 55, Name: 'Quiz' }]);
    if (parsed.pathname.endsWith('/quizzes/55/attempts/')) { assert.equal(parsed.searchParams.get('userId'), '7'); return json({ Objects: [], Next: null }); }
    return fake.fetchImpl(url, options);
  };
  const session = new Session('', { crypt: memoryCrypt }); session.value = credentials();
  await new Connector(new BrightspaceClient(session, { fetchImpl }), store).audit({ course: '42' });
  assert.ok(paths.some(path => path.endsWith('/quizzes/55/attempts/')));
  const saved = store.db.prepare("SELECT data FROM resources WHERE category='calendar_occurrences'").get();
  assert.deepEqual(JSON.parse(saved.data).Occurrences, [occurrence]);
});

test('a denied quiz list can be supplemented by verified grade/tool associations without inventing quiz IDs', async t => {
  let store; t.after(() => store?.close()); store = new Store(await temporary(t));
  const fake = fakeBrightspace(); const paths = [];
  const fetchImpl = async (url, options) => {
    const parsed = new URL(url); paths.push(parsed.pathname);
    if (parsed.pathname.endsWith('/quizzes/')) return json({}, 403);
    if (parsed.pathname.endsWith('/grades/values/myGradeValues/')) return json([{ GradeObjectIdentifier: 88, GradeObjectName: 'Quiz 1' }]);
    if (parsed.pathname.endsWith('/grades/88')) return json({ Id: 88, AssociatedTool: { ToolId: 17, ToolItemId: 55 } });
    if (parsed.pathname.endsWith('/tools/orgUnits/42/17')) { assert.equal(parsed.searchParams.get('namesOnly'), 'true'); return json({ ToolId: 17, DisplayName: 'Quizzes' }); }
    return fake.fetchImpl(url, options);
  };
  const session = new Session('', { crypt: memoryCrypt }); session.value = credentials();
  const summary = await new Connector(new BrightspaceClient(session, { fetchImpl }), store).audit({ course: '42' });
  assert.ok(paths.some(path => path.endsWith('/quizzes/55')));
  assert.equal(summary.quizDiscovery.confirmedReferences, 1);
  assert.equal(summary.quizDiscovery.unresolvedCandidates, 0);
  assert.equal(summary.quizDiscovery.sourcesComplete, false);
});
