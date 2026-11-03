import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assignmentWorkspace } from '../src/assignment-workspace.mjs';
import { projectInventory } from '../src/ui-data.mjs';
import { demoInventory } from '../src/ui-demo.mjs';
import { createUiServer } from '../src/ui-server.mjs';
import { Store } from '../src/store.mjs';

const enrollment = { key: 'enrollments', category: 'enrollments', outcome: 'available', data: [
  { OrgUnit: { Id: 1, Name: 'ELEC 425 · Signals' }, Access: { CanAccess: true } },
  { OrgUnit: { Id: 2, Name: 'ELEC 425 · Previous term' }, Access: { CanAccess: true } },
] };
const row = (category, suffix, data, outcome = 'available', course = '1') => ({
  key: `/d2l/api/le/1.93/${course}/dropbox/folders/${suffix}`, category, course, data, outcome,
  last_success: '2026-11-02T14:00:00Z', checked_at: '2026-11-03T14:00:00Z',
});
const listing = (course = '1') => ({ ...row('assignments', '', [
  { Id: 20, Name: 'Assignment 2', DueDate: '2026-11-12T23:59:00Z', Instructions: { Text: 'Submit a report.' }, Attachments: [{ FileId: 7, FileName: 'Specifications.pdf' }] },
  { Id: 21, Name: 'Assignment 20', Instructions: { Text: 'other-assignment-secret' } },
], 'available', course), key: `/d2l/api/le/1.93/${course}/dropbox/folders/` });

test('natural language resolves the course and assignment, gathering related records before supporting context', () => {
  const inventory = demoInventory();
  const workspace = assignmentWorkspace(inventory, "I'm going to work on assignment 2 for my elec425 class");
  assert.equal(workspace.status, 'resolved');
  assert.equal(workspace.course, '103');
  assert.equal(workspace.id, '202');
  assert.equal(workspace.records[0].category, 'instructions');
  assert.match(workspace.records.find(record => record.category === 'rubric').text, /Validation\nPoints: 40/);
  assert.match(workspace.records.find(record => record.category === 'attachment').text, /1 kHz/);
  assert.equal(workspace.supporting.length, 2);
  assert.ok(workspace.supporting.every(source => source.course === '103' && source.reason));
  assert.match(workspace.url, /folder_submit_files\.d2l\?db=202&ou=103$/);
  assert.equal(workspace.dueDate, '2026-11-12T23:59:00-05:00');
  assert.doesNotMatch(JSON.stringify(workspace), /Memory journal/);
});

test('ambiguous assignments and semesters require a choice; missing targets never fall back to another assignment', () => {
  const inventory = projectInventory([enrollment, listing(), listing('2')], null, 'https://school.example');
  const ambiguous = assignmentWorkspace(inventory, 'work on assignment 2 in ELEC 425');
  assert.equal(ambiguous.status, 'choose');
  assert.equal(ambiguous.choices.length, 2);
  assert.equal(assignmentWorkspace(inventory, 'assignment 2', '1').id, '20');
  assert.equal(assignmentWorkspace(inventory, 'assignment 3', '1', '20').status, 'missing');
  assert.equal(assignmentWorkspace(inventory, 'assignment 2 ELEC 4250').status, 'missing');
  assert.equal(assignmentWorkspace(inventory, 'assignment 2 ELEC 999').status, 'missing');
  assert.equal(assignmentWorkspace(inventory, 'frequency response'), null);
});

test('follow-ups retain the assignment, prioritize rubric for submission, and allow an explicit course switch', () => {
  const inventory = demoInventory();
  const followup = assignmentWorkspace(inventory, 'Explain criterion three', '103', '202');
  assert.equal(followup.id, '202');
  assert.equal(followup.records[0].category, 'rubric');
  assert.equal(assignmentWorkspace(inventory, 'Am I ready to submit?', '103', '202').intent, 'submit');
  assert.equal(assignmentWorkspace(inventory, 'Assignment 2 PSYC 100', '103', '202').id, '203');
  assert.equal(assignmentWorkspace(inventory, 'quiz 2', '103', '202'), null);
});

test('relationships are bounded by course and assignment; projection excludes raw fields and inaccessible data', () => {
  const inventory = projectInventory([enrollment, listing(),
    row('assignment_detail', '20', { Name: 'Assignment 2', Instructions: { Html: '<p>Design the circuit.</p><script>private-script</script>' }, token: 'private-token' }),
    row('rubrics', '20/assessment/rubrics', [{ Name: 'Criterion one', Points: 10, raw: 'private-bytes' }]),
    row('assignment_file', '20/attachments/7', { text: 'Use these specifications.', base64: 'private-bytes' }),
    row('own_feedback', '20/feedback/user/4', { Text: 'denied-secret' }, 'denied'),
    row('rubrics', '21/assessment/rubrics', [{ Name: 'other-assignment-secret' }]),
    row('rubrics', '20/assessment/rubrics', [{ Name: 'other-course-secret' }], 'available', '2'),
    { key: 'announcement', course: '1', category: 'announcements', outcome: 'available', data: { Title: 'Assignment 20 clarification', Body: { Text: 'other-assignment-secret' } } },
  ], null, 'https://school.example');
  const workspace = assignmentWorkspace(inventory, 'assignment 2', '1');
  assert.equal(workspace.records.find(record => record.category === 'feedback').status, 'inaccessible');
  assert.equal(workspace.records.find(record => record.category === 'rubric').text, 'Criterion one\nPoints: 10');
  assert.equal(workspace.records[0].text, 'Design the circuit.');
  assert.doesNotMatch(JSON.stringify(workspace), /private-|denied-secret|other-assignment-secret|other-course-secret/);
});

