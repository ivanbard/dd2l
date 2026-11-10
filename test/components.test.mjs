import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtures } from '../experiments/design-systems/fixtures.mjs';
import { validComponents, validComponentContext, componentState, componentAction, validComponentState } from '../ui/component-contract.js';
import { validSavedWorkspace } from '../ui/workspace-storage.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.mjs';
import { createUiServer } from '../src/ui-server.mjs';

const program = () => ({ ...structuredClone(fixtures.scenarios.planner), answer: 'Review the verified requirements.', layout: 'columns' });
test('component programs validate source IDs, fields, layouts and serializable bounded state', () => {
  const plan = program();
  assert.equal(validComponents(plan, fixtures.sources), true);
  assert.equal(validComponents({}), false);
  assert.equal(validComponentContext({ program: [], state: {} }), false);
  assert.equal(validComponents({ ...plan, html: '<script>bad()</script>' }), false);
  assert.equal(validComponents({ ...plan, layout: 'executable' }), false);
  plan.sections[0].items[0].sourceId = 'forged';
  assert.equal(validComponents(plan, fixtures.sources), false);
  const state = componentState(program());
  assert.equal(validComponentState(program(), state), true);
  assert.equal(validComponentState(program(), { ...state, draft: 'x'.repeat(16001) }), false);
  assert.equal(validComponentState(program(), { ...state, values: [] }), false);
});

test('drafts survive layout changes and removed notes remain available as archived text', () => {
  const plan = program();
  let state = componentState(plan);
  state = componentAction(plan, state, { type: 'draft', value: 'My assignment outline' });
  state = componentAction(plan, state, { type: 'value', id: 'notes', value: '<script>Plain text notes</script>' });
  state = componentAction(plan, state, { type: 'value', id: 'calculations', value: true });
  const next = { ...plan, layout: 'tabs', sections: plan.sections.filter(section => section.id !== 'notes') };
  const adapted = componentState(next, plan, state);
  assert.equal(adapted.draft, 'My assignment outline');
  assert.equal(adapted.values.calculations, true);
  assert.deepEqual(adapted.archivedNotes, [{ title: 'Draft notes', text: '<script>Plain text notes</script>' }]);
  assert.equal(validComponentContext({ program: next, state: adapted }), true);
  assert.equal(componentAction(plan, state, { type: 'draft', value: 'x'.repeat(16001) }), state);
  const reorderedKeys = structuredClone(plan);
  reorderedKeys.sections[0].items = reorderedKeys.sections[0].items.map(({ id, text, sourceId }) => ({ sourceId, text, id }));
  assert.equal(componentState(reorderedKeys, plan, state).values.calculations, true);
});

test('saved records bind the draft to its scope, source context and revision', () => {
  const plan = program(), scope = 'a'.repeat(64), id = '6f57927a-cbd6-44a4-a133-a9db4fc83c88';
  const record = { scope, id, key: `${scope}:${id}`, program: plan, state: componentState(plan), revision: 1,
    updated: new Date().toISOString(), course: '103', context: { goal: plan.goal, sourceIds: fixtures.sources.map(source => source.id) } };
  assert.equal(validSavedWorkspace(record), true);
  assert.equal(validSavedWorkspace({ ...record, scope: 'b'.repeat(64) }), false);
  assert.equal(validSavedWorkspace({ ...record, revision: -1 }), false);
});

test('the production API composes components, binds prior drafts to account scope and rechecks revoked sources', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'dd2l-components-'));
  const store = new Store(directory), identity = { Identifier: 4 }, origin = 'https://school.example';
  const enrollments = { key: 'enrollments', category: 'enrollments', complete: true, outcome: 'available',
    data: [{ OrgUnit: { Id: 1, Name: 'Course' }, Access: { CanAccess: true } }] };
  const reading = { key: 'reading', category: 'content_file', course: '1', outcome: 'available', data: { text: 'Verified report requirement.' } };
  store.commit(identity, origin, [enrollments, reading], {}, enrollments);
  let revoke = false;
  const server = createUiServer({ inventoryPath: store.path, llm: {
    planWorkspace: async (q, model, { catalogue }) => ({ title: 'Report', goal: q, question: '',
      sections: [{ title: 'Requirements', purpose: 'Finish the report', sourceIds: [catalogue[0].id] }] }),
    generateWorkspace: async (q, model, sources, previous) => {
      if (previous) assert.equal(previous.state.draft, 'My outline');
      if (revoke) store.commit(identity, origin, [{ ...reading, outcome: 'denied', data: null }], {}, enrollments);
      return { title: 'Report', goal: q, answer: 'Review the evidence.', layout: 'columns', sections: [
        { id: 'requirements', type: 'reading', title: 'Requirements', text: sources[0].excerpt, sourceIds: [sources[0].id] },
      ] };
    },
  } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.close(); server.closeAllConnections(); store.close(); await rm(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = body => fetch(`${base}/api/llm/answer`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: 'Finish the report', model: 'model', consent: true, course: '1', ...body }) });
  const first = await (await post({})).json();
  assert.equal(first.components.layout, 'columns');
  const components = { program: first.components, state: componentState(first.components) };
  components.state.draft = 'My outline';
  assert.equal((await post({ components, scope: 'wrong' })).status, 409);
  assert.equal((await post({ components, scope: first.scope })).status, 200);
  const ids = first.sources.map(source => source.id).join(',');
  assert.equal((await fetch(`${base}/api/workspace-sources?ids=${ids}&course=1`)).status, 200);
  revoke = true;
  const revoked = await post({ components, scope: first.scope });
  assert.equal(revoked.status, 409);
  assert.doesNotMatch(await revoked.text(), /Verified report requirement/);
  assert.equal((await fetch(`${base}/api/workspace-sources?ids=${ids}&course=1`)).status, 404);
});
