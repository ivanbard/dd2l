import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { BrightspaceClient } from './client.mjs';
import { Session, login, atomicWrite } from './session.mjs';
import { Store, lock } from './store.mjs';
import { Connector, sync } from './connector.mjs';
import { runApp } from './app-runner.mjs';

const help = `dd2l — direct, read-only Queen's onQ connector (Windows, Node 24+)

dd2l setup                          Guided school sign-in, then open the app and sync
dd2l start                          Open the app and sync with your saved school session
dd2l login                          Open Chrome for school sign-in and MFA
dd2l courses                        List your course IDs and names
dd2l audit [--course ID]             Audit one course (defaults to an accessible active course)
dd2l audit --all                    Advance the all-course pass (five courses per run)
dd2l syllabus [--course ID]          Retrieve syllabus/course-information sources and text
dd2l sync [--course ID]              Repeat that audit every 15 minutes until Ctrl+C
dd2l sync --all                     Rotate through all accessible courses in bounded passes
dd2l status                         Show coverage and last successful reads
dd2l logout                         Delete dd2l's session and local inventory

Without a global install: npx dd2l <command>.
From source: npm start -- <command>, or npm run setup.

audit/sync: --from ISO --to ISO      Calendar window (default: past 30 / next 120 days)
syllabus: --course ID               Choose the course without changing the sync selection

Data: %LOCALAPPDATA%\\dd2l (session protected for this Windows user; inventory is private local data).
ChatGPT is optional in the UI; connector commands make no external model calls.`;

async function main() {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: {
    course: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, all: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
  } });
  const command = positionals[0];
  if (values.help || !command) { console.log(help); return; }
  if (positionals.length > 1 || !['setup', 'start', 'login', 'courses', 'audit', 'syllabus', 'sync', 'status', 'logout'].includes(command)) throw new Error('Unknown command. Run dd2l --help.');
  if (!['audit', 'sync', 'syllabus'].includes(command) && Object.keys(values).length) throw new Error('Date/course options apply only to audit, syllabus and sync.');
  if (command === 'syllabus' && (values.from || values.to)) throw new Error('Calendar date options apply only to audit and sync.');
  if (values.all && (!['audit', 'sync'].includes(command) || values.course)) throw new Error('--all applies to audit/sync and cannot be combined with --course.');
  if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) throw new Error('This first connector requires Windows with LOCALAPPDATA.');
  const directory = join(process.env.LOCALAPPDATA, 'dd2l');
  if (command === 'setup') {
    console.log(`Welcome to dd2l. Requires Google Chrome and a Queen's onQ account.
School sign-in and MFA happen in a separate Chrome window; no school password is saved.
Session credentials are encrypted for your Windows account. Coursework and grades
are cached unencrypted in ${directory}. The connector is read-only.
ChatGPT is optional: connect it later in Settings. Local search stays on this computer.`);
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Run dd2l setup in an interactive terminal.');
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const answer = await prompt.question('Connect onQ and start collecting coursework? [y/N] ');
      if (!/^y(?:es)?$/i.test(answer.trim())) { console.log('Setup cancelled. No school connection was made.'); return; }
    } finally { prompt.close(); }
  }
  await mkdir(directory, { recursive: true });
  // Status is read-only and can inspect a running worker without taking its lock.
  const release = command === 'status' ? async () => {} : await lock(directory);
  let store;
  try {
    store = new Store(directory);
    const session = new Session(directory);
    const client = new BrightspaceClient(session);
    const connector = new Connector(client, store);
    if (command === 'login' || command === 'setup') {
      await login(session, client, { expectedAccount: store.getMeta('account') });
      store.meta('state', { state: 'ready', updatedAt: new Date().toISOString() });
    }
    if (command === 'start' || command === 'setup') {
      await runApp(connector, { onUpdate: async summary => {
        await atomicWrite(join(directory, 'summary.json'), JSON.stringify(summary, null, 2));
        console.log(summary.state === 'retry_wait' ? 'Collection delayed; will retry automatically.' : 'Coursework pass saved. Reopen Courses or search to see updates.');
      } });
    } else if (command === 'courses') {
      const { enrollments } = await connector.courses();
      console.log(JSON.stringify({ complete: enrollments.complete, courses: enrollments.data.map(item => ({
        id: item.OrgUnit?.Id, name: item.OrgUnit?.Name, active: item.Access?.IsActive, canAccess: item.Access?.CanAccess,
      })) }, null, 2));
    } else if (command === 'syllabus') {
      const summary = await connector.syllabus(values);
      await atomicWrite(join(directory, 'syllabus-summary.json'), JSON.stringify(summary, null, 2));
      console.log(JSON.stringify(summary, null, 2));
    } else if (command === 'audit' || command === 'sync') {
      const report = async summary => {
        await atomicWrite(join(directory, 'summary.json'), JSON.stringify(summary, null, 2));
        console.log(JSON.stringify(summary, null, 2));
      };
      if (command === 'audit') await report(await connector.audit(values));
      else {
        const controller = new AbortController();
        const stop = () => controller.abort();
        process.on('SIGINT', stop);
        process.on('SIGTERM', stop);
        try { await sync(connector, values, { signal: controller.signal, onUpdate: report }); }
        finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
      }
    } else if (command === 'status') console.log(JSON.stringify(store.status(), null, 2));
    else if (command === 'logout') {
      await rm(session.path, { force: true });
      await rm(join(directory, 'summary.json'), { force: true });
      await rm(join(directory, 'syllabus-summary.json'), { force: true });
      store.clear();
      store.close();
      store = null;
      for (const name of ['inventory.sqlite', 'inventory.sqlite-wal', 'inventory.sqlite-shm']) {
        await rm(join(directory, name), { force: true });
      }
      console.log('dd2l session and inventory removed. School sign-in on other apps is unchanged.');
    }
  } catch (error) {
    if (store && error.code === 'needs_login') store.meta('state', { state: 'needs_login', updatedAt: new Date().toISOString() });
    if (error.code === 'needs_login' && ['start', 'setup'].includes(command)) error.message += ' Run dd2l setup to sign in and restart.';
    throw error;
  } finally { store?.close(); await release(); }
}

main().catch(error => { console.error(`${error.code || 'error'}: ${error.message}`); process.exitCode = 1; });
