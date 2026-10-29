import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { BrightspaceClient } from '../src/client.mjs';
import { Session } from '../src/session.mjs';
import { Store, lock } from '../src/store.mjs';
import { Connector } from '../src/connector.mjs';

const output = resolve('.dd2l/coverage-retest');
const baseline = JSON.parse(await readFile(resolve('.dd2l/syllabus-investigation/private-report.json'), 'utf8'));
if (baseline.courses?.length < 6) throw new Error('The frozen six-course investigation sample is required.');
const directory = join(process.env.LOCALAPPDATA, 'dd2l');
const release = await lock(directory);
let store;
let selected;
try {
  store = new Store(directory);
  selected = store.getMeta('selected_course');
  const connector = new Connector(new BrightspaceClient(new Session(directory)), store);
  await mkdir(output, { recursive: true });
  const report = { at: new Date().toISOString(), scope: 'three frozen sample courses, with two consecutive passes of the original course', runs: [] };
  for (const index of [0, 0, 2, 5]) {
    const course = baseline.courses[index];
    const summary = await connector.audit({ course: String(course.courseId) });
    const outcomes = {};
    for (const item of summary.resources) {
      const category = outcomes[item.category] ??= {};
      category[item.outcome] = (category[item.outcome] || 0) + 1;
    }
    const inventory = store.db.prepare("SELECT data,observation FROM resources WHERE category='quiz_inventory' AND course=?").get(String(course.courseId));
    const quizzes = inventory ? JSON.parse(inventory.observation).data ?? (inventory.data ? JSON.parse(inventory.data) : null) : null;
    const run = { alias: course.alias, finishedAt: summary.finishedAt, complete: summary.complete, traversal: summary.traversal,
      syllabus: summary.syllabus, outcomes, confirmedQuizReferences: quizzes?.quizzes.length, unresolvedQuizCandidates: quizzes?.candidates.length,
      assignmentDetailsInCache: store.db.prepare("SELECT count(*) AS count FROM resources WHERE category='assignment_detail' AND course=? AND data IS NOT NULL").get(String(course.courseId)).count,
      fileFormats: store.db.prepare("SELECT json_extract(data,'$.format') AS format,count(*) AS count FROM resources WHERE course=? AND category IN ('content_file','assignment_file') AND data IS NOT NULL GROUP BY format").all(String(course.courseId)) };
    report.runs.push(run);
    await writeFile(join(output, 'summary.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(run));
  }
} finally {
  if (store) { store.meta('selected_course', selected); store.close(); }
  await release();
}
