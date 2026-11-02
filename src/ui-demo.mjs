import { projectInventory } from './ui-data.mjs';

export function demoInventory() {
  const stamp = '2026-11-02T14:00:00.000Z';
  const row = (category, course, data) => ({ key: `demo:${category}:${course}`, category, course,
    data, outcome: 'available', last_success: stamp, checked_at: stamp });
  return { ...projectInventory([
    row('enrollments', null, [
      { OrgUnit: { Id: 101, Name: 'CISC 121 · Introduction to Computing' }, Access: { CanAccess: true, IsActive: true } },
      { OrgUnit: { Id: 102, Name: 'PSYC 100 · Principles of Psychology' }, Access: { CanAccess: true, IsActive: true } },
    ]),
    row('assignments', '101', [{ Name: 'Assignment 3 · Recursion', DueDate: '2026-11-09T23:59:00-05:00',
      Instructions: { Text: 'Implement and test recursive functions. Submit your Python file and a short explanation through onQ. Review the recursion lecture before starting.' } }]),
    row('syllabus_source', '101', { title: 'Course syllabus', text: 'Assessment: assignments 30%, labs 20%, final exam 50%. Office hours are Tuesday, 2–4 pm. Consult onQ for the current schedule.' }),
    row('content', '102', { Modules: [{ Title: 'Week 8 · Memory', Topics: [
      { Title: 'Memory and retrieval', Description: { Text: 'Encoding, working memory, long-term memory, and retrieval practice. Read chapter 8 before the seminar.' } },
    ] }] }),
    row('announcements', '102', [{ Title: 'Midterm review session', Body: { Text: 'Bring your questions about memory and learning to the review session on Thursday.' } }]),
  ], { state: 'demo', updatedAt: stamp }), scope: 'demo' };
}
