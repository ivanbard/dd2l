import test from 'node:test';
import assert from 'node:assert/strict';
import { taskCatalogue, planningCatalogue, buildTaskWorkspace, composeTaskWorkspace, validTaskContext } from '../src/task-workspace.mjs';
import { demoInventory } from '../src/ui-demo.mjs';
import { projectInventory } from '../src/ui-data.mjs';

const plan = (sources, goal = 'Prepare for my seminar') => ({ title: 'Seminar preparation', goal, question: '',
  sections: [{ title: 'Understand and practice', purpose: 'Read these before preparing questions', sourceIds: sources.map(source => source.id) }] });

test('planning sees varied coursework without an assignment matcher or exact query overlap', async () => {
  const inventory = demoInventory();
  const request = 'I feel behind and want to make the best use of my afternoon';
  let planned = false;
  const result = await composeTaskWorkspace({ planWorkspace: async (q, model, input, context) => {
    planned = true;
    assert.equal(q, request);
    assert.equal(model, 'selected-model');
    assert.equal(context, null);
    assert.ok(input.catalogue.some(source => source.course.includes('ELEC 425')));
    assert.ok(input.catalogue.some(source => source.course.includes('PSYC 100')));
    const sources = input.catalogue.filter(source => source.category === 'assignment').slice(0, 2);
    return plan(sources, 'Prioritize coursework across my classes');
  } }, inventory, request, 'selected-model', '', null);
  assert.ok(planned);
  assert.equal(result.workspace.kind, 'task');
  assert.equal(result.workspace.goal, 'Prioritize coursework across my classes');
  assert.equal(new Set(result.sources.map(source => source.course)).size, 2);
  assert.equal(result.workspace.sections[0].title, 'Understand and practice');
  assert.ok(result.sources.every(source => source.excerpt && source.url));
});

test('course scope is enforced and generated IDs, URLs, unsupported properties and ungrounded plans are rejected', () => {
  const catalogue = taskCatalogue(demoInventory(), '103');
  assert.ok(catalogue.every(source => source.course === '103'));
  const forged = plan([{ id: 'invented' }]);
  assert.throws(() => buildTaskWorkspace(forged, catalogue, catalogue.length, catalogue.length), /verified/);
  const value = plan(catalogue.slice(0, 1));
  value.sections[0].url = 'javascript:alert(1)';
  assert.throws(() => buildTaskWorkspace(value, catalogue, 1, 1), /verified/);
  assert.throws(() => buildTaskWorkspace({ ...plan([]), sections: [] }, catalogue, 1, 1), /sources or a clarifying question/);
  const foreign = taskCatalogue(demoInventory(), '102')[0];
  assert.throws(() => buildTaskWorkspace(plan([foreign]), catalogue, catalogue.length, catalogue.length), /verified/);
  assert.equal(validTaskContext({ goal: 'Study', sourceIds: ['known'] }), true);
  assert.equal(validTaskContext({ goal: 'Study', sourceIds: ['known'], summary: 'Previous study steps' }), true);
  assert.equal(validTaskContext({ goal: 'Study', sourceIds: [], summary: 'x'.repeat(12001) }), false);
  assert.equal(validTaskContext({ goal: 'Study', sourceIds: ['known'], admin: true }), false);
  assert.equal(validTaskContext({ goal: 'x'.repeat(1001), sourceIds: [] }), false);
});

test('follow-up context reaches planning and can be replaced by a new goal', async () => {
  const inventory = demoInventory();
  const first = taskCatalogue(inventory).find(source => source.category === 'rubric');
  const context = { goal: 'Finish the filter design report', sourceIds: [first.id] };
  const result = await composeTaskWorkspace({ planWorkspace: async (q, model, { catalogue }, previous) => {
    assert.deepEqual(previous, context);
    assert.equal(q, 'Actually help me prepare for psychology instead');
    return plan(catalogue.filter(source => source.course.includes('PSYC') && source.category === 'content'), 'Prepare for psychology');
  } }, inventory, 'Actually help me prepare for psychology instead', 'model', '', context);
  assert.equal(result.workspace.context.goal, 'Prepare for psychology');
  assert.ok(result.sources.every(source => source.course === '102'));
});

test('clarification and missing evidence remain workspaces instead of fabricated answers', () => {
  const result = buildTaskWorkspace({ title: 'Choose a course', goal: 'Prepare for an exam',
    question: 'Which course and exam are you preparing for?', sections: [] }, [], 0, 0);
  assert.match(result.workspace.question, /Which course/);
  assert.deepEqual(result.sources, []);
  assert.deepEqual(result.workspace.context.sourceIds, []);
});

