import { AccessError, BrightspaceClient } from './client.mjs';
import { createHash } from 'node:crypto';
import { readDocument } from './documents.mjs';
import { classifyOverview, collectSyllabus } from './syllabus.mjs';
import { courseNodes, reconcileQuizzes, batch } from './discovery.mjs';
import { readLinkedDocument, actionLink, linkUrl } from './links.mjs';
import { descriptionContent } from './documents.mjs';
import { youtubeId, youtubeTranscript } from './media.mjs';

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
    if (file && ['failed', 'partial', 'unsupported'].includes(result.data.textStatus)) result.complete = false;
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

function assignmentSamples(folders, grades) {
  const scored = new Set((grades ?? []).filter(grade =>
    grade.PointsNumerator != null || grade.WeightedNumerator != null || grade.ReleasedDate != null)
    .map(grade => String(grade.GradeObjectIdentifier)));
  const withRubric = folders.find(folder => folder.Assessment?.Rubrics?.length);
  const withGrade = folders.find(folder => scored.has(String(folder.GradeItemId)));
  return [...new Set([withGrade ?? withRubric ?? folders[0], withRubric].filter(Boolean))];
}

function feedbackEntity(folder, identity, submissions, groups) {
  if (folder.DropboxType !== 1 && folder.GroupTypeId == null) return { type: 'user', entityId: id(identity.Identifier) };
  // A group-category ID identifies the assignment's grouping, not a submitter.
  const submitted = [...new Set((submissions ?? []).filter(item => item.Entity?.EntityType === 'Group')
    .map(item => String(item.Entity.EntityId)))];
  if (submitted.length === 1) return { type: 'group', entityId: id(submitted[0]) };
  if (submitted.length > 1 || folder.GroupTypeId == null) return null;
  const memberships = (groups ?? []).filter(group => String(group.GroupCategoryId) === String(folder.GroupTypeId));
  return memberships.length === 1 ? { type: 'group', entityId: id(memberships[0].GroupId) } : null;
}

export class Connector {
  constructor(client, store) { this.client = client; this.store = store; this.queue = Promise.resolve(); }

  exclusive(operation, signal) {
    const run = this.queue.then(() => { signal?.throwIfAborted(); return operation(); });
    this.queue = run.catch(() => {});
    if (!signal) return run;
    return new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      run.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
  }

  async courses(client = this.client) {
    const versions = await client.versions();
    const identity = await client.get(`/d2l/api/lp/${versions.lp}/users/whoami`);
    const session = await client.session.load();
    if (!identity?.Identifier || String(identity.Identifier) !== String(session.identity.Identifier)) {
      throw new AccessError('needs_login', 'Account identity changed. Sign in again before reading course data.');
    }
    const account = this.store.getMeta('account');
    if (account && account !== `${this.client.origin}:${identity.Identifier}`) throw new AccessError('needs_login', 'Local inventory belongs to another account. Sign out before switching accounts.');
    const enrollments = await client.collection(`/d2l/api/lp/${versions.lp}/enrollments/myenrollments/?orgUnitTypeId=3`);
    return { identity, versions, enrollments };
  }

  syllabus(options) { return this.exclusive(() => this.readSyllabus(options)); }

