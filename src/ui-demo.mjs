import { projectInventory } from './ui-data.mjs';

export function demoInventory() {
  const stamp = '2026-11-02T14:00:00.000Z';
  const row = (category, course, data) => ({ key: `demo:${category}:${course}`, category, course,
    data, outcome: 'available', last_success: stamp, checked_at: stamp });
  return { ...projectInventory([
    row('enrollments', null, [
      { OrgUnit: { Id: 101, Name: 'CISC 121 · Introduction to Computing' }, Access: { CanAccess: true, IsActive: true } },
      { OrgUnit: { Id: 103, Name: 'ELEC 425 · Signals and Systems' }, Access: { CanAccess: true, IsActive: true } },
      { OrgUnit: { Id: 102, Name: 'PSYC 100 · Principles of Psychology' }, Access: { CanAccess: true, IsActive: true } },
    ]),
    row('assignments', '101', [{ Id: 201, Name: 'Assignment 3 · Recursion', DueDate: '2026-11-09T23:59:00-05:00',
      Instructions: { Text: 'Implement and test recursive functions. Submit your Python file and a short explanation through onQ. Review the recursion lecture before starting.' } }]),
    row('syllabus_source', '101', { title: 'Course syllabus', text: 'Assessment: assignments 30%, labs 20%, final exam 50%. Office hours are Tuesday, 2–4 pm. Consult onQ for the current schedule.' }),
    row('content', '102', { Modules: [{ Title: 'Week 8 · Memory', Topics: [
      { Title: 'Memory and retrieval', Description: { Text: 'Encoding, working memory, long-term memory, and retrieval practice. Read chapter 8 before the seminar.' } },
    ] }] }),
    row('announcements', '102', [{ Title: 'Midterm review session', Body: { Text: 'Bring your questions about memory and learning to the review session on Thursday.' } }]),
    row('assignments', '102', [{ Id: 203, Name: 'Assignment 2 · Memory journal', DueDate: '2026-11-13T23:59:00-05:00',
      Instructions: { Text: 'Write a reflection on retrieval practice and your study habits.' } }]),
    row('assignments', '103', [{ Id: 202, Name: 'Assignment 2 · Filter design', DueDate: '2026-11-12T23:59:00-05:00',
      Instructions: { Text: 'Design a low-pass filter. Submit a PDF report with your calculations, frequency response plots, and MATLAB code. Review Frequency response before starting.' },
      Attachments: [{ FileId: 7, FileName: 'Filter specifications.pdf' }] }]),
    { ...row('rubrics', '103', [{ Name: 'Filter design rubric', Criteria: [
      { Name: 'Design and calculations', Points: 40, Description: { Text: 'Justify the filter parameters and show your calculations.' } },
      { Name: 'Validation', Points: 40, Description: { Text: 'Include labelled frequency response plots and discuss the results.' } },
      { Name: 'Presentation', Points: 20, Description: { Text: 'Use a readable report with reproducible MATLAB code.' } },
    ] }]), key: '/d2l/api/le/1.93/103/rubrics/?objectType=Dropbox&objectId=202' },
    { ...row('assignment_file', '103', { text: 'Use a 1 kHz cutoff frequency and a 10 kHz sampling rate. Include the magnitude and phase response.' }),
      key: '/d2l/api/le/1.93/103/dropbox/folders/202/attachments/7' },
    { ...row('own_submissions', '103', []), key: '/d2l/api/le/1.93/103/dropbox/folders/202/submissions/mysubmissions/' },
    row('content', '103', { Title: 'Frequency response', Description: { Text: 'Calculate and plot magnitude and phase. Compare the response against the filter specifications.' } }),
    row('announcements', '103', [{ Title: 'Assignment 2 clarification', Body: { Text: 'For Assignment 2, include both magnitude and phase plots in your report.' } }]),
  ], { state: 'demo', updatedAt: stamp }), scope: 'demo' };
}
