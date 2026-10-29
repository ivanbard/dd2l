import { AccessError } from './client.mjs';
import { readDocument } from './documents.mjs';
import { classifyOverview, collectSyllabus } from './syllabus.mjs';

function id(value) {
  const result = String(value);
  if (!/^\d+$/.test(result)) throw new Error('Expected a numeric Brightspace ID.');
  return result;
}

export function fields(value) {
  const keys = new Set();
  const visit = (item, depth) => {
    if (!item || typeof item !== 'object' || depth > 8) return;
    if (Array.isArray(item)) { for (const child of item) visit(child, depth + 1); }
    else for (const [key, child] of Object.entries(item)) { keys.add(key); visit(child, depth + 1); }
  };
  visit(value, 0);
  return [...keys].sort();
}

async function readResource(client, category, path, { list = false, courseId, file = false } = {}) {
  const observation = { key: path.split('?')[0], category, course: courseId, source: path,
    retrievedAt: new Date().toISOString(), outcome: 'available' };
  try {
    const result = file ? { data: await readDocument(client, path), complete: true } : list ? await client.collection(path) : { data: await client.get(path), complete: true };
    Object.assign(observation, result);
    if (!result.complete) observation.outcome = 'partial';
  } catch (error) {
    if (!(error instanceof AccessError) || error.code === 'needs_login') throw error;
    Object.assign(observation, { outcome: error.code === 'partial' ? 'partial' : error.code === 'denied' ? 'denied' : 'failed',
      error: error.code, message: error.message, status: error.status, retryAfter: error.retryAfter, complete: false });
  }
  return observation;
}

function selectCourse(enrollments, course) {
  const candidates = enrollments.data.filter(item => item?.OrgUnit?.Id && item.Access?.CanAccess === true)
    .sort((a, b) => (Date.parse(b.Access.LastAccessed) || 0) - (Date.parse(a.Access.LastAccessed) || 0));
  const selected = course ? candidates.find(item => String(item.OrgUnit.Id) === id(course)) :
    candidates.find(item => item.Access?.IsActive === true) ?? candidates[0];
  if (course && !selected) throw new Error('Requested course was not confirmed accessible in your enrollments.');
  return selected ? id(selected.OrgUnit.Id) : null;
}

export class Connector {
  constructor(client, store) { this.client = client; this.store = store; }

  async courses() {
    const versions = await this.client.versions();
    const identity = await this.client.get(`/d2l/api/lp/${versions.lp}/users/whoami`);
    const session = await this.client.session.load();
    if (!identity?.Identifier || String(identity.Identifier) !== String(session.identity.Identifier)) {
      throw new AccessError('needs_login', 'Account identity changed. Sign in again before reading course data.');
    }
    const account = this.store.getMeta('account');
    if (account && account !== `${this.client.origin}:${identity.Identifier}`) throw new AccessError('needs_login', 'Local inventory belongs to another account. Sign out before switching accounts.');
    const enrollments = await this.client.collection(`/d2l/api/lp/${versions.lp}/enrollments/myenrollments/?orgUnitTypeId=3`);
    return { identity, versions, enrollments };
  }

  async syllabus({ course } = {}) {
    const { identity, versions, enrollments } = await this.courses();
    const courseId = selectCourse(enrollments, course);
    if (!courseId) throw new Error('No accessible course was found.');
    const le = `/d2l/api/le/${versions.le}/${courseId}`;
    const content = await readResource(this.client, 'content', `${le}/content/toc`, { courseId });
    const overview = classifyOverview(await readResource(this.client, 'overview', `${le}/overview`, { courseId }));
    const result = await collectSyllabus(this.client, { le, courseId, content, overview });
    const summary = { finishedAt: new Date().toISOString(), scope: 'syllabus sources for one course', versions,
      courseCount: enrollments.data.length, ...result.summary };
    this.store.commit(identity, this.client.origin, [content, overview, ...result.observations], summary, enrollments);
    return summary;
  }

