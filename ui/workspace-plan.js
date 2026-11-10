import { matches } from './answer-view.js';

const text = (maxLength = 1000) => ({ type: 'string', maxLength });
const list = (items, maxItems, minItems = 1) => ({ type: 'array', items, minItems, maxItems });
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const base = type => ({ id: text(48), type: { type: 'string', enum: [type] }, title: text(120) });
export const planSchema = object({
  title: text(160), goal: text(1000), sections: list({ anyOf: [
    object({ ...base('checklist'), items: list(object({ id: text(48), text: text(), sourceId: text(48) }), 12) }),
    object({ ...base('schedule'), date: text(10) }),
    object({ ...base('rubric'), rows: list(object({ criterion: text(120), points: { type: 'integer', minimum: 0, maximum: 100 }, description: text(), sourceId: text(48) }), 12) }),
    object({ ...base('notes'), placeholder: text(200) }),
    object({ ...base('reading'), text: text(6000), sourceIds: list(text(48), 24) }),
    object({ ...base('practice'), questions: list(object({ id: text(48), prompt: text(), choices: list(text(300), 6, 2),
      answer: { type: 'integer', minimum: 0, maximum: 5 }, explanation: text(), sourceId: text(48) }), 8) }),
  ] }, 8),
});

const idPattern = /^[a-z][a-z0-9-]{0,47}$/;
const validId = id => idPattern.test(id) && !['constructor', 'prototype', '__proto__'].includes(id);
export const validDate = date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
  Number.isFinite(Date.parse(`${date}T12:00:00Z`)) && new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) === date;

export function validPlan(plan, sources) {
  if (!matches(plan, planSchema) || !plan.title.trim() || !plan.goal.trim()) return false;
  const ids = new Set();
  const add = id => validId(id) && !ids.has(id) && !!ids.add(id);
  const sourceIds = new Set(sources.map(source => source.id));
  return plan.sections.every(section => add(section.id) && !!section.title.trim() &&
    (section.type !== 'schedule' || validDate(section.date)) &&
    (section.items || []).every(item => add(item.id) && item.text.trim() && sourceIds.has(item.sourceId)) &&
    (section.rows || []).every(row => row.criterion.trim() && sourceIds.has(row.sourceId)) &&
    (section.sourceIds || []).every(id => sourceIds.has(id)) &&
    (section.questions || []).every(question => add(question.id) && question.prompt.trim() &&
      question.choices.every(choice => choice.trim()) && question.answer < question.choices.length && sourceIds.has(question.sourceId)));
}

function fields(plan) {
  return plan.sections.flatMap(section => section.type === 'checklist' ? section.items.map(item => ({ ...item, type: 'check' })) :
    section.type === 'practice' ? section.questions.map(question => ({ ...question, type: 'answer' })) :
    ['notes', 'schedule'].includes(section.type) ? [{ ...section, type: section.type }] : []);
}

export function createState(plan, previousPlan, previous) {
  const priorFields = new Map(previousPlan ? fields(previousPlan).map(field => [field.id, field]) : []);
  const state = { active: plan.sections.some(section => section.id === previous?.active) ? previous.active : plan.sections[0].id,
    values: {}, revealed: {} };
  for (const field of fields(plan)) {
    const prior = priorFields.get(field.id);
    const same = prior?.type === field.type && (['notes', 'schedule'].includes(field.type) ||
      (field.type === 'check' ? prior.text === field.text && prior.sourceId === field.sourceId :
        prior.prompt === field.prompt && prior.answer === field.answer && prior.sourceId === field.sourceId && JSON.stringify(prior.choices) === JSON.stringify(field.choices)));
    state.values[field.id] = same ? previous.values[field.id] : field.type === 'check' ? false : field.type === 'answer' ? null : field.type === 'schedule' ? field.date : '';
    if (field.type === 'answer') state.revealed[field.id] = same ? previous.revealed[field.id] : false;
  }
  return state;
}

export function reduce(plan, state, action) {
  if (!action || typeof action !== 'object') return state;
  if (action.type === 'tab' && plan.sections.some(section => section.id === action.id)) return { ...state, active: action.id };
  const field = fields(plan).find(field => field.id === action.id);
  if (!field) return state;
  if (action.type === 'reveal' && field.type === 'answer' && state.values[field.id] !== null) {
    return { ...state, revealed: { ...state.revealed, [field.id]: true } };
  }
  if (action.type !== 'value') return state;
  const value = action.value;
  const valid = field.type === 'check' ? typeof value === 'boolean' : field.type === 'notes' ? typeof value === 'string' && value.length <= 4000 :
    field.type === 'schedule' ? value === '' || validDate(value) : Number.isInteger(value) && value >= 0 && value < field.choices.length;
  if (!valid) return state;
  return { ...state, values: { ...state.values, [field.id]: value },
    revealed: field.type === 'answer' ? { ...state.revealed, [field.id]: false } : state.revealed };
}

