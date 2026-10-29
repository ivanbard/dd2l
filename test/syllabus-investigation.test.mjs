import test from 'node:test';
import assert from 'node:assert/strict';
import { findSyllabusSources } from '../scripts/investigate-syllabus.mjs';

test('syllabus search covers module text, nested files, HTML file topics and external links', () => {
  const sources = findSyllabusSources({ Modules: [{ ModuleId: 1, Title: 'Course Information',
    Description: { Html: '<p>Course policies and syllabus information.</p>' },
    Modules: [{ ModuleId: 2, Title: 'Documents', Topics: [{ TopicId: 3, Title: 'Assessment guide', ActivityType: 1, Url: '/content/guide.pdf' }] }],
    Topics: [{ TopicId: 4, Title: 'Course outline', ActivityType: 1, Url: '/content/outline.html' },
      { TopicId: 5, Title: 'Syllabus service', ActivityType: 27, Url: 'https://external.example/syllabus' }],
  }] });
  assert.equal(sources.length, 4);
  assert.equal(sources[0].kind, 'module_description');
  assert.equal(sources[1].matchedBy, 'parent_module');
  assert.equal(sources[2].kind, 'content_file');
  assert.equal(sources[3].kind, 'linked_topic');
});

test('a generic description can identify a candidate; absent candidates are not evidence of absence', () => {
  const tree = { Modules: [{ Title: 'Welcome', ModuleId: 1, Description: { Text: 'Please read the syllabus below.' } },
    { Title: 'Lectures', Topics: [{ TopicId: 2, Title: 'Week one', ActivityType: 1 }] }] };
  assert.equal(findSyllabusSources(tree).length, 1);
  assert.deepEqual(findSyllabusSources({ Modules: [] }), []);
});

test('inherited release restrictions prevent candidate document reads', () => {
  const sources = findSyllabusSources({ Modules: [{ ModuleId: 1, Title: 'Syllabus', IsHidden: true,
    Topics: [{ TopicId: 2, Title: 'Outline', ActivityType: 1 }] },
    { ModuleId: 3, Title: 'Course overview', StartDateTime: '2030-01-01T00:00:00Z',
      Topics: [{ TopicId: 4, Title: 'Information', ActivityType: 1 }] }] }, Date.parse('2026-10-29T00:00:00Z'));
  assert.ok(sources.length > 0);
  assert.ok(sources.every(source => source.unavailable));
});
