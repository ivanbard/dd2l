import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { BrightspaceClient } from '../src/client.mjs';
import { Session } from '../src/session.mjs';
import { Store, lock } from '../src/store.mjs';
import { Connector } from '../src/connector.mjs';
import { descriptionContent } from '../src/documents.mjs';

// Keep the original sample fixed; a changing denominator would obscure regressions.
const baselinePath = resolve('.dd2l/syllabus-investigation/private-report.json');
const output = resolve('.dd2l/syllabus-retest');
let store;
let release;
try {
  const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
  let priorChecks;
  try { priorChecks = JSON.parse(await readFile(resolve('.dd2l/syllabus-investigation/text-checks.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!baseline.courses?.length) throw new Error('Original investigation sample is missing. Run investigate-syllabus first.');
  const directory = join(process.env.LOCALAPPDATA, 'dd2l');
  release = await lock(directory);
  store = new Store(directory);
  const connector = new Connector(new BrightspaceClient(new Session(directory)), store);
  await mkdir(output, { recursive: true });
  const result = { at: new Date().toISOString(), baselineAt: baseline.at, metric: 'at least one retrieved source with non-empty extracted text; not syllabus completeness or authority',
    sampleSize: baseline.courses.length,
    baselineReadableCourses: priorChecks ? new Set(priorChecks.filter(check => check.characters > 0 && baseline.courses.some(course => course.alias === check.course)).map(check => check.course)).size : null,
    baselineReadableOverviews: baseline.courses.filter(course => descriptionContent(course.overview?.data?.Description).text).length,
    courses: [] };
  for (const course of baseline.courses) {
    const summary = await connector.syllabus({ course: course.courseId });
    const entry = { alias: course.alias, baselineOverview: course.overview.outcome, ...summary };
    result.courses.push(entry);
    await writeFile(join(output, 'summary.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(entry));
  }
  result.readableCourses = result.courses.filter(course => course.readableSourceCount > 0).length;
  result.explicitSourceCourses = result.courses.filter(course => course.explicitSourceCount > 0).length;
  result.unresolvedCourses = result.sampleSize - result.readableCourses;
  result.readableRate = result.readableCourses / result.sampleSize;
  await writeFile(join(output, 'summary.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ sampleSize: result.sampleSize, baselineReadableOverviews: result.baselineReadableOverviews,
    baselineReadableCourses: result.baselineReadableCourses,
    readableCourses: result.readableCourses, explicitSourceCourses: result.explicitSourceCourses, unresolvedCourses: result.unresolvedCourses, readableRate: result.readableRate }));
} catch (error) { console.error(`${error.code || 'error'}: ${error.message}`); process.exitCode = 1; }
finally { store?.close(); await release?.(); }
