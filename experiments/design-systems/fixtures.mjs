import { demoInventory } from '../../src/ui-demo.mjs';
import { taskCatalogue } from '../../src/task-workspace.mjs';

const catalogue = taskCatalogue(demoInventory());
const source = (course, category, title) => {
  const record = catalogue.find(record => record.course === course && record.category === category && (!title || record.title === title));
  if (!record) throw new Error(`Missing comparison fixture: ${course}/${category}`);
  return { id: record.id, title: record.title, text: record.text, courseName: record.courseName };
};
const instructions = source('103', 'instructions');
const rubric = source('103', 'rubric');
const clarification = source('103', 'announcements');
const memory = source('102', 'content', 'Memory and retrieval');

export const fixtures = {
  sources: [instructions, rubric, clarification, memory],
  scenarios: {
    planner: {
      title: 'Finish the filter design report', goal: 'Help me finish the filter design report and check it against the rubric.',
      sections: [
        { id: 'requirements', type: 'checklist', title: 'Requirements', items: [
          { id: 'calculations', text: 'Justify the filter parameters and show calculations.', sourceId: rubric.id },
          { id: 'plots', text: 'Include both magnitude and phase plots in the report.', sourceId: clarification.id },
          { id: 'code', text: 'Include calculations, frequency response plots and MATLAB code in the PDF report.', sourceId: instructions.id },
        ] },
        { id: 'schedule', type: 'schedule', title: 'Work date', date: '2026-11-11' },
        { id: 'rubric', type: 'rubric', title: 'Rubric', rows: [
          { criterion: 'Design and calculations', points: 40, description: 'Justify parameters and show calculations.', sourceId: rubric.id },
          { criterion: 'Validation', points: 40, description: 'Label plots and discuss results.', sourceId: rubric.id },
          { criterion: 'Presentation', points: 20, description: 'Use a readable report with reproducible code.', sourceId: rubric.id },
        ] },
        { id: 'notes', type: 'notes', title: 'Draft notes', placeholder: 'What needs another pass?' },
      ],
    },
    study: {
      title: 'Practice memory and retrieval', goal: 'Prepare me for the memory seminar with retrieval practice and space for notes.',
      sections: [
        { id: 'practice', type: 'practice', title: 'Practice', questions: [
          { id: 'retrieval', prompt: 'Which approach is named in the memory material?', choices: ['Retrieval practice', 'Frequency response analysis', 'Recursive function tracing'],
            answer: 0, explanation: 'The source explicitly lists retrieval practice. This is suggested practice, not an official assessment question.', sourceId: memory.id },
          { id: 'topics', prompt: 'Which topic belongs in this seminar preparation?', choices: ['Filter cutoff frequency', 'Working memory', 'Python recursion'],
            answer: 1, explanation: 'The cached memory material lists working memory alongside encoding, long-term memory and retrieval practice.', sourceId: memory.id },
        ] },
        { id: 'study-notes', type: 'notes', title: 'Study notes', placeholder: 'Record what you want to revisit.' },
      ],
    },
  },
};
