import test from 'node:test';
import assert from 'node:assert/strict';
import { answerSchema, parseAnswerView, validAnswerView } from '../ui/answer-view.js';

const view = () => ({ title: 'Prepare for the exam', answer: 'Review the cached course material [1].', sections: [
  { type: 'checklist', title: 'Study plan', items: [{ text: 'Review recursion.', citations: [1] }] },
  { type: 'comparison', title: 'Requirements', columns: ['Activity', 'Requirement'], rows: [{ cells: ['Assignment', 'Python file'], citations: [1] }] },
  { type: 'cards', title: 'Course materials', cards: [{ title: 'Recursion', text: 'Review the lecture.', citations: [1] }] },
] });

test('answer views accept the three bounded formats and keep citations inside supplied evidence', () => {
  const value = view();
  assert.equal(answerSchema.additionalProperties, false);
  assert.equal(validAnswerView(value, 1), true);
  assert.deepEqual(parseAnswerView(JSON.stringify(value), 1), { answer: value.answer, view: value });
  assert.equal(validAnswerView(value, 0), false);
  for (const citation of [0, -1, 2, 1.5, '1']) {
    const invalid = view(); invalid.sections[0].items[0].citations = [citation];
    assert.equal(validAnswerView(invalid, 1), false);
  }
  assert.equal(validAnswerView({ title: '', answer: 'Insufficient evidence.', sections: [] }, 0), true);
});

test('unsupported UI, executable attributes, oversized output and ragged tables are rejected', () => {
  const bad = [];
  let value = view(); value.sections[0].type = 'iframe'; bad.push(value);
  value = view(); value.sections[0].onClick = 'alert(1)'; bad.push(value);
  value = view(); value.sections[2].cards[0].url = 'javascript:alert(1)'; bad.push(value);
  value = view(); value.sections[1].rows[0].cells.pop(); bad.push(value);
  value = view(); value.sections[0].items[0].text = 'x'.repeat(1001); bad.push(value);
  value = view(); value.sections = Array(7).fill(value.sections[0]); bad.push(value);
  value = view(); value.sections[0].items[0].citations = []; bad.push(value);
  for (const value of [...bad, null, [], {}, { answer: 'Text only.' }]) assert.equal(validAnswerView(value, 1), false);
  const literal = view(); literal.sections[0].items[0].text = '<script>alert(1)</script>';
  assert.equal(validAnswerView(literal, 1), true); // The renderer treats all model strings as text.
});

test('invalid layouts fall back to a bounded summary, and malformed JSON never appears as an answer', () => {
  const invalid = view(); invalid.sections[0].items[0].citations = [99];
  const fallback = parseAnswerView(JSON.stringify(invalid), 1);
  assert.equal(fallback.view, null);
  assert.equal(fallback.answer, invalid.answer);
  assert.ok(fallback.viewWarning);
  assert.deepEqual(parseAnswerView('Ordinary answer [1].', 1), { answer: 'Ordinary answer [1].', view: null });
  for (const raw of ['{"sections":', '```json\n{}', '[]', 'null', '{"answer":42}']) {
    const result = parseAnswerView(raw, 1);
    assert.equal(result.view, null);
    assert.match(result.answer, /unreadable/);
  }
});
