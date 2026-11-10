import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { fixtures } from '../fixtures.mjs';
import { createState, generationPrompt, reduce, validDate, validPlan } from '../model.mjs';
import { createComparisonServer } from '../server.mjs';

test('fixture plans satisfy the shared bounded schema and real demo source references', () => {
  for (const plan of Object.values(fixtures.scenarios)) assert.equal(validPlan(plan, fixtures.sources), true);
  assert.equal(validDate('2026-02-30'), false);
  assert.equal(validDate('not a date'), false);
  assert.equal(validDate('2028-02-29'), true);
  const plan = structuredClone(fixtures.scenarios.planner);
  plan.sections[0].items[0].sourceId = 'forged';
  assert.equal(validPlan(plan, fixtures.sources), false);
  plan.sections[0].items[0].sourceId = fixtures.sources[0].id;
  plan.sections[1].id = plan.sections[0].id;
  assert.equal(validPlan(plan, fixtures.sources), false);
  plan.sections[1].id = 'constructor';
  assert.equal(validPlan(plan, fixtures.sources), false);
  assert.equal(validPlan({ ...fixtures.scenarios.planner, html: '<script>bad()</script>' }, fixtures.sources), false);
  assert.equal(validPlan({ ...fixtures.scenarios.planner, title: 'x'.repeat(161) }, fixtures.sources), false);
});

test('adaptation preserves stable progress and drops removed controls or changed questions', () => {
  const plan = fixtures.scenarios.planner;
  let state = createState(plan);
  state = reduce(plan, state, { type: 'value', id: 'calculations', value: true });
  state = reduce(plan, state, { type: 'value', id: 'notes', value: '<script>Just text</script>' });
  state = reduce(plan, state, { type: 'value', id: 'schedule', value: '2026-11-12' });
  const reordered = { ...plan, sections: [...plan.sections].reverse() };
  const adapted = createState(reordered, plan, state);
  assert.deepEqual(adapted.values, state.values);
  assert.equal(createState(plan).values.notes, '');
  const removed = createState({ ...plan, sections: plan.sections.slice(0, 1) }, plan, state);
  assert.equal(Object.hasOwn(removed.values, 'notes'), false);
  const study = fixtures.scenarios.study;
  let answers = createState(study);
  answers = reduce(study, answers, { type: 'value', id: 'retrieval', value: 0 });
  answers = reduce(study, answers, { type: 'reveal', id: 'retrieval' });
  const changed = structuredClone(study); changed.sections[0].questions[0].prompt = 'A different question';
  const next = createState(changed, study, answers);
  assert.equal(next.values.retrieval, null); assert.equal(next.revealed.retrieval, false);
});

test('actions cannot introduce fields, invalid dates, oversized notes or out-of-range answers', () => {
  const plan = fixtures.scenarios.planner, state = createState(plan);
  for (const action of [{ type: 'value', id: '__proto__', value: true }, { type: 'value', id: 'calculations', value: 'true' },
    { type: 'value', id: 'notes', value: 'x'.repeat(4001) }, { type: 'value', id: 'schedule', value: '2026-02-30' },
    { type: 'tab', id: 'missing' }]) assert.equal(reduce(plan, state, action), state);
  const study = fixtures.scenarios.study, practice = createState(study);
  assert.equal(reduce(study, practice, { type: 'reveal', id: 'retrieval' }), practice);
  assert.equal(reduce(study, practice, { type: 'value', id: 'retrieval', value: 99 }), practice);
  assert.match(generationPrompt(plan, fixtures.sources), /Schema:/);
  assert.match(generationPrompt(plan, fixtures.sources), /not library-specific code generation/);
});

test('comparison server rejects remote hosts, cross-site requests, writes and arbitrary paths', async t => {
  const server = createComparisonServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.close(); server.closeAllConnections(); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const badHost = await new Promise(resolve => {
    const req = request(url, { headers: { host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode); });
    req.end();
  });
  assert.equal(badHost, 403);
  const malformed = await new Promise(resolve => {
    const req = request(url, { path: 'http://[' }, response => { response.resume(); resolve(response.statusCode); });
    req.end();
  });
  assert.equal(malformed, 400);
  assert.equal((await fetch(url, { headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await fetch(url, { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
  assert.equal((await fetch(url, { method: 'POST' })).status, 405);
  assert.equal((await fetch(`${url}/package.json`)).status, 404);
  assert.equal((await fetch(`${url}/api/llm/status`)).status, 404);
});