test('catalogue bounds retain course/category diversity and are disclosed', () => {
  const sources = Array.from({ length: 600 }, (_, index) => ({ id: `${index}`, course: '1', courseName: 'Large course',
    category: 'content', title: `Lecture ${index}`, text: 'Calculus', url: 'https://school.example' }));
  sources.push({ id: 'small', course: '2', courseName: 'Small course', category: 'quizzes', title: 'Midterm', text: 'Memory' });
  const catalogue = planningCatalogue(sources, 'Calculus');
  assert.equal(catalogue.length, 400);
  assert.ok(catalogue.some(source => source.id === 'small'));
  const result = buildTaskWorkspace(plan([sources[0]]), sources.slice(0, 400), 400, sources.length);
  assert.equal(result.workspace.catalogueCount, 400);
  assert.equal(result.workspace.total, 601);
});

test('source identities survive unrelated inventory additions, and revoked records are rechecked after planning', async () => {
  const inventory = demoInventory();
  const original = taskCatalogue(inventory);
  const changed = structuredClone(inventory);
  changed.sources.unshift({ ...changed.sources[0], id: 'new-key#0', title: 'New unrelated source' });
  assert.deepEqual(taskCatalogue(changed).slice(1).map(source => source.id), original.map(source => source.id));
  await assert.rejects(composeTaskWorkspace({ planWorkspace: async (q, model, { catalogue }) => plan(catalogue.slice(0, 1)) },
    inventory, 'Help me study', 'model', '', null, undefined, () => ({ courses: [], sources: [], assignments: [] })), /verified|account changed/);
});

test('quiz details, released grades and feedback are available without raw API fields or hidden data', () => {
  const enrollment = { category: 'enrollments', data: [{ OrgUnit: { Id: 1, Name: 'Course' }, Access: { CanAccess: true } }] };
  const inventory = projectInventory([enrollment,
    { key: 'quiz', course: '1', category: 'quiz_details', outcome: 'available', data: { Name: 'Midterm', Description: { Text: 'Review memory.' }, token: 'private-token' } },
    { key: 'grade', course: '1', category: 'grades', outcome: 'available', data: [{ Name: 'Midterm', PointsNumerator: 18, PointsDenominator: 20 }] },
    { key: 'feedback', course: '1', category: 'own_feedback', outcome: 'available', data: { Feedback: { Text: 'Explain your reasoning.' } } },
    { key: 'hidden', course: '1', category: 'quiz_details', outcome: 'available', data: { Name: 'hidden-secret', IsHidden: true } },
    { key: 'hidden/attempts', course: '1', category: 'own_quiz_attempts', outcome: 'available', data: { Name: 'hidden-attempt-secret', CompletionDate: '2026-11-02' } },
  ], null);
  const sources = taskCatalogue(inventory);
  assert.ok(sources.some(source => source.category === 'quiz_details'));
  assert.ok(sources.some(source => source.text.includes('PointsNumerator: 18')));
  assert.ok(sources.some(source => source.text.includes('Explain your reasoning.')));
  assert.doesNotMatch(JSON.stringify(sources), /private-token|hidden-secret|hidden-attempt-secret/);
});

test('cached children of a hidden or removed assignment cannot re-enter the model catalogue', () => {
  const inventory = demoInventory();
  inventory.assignments = inventory.assignments.filter(assignment => assignment.id !== '202');
  const catalogue = taskCatalogue(inventory);
  assert.ok(!catalogue.some(source => source.category === 'assignment_file'));
  assert.ok(!catalogue.some(source => source.title === 'Filter design rubric'));
});

test('identically named topics remain distinct and native IDs survive topic insertion', () => {
  const enrollment = { category: 'enrollments', data: [{ OrgUnit: { Id: 1, Name: 'Course' }, Access: { CanAccess: true } }] };
  const row = { key: 'toc', course: '1', category: 'content', outcome: 'available', data: { Topics: [
    { TopicId: 1, Title: 'Overview', Description: { Text: 'First topic' } },
    { TopicId: 2, Title: 'Overview', Description: { Text: 'Second topic' } },
  ] } };
  const original = taskCatalogue(projectInventory([enrollment, row], null));
  assert.equal(new Set(original.map(source => source.id)).size, 2);
  row.data.Topics.unshift({ TopicId: 3, Title: 'Introduction', Description: { Text: 'New topic' } });
  assert.deepEqual(taskCatalogue(projectInventory([enrollment, row], null)).slice(1).map(source => source.id), original.map(source => source.id));
});
