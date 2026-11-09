import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BrightspaceClient } from '../src/client.mjs';
import { Connector } from '../src/connector.mjs';
import { Store } from '../src/store.mjs';
import { readInventory } from '../src/ui-data.mjs';
import { createResearch } from '../src/research.mjs';
import { composeTaskWorkspace } from '../src/task-workspace.mjs';
import { createUiServer } from '../src/ui-server.mjs';

const origin = 'https://school.example';
const browse = (section, query = '', course = '42') => ({ action: 'browse', section, query, course });
const read = resource => ({ action: 'read', resource });
const decision = requests => ({ title: 'Find the coursework', goal: 'Work on recursion', question: '', sections: [], requests });

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'dd2l-research-'));
  const store = new Store(directory);
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  const state = { allowed: true, hidden: false, rateLimit: false, expired: false, deniedFile: false };
  const requests = [];
  const json = (value, status = 200) => Response.json(value, { status });
  const identity = { Identifier: '7' };
  const enrollments = () => [{ OrgUnit: { Id: 42, Name: 'CISC 121' }, Access: { CanAccess: state.allowed, IsActive: true } }];
  const fetchImpl = async (url, options) => {
    const target = new URL(url), path = target.pathname;
    requests.push({ url: target.href, method: options.method || 'GET', headers: options.headers });
    assert.equal(options.method || 'GET', 'GET');
    assert.equal(target.origin, origin);
    if (path === '/d2l/api/versions/') return json([{ ProductCode: 'lp', LatestVersion: '1.93' }, { ProductCode: 'le', LatestVersion: '1.100' }]);
    if (path.endsWith('/users/whoami')) return state.expired ? json({}, 401) : json(identity);
    if (path.includes('/enrollments/myenrollments/')) return json(enrollments());
    if (state.rateLimit) return json({}, 429);
    if (path.endsWith('/content/toc')) return json({ Modules: [{ Title: 'Recursion', IsHidden: state.hidden, Topics: [
      { TopicId: 10, Title: 'Recursion worksheet', ActivityType: 1 },
      { TopicId: 11, Title: 'Recursion HTML notes', ActivityType: 1, Url: '/content/enforced/42-course/notes.html' },
    ] }] });
    if (path.endsWith('/content/topics/10/file')) return state.deniedFile ? json({}, 403)
      : new Response('Previously uncached recursion instructions. Implement and test recursive functions.', { headers: { 'content-type': 'text/plain' } });
    if (path.endsWith('/content/topics/11/file')) return new Response(`<main><h1>Recursion notes</h1><a href="extra.html">Worked example</a><a href="https://evil.example/private">Unsupported</a><a href="/d2l/common/dialogs/quickLink/quickLink.d2l?type=quiz">Start quiz</a></main>`, { headers: { 'content-type': 'text/html' } });
    if (path === '/content/enforced/42-course/extra.html') {
      assert.equal(options.headers.authorization, undefined);
      assert.equal(options.headers.cookie, 'session=fake-cookie');
      return new Response('<main>A freshly followed worked example.</main>', { headers: { 'content-type': 'text/html' } });
    }
    if (path.endsWith('/dropbox/folders/')) return json([{ Id: 5, Name: 'Assignment 2', Instructions: { Text: 'Read the worksheet.' } }]);
    if (path.endsWith('/dropbox/folders/5')) return json({ Id: 5, Name: 'Assignment 2', Instructions: { Text: 'Submit a recursion report.' }, Attachments: [{ FileId: 9, FileName: 'Requirements.txt' }] });
    if (path.endsWith('/rubrics/')) { assert.equal(target.searchParams.get('objectId'), '5'); return json([{ Name: 'Recursion rubric', Criteria: [{ Name: 'Correctness', Points: 10 }] }]); }
    if (path.endsWith('/submissions/mysubmissions/')) return json([{ Submissions: [] }]);
    if (path.endsWith('/feedback/user/7')) return json({}, 403);
    if (path.endsWith('/dropbox/folders/5/attachments/9')) return new Response('Uncached assignment attachment.', { headers: { 'content-type': 'text/plain' } });
    if (path.endsWith('/quizzes/')) return json([{ QuizId: 6, Name: 'Recursion quiz' }]);
    if (path.endsWith('/quizzes/6')) return json({ QuizId: 6, Name: 'Recursion quiz', Instructions: { Text: 'Review recursive calls.' } });
    if (path.endsWith('/quizzes/6/attempts/')) { assert.equal(target.searchParams.get('userId'), '7'); return json([]); }
    throw new Error(`Unexpected fixture read: ${path}`);
  };
  const session = { token: async () => 'fake-token', load: async () => ({ identity,
    cookies: [{ name: 'session', value: 'fake-cookie', domain: 'school.example', path: '/', expires: -1 }] }) };
  const client = new BrightspaceClient(session, { origin, fetchImpl });
  const connector = new Connector(client, store);
  const path = join(directory, 'inventory.sqlite');
  store.commit(identity, origin, [{ key: 'enrollments', category: 'enrollments', data: enrollments(), outcome: 'available', complete: true }], { scope: 'Existing sync summary' }, { data: enrollments(), complete: true });
  store.meta('selected_course', '123'); store.meta('cursor:42:content_files:', 20);
  return { state, requests, connector, store, path, refresh: () => readInventory(path) };
}

