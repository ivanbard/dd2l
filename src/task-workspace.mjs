import { createHash } from 'node:crypto';
import { matches } from '../ui/answer-view.js';

const text = maxLength => ({ type: 'string', maxLength });
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const list = (items, maxItems, minItems = 0) => ({ type: 'array', items, minItems, maxItems });
export const workspacePlanSchema = object({
  title: text(160), goal: text(1000), question: text(500),
  sections: list(object({ title: text(160), purpose: text(500), sourceIds: list(text(80), 24, 1) }), 8),
});

const fail = message => Object.assign(new Error(message), { public: true });
const excerpt = (value, length) => value.length > length ? `${value.slice(0, length)}\n[Excerpt truncated.]` : value;

export function taskCatalogue(inventory, course = '') {
  const allowed = new Set(inventory.courses.filter(item => !course || item.id === course).map(item => item.id));
  const parents = new Set((inventory.assignments || []).map(assignment => `${assignment.course}:${assignment.id}`));
  const sources = inventory.sources.filter(source => {
    const assignment = source.id.match(/\/dropbox\/folders\/(\d+)(?:\/|#|$)/)?.[1] ||
      (source.category === 'rubrics' ? source.id.match(/[?&]objectId=(\d+)(?:&|#|$)/)?.[1] : null);
    return allowed.has(source.course) && (!assignment || parents.has(`${source.course}:${assignment}`));
  }).map(source => ({ ...source,
    ref: JSON.stringify([source.course, source.category, source.id, source.title]),
  }));
  for (const assignment of inventory.assignments || []) {
    if (!allowed.has(assignment.course)) continue;
    const parent = `${assignment.course}:${assignment.id}`;
    sources.push({ ...assignment, category: 'assignment', ref: `${parent}:overview`,
      text: `Due: ${assignment.dueDate || 'Not retrieved'}\nOpens: ${assignment.startDate || 'Not retrieved'}\nCloses: ${assignment.endDate || 'Not retrieved'}\n${assignment.submissionStatus}`,
      records: undefined, parent });
    for (const record of assignment.records) sources.push({ ...record, title: `${assignment.title} · ${record.title}`,
      text: record.text || `${record.title}: ${record.status}. No readable text retrieved.`, ref: record.id, parent });
  }
  return sources.map(({ ref, records, ...source }) => ({ ...source,
    id: createHash('sha256').update(ref).digest('base64url').slice(0, 24),
  }));
}

// Bounded catalogue selection is distinct from evidence selection: the model sees varied records,
// including records with no literal query overlap, and can follow assignment relationships.
export function planningCatalogue(sources, query, context = null) {
  const terms = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [])];
  const previous = new Set(context?.sourceIds || []);
  const ranked = sources.map((source, index) => ({ source, index,
    score: (previous.has(source.id) ? 10 : 0) + terms.reduce((score, term) => score +
      (source.title.toLowerCase().includes(term) ? 3 : source.text.toLowerCase().includes(term) ? 1 : 0), 0),
  })).sort((a, b) => b.score - a.score || a.index - b.index);
  const selected = new Map(ranked.slice(0, 200).map(({ source }) => [source.id, source]));
  // Reserve space for every course/category rather than letting a large course crowd out others.
  const buckets = new Map();
  for (const source of sources) {
    const key = `${source.course}:${source.category}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(source);
  }
  for (let round = 0; selected.size < 400; round++) {
    let added = false;
    for (const bucket of buckets.values()) {
      if (selected.size >= 400) break;
      const source = bucket[round];
      if (source && !selected.has(source.id)) { selected.set(source.id, source); added = true; }
    }
    if (!added && [...buckets.values()].every(bucket => round >= bucket.length)) break;
  }
  return [...selected.values()].map(source => ({ id: source.id, course: source.courseName, category: source.category,
    title: excerpt(source.title, 200), preview: excerpt(source.text, 400), parent: source.parent || null,
    dueDate: source.dueDate || null, stale: !!source.stale, status: source.status || 'available',
  }));
}

export function buildTaskWorkspace(plan, sources, catalogueCount, total) {
  const byId = new Map(sources.map(source => [source.id, source]));
  if (!matches(plan, workspacePlanSchema) || !plan.title.trim() || !plan.goal.trim() || plan.sections.some(section => !section.sourceIds.length ||
    section.sourceIds.some(id => !byId.has(id)))) throw fail('The workspace plan could not be verified. Please retry.');
  const ids = [...new Set(plan.sections.flatMap(section => section.sourceIds))];
  if (ids.length > 24 || (!ids.length && !plan.question.trim())) throw fail('The workspace plan needs sources or a clarifying question. Please retry.');
  const evidence = ids.map(id => {
    const { text, ...source } = byId.get(id);
    return { ...source, excerpt: excerpt(text, 8000) };
  });
  return { workspace: { kind: 'task', title: plan.title, goal: plan.goal, question: plan.question,
    sections: plan.sections.map(section => ({ ...section, sources: section.sourceIds.map(id => {
      const source = byId.get(id);
      return { id, title: source.title, category: source.category, courseName: source.courseName,
        text: excerpt(source.text, 30_000), url: source.url, dueDate: source.dueDate || null,
        stale: !!source.stale, status: source.status || 'available', lastSuccess: source.lastSuccess || null };
    }) })),
    context: { goal: plan.goal, sourceIds: ids }, catalogueCount, total }, sources: evidence };
}

export function validTaskContext(context) {
  if (context === null) return true;
  if (!context || typeof context !== 'object' || Array.isArray(context)) return false;
  const { summary, ...references } = context;
  return matches(references, object({ goal: text(1000), sourceIds: list(text(80), 24) })) &&
    (summary === undefined || (typeof summary === 'string' && summary.length <= 12_000));
}

export async function composeTaskWorkspace(llm, inventory, query, model, course, context, signal, refresh = () => inventory) {
  const all = taskCatalogue(inventory, course);
  const catalogue = planningCatalogue(all, query, context);
  const plan = await llm.planWorkspace(query, model, { catalogue, total: all.length,
    courses: inventory.courses.filter(item => !course || item.id === course), now: new Date().toISOString() }, context, signal);
  const visible = new Set(catalogue.map(source => source.id));
  return buildTaskWorkspace(plan, taskCatalogue(refresh(), course).filter(source => visible.has(source.id)), catalogue.length, all.length);
}