  async audit({ course, from, to } = {}) {
    from ??= new Date(Date.now() - 30 * 86400_000).toISOString();
    to ??= new Date(Date.now() + 120 * 86400_000).toISOString();
    if (!Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to)) || Date.parse(from) >= Date.parse(to)) {
      throw new Error('Calendar window must contain valid ISO dates with from earlier than to.');
    }
    const { identity, versions, enrollments } = await this.courses();
    const observations = [];
    const capture = async (category, path, { list = false, courseId, file = false } = {}) => {
      const observation = await readResource(this.client, category, path, { list, courseId, file });
      observations.push(observation);
      return observation;
    };
    observations.push({ key: 'enrollments', category: 'enrollments', ...enrollments,
      outcome: enrollments.complete ? 'available' : 'partial', retrievedAt: new Date().toISOString() });
    const courseId = selectCourse(enrollments, course);
    let syllabus;
    if (courseId) {
      const le = `/d2l/api/le/${versions.le}/${courseId}`;
      const lp = `/d2l/api/lp/${versions.lp}/${courseId}`;
      // Sequential reads keep this first discovery pass bounded and gentle on the tenant.
      const read = (category, path, options) => capture(category, path, { courseId, ...options });
      const content = await read('content', `${le}/content/toc`);
      const overview = classifyOverview(await read('overview', `${le}/overview`));
      const result = await collectSyllabus(this.client, { le, courseId, content, overview });
      syllabus = result.summary;
      observations.push(...result.observations);
      const assignments = await read('assignments', `${le}/dropbox/folders/`, { list: true });
      await read('quizzes', `${le}/quizzes/`, { list: true });
      await read('grades', `${le}/grades/values/myGradeValues/`, { list: true });
      await read('announcements', `${le}/news/`, { list: true });
      const forums = await read('discussion_forums', `${le}/discussions/forums/`, { list: true });
      await read('groups', `${lp}/groups/`, { list: true });
      await read('sections', `${lp}/sections/mysections/`, { list: true });
      const calendar = new URL(`${le}/calendar/events/myEvents/`, this.client.origin);
      calendar.searchParams.set('startDateTime', new Date(from).toISOString());
      calendar.searchParams.set('endDateTime', new Date(to).toISOString());
      const [major, minor] = versions.le.split('.').map(Number);
      await read('calendar', `${calendar.pathname}${calendar.search}`, { list: true });
      const folder = assignments.data?.[0];
      if (folder?.Id != null) {
        const folderPath = `${le}/dropbox/folders/${id(folder.Id)}`;
        await read('assignment_detail', folderPath);
        await read('own_submissions', `${folderPath}/submissions/mysubmissions/`, { list: true });
        await read('own_feedback', `${folderPath}/feedback/user/${id(identity.Identifier)}`);
        if (major > 1 || minor >= 93) await read('rubrics', `${le}/rubrics/?objectType=Dropbox&objectId=${id(folder.Id)}`, { list: true });
        const attachment = folder.Attachments?.[0];
        if (attachment?.FileId != null) await read('assignment_file_sample', `${folderPath}/attachments/${id(attachment.FileId)}`, { file: true });
      }
      const forum = forums.data?.[0];
      if (forum?.ForumId != null) {
        const forumPath = `${le}/discussions/forums/${id(forum.ForumId)}`;
        const topics = await read('discussion_topics', `${forumPath}/topics/`, { list: true });
        if (topics.data?.[0]?.TopicId != null) await read('discussion_posts_sample', `${forumPath}/topics/${id(topics.data[0].TopicId)}/posts/`, { list: true });
      }
      const findTopic = item => {
        if (!item || typeof item !== 'object') return null;
        if (item.TopicId != null && item.ActivityType === 1 && !item.IsHidden && !item.IsLocked) return item;
        for (const child of Object.values(item)) {
          if (Array.isArray(child)) { for (const entry of child) { const topic = findTopic(entry); if (topic) return topic; } }
          else if (child && typeof child === 'object') { const topic = findTopic(child); if (topic) return topic; }
        }
        return null;
      };
      const topic = findTopic(content.data);
      if (topic) {
        const path = `${le}/content/topics/${id(topic.TopicId)}/file`;
        const existing = observations.find(item => item.category === 'syllabus_source' && item.source === path && item.outcome === 'available');
        if (existing) observations.push({ ...existing, key: path, category: 'content_file_sample' });
        else await read('content_file_sample', path, { file: true });
      }
    }
    const summary = {
      finishedAt: new Date().toISOString(), scope: 'one selected accessible course; representative detail reads',
      versions, courseCount: enrollments.data.length, enrollmentCoverageComplete: enrollments.complete,
      selectedCourse: courseId ? 'course-1' : null, calendarWindow: { from, to }, syllabus,
      complete: Boolean(courseId) && observations.every(item => item.complete),
      retryAfter: Math.max(0, ...observations.filter(item => item.error === 'retry_wait').map(item => item.retryAfter || 60_000)),
      resources: observations.map(item => ({ category: item.category, outcome: item.outcome,
        complete: item.complete, pages: item.pages, count: Array.isArray(item.data) ? item.data.length : undefined,
        fieldNames: fields(item.data), error: item.error, message: item.message })),
      notChecked: ['full document extraction/OCR', 'external LTI contents', 'video transcripts', 'all per-object details', 'calendar recurrence expansion', 'comparison with the onQ browser'],
    };
    this.store.commit(identity, this.client.origin, observations, summary, enrollments);
    this.selectedCourse = courseId;
    if (courseId) this.store.meta('selected_course', courseId);
    return summary;
  }
}

export async function sync(connector, options, { signal, onUpdate = console.log, wait = ms => new Promise(resolve => {
  const timer = setTimeout(done, ms);
  function done() { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); }
  signal?.addEventListener('abort', done, { once: true });
  if (signal?.aborted) done();
}) } = {}) {
  let failures = 0;
  options = { ...options, course: options?.course ?? connector.store.getMeta('selected_course') ?? undefined };
  while (!signal?.aborted) {
    let delay = 15 * 60_000;
    connector.store.meta('state', { state: 'syncing', updatedAt: new Date().toISOString() });
    try {
      const summary = await connector.audit(options);
      options.course ??= connector.selectedCourse ?? undefined;
      failures = 0;
      delay = Math.max(delay, summary.retryAfter);
      await onUpdate({ state: summary.retryAfter ? 'retry_wait' : 'ready', ...summary });
    } catch (error) {
      const state = error.code === 'needs_login' ? 'needs_login' : 'retry_wait';
      connector.store.meta('state', { state, updatedAt: new Date().toISOString() });
      if (state === 'needs_login' || !(error instanceof AccessError)) throw error;
      delay = Math.max(error.retryAfter || 0, Math.min(15 * 60_000, 60_000 * 2 ** Math.min(failures++, 4)));
      await onUpdate({ state, message: error.message });
    }
    if (!signal?.aborted) await wait(delay);
  }
}