test('a model can discover and fetch uncached course material, then build a workspace from the new evidence', async t => {
  const f = await fixture(t);
  assert.equal(f.refresh().sources.length, 0);
  const research = createResearch({ connector: f.connector, inventoryPath: f.path, scope: '42' });
  let turns = 0;
  const task = await composeTaskWorkspace({ planWorkspace: async (query, model, input) => {
    turns++;
    if (turns === 1) return decision([browse('content', 'recursion')]);
    if (turns === 2) {
      const resource = input.browsing.history[0].result.resources.find(item => item.kind === 'topic');
      return decision([read(resource.resource)]);
    }
    const file = input.catalogue.find(source => source.category === 'content_file');
    assert.match(file.preview, /Previously uncached/);
    return { ...decision([]), sections: [{ title: 'Work through the worksheet', purpose: 'Use the fetched instructions', sourceIds: [file.id] }] };
  } }, f.refresh(), 'Help me work on recursion', 'model', '42', null, undefined, f.refresh, research);
  assert.equal(turns, 3);
  assert.match(task.sources[0].excerpt, /Previously uncached/);
  assert.equal(task.workspace.research.length, 2);
  assert.equal(f.store.getMeta('selected_course'), '123');
  assert.equal(f.store.getMeta('cursor:42:content_files:'), 20);
  assert.equal(f.store.getMeta('last_run').scope, 'Existing sync summary');
  assert.doesNotMatch(JSON.stringify(research.history), /fake-cookie|fake-token|base64|authorization/);
});

test('live course discovery can populate an empty inventory before the first sync', async t => {
  const f = await fixture(t);
  f.store.db.exec('DELETE FROM resources; DELETE FROM meta;');
  const inventory = f.refresh();
  assert.equal(inventory.scope, null);
  const research = createResearch({ connector: f.connector, inventoryPath: f.path, accountScope: inventory.scope || '' });
  let turns = 0;
  const result = await composeTaskWorkspace({ planWorkspace: async (q, model, input) => {
    if (++turns === 1) return decision([browse('courses', '', '')]);
    assert.equal(input.courses[0].id, '42');
    return { ...decision([]), question: 'Which material in CISC 121 would you like?' };
  } }, inventory, 'Find my classes', 'model', '', null, undefined, f.refresh, research);
  assert.equal(result.workspace.research[0].outcome, 'available');
  assert.ok(f.refresh().scope);
});

test('assignment discovery reads the rubric, own status and attachment on demand without submissions or writes', async t => {
  const f = await fixture(t);
  const research = createResearch({ connector: f.connector, inventoryPath: f.path, scope: '42' });
  const listing = await research.execute(browse('assignments'));
  const details = await research.execute(read(listing.resources[0].resource));
  assert.ok(details.outcomes.some(item => item.category === 'rubrics' && item.outcome === 'available'));
  assert.ok(details.outcomes.some(item => item.category === 'own_feedback' && item.outcome === 'denied'));
  const attachment = details.resources.find(item => item.kind === 'assignment_file');
  await research.execute(read(attachment.resource));
  assert.ok(f.refresh().assignments[0].records.some(record => record.text.includes('Uncached assignment attachment.')));
  assert.ok(f.refresh().assignments[0].records.some(record => record.text.includes('Correctness')));
  assert.ok(f.requests.every(request => request.method === 'GET'));
  assert.ok(!f.requests.some(request => /submit_files|attempts\/.*start/.test(request.url)));
});

test('document crawling follows discovered approved links and never sends school authorization to a link reader', async t => {
  const f = await fixture(t);
  const research = createResearch({ connector: f.connector, inventoryPath: f.path, scope: '42' });
  const discovery = await research.execute(browse('content', 'HTML'));
  const document = await research.execute(read(discovery.resources[0].resource));
  assert.equal(document.resources.length, 1);
  assert.equal(document.resources[0].title, 'Worked example');
  await research.execute(read(document.resources[0].resource));
  assert.ok(f.refresh().sources.some(source => source.text.includes('freshly followed worked example')));
});

test('invented handles, cross-course operations and hidden parents cannot trigger document requests', async t => {
  const f = await fixture(t);
  const resources = new Map();
  await assert.rejects(f.connector.browse(browse('content', '', 42), { resources }), { code: 'invalid_link' });
  await assert.rejects(f.connector.browse(read('https://evil.example/steal'), { resources }), { code: 'invalid_link' });
  await assert.rejects(f.connector.browse(browse('content', '', '999'), { scope: '42', resources }), { code: 'denied' });
  assert.equal(f.requests.length, 0);
  const result = await f.connector.browse(browse('content'), { scope: '42', resources });
  const handle = result.resources[0].resource;
  await f.connector.browse(read(handle), { scope: '42', resources });
  f.state.hidden = true;
  const filesBefore = f.requests.filter(item => item.url.endsWith('/file')).length;
  await assert.rejects(f.connector.browse(read(handle), { scope: '42', resources }), { code: 'restricted' });
  assert.equal(f.requests.filter(item => item.url.endsWith('/file')).length, filesBefore);
  assert.ok(!f.refresh().sources.some(source => source.text.includes('Previously uncached')));
});

