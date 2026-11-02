import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, fits, firstSpace, restore } from '../ui/widget-layout.js';
import { homeInventory, projectInventory } from '../src/ui-data.mjs';

test('widget layouts stay in bounds, never overlap and restore only supported preferences', () => {
  const layout = defaults();
  assert.ok(layout.every(widget => fits(layout, widget)));
  assert.equal(fits(layout, { ...layout[0], x: 1 }), false);
  assert.equal(fits(layout, { ...layout[0], x: -1 }), false);
  assert.equal(fits(layout, { ...layout[0], y: 8 }), false);
  assert.equal(fits(layout, { ...layout[0], x: 0.5 }), false);
  assert.equal(fits(layout, { ...layout[0], size: 'unknown' }), false);
  assert.equal(fits(layout, { ...layout[0], size: '__proto__' }), false);
  assert.deepEqual(firstSpace(layout.slice(0, 2), 'shortcuts'), { type: 'shortcuts', size: 'wide', x: 0, y: 1 });
  assert.deepEqual(restore({ layout: [], pins: [] }), { layout: [], pins: [] });
  assert.deepEqual(restore({ layout, pins: ['course:101', 'course:101', null] }), { layout, pins: ['course:101'] });
  assert.equal(restore({ layout: [layout[0], layout[0]], pins: [] }), null);
  assert.equal(restore({ layout: [{ ...layout[0], type: 'evil' }], pins: [] }), null);
  assert.equal(restore({ layout: [{ ...layout[0], y: 99 }], pins: [] }), null);
  const custom = { type: 'deadlines', x: 1, y: 2, size: '3x4' };
  assert.deepEqual(restore({ layout: [custom], pins: [] }), { layout: [custom], pins: [] });
  assert.equal(fits([], { ...custom, size: '5x4' }), false);
  assert.equal(fits([], { ...custom, size: '3x9' }), false);
});

test('home uses explicit upcoming dates and publication order while preserving visibility and stale flags', () => {
  const row = (category, data, extra = {}) => ({ key: category, course: '1', category, data, outcome: 'available', ...extra });
  const inventory = projectInventory([
    row('enrollments', [{ OrgUnit: { Id: 1, Name: 'Course' }, Access: { CanAccess: true } }]),
    row('assignments', [
      { Name: 'Later', DueDate: '2099-02-01' }, { Name: 'Soon', DueDate: '2099-01-01' },
      { Name: 'Past', DueDate: '2000-01-01' }, { Name: 'Unknown', DueDate: 'bad' },
      { Name: 'Hidden', DueDate: '2099-01-01', IsHidden: true },
    ], { outcome: 'failed' }),
    row('announcements', [
      { Title: 'Old', StartDate: '2020-01-01' }, { Title: 'New', StartDate: '2021-01-01' },
      { Title: 'Scheduled', StartDate: '2099-01-01' }, { Title: 'Draft', IsPublished: false },
      { Title: 'Expired', EndDate: '2000-01-01' },
    ]),
    row('assignments', [{ Name: 'Revoked', DueDate: '2099-01-01' }], { course: '2' }),
  ], null);
  const home = homeInventory(inventory, Date.parse('2026-11-02'));
  assert.deepEqual(home.deadlines.map(s => s.title), ['Soon', 'Later']);
  assert.ok(home.deadlines.every(s => s.stale));
  assert.deepEqual(home.announcements.map(s => s.title), ['New', 'Old']);
  assert.doesNotMatch(JSON.stringify(home), /Hidden|Scheduled|Draft|Expired|Revoked/);
  assert.ok(home.sources.every(s => !('text' in s) && s.ref));
});