test('missing and stale records do not invent current submission status, deadlines, or rubric availability', () => {
  const base = listing();
  base.data[0].DueDate = null;
  const inventory = projectInventory([enrollment, base,
    row('own_submissions', '20/submissions/mysubmissions/', [{ Submissions: [{ Id: 1 }] }], 'failed'),
    row('assignment_file', '20/attachments/7', { text: 'Old specifications.' }, 'failed'),
  ], null);
  const workspace = assignmentWorkspace(inventory, 'assignment 2', '1');
  assert.equal(workspace.dueDate, null);
  assert.match(workspace.submissionStatus, /1 cached submission · stale/);
  assert.equal(workspace.records.find(record => record.category === 'rubric').status, 'missing');
  assert.equal(workspace.records.find(record => record.category === 'attachment').status, 'stale');
  const missing = assignmentWorkspace(projectInventory([enrollment, base], null), 'assignment 2', '1');
  assert.equal(missing.submissionStatus, 'Submission status not retrieved');
});

test('hidden assignments, revoked courses and denied listings cannot produce a workspace', () => {
  const hidden = listing(); hidden.data[0].IsHidden = true;
  assert.equal(assignmentWorkspace(projectInventory([enrollment, hidden], null), 'assignment 2', '1').status, 'missing');
  const denied = listing(); denied.outcome = 'denied';
  assert.equal(assignmentWorkspace(projectInventory([enrollment, denied], null), 'assignment 2', '1').status, 'missing');
  assert.equal(assignmentWorkspace(projectInventory([listing()], null), 'assignment 2', '1').status, 'missing');
});

test('HTTP workspace and AI share resolved evidence, validate context, and re-read revoked access', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'dd2l-assignment-'));
  const store = new Store(directory);
  const enrollments = { ...enrollment, complete: true };
  store.commit({ Identifier: 4 }, 'https://school.example', [enrollments, listing(),
    row('rubrics', '20/assessment/rubrics', [{ Name: 'Criterion one', Points: 10 }]),
  ], {}, enrollments);
  let calls = 0;
  let failExplanation = false;
  const server = createUiServer({ inventoryPath: join(directory, 'inventory.sqlite'), llm: {
    planWorkspace: async (q, model, { catalogue }) => ({ title: 'Your task', goal: q,
      question: q === 'assignment 3' ? 'Assignment 3 is not in the cache. Which activity did you mean?' : '',
      sections: q === 'assignment 3' ? [] : [{ title: 'Criteria', purpose: 'Review the grading criteria',
        sourceIds: catalogue.filter(source => source.category === 'rubric').map(source => source.id) }] }),
    answer: async (q, model, sources) => {
    calls++;
    if (failExplanation) throw Object.assign(new Error('Provider unavailable'), { public: true });
    assert.equal(model, 'model');
    assert.ok(sources.some(source => source.category === 'rubric'));
    assert.ok(sources.every(source => source.course === '1'));
    return { answer: 'Grounded answer.' };
  } } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    store.close();
    await rm(directory, { recursive: true, force: true });
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const search = params => fetch(`${origin}/api/search?${new URLSearchParams(params)}`);
  const post = body => fetch(`${origin}/api/llm/answer`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'model', consent: true, ...body }) });
  assert.equal((await (await search({ q: 'assignment 2', course: '1' })).json()).workspace.id, '20');
  assert.equal((await search({ q: 'explain', assignment: '20' })).status, 400);
  assert.equal((await search({ q: 'explain', course: '1', assignment: '../20' })).status, 400);
  assert.equal((await post({ q: 'explain', course: '1', assignment: {} })).status, 400);
  assert.equal((await post({ q: 'explain', context: { goal: 'study', sourceIds: [], admin: true } })).status, 400);
  const answer = await (await post({ q: 'Explain criterion one', course: '1', assignment: '20' })).json();
  assert.equal(answer.workspace.kind, 'task');
  assert.equal(answer.answer, 'Grounded answer.');
  failExplanation = true;
  const partial = await (await post({ q: 'Explain criterion one', course: '1' })).json();
  assert.equal(partial.workspace.kind, 'task');
  assert.equal(partial.answerWarning, 'Provider unavailable');
  assert.ok(partial.sources.length);
  assert.match((await (await post({ q: 'assignment 3', course: '1' })).json()).workspace.question, /not in the cache/);
  assert.equal(calls, 2);
  store.commit({ Identifier: 4 }, 'https://school.example', [{ ...enrollments, data: [] }], {}, { complete: true, data: [] });
  assert.equal((await search({ q: 'assignment 2', course: '1' })).status, 404);
});
