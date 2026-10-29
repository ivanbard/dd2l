import { DatabaseSync } from 'node:sqlite';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { AccessError, BrightspaceClient } from '../src/client.mjs';
import { Session } from '../src/session.mjs';
import { Connector } from '../src/connector.mjs';
import { lock, withoutCredentials } from '../src/store.mjs';
import { findSyllabusSources } from '../src/syllabus.mjs';
export { findSyllabusSources } from '../src/syllabus.mjs';

async function readCandidate(client, path, output) {
  const response = await client.response(path);
  const chunks = [];
  const reader = response.body.getReader();
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2 * 1024 * 1024) throw new AccessError('partial', 'Candidate exceeds the 2 MiB investigation limit.');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const bytes = Buffer.concat(chunks);
  const contentType = response.headers.get('content-type') || 'application/octet-stream';
  if (/text\/html/i.test(contentType) && bytes.toString().includes('/d2l/login?sessionExpired=1')) throw new AccessError('needs_login', 'School session has expired.');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const extension = bytes.subarray(0, 5).toString() === '%PDF-' ? 'pdf' : /text\/html/i.test(contentType) ? 'html' : 'bin';
  const file = `${sha256}.${extension}`;
  await writeFile(join(output, file), bytes, { mode: 0o600 });
  return { outcome: 'readable', contentType, size, sha256, file };
}

async function observe(action) {
  try { return { outcome: 'available', data: await action() }; }
  catch (error) {
    if (!(error instanceof AccessError) || error.code === 'needs_login') throw error;
    return { outcome: error.code, status: error.status, message: error.message };
  }
}

async function main() {
  const directory = join(process.env.LOCALAPPDATA, 'dd2l');
  const output = resolve('.dd2l', 'syllabus-investigation');
  await mkdir(output, { recursive: true });
  const release = await lock(directory);
  let db;
  try {
    db = new DatabaseSync(join(directory, 'inventory.sqlite'), { readOnly: true });
    const store = { getMeta: key => {
      const row = db.prepare('SELECT value FROM meta WHERE key=?').get(key);
      return row ? JSON.parse(row.value) : null;
    } };
    const client = new BrightspaceClient(new Session(directory));
    const { versions, enrollments } = await new Connector(client, store).courses();
    if (!enrollments.complete) throw new Error('Enrollment coverage is incomplete; cannot select a reliable sample.');
    const candidates = enrollments.data.filter(item => item.Access?.CanAccess === true && item.Access?.IsActive === true)
      .sort((a, b) => (Date.parse(b.Access.LastAccessed) || 0) - (Date.parse(a.Access.LastAccessed) || 0));
    const originalId = store.getMeta('selected_course');
    const original = candidates.find(item => String(item.OrgUnit.Id) === originalId);
    const sample = [...(original ? [original] : []), ...candidates.filter(item => item !== original)].slice(0, 6);
    const report = { at: new Date().toISOString(), versions, enrollmentCount: enrollments.data.length,
      selection: 'original audit course, then recently accessed courses marked active and accessible; maximum six', courses: [] };
    for (const [index, course] of sample.entries()) {
      const courseId = String(course.OrgUnit.Id);
      if (!/^\d+$/.test(courseId)) throw new Error('Invalid course ID.');
      const le = `/d2l/api/le/${versions.le}/${courseId}`;
      const overview = await observe(() => client.get(`${le}/overview`));
      const content = await observe(() => client.get(`${le}/content/toc`));
      const sources = content.data ? findSyllabusSources(content.data) : [];
      const result = { alias: `course-${index + 1}`, originalAuditCourse: courseId === originalId,
        courseId, courseName: course.OrgUnit.Name, overview, contentOutcome: content.outcome, sources };
      // Bound document reads; all matching metadata remains available in the private report.
      for (const source of sources.filter(source => source.kind === 'content_file' && !source.unavailable).slice(0, 3)) {
        if (!/^\d+$/.test(String(source.topicId))) continue;
        source.read = await observe(() => readCandidate(client, `${le}/content/topics/${source.topicId}/file`, output));
      }
      if (overview.data) result.overviewAttachment = await observe(() => readCandidate(client, `${le}/overview/attachment`, output));
      report.courses.push(result);
      await writeFile(join(output, 'private-report.json'), JSON.stringify(withoutCredentials(report), null, 2), { mode: 0o600 });
      console.log(JSON.stringify({ alias: result.alias, originalAuditCourse: result.originalAuditCourse,
        overview: overview.status ?? overview.outcome, content: content.outcome,
        candidates: sources.map(source => ({ kind: source.kind, unavailable: source.unavailable,
          descriptionCharacters: source.description.length, matchedBy: source.matchedBy,
          read: source.read?.data ? { outcome: source.read.data.outcome, contentType: source.read.data.contentType, bytes: source.read.data.size } : source.read })) }));
    }
    console.log('Private evidence saved under .dd2l/syllabus-investigation/ (ignored by Git).');
  } finally { db?.close(); await release(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(`${error.code || 'error'}: ${error.message}`); process.exitCode = 1; });
}
