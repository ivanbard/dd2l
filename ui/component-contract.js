import { matches } from './answer-view.js';
import { planSchema, validPlan, createState, reduce, validDate } from './workspace-plan.js';
import { canvasSchema } from './canvas-contract.js';

export const componentSchema = { ...planSchema, properties: { ...planSchema.properties,
  answer: { type: 'string', maxLength: 6000 }, layout: { type: 'string', enum: ['columns', 'tabs', 'stack'] } },
  required: [...planSchema.required, 'answer', 'layout'] };
export const generatedWorkspaceSchema = { type: 'object', additionalProperties: false,
  properties: { program: { anyOf: [componentSchema, canvasSchema] } }, required: ['program'] };
export const componentSourceIds = program => [...new Set(program.sections.flatMap(section => [
  ...(section.items || []).map(item => item.sourceId), ...(section.rows || []).map(row => row.sourceId),
  ...(section.questions || []).map(question => question.sourceId), ...(section.sourceIds || []),
]))];

export function validComponents(program, sources) {
  if (!matches(program, componentSchema)) return false;
  sources ??= componentSourceIds(program).map(id => ({ id }));
  const { answer, layout, ...plan } = program;
  return validPlan(plan, sources) && program.sections.every(section => section.type !== 'reading' || section.sourceIds.every(id => sources.some(source => source.id === id)));
}

export function componentState(program, previousProgram, previous) {
  const state = createState(program, previousProgram, previous);
  state.draft = previous?.draft || '';
  state.archivedNotes = [...(previous?.archivedNotes || [])];
  for (const section of previousProgram?.sections || []) {
    const value = previous?.values[section.id];
    if (section.type === 'notes' && value && !program.sections.some(next => next.type === 'notes' && next.id === section.id)) {
      state.archivedNotes.push({ title: section.title, text: value });
    }
  }
  return state;
}

export function validComponentState(program, state) {
  if (!state || typeof state !== 'object' || Array.isArray(state) || Object.keys(state).sort().join() !== 'active,archivedNotes,draft,revealed,values') return false;
  if (typeof state.draft !== 'string' || state.draft.length > 16000 || !Array.isArray(state.archivedNotes) || state.archivedNotes.length > 100 ||
    !state.archivedNotes.every(note => matches(note, { type: 'object', required: ['title', 'text'], properties: { title: { type: 'string', maxLength: 120 }, text: { type: 'string', maxLength: 4000 } } }))) return false;
  const initial = createState(program);
  if (!state.values || typeof state.values !== 'object' || Array.isArray(state.values) || !state.revealed || typeof state.revealed !== 'object' || Array.isArray(state.revealed) || Object.keys(state.values).sort().join() !== Object.keys(initial.values).sort().join() ||
    Object.keys(state.revealed).sort().join() !== Object.keys(initial.revealed).sort().join() ||
    !Object.values(state.revealed).every(value => typeof value === 'boolean') || !program.sections.some(section => section.id === state.active)) return false;
  for (const section of program.sections) {
    if (section.type === 'notes' && (typeof state.values[section.id] !== 'string' || state.values[section.id].length > 4000)) return false;
    if (section.type === 'schedule' && state.values[section.id] !== '' && !validDate(state.values[section.id])) return false;
    if (section.items?.some(item => typeof state.values[item.id] !== 'boolean')) return false;
    if (section.questions?.some(question => state.values[question.id] !== null && (!Number.isInteger(state.values[question.id]) || state.values[question.id] < 0 || state.values[question.id] >= question.choices.length))) return false;
  }
  return JSON.stringify(state).length <= 128000;
}

export function componentAction(program, state, action) {
  const next = action?.type === 'draft' && typeof action.value === 'string' ? { ...state, draft: action.value } : reduce(program, state, action);
  return validComponentState(program, next) ? next : state;
}

export const validComponentContext = value => value === null || (!!value && typeof value === 'object' &&
  Object.keys(value).every(key => ['program', 'state', 'error'].includes(key)) &&
  (value.error === undefined || (typeof value.error === 'string' && value.error.length <= 600)) &&
  validComponents(value.program) && validComponentState(value.program, value.state));