test('revoked enrollment clears cached evidence, while login expiry and rate limits stop further live reads', async t => {
  const f = await fixture(t);
  let research = createResearch({ connector: f.connector, inventoryPath: f.path, scope: '42' });
  const result = await research.execute(browse('content'));
  await research.execute(read(result.resources[0].resource));
  f.state.allowed = false;
  assert.equal((await research.execute(browse('content'))).outcome, 'denied');
  assert.equal(f.refresh().sources.length, 0);
  f.state.allowed = true; f.state.rateLimit = true;
  research = createResearch({ connector: f.connector, inventoryPath: f.path, scope: '42' });
  assert.equal((await research.execute(browse('content'))).outcome, 'retry_wait');
  assert.equal(research.available, false);
  const count = f.requests.length;
  await assert.rejects(research.execute(browse('assignments')), /budget/);
  assert.equal(f.requests.length, count);
  f.state.rateLimit = false; f.state.expired = true;
  research = createResearch({ connector: f.connector, inventoryPath: f.path, scope: '42' });
  assert.equal((await research.execute(browse('content'))).outcome, 'needs_login');
  assert.equal(research.available, false);
});

test('quiz metadata and attempt history use verified quiz IDs and only the current user', async t => {
  const f = await fixture(t);
  const research = createResearch({ connector: f.connector, inventoryPath: f.path, scope: '42' });
  const result = await research.execute(browse('quizzes'));
  await research.execute(read(result.resources[0].resource));
  assert.ok(f.refresh().sources.some(source => source.category === 'quiz_details'));
  assert.ok(f.requests.some(request => request.url.endsWith('/quizzes/6/attempts/?userId=7')));
});

test('queued on-demand work cancels promptly without competing with a sync operation', async t => {
  const f = await fixture(t);
  let release;
  const active = f.connector.exclusive(() => new Promise(resolve => { release = resolve; }));
  await Promise.resolve();
  const controller = new AbortController();
  const queued = f.connector.browse(browse('content'), { signal: controller.signal });
  controller.abort();
  await assert.rejects(queued, { name: 'AbortError' });
  assert.equal(f.requests.length, 0);
  release(); await active;
  await f.connector.browse(browse('courses'));
  assert.ok(f.requests.length);
});

test('the HTTP workspace request actually drives live discovery before canvas generation', async t => {
  const f = await fixture(t);
  let turns = 0;
  const server = createUiServer({ connector: f.connector, llm: {
    planWorkspace: async (q, model, input) => {
      if (++turns === 1) return decision([browse('content')]);
      if (turns === 2) return decision([read(input.browsing.history[0].result.resources[0].resource)]);
      return { ...decision([]), sections: [{ title: 'Instructions', purpose: 'Read the new worksheet', sourceIds: [input.catalogue.find(source => source.category === 'content_file').id] }] };
    },
    generateCanvas: async (q, model, sources) => {
      assert.match(sources[0].excerpt, /Previously uncached/);
      return { title: 'Recursion', answer: 'Use the worksheet.', html: '<h1>Recursion</h1>', css: '', js: 'return {state};' };
    },
  } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const address = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(address + '/api/llm/answer', { method: 'POST', headers: { Origin: address, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: 'Find the recursion worksheet', course: '42', model: 'model', consent: true }) });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.canvas.title, 'Recursion');
  assert.equal(data.workspace.research.length, 2);
  assert.match(data.sources[0].excerpt, /Previously uncached/);
});

test('the reading loop has four rounds and eight operations, then asks the model to finish with bounded evidence', async t => {
  const f = await fixture(t);
  const research = createResearch({ connector: f.connector, inventoryPath: f.path, scope: '42' });
  let turns = 0;
  const result = await composeTaskWorkspace({ planWorkspace: async (q, model, input) => {
    const round = turns++;
    if (round < 4) return decision([browse('content', `${round} a`), browse('content', `${round} b`)]);
    assert.equal(input.browsing.available, false);
    assert.equal(input.browsing.remaining, 0);
    return { ...decision([]), question: 'Which worksheet should I focus on?' };
  } }, f.refresh(), 'Find coursework', 'model', '42', null, undefined, f.refresh, research);
  assert.equal(turns, 5);
  assert.equal(research.remaining, 0);
  assert.equal(result.workspace.research.length, 8);
  assert.match(result.workspace.question, /Which worksheet/);
});

test('the model cannot smuggle a raw URL or write action into the read schema', async t => {
  const f = await fixture(t);
  const research = createResearch({ connector: f.connector, inventoryPath: f.path, scope: '42' });
  await assert.rejects(research.execute({ action: 'read', resource: 'abcd', url: 'https://evil.example' }), /Invalid/);
  await assert.rejects(research.execute({ action: 'submit', course: '42', assignment: '5' }), /Invalid/);
  assert.equal(f.requests.length, 0);
});