  async readSyllabus({ course } = {}) {
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

  browse(action, { scope = '', accountScope = '', resources = new Map(), signal } = {}) {
    return this.exclusive(async () => {
      signal?.throwIfAborted();
      const sections = ['courses', 'content', 'assignments', 'quizzes', 'announcements', 'grades', 'calendar', 'overview', 'discussions'];
      const browsing = action?.action === 'browse';
      const target = action?.action === 'read' && resources.get(action.resource);
      if ((!browsing && !target) || (browsing && (!sections.includes(action.section) ||
        typeof action.query !== 'string' || action.query.length > 200 ||
        typeof action.course !== 'string' || action.course.length > 20 ||
        (action.section !== 'courses' && !/^\d+$/.test(action.course))))) {
        throw new AccessError('invalid_link', 'Choose a course area or a resource returned by discovery.');
      }
      const course = browsing ? action.course : target.course;
      if (scope && course && course !== scope) throw new AccessError('denied', 'The selected course is the boundary for this request.');
      const client = new BrightspaceClient(this.client.session, { origin: this.client.origin, fetchImpl: this.client.fetch, signal });
      const { identity, versions, enrollments } = await this.courses(client);
      const account = createHash('sha256').update(`${client.origin}:${identity.Identifier}`).digest('hex');
      if (accountScope && account !== accountScope) throw new AccessError('needs_login', 'School account changed. Start a new workspace request.');
      signal?.throwIfAborted();
      const observations = [{ key: 'enrollments', category: 'enrollments', ...enrollments,
        outcome: enrollments.complete ? 'available' : 'partial', retrievedAt: new Date().toISOString() }];
      const candidates = [];
      const le = `/d2l/api/le/${versions.le}/${course}`;
      const read = async (category, path, options = {}) => {
        signal?.throwIfAborted();
        const observation = await readResource(client, category, path, { courseId: course, ...options });
        signal?.throwIfAborted();
        if (category === 'rubrics') observation.key = path;
        observations.push(observation);
        if (observation.status === 429) throw new AccessError('retry_wait', 'Brightspace rate limit reached. Live discovery stopped.', { status: 429, retryAfter: observation.retryAfter });
        return observation;
      };
      const visible = value => value && !value.IsHidden && !value.IsLocked && !value.IsDeleted && value.IsPublished !== false &&
        !(Date.parse(value.StartDateTime) > Date.now()) && !(Date.parse(value.EndDateTime) < Date.now());
      const requireData = row => {
        if (row.outcome !== 'available') throw new AccessError(row.outcome === 'denied' ? 'denied' : 'unavailable', 'This resource could not be read live; cached evidence may be incomplete.');
        return row.data;
      };
      const deny = (category, key) => {
        observations.push({ key, category, course, outcome: 'denied', complete: false, retrievedAt: new Date().toISOString() });
        throw new AccessError('restricted', 'Resource or its parent is hidden, removed, or outside release conditions.');
      };
      const offer = (kind, value, title, description = '') => candidates.push({ kind, course, ...value,
        title: String(title || kind).slice(0, 200), description: String(description).slice(0, 400) });
      const links = (content, owner) => {
        for (const link of content.links || []) {
          if (actionLink(link.url, client.origin)) continue;
          try {
            const url = new URL(link.url, new URL(owner.base || '/', client.origin));
            const linkedCourse = url.origin === client.origin && url.pathname.match(/^\/d2l\/(?:le\/content|api\/le\/\d+\.\d+)\/(\d+)\//)?.[1];
            const enforced = url.origin === client.origin && url.pathname.match(/^\/content\/enforced\/(\d+)[-/]/)?.[1];
            if ((linkedCourse && linkedCourse !== course) || (enforced && enforced !== course)) continue;
            if (!linkedCourse) linkUrl(client, url.href);
            offer('link', { url: url.href, owner }, link.label || url.pathname);
          } catch { /* Unsupported providers and action links are not browsing capabilities. */ }
        }
      };
      const tree = async () => {
        const previous = courseNodes(this.store.resource?.(`${le}/content/toc`)?.data);
        const toc = requireData(await read('content', `${le}/content/toc`));
        const nodes = courseNodes(toc), current = new Map(nodes.filter(item => item.TopicId != null).map(item => [String(item.TopicId), item]));
        for (const node of [...nodes, ...previous.filter(item => item.TopicId != null && !current.has(String(item.TopicId)))]) {
          if (node.TopicId == null || (!node.restricted && current.has(String(node.TopicId)))) continue;
          observations.push({ key: `${le}/content/topics/${node.TopicId}/file`, course, category: 'content_file',
            outcome: 'denied', complete: false, retrievedAt: new Date().toISOString() });
          for (const link of [{ url: node.Url }, ...descriptionContent(node.Description).links].filter(item => item.url)) {
            try { observations.push({ key: `linked:${course}:${new URL(link.url, client.origin).href}`, course,
              category: 'linked_content', outcome: 'denied', complete: false, retrievedAt: new Date().toISOString() }); } catch {}
          }
        }
        return toc;
      };
      const assignment = async assignmentId => {
        const folders = requireData(await read('assignments', `${le}/dropbox/folders/`, { list: true }));
        const folder = folders.find(item => String(item.Id) === assignmentId && visible(item));
        if (!folder) deny('assignment_detail', `${le}/dropbox/folders/${assignmentId}`);
        return folder;
      };
      const topic = async topicId => {
        const toc = await tree();
        const node = courseNodes(toc).find(item => String(item.TopicId) === topicId);
        if (!node || node.restricted) deny('content_file', `${le}/content/topics/${topicId}/file`);
        return { toc, node };
      };
      const forum = async forumId => {
        const forums = requireData(await read('discussion_forums', `${le}/discussions/forums/`, { list: true }));
        if (!forums.some(item => String(item.ForumId) === forumId && visible(item))) deny('discussion_topics', `${le}/discussions/forums/${forumId}/topics/`);
        return requireData(await read('discussion_topics', `${le}/discussions/forums/${forumId}/topics/`, { list: true }));
      };
      try {
        if (course && !enrollments.data.some(item => String(item.OrgUnit?.Id) === course && item.Access?.CanAccess === true)) {
          throw new AccessError('denied', 'Course access is not confirmed by current enrollments.');
        }
        if (browsing) {
          if (action.section === 'courses') return { outcome: 'available', accountScope: account, courses: enrollments.data.filter(item => item.Access?.CanAccess === true && (!scope || String(item.OrgUnit.Id) === scope))
            .slice(0, 100).map(item => ({ id: String(item.OrgUnit.Id), name: item.OrgUnit.Name })), resources: [] };
          if (action.section === 'content') {
            for (const node of courseNodes(await tree()).filter(item => !item.restricted && item.TopicId != null)) {
              if (node.ActivityType === 1) offer('topic', { topicId: id(node.TopicId) }, node.Title, descriptionContent(node.Description).text);
              else links({ links: [{ url: node.Url, label: node.Title }, ...descriptionContent(node.Description).links].filter(link => link.url) }, { topicId: id(node.TopicId) });
            }
          } else if (action.section === 'assignments') {
            for (const folder of requireData(await read('assignments', `${le}/dropbox/folders/`, { list: true })).filter(visible)) {
              offer('assignment', { assignmentId: id(folder.Id) }, folder.Name, descriptionContent(folder.Instructions).text);
            }
          } else if (action.section === 'quizzes') {
            const list = await read('quizzes', `${le}/quizzes/`, { list: true });
            for (const quiz of reconcileQuizzes((list.data || []).filter(visible), await tree(), [], client.origin).quizzes.filter(item => !item.restricted)) {
              offer('quiz', { quizId: id(quiz.quizId) }, quiz.name);
            }
          } else if (action.section === 'discussions') {
            for (const item of requireData(await read('discussion_forums', `${le}/discussions/forums/`, { list: true })).filter(visible)) offer('forum', { forumId: id(item.ForumId) }, item.Name);
          } else {
            const routes = { announcements: ['announcements', 'news/', true], grades: ['grades', 'grades/values/myGradeValues/', true],
              calendar: ['calendar', `calendar/events/myEvents/?startDateTime=${new Date(Date.now() - 30 * 86400_000).toISOString()}&endDateTime=${new Date(Date.now() + 120 * 86400_000).toISOString()}`, true], overview: ['overview', 'overview', false] };
            const [category, path, list] = routes[action.section];
            const row = await read(category, `${le}/${path}`, { list });
            if (action.section === 'overview') Object.assign(row, classifyOverview(row));
            if (action.section === 'calendar') for (const event of row.data || []) {
              if (event.IsRecurring && event.CalendarEventId != null && visible(event)) offer('calendar', { eventId: id(event.CalendarEventId) }, event.Title);
            }
            if (action.section === 'overview' && row.data) {
              links(descriptionContent(row.data.Description), { overview: true });
              if (row.data.Attachment) offer('overview_file', {}, row.data.Attachment.FileName || 'Overview attachment');
            }
          }
        } else if (target.kind === 'assignment' || target.kind === 'assignment_file') {
          const folder = await assignment(target.assignmentId);
          const path = `${le}/dropbox/folders/${target.assignmentId}`;
          const detail = requireData(await read('assignment_detail', path));
          if (!visible(detail)) deny('assignment_detail', path);
          if (target.kind === 'assignment_file') {
            const attachment = (detail.Attachments || folder.Attachments || []).find(item => String(item.FileId) === target.fileId && visible(item));
            if (!attachment) deny('assignment_file', `${path}/attachments/${target.fileId}`);
            const file = await read('assignment_file', `${path}/attachments/${target.fileId}`, { file: true });
            if (file.data) { file.data.Title = target.title; links(file.data, { assignmentId: target.assignmentId, base: client.origin }); }
          } else {
            const submissions = await read('own_submissions', `${path}/submissions/mysubmissions/`, { list: true });
            const rubrics = detail.Assessment?.Rubrics || folder.Assessment?.Rubrics;
            if (rubrics?.length) observations.push({ key: `${path}/assessment/rubrics`, category: 'rubrics', course, data: rubrics,
              outcome: 'available', complete: true, source: path, retrievedAt: new Date().toISOString() });
            else {
              const [major, minor] = versions.le.split('.').map(Number);
              if (major > 1 || minor >= 93) await read('rubrics', `${le}/rubrics/?objectType=Dropbox&objectId=${target.assignmentId}`, { list: true });
            }
            const groups = folder.DropboxType === 1 || folder.GroupTypeId != null ? (await read('groups', `/d2l/api/lp/${versions.lp}/${course}/groups/`, { list: true })).data : [];
            const entity = feedbackEntity(folder, identity, submissions.data, groups);
            if (entity) await read('own_feedback', `${path}/feedback/${entity.type}/${entity.entityId}`);
            for (const file of detail.Attachments || folder.Attachments || []) if (file.FileId != null && visible(file)) offer('assignment_file', { assignmentId: target.assignmentId, fileId: id(file.FileId) }, file.FileName || file.Name);
            links(descriptionContent(detail.Instructions || folder.Instructions), { assignmentId: target.assignmentId });
          }
        } else if (target.kind === 'topic') {
          const { node } = await topic(target.topicId);
          const file = await read('content_file', `${le}/content/topics/${target.topicId}/file`, { file: true });
          if (file.data) { file.data.Title = node.Title; links(file.data, { topicId: target.topicId, base: node.Url || file.data.resolvedUrl || client.origin }); }
        } else if (target.kind === 'quiz') {
          const list = await read('quizzes', `${le}/quizzes/`, { list: true });
          const known = reconcileQuizzes((list.data || []).filter(visible), await tree(), [], client.origin).quizzes.find(item => item.quizId === target.quizId && !item.restricted);
          if (!known || (list.data || []).some(item => String(item.QuizId) === target.quizId && !visible(item))) deny('quiz_details', `${le}/quizzes/${target.quizId}`);
          const detail = await read('quiz_details', `${le}/quizzes/${target.quizId}`);
          if (detail.data && !visible(detail.data)) deny('quiz_details', detail.key);
          else await read('own_quiz_attempts', `${le}/quizzes/${target.quizId}/attempts/?userId=${id(identity.Identifier)}`, { list: true });
        } else if (target.kind === 'forum') {
          for (const item of (await forum(target.forumId)).filter(visible)) offer('discussion', { forumId: target.forumId, topicId: id(item.TopicId) }, item.Name);
        } else if (target.kind === 'discussion') {
          if (!(await forum(target.forumId)).some(item => String(item.TopicId) === target.topicId && visible(item))) deny('discussion_posts', `${le}/discussions/topics/${target.topicId}/posts/`);
          await read('discussion_posts', `${le}/discussions/topics/${target.topicId}/posts/`, { list: true });
        } else if (target.kind === 'overview_file') {
          if (!requireData(await read('overview', `${le}/overview`)).Attachment) deny('content_file', `${le}/overview/attachment`);
          const file = await read('content_file', `${le}/overview/attachment`, { file: true });
          if (file.data) { file.data.Title = target.title; links(file.data, { overview: true, base: client.origin }); }
        } else if (target.kind === 'calendar') {
          const events = requireData(await read('calendar', `${le}/calendar/events/myEvents/?startDateTime=${new Date(Date.now() - 30 * 86400_000).toISOString()}&endDateTime=${new Date(Date.now() + 120 * 86400_000).toISOString()}`, { list: true }));
          if (!events.some(event => String(event.CalendarEventId) === target.eventId && visible(event))) deny('calendar_occurrences', `${le}/calendar/event/${target.eventId}/occurrences`);
          await read('calendar_occurrences', `${le}/calendar/event/${target.eventId}/occurrences`);
        } else if (target.kind === 'link') {
          let toc;
          if (target.owner.topicId) ({ toc } = await topic(target.owner.topicId));
          else if (target.owner.assignmentId) await assignment(target.owner.assignmentId);
          else requireData(await read('overview', `${le}/overview`));
          const linkedTopic = new URL(target.url).pathname.match(/\/viewContent\/(\d+)\//)?.[1] ||
            new URL(target.url).pathname.match(/\/content\/topics\/(\d+)\/file$/)?.[1];
          if (linkedTopic && new URL(target.url).origin === client.origin) ({ toc } = await topic(linkedTopic));
          signal?.throwIfAborted();
          const row = { key: `linked:${course}:${target.url}`, source: target.url, course, category: 'linked_content',
            retrievedAt: new Date().toISOString(), outcome: 'available', complete: true };
          try {
            row.data = await readLinkedDocument(client, target.url, { le, courseId: course, tree: toc });
            if (row.data.textStatus && !['available', 'empty'].includes(row.data.textStatus)) { row.outcome = 'partial'; row.complete = false; }
            row.data.Title = target.title;
            links(row.data, { ...target.owner, base: target.url });
          } catch (error) {
            if (error.code === 'needs_login' || error.status === 429 || signal?.aborted) throw error;
            Object.assign(row, { outcome: ['denied', 'restricted'].includes(error.code) ? 'denied' : 'failed', complete: false, error: error.code });
          }
          observations.push(row);
        }
        const terms = (browsing ? action.query : '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
        const ranked = candidates.map(item => ({ item, score: terms.reduce((score, term) => score + (`${item.title} ${item.description}`.toLowerCase().includes(term) ? 1 : 0), 0) }))
          .filter(item => !terms.length || item.score).sort((a, b) => b.score - a.score);
        const result = ranked.slice(0, 30).map(({ item }) => {
          const reference = createHash('sha256').update(JSON.stringify(item)).digest('base64url').slice(0, 24);
          resources.set(reference, item);
          return { resource: reference, course: item.course, kind: item.kind, title: item.title, description: item.description };
        });
        return { outcome: observations.some(row => !['available'].includes(row.outcome)) ? 'partial' : 'available', accountScope: account, resources: result,
          total: ranked.length, resourceKeys: observations.map(row => row.key), outcomes: observations.slice(1).map(({ category, outcome }) => ({ category, outcome })) };
      } catch (error) {
        if (target?.kind === 'link' && ['restricted', 'denied'].includes(error.code)) observations.push({
          key: `linked:${course}:${target.url}`, course, category: 'linked_content', outcome: 'denied', complete: false, retrievedAt: new Date().toISOString() });
        throw error;
      } finally {
        signal?.throwIfAborted();
        this.store.commit(identity, client.origin, observations, { ...this.store.getMeta('last_run'),
          onDemand: { checkedAt: new Date().toISOString(), resources: observations.length - 1 } }, enrollments);
      }
    }, signal);
  }

  async auditAll(options) {
    const { enrollments } = await this.courses();
    if (!enrollments.complete) throw new AccessError('retry_wait', 'Complete enrollment coverage is required for an all-course pass.');
    const courses = enrollments.data.filter(item => item.Access?.CanAccess === true)
      .sort((a, b) => Number(a.OrgUnit.Id) - Number(b.OrgUnit.Id));
    const selected = batch(courses, this.store.getMeta('all_course_cursor'), 5);
    const previous = this.store.getMeta('selected_course');
    const results = [];
    try {
      for (const [index, course] of selected.items.entries()) {
        results.push({ alias: `course-${selected.start + index + 1}`, ...await this.audit({ ...options, course: String(course.OrgUnit.Id) }) });
      }
      const summary = { finishedAt: new Date().toISOString(), scope: 'resumable all-accessible-course pass; up to five courses per run',
        accessibleCourseCount: courses.length, coursesProcessed: results.length, nextCourseOffset: selected.next,
        complete: !selected.limited && results.every(item => item.complete),
        retryAfter: Math.max(0, ...results.map(item => item.retryAfter || 0)), courses: results };
      this.store.meta('all_course_cursor', selected.next);
      this.store.meta('last_run', summary);
      return summary;
    } finally { this.store.meta('selected_course', previous); }
  }

  audit(options = {}) {
    if (options.all && options.course) return Promise.reject(new Error('Choose either --all or --course.'));
    return options.all ? this.auditAll({ from: options.from, to: options.to }) : this.exclusive(() => this.auditCourse(options));
  }

  async auditCourse({ course, from, to, all } = {}) {
    from ??= new Date(Date.now() - 30 * 86400_000).toISOString();
    to ??= new Date(Date.now() + 120 * 86400_000).toISOString();
    if (!Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to)) || Date.parse(from) >= Date.parse(to)) {
      throw new Error('Calendar window must contain valid ISO dates with from earlier than to.');
    }
    const { identity, versions, enrollments } = await this.courses();
    const observations = [];
    const checkpoints = [];
    const traversal = {};
    const window = (name, items, size = 25, owner = '') => {
      const key = `cursor:${courseId}:${name}:${owner}`;
      const selected = batch(items, this.store.getMeta(key), size);
      const phase = traversal[name] ??= { total: 0, processed: 0, limited: false };
      phase.total += selected.total;
      phase.processed += selected.items.length;
      phase.limited ||= selected.limited;
      checkpoints.push([key, selected.next]);
      return selected.items;
    };
    const capture = async (category, path, { list = false, courseId, file = false, version } = {}) => {
      if (file && version) {
        const cached = this.store.resource?.(path.split('?')[0]);
        if (cached?.outcome === 'available' && cached.observation.version === version &&
          Date.now() - Date.parse(cached.last_success) < 6 * 3600_000 && cached.data?.textStatus === 'available') {
          const observation = { ...cached.observation, data: cached.data, cached: true, category, course: courseId, retrievedAt: cached.last_success };
          observations.push(observation);
          return observation;
        }
      }
      const observation = await readResource(this.client, category, path, { list, courseId, file });
      if (observation.status === 429) throw new AccessError('retry_wait', 'Brightspace rate limit reached; the pass stopped before further reads.', { status: 429, retryAfter: observation.retryAfter });
      if (version) observation.version = version;
      observations.push(observation);
      return observation;
    };
    observations.push({ key: 'enrollments', category: 'enrollments', ...enrollments,
      outcome: enrollments.complete ? 'available' : 'partial', retrievedAt: new Date().toISOString() });
    const courseId = selectCourse(enrollments, course);
    let syllabus;
    let quizDiscovery;
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
      const quizList = await read('quizzes', `${le}/quizzes/`, { list: true });
      const grades = await read('grades', `${le}/grades/values/myGradeValues/`, { list: true });
      await read('announcements', `${le}/news/`, { list: true });
      const forums = await read('discussion_forums', `${le}/discussions/forums/`, { list: true });
      const groups = await read('groups', `${lp}/groups/`, { list: true });
      await read('sections', `${lp}/sections/mysections/`, { list: true });
      const calendar = new URL(`${le}/calendar/events/myEvents/`, this.client.origin);
      calendar.searchParams.set('startDateTime', new Date(from).toISOString());
      calendar.searchParams.set('endDateTime', new Date(to).toISOString());
      const [major, minor] = versions.le.split('.').map(Number);
      const events = await read('calendar', `${calendar.pathname}${calendar.search}`, { list: true });
      const recurring = (events.data || []).filter(event => event.IsRecurring === true);
      for (const event of window('recurring_events', recurring)) {
        await read('calendar_occurrences', `${le}/calendar/event/${id(event.CalendarEventId)}/occurrences`);
      }
      const reconciled = reconcileQuizzes(quizList.data, content.data, grades.data, this.client.origin);
      const toolNames = new Map();
      for (const candidate of window('quiz_grade_associations', reconciled.candidates.filter(item => item.source === 'gradebook'))) {
        const definition = await read('quiz_grade_association', `${le}/grades/${id(candidate.gradeItemId)}`);
        const association = definition.data?.AssociatedTool;
        if (!association || !/^\d+$/.test(String(association.ToolId)) || !/^\d+$/.test(String(association.ToolItemId))) continue;
        const toolId = String(association.ToolId);
        if (!toolNames.has(toolId)) {
          const tool = await read('quiz_tool', `/d2l/api/lp/${versions.lp}/tools/orgUnits/${courseId}/${toolId}?namesOnly=true`);
          toolNames.set(toolId, tool.data?.DisplayName || '');
        }
        if (!/quiz/i.test(toolNames.get(toolId))) continue;
        const quizId = String(association.ToolItemId);
        if (!reconciled.quizzes.some(quiz => quiz.quizId === quizId)) reconciled.quizzes.push({ quizId, name: candidate.name,
          gradeItemId: candidate.gradeItemId, sources: ['grade_association'], restricted: false });
        reconciled.candidates = reconciled.candidates.filter(item => item !== candidate);
      }
      const quizSourcesComplete = quizList.complete === true && content.complete === true && grades.complete === true;
      quizDiscovery = { confirmedReferences: reconciled.quizzes.length, unresolvedCandidates: reconciled.candidates.length, sourcesComplete: quizSourcesComplete };
      observations.push({ key: `${le}/quiz_inventory`, category: 'quiz_inventory', course: courseId, source: `${le}/content/toc`,
        retrievedAt: new Date().toISOString(), outcome: quizSourcesComplete && !reconciled.candidates.length ? 'available' : 'partial', complete: quizSourcesComplete && !reconciled.candidates.length,
        data: { ...reconciled, listCoverage: quizList.outcome, candidatesAreNotConfirmedQuizzes: true } });
      for (const quiz of window('quiz_details', reconciled.quizzes.filter(item => !item.restricted))) {
        const path = `${le}/quizzes/${id(quiz.quizId)}`;
        await read('quiz_details', path);
        await read('own_quiz_attempts', `${path}/attempts/?userId=${id(identity.Identifier)}`, { list: true });
      }
      const prioritized = [...new Set([...assignmentSamples(assignments.data ?? [], grades.data), ...(assignments.data || [])])];
      for (const folder of window('assignments', prioritized)) {
        const assignmentFiles = [];
        const folderPath = `${le}/dropbox/folders/${id(folder.Id)}`;
        const detail = await read('assignment_detail', folderPath);
        const submissions = await read('own_submissions', `${folderPath}/submissions/mysubmissions/`, { list: true });
        const entity = feedbackEntity(folder, identity, submissions.data, groups.data);
        if (entity) {
          const feedbackPath = `${folderPath}/feedback/${entity.type}/${entity.entityId}`;
          const feedback = await read('own_feedback', feedbackPath);
          for (const file of feedback.data?.Attachments || []) if (file.FileId != null) assignmentFiles.push({ category: 'feedback_file', path: `${feedbackPath}/attachments/${id(file.FileId)}` });
        }
        else observations.push({ key: `${folderPath}/feedback/`, course: courseId, category: 'own_feedback',
          source: folderPath, retrievedAt: new Date().toISOString(), outcome: 'unknown', complete: false,
          error: 'unresolved_group', message: 'Own group could not be identified unambiguously; no user or group feedback request was guessed.' });
        const embedded = detail.data?.Assessment?.Rubrics?.length ? detail.data.Assessment.Rubrics : folder.Assessment?.Rubrics;
        if (embedded?.length) observations.push({ key: `${folderPath}/assessment/rubrics`, course: courseId, category: 'rubrics',
          source: detail.data?.Assessment?.Rubrics?.length ? folderPath : `${le}/dropbox/folders/`,
          field: 'Assessment.Rubrics', retrievedAt: new Date().toISOString(), outcome: 'available', complete: true, data: embedded });
        else if (major > 1 || minor >= 93) {
          const rubrics = await read('rubrics', `${le}/rubrics/?objectType=Dropbox&objectId=${id(folder.Id)}`, { list: true });
          // Distinct assignment associations share a route but must not share a cache key.
          rubrics.key = rubrics.source;
        }
        for (const attachment of detail.data?.Attachments ?? folder.Attachments ?? []) {
          if (attachment.FileId != null) assignmentFiles.push({ category: 'assignment_file', path: `${folderPath}/attachments/${id(attachment.FileId)}` });
        }
        for (const own of submissions.data || []) for (const submission of own.Submissions || []) for (const file of submission.Files || []) {
          if (submission.Id != null && file.FileId != null) assignmentFiles.push({ category: 'own_submission_file', path: `${folderPath}/submissions/${id(submission.Id)}/files/${id(file.FileId)}` });
        }
        for (const file of window('assignment_files', assignmentFiles, 2, id(folder.Id))) await read(file.category, file.path, { file: true });
      }
      for (const forum of window('discussion_forums', forums.data || [], 5)) {
        if (forum.IsHidden) continue;
        const forumPath = `${le}/discussions/forums/${id(forum.ForumId)}`;
        const topics = await read('discussion_topics', `${forumPath}/topics/`, { list: true });
        for (const topic of window('discussion_posts', (topics.data || []).filter(item => !item.IsHidden), 5, id(forum.ForumId))) {
          const topicPath = `${forumPath}/topics/${id(topic.TopicId)}`;
          const posts = await read('discussion_posts', `${topicPath}/posts/`, { list: true });
          const discussionFiles = [];
          for (const post of posts.data || []) for (const attachment of post.Attachments || []) {
            if (post.PostId != null && attachment.FileId != null) discussionFiles.push(`${topicPath}/posts/${id(post.PostId)}/attachments/${id(attachment.FileId)}`);
          }
          for (const path of window('discussion_files', discussionFiles, 2, id(topic.TopicId))) await read('discussion_file', path, { file: true });
        }
      }
      const allNodes = courseNodes(content.data);
      const files = allNodes.filter(topic => topic.TopicId != null && topic.ActivityType === 1);
      for (const topic of files.filter(item => item.restricted)) observations.push({ key: `${le}/content/topics/${id(topic.TopicId)}/file`,
        category: 'content_file', course: courseId, outcome: 'denied', complete: false, error: 'restricted',
        source: `${le}/content/toc`, retrievedAt: new Date().toISOString(), message: 'Topic or ancestor is outside its release conditions.' });
      for (const topic of window('content_files', files.filter(item => !item.restricted), 20)) {
        const path = `${le}/content/topics/${id(topic.TopicId)}/file`;
        const existing = observations.find(item => item.category === 'syllabus_source' && item.source === path && item.outcome === 'available');
        if (existing) observations.push({ ...existing, key: path, category: 'content_file' });
        else await read('content_file', path, { file: true, version: topic.LastModifiedDate });
      }
      const targets = new Set();
      for (const topic of allNodes.filter(item => !item.restricted)) {
        if (topic.Url && topic.ActivityType !== 1) targets.add(topic.Url);
        for (const link of descriptionContent(topic.Description).links) targets.add(link.url);
      }
      for (const target of window('linked_content', [...targets], 20)) {
        if (actionLink(target, this.client.origin)) continue;
        let url;
        try { url = new URL(target, this.client.origin); } catch { continue; }
        const record = { key: `linked:${courseId}:${url.href}`, category: youtubeId(url.href) ? 'video_transcript' : 'linked_content',
          course: courseId, source: url.href, retrievedAt: new Date().toISOString(), outcome: 'available', complete: true };
        try {
          record.data = youtubeId(url.href) ? await youtubeTranscript(this.client, url.href) : await readLinkedDocument(this.client, url.href, { le, courseId, tree: content.data });
          if (record.data.textStatus && record.data.textStatus !== 'available' && record.data.textStatus !== 'empty') { record.complete = false; record.outcome = 'partial'; }
        } catch (error) {
          if (!(error instanceof AccessError) || error.code === 'needs_login') throw error;
          if (error.status === 429) throw error;
          Object.assign(record, { outcome: error.code === 'denied' || error.code === 'restricted' ? 'denied' : 'failed', complete: false, error: error.code, message: error.message, status: error.status, retryAfter: error.retryAfter });
        }
        observations.push(record);
      }
    }
    const summary = {
      finishedAt: new Date().toISOString(), scope: 'one selected accessible course; resumable bounded traversal',
      versions, courseCount: enrollments.data.length, enrollmentCoverageComplete: enrollments.complete,
      selectedCourse: courseId ? 'course-1' : null, calendarWindow: { from, to }, syllabus, quizDiscovery,
      traversal, complete: Boolean(courseId) && observations.every(item => item.complete) && Object.values(traversal).every(item => !item.limited),
      retryAfter: Math.max(0, ...observations.filter(item => item.error === 'retry_wait').map(item => item.retryAfter || 60_000)),
      resources: observations.map(item => ({ category: item.category, outcome: item.outcome,
        complete: item.complete, pages: item.pages, count: Array.isArray(item.data) ? item.data.length : undefined,
        fieldNames: fields(item.data), error: item.error, message: item.message })),
      notChecked: ['private external-provider authorization', 'every object compared against the onQ browser', 'natural session-expiry soak test'],
    };
    this.store.commit(identity, this.client.origin, observations, summary, enrollments);
    for (const [key, value] of checkpoints) this.store.meta(key, value);
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
  options = { ...options, course: options?.all ? undefined : options?.course ?? connector.store.getMeta('selected_course') ?? undefined };
  while (!signal?.aborted) {
    let delay = 15 * 60_000;
    connector.store.meta('state', { state: 'syncing', updatedAt: new Date().toISOString() });
    try {
      const summary = await connector.audit(options);
      if (!options.all) options.course ??= connector.selectedCourse ?? undefined;
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
