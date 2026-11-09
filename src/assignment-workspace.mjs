import { htmlContent } from './documents.mjs';

const numeric = value => /^\d+$/.test(String(value ?? ''));
const visible = value => value && !value.IsHidden && !value.IsLocked && !value.IsDeleted && value.IsPublished !== false;
const readable = row => row?.data != null && !['denied', 'not_configured'].includes(row.outcome);
const normalize = value => String(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const date = value => Number.isFinite(Date.parse(value)) ? value : null;
const fields = new Set(['Name', 'Title', 'Description', 'Instructions', 'Text', 'Html', 'text',
  'Criteria', 'CriteriaGroups', 'Levels', 'Rubrics', 'Feedback', 'FeedbackText', 'Points', 'MaxPoints', 'Score', 'OutOf']);

// Project only coursework fields: never expose raw responses, retained bytes, or credentials.
function courseworkText(value, depth = 0) {
  if (depth > 10 || value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(item => courseworkText(item, depth + 1)).filter(Boolean).join('\n');
  if (!visible(value)) return '';
  if (value.Html) return htmlContent(value.Html).text;
  return Object.entries(value).filter(([key]) => fields.has(key))
    .map(([key, item]) => `${['Points', 'MaxPoints', 'Score', 'OutOf'].includes(key) ? `${key}: ` : ''}${courseworkText(item, depth + 1)}`)
    .filter(Boolean).join('\n');
}

function state(row) {
  if (!row) return 'missing';
  if (row.outcome === 'denied') return 'inaccessible';
  if (row.outcome === 'not_configured') return 'not_configured';
  return readable(row) ? row.outcome === 'available' ? 'available' : 'stale' : 'missing';
}

export function projectAssignments(rows, courses, origin) {
  const assignments = [];
  for (const course of courses) {
    const scoped = rows.filter(row => String(row.course) === course.id);
    const listing = scoped.find(row => row.category === 'assignments');
    if (!readable(listing) || !Array.isArray(listing.data)) continue;
    for (const folder of listing.data.filter(item => numeric(item.Id) && visible(item))) {
      const id = String(folder.Id);
      const related = scoped.filter(row => {
        const path = row.key || '';
        return path.match(/\/dropbox\/folders\/(\d+)(?:\/|$)/)?.[1] === id ||
          (row.category === 'rubrics' && new URL(path, origin).searchParams.get('objectId') === id);
      });
      const detail = related.find(row => row.category === 'assignment_detail');
      if (readable(detail) && !visible(detail.data)) continue;
      const data = { ...folder, ...(readable(detail) ? detail.data : {}) };
      const url = `${origin}/d2l/lms/dropbox/user/folder_submit_files.d2l?db=${id}&ou=${course.id}`;
      const record = (kind, title, row, text = readable(row) ? courseworkText(row.data) : '') => ({
        id: `${course.id}:${id}:${kind}:${row?.key || title}`, resourceKey: row?.key || null, course: course.id, courseName: course.name,
        category: kind, title, text: text.length > 100_000 ? `${text.slice(0, 100_000)}\n[Excerpt truncated. Open Brightspace for the full source.]` : text, status: state(row),
        stale: state(row) === 'stale', lastSuccess: row?.last_success || null, checkedAt: row?.checked_at || null, url,
      });
      const instructions = courseworkText(data.Instructions) || courseworkText(data.Description);
      const records = [record('instructions', 'Instructions and deliverables', readable(detail) ? detail : listing, instructions)];
      const rubric = related.find(row => row.category === 'rubrics');
      const embedded = data.Assessment?.Rubrics;
      records.push(rubric ? record('rubric', 'Rubric', rubric) : embedded?.length
        ? record('rubric', 'Rubric', readable(detail) ? detail : listing, courseworkText(embedded))
        : record('rubric', 'Rubric', null));
      const submissions = related.find(row => row.category === 'own_submissions');
      // A complete empty response establishes no submissions; a missing read does not.
      let submissionStatus = 'Submission status not retrieved';
      if (readable(submissions) && Array.isArray(submissions.data)) {
        const count = submissions.data
          .reduce((total, entity) => total + (entity.Submissions?.length || 0), 0);
        submissionStatus = count ? `${count} cached submission${count === 1 ? '' : 's'}` : 'No submissions in the cached response';
        if (state(submissions) === 'stale') submissionStatus += ' · stale';
      } else if (state(submissions) === 'inaccessible') submissionStatus = 'Submission status inaccessible';
      const feedback = related.find(row => row.category === 'own_feedback');
      records.push(record('feedback', 'Your feedback', feedback));
      for (const attachment of data.Attachments || []) {
        if (!numeric(attachment.FileId) || !visible(attachment)) continue;
        const file = related.find(row => row.category === 'assignment_file' && row.key.endsWith(`/attachments/${attachment.FileId}`));
        records.push(record('attachment', attachment.FileName || attachment.Name || `Attachment ${attachment.FileId}`, file));
      }
      assignments.push({ id, course: course.id, courseName: course.name, title: data.Name || `Assignment ${id}`,
        dueDate: date(data.DueDate), startDate: date(data.Availability?.StartDate || data.StartDate),
        endDate: date(data.Availability?.EndDate || data.EndDate), submissionStatus, url,
        stale: state(listing) === 'stale' || state(detail) === 'stale', lastSuccess: (readable(detail) ? detail : listing).last_success || null,
        records });
    }
  }
  return assignments;
}

export function assignmentWorkspace(inventory, query, course = '', assignmentId = '') {
  const normalized = normalize(query);
  const number = normalized.match(/\b(?:assignment|assign|a|hw|homework)\s*0*(\d+)\b/)?.[1];
  const courseMatches = inventory.courses.filter(item => {
    const codes = [...normalize(item.name).matchAll(/\b([a-z]{2,})\s*(\d{3,4})\b/g)];
    return codes.some(code => new RegExp(`\\b${code[1]}\\s*${code[2]}\\b`).test(normalized));
  });
  // An explicitly named course takes precedence over context from the previous request.
  const namedCourses = courseMatches.map(item => item.id);
  const unknownCourse = !namedCourses.length && /\b(?!assignment\b|homework\b)[a-z]{2,}\s*\d{3,4}\b/.test(normalized);
  let candidates = (inventory.assignments || []).filter(item => namedCourses.length ? namedCourses.includes(item.course) : !course || item.course === course);
  if (unknownCourse && number) candidates = [];
  if (number) candidates = candidates.filter(item => normalize(item.title).match(/\b(?:assignment|assign|a|hw|homework)\s*0*(\d+)\b/)?.[1] === number);
  else {
    const titles = candidates.filter(item => normalized.includes(normalize(item.title)));
    if (titles.length) candidates = titles;
    else if (assignmentId && !namedCourses.length && !/\b(?:assignment|homework|quiz|test|exam)\b/.test(normalized)) candidates = candidates.filter(item => item.id === assignmentId);
    else if (!/\b(?:assignment|homework)\b/.test(normalized)) return null;
  }
  if (candidates.length > 1 && assignmentId && course) {
    const selected = candidates.filter(item => item.id === assignmentId && item.course === course);
    if (selected.length) candidates = selected;
  }
  const choices = candidates.map(({ id, course, courseName, title }) => ({ id, course, courseName, title }));
  if (candidates.length !== 1) return { status: candidates.length ? 'choose' : 'missing', choices };
  const target = candidates[0];
  const title = normalize(target.title);
  const shortTitle = title.match(/\b(?:assignment|homework|hw)\s*\d+\b/)?.[0] || title;
  const instructions = normalize(target.records.find(record => record.category === 'instructions')?.text || '');
  const supporting = inventory.sources.filter(source => source.course === target.course &&
    ['content', 'content_file', 'linked_content', 'syllabus_source', 'announcements'].includes(source.category))
    .map(source => {
      const name = normalize(source.title), body = normalize(source.text);
      const mentions = value => (` ${value} `).includes(` ${shortTitle} `);
      const reason = mentions(name) || mentions(body) ? 'Mentions this assignment'
        : name.length > 8 && instructions.includes(name) ? 'Referenced in the assignment instructions'
          : source.category === 'syllabus_source' ? 'Course policy reference' : '';
      return { ...source, status: source.stale ? 'stale' : 'available', reason };
    }).filter(source => source.reason).sort((a, b) => (a.reason === 'Course policy reference') - (b.reason === 'Course policy reference')).slice(0, 6);
  const submitting = /\b(submit|submission|ready|hand in)\b/.test(normalized);
  const order = submitting || /\b(rubric|criterion|criteria)\b/.test(normalized) ? ['rubric', 'instructions', 'attachment', 'feedback'] : ['instructions', 'attachment', 'rubric', 'feedback'];
  const records = [...target.records].sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category));
  return { status: 'resolved', ...target, records, supporting, intent: submitting ? 'submit' : 'work' };
}
