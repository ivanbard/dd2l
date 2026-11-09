import test from 'node:test';
import assert from 'node:assert/strict';
import { canvasSchema, validCanvas, validCanvasState, validCanvasContext } from '../ui/canvas-contract.js';
import { canvasDocument } from '../src/canvas.mjs';

const program = () => ({ title: 'Work on the report', answer: 'Review the rubric.', html: '<h1>Your report</h1>', css: 'main{display:grid}', js: 'return {state};' });

test('canvas output is bounded code/data with a fixed envelope, not a fixed widget catalogue', () => {
  assert.equal(validCanvas(program()), true);
  assert.deepEqual(canvasSchema.required, ['title', 'answer', 'html', 'css', 'js']);
  assert.equal(validCanvas({ ...program(), html: '<svg><path d="M0 0L20 20" /></svg><form><input name="notes"></form>' }), true);
  assert.equal(validCanvas({ ...program(), js: 'x'.repeat(60001) }), false);
  assert.equal(validCanvas({ ...program(), title: '' }), false);
  assert.equal(validCanvas({ ...program(), tools: ['shell'] }), false);
  assert.equal(validCanvas({ ...program(), html: {} }), false);
});

test('progress accepts bounded JSON while rejecting excessive, cyclic and prototype-bearing state', () => {
  const state = { inputs: { done: { value: 'on', checked: true }, notes: { value: 'My draft', checked: false } }, step: 2 };
  assert.equal(validCanvasState(state), true);
  assert.equal(validCanvasContext({ program: program(), state }), true);
  assert.equal(validCanvasContext({ program: program(), state, error: 'Missing variable' }), true);
  assert.equal(validCanvasContext(null), true);
  assert.equal(validCanvasContext({ program: program(), state, admin: true }), false);
  assert.equal(validCanvasState({ text: 'x'.repeat(32001) }), false);
  assert.equal(validCanvasState({ value: Infinity }), false);
  assert.equal(validCanvasState(JSON.parse('{"__proto__":{"admin":true}}')), false);
  const cyclic = {}; cyclic.self = cyclic;
  assert.equal(validCanvasState(cyclic), false);
  assert.equal(validCanvasState({ value: () => {} }), false);
});

test('the frame has a separate opaque-origin policy and a trusted bootstrap with no external network access', () => {
  const document = canvasDocument();
  assert.match(document.policy, /sandbox allow-scripts/);
  assert.doesNotMatch(document.policy, /allow-same-origin|https:|unsafe-inline.*script-src/);
  assert.match(document.policy, /connect-src 'none'/);
  assert.match(document.policy, /frame-src 'none'/);
  assert.match(document.policy, /form-action 'none'/);
  assert.match(document.policy, /worker-src blob:/);
  assert.match(document.html, /<script nonce="/);
  assert.notEqual(document.policy, canvasDocument().policy);
});
