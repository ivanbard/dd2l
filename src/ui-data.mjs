import { DatabaseSync } from 'node:sqlite';
import { htmlContent } from './documents.mjs';
import { SCHOOL, schoolOrigin } from './client.mjs';
import { createHash } from 'node:crypto';

const categories = new Set(['content', 'overview', 'syllabus_source', 'assignments', 'quizzes', 'announcements',
  'calendar', 'calendar_occurrences', 'content_file', 'assignment_file', 'linked_content', 'video_transcript']);
const textFields = new Set(['Title', 'Name', 'Subject', 'Text', 'Html', 'text', 'Description', 'Instructions',
  'Body', 'Content', 'StartDate', 'EndDate', 'DueDate', 'StartDateTime', 'EndDateTime']);

// Open for each request so logout, revoked access and new syncs are reflected immediately.
export function readInventory(path) {
  let db;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    db.exec('PRAGMA busy_timeout=3000; BEGIN');
    const meta = key => {
      const row = db.prepare('SELECT value FROM meta WHERE key=?').get(key);
      return row ? JSON.parse(row.value) : null;
    };
    const state = meta('state');
    const rows = db.prepare(`SELECT key,course,category,data,last_success,checked_at,outcome
      FROM resources WHERE data IS NOT NULL AND outcome NOT IN ('denied','not_configured')`).all()
      .map(row => ({ ...row, data: JSON.parse(row.data) }));
    return { ...projectInventory(rows, state, meta('school_origin') ?? SCHOOL), scope: createHash('sha256').update(String(meta('account') || 'local')).digest('hex') };
  } catch (error) {
    if (error.code === 'ERR_SQLITE_ERROR' && /unable to open database/.test(error.message)) {
      return { courses: [], sources: [], state: null };
    }
    throw error;
  } finally { db?.close(); }
}

export function projectInventory(rows, state, origin = SCHOOL) {
  origin = schoolOrigin(origin);
  const enrollment = rows.find(row => row.category === 'enrollments' && !['denied', 'not_configured'].includes(row.outcome));
  const courses = (enrollment?.data ?? []).filter(item => item.Access?.CanAccess === true && item.OrgUnit?.Id)
    .map(item => ({ id: String(item.OrgUnit.Id), name: item.OrgUnit.Name || `Course ${item.OrgUnit.Id}`,
      active: item.Access.IsActive === true }));
  const allowed = new Map(courses.map(course => [course.id, course]));
  const sources = [];
  for (const row of rows) {
    if (!categories.has(row.category) || !allowed.has(String(row.course)) || ['denied', 'not_configured'].includes(row.outcome)) continue;
    const visit = (value, parentTitle = '', depth = 0) => {
      if (!value || typeof value !== 'object' || depth > 15) return;
      if (Array.isArray(value)) { for (const item of value) visit(item, parentTitle, depth + 1); return; }
      if (value.IsHidden || value.IsLocked || value.IsDeleted || value.IsPublished === false ||
        Date.parse(value.StartDateTime) > Date.now() || Date.parse(value.EndDateTime) < Date.now() ||
        (row.category === 'announcements' && (Date.parse(value.StartDate) > Date.now() || Date.parse(value.EndDate) < Date.now()))) return;
      const title = String(value.Title || value.Name || value.Subject || value.title || parentTitle || row.category.replaceAll('_', ' '));
      const parts = [];
      const collect = (item, field, level = 0) => {
        if (typeof item === 'string') parts.push(['Html', 'Description', 'Instructions', 'Body', 'Content'].includes(field) ? htmlContent(item).text : item);
        else if (item && typeof item === 'object' && !Array.isArray(item) && level < 3) {
          for (const [key, child] of Object.entries(item)) if (textFields.has(key)) collect(child, key, level + 1);
        }
      };
      for (const [key, child] of Object.entries(value)) if (textFields.has(key)) collect(child, key);
      const text = [...new Set(parts.filter(Boolean))].join('\n').slice(0, 1_000_000);
      if (text) sources.push({ id: `${row.key}#${sources.length}`, course: String(row.course),
        courseName: allowed.get(String(row.course)).name, title, text, category: row.category,
        lastSuccess: row.last_success, checkedAt: row.checked_at, stale: row.outcome !== 'available',
        dueDate: ['assignments', 'quizzes', 'calendar', 'calendar_occurrences'].includes(row.category) && Number.isFinite(Date.parse(value.DueDate)) ? value.DueDate : null,
        publishedAt: row.category === 'announcements' ? value.PublishedDate || value.StartDate || null : null,
        url: `${origin}/d2l/home/${row.course}` });
      for (const [key, child] of Object.entries(value)) {
        if (!textFields.has(key) && child && typeof child === 'object') visit(child, title, depth + 1);
      }
    };
    visit(row.data);
  }
  return { courses, sources, state };
}

export function homeInventory(inventory, now = Date.now()) {
  const sources = inventory.sources.map(({ text, ...source }) => ({ ...source, excerpt: text.slice(0, 300),
    ref: JSON.stringify([source.course, source.category, source.title]) }));
  return { scope: inventory.scope || 'local-empty', courses: inventory.courses,
    deadlines: sources.filter(source => Date.parse(source.dueDate) >= now).sort((a, b) => Date.parse(a.dueDate) - Date.parse(b.dueDate)),
    announcements: sources.filter(source => source.category === 'announcements').sort((a, b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0)),
    sources };
}

const stopWords = new Set('a an the what when where which who how are is was were do does did i my me we our you your for of to in on at and or about can could would should please find show tell looking today'.split(' '));

export function searchInventory(inventory, query, course = '') {
  // shortcut: local keyword retrieval only; replace with grounded prompt retrieval when that service exists.
  const terms = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])].filter(term => !stopWords.has(term));
  if (query.trim() && !terms.length) return { results: [], total: 0 };
  const matches = inventory.sources.filter(source => !course || source.course === course).map(source => {
    const title = `${source.title} ${source.courseName}`.toLowerCase();
    const body = source.text.toLowerCase();
    return { source, score: terms.reduce((score, term) => score + (title.includes(term) ? 3 : body.includes(term) ? 1 : 0), 0) };
  }).filter(item => !terms.length || item.score > 0).sort((a, b) => b.score - a.score);
  return { total: matches.length, results: matches.slice(0, 30).map(({ source }) => {
    const lower = source.text.toLowerCase();
    const first = terms.map(term => lower.indexOf(term)).filter(index => index >= 0);
    const start = Math.max(0, (first.length ? Math.min(...first) : 0) - 100);
    const { text, ...metadata } = source;
    return { ...metadata, excerpt: `${start ? '…' : ''}${text.slice(start, start + 700)}${text.length > start + 700 ? '…' : ''}` };
  }) };
}
