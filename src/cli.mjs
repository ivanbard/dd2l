import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { select, text, isCancel, cancel, log, outro } from '@clack/prompts';
import { BrightspaceClient, SCHOOL, schoolOrigin } from './client.mjs';
import { Session, login, atomicWrite } from './session.mjs';
import { Store, lock } from './store.mjs';
import { Connector, sync } from './connector.mjs';
import { runApp } from './app-runner.mjs';
import { renderBanner } from './cli-banner.mjs';

const help = `dd2l — direct, read-only Brightspace connector (Windows, Node 24+)

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

Without a global install: npx @ivanbard/dd2l <command>.
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
  let selectedOrigin;
  if (['setup', 'start'].includes(command)) console.log(`\n${renderBanner(process.stdout.columns)}\n`);
  if (command === 'setup') {
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Run dd2l setup in an interactive terminal.');
    log.info('Read-only access. Coursework is stored unencrypted on this PC.');
    const school = await select({ message: 'Select your school', options: [
      { value: SCHOOL, label: 'Queen\'s University', hint: 'onQ · connect and collect coursework' },
      { value: 'not-listed', label: 'My school isn\'t listed', hint: 'enter a Brightspace URL' },
    ] });
    if (isCancel(school)) { cancel('Setup cancelled. No school connection was made.'); return; }
    if (school === 'not-listed') {
      const url = await text({ message: 'Your school\'s Brightspace URL', placeholder: 'your-school.brightspace.com',
        validate: value => { try { schoolOrigin(value); } catch (error) { return error.message; } },
      });
      if (isCancel(url)) { cancel('Setup cancelled. No school connection was made.'); return; }
      selectedOrigin = schoolOrigin(url);
      log.info('Custom school · compatibility has not been verified.');
      log.info('Help add your school: open an issue with its name and URL.\nhttps://github.com/ivanbard/dd2l/issues/new');
    } else selectedOrigin = school;
  }
  await mkdir(directory, { recursive: true });
  // Status is read-only and can inspect a running worker without taking its lock.
  const release = command === 'status' ? async () => {} : await lock(directory);
  let store;
  try {
    store = new Store(directory);
    const origin = ['status', 'logout'].includes(command) ? SCHOOL : schoolOrigin(selectedOrigin ?? store.getMeta('school_origin') ?? SCHOOL);
    const session = new Session(directory, { origin });
    const client = new BrightspaceClient(session, { origin });
    const connector = new Connector(client, store);
    if (command === 'login' || command === 'setup') {
      if (command === 'setup') {
        log.step(`Sign in to ${origin === SCHOOL ? 'Queen\'s onQ' : new URL(origin).hostname}`);
        log.info('Complete sign-in and MFA in Chrome. Your password is never saved.\nSession credentials are encrypted for your Windows account.');
      }
      await login(session, client, { expectedAccount: store.getMeta('account'),
        ...(command === 'setup' ? { onProgress: () => {} } : {}) });
      store.meta('school_origin', origin);
      if (command === 'setup') log.success('School connected · identity verified');
      store.meta('state', { state: 'ready', updatedAt: new Date().toISOString() });
    }
    if (command === 'start' || command === 'setup') {
      if (command === 'setup') log.info(`Coursework and grades will be cached in:\n${directory}`);
      await runApp(connector, { onUpdate: async summary => {
        await atomicWrite(join(directory, 'summary.json'), JSON.stringify(summary, null, 2));
      } });
      outro('dd2l stopped. Your cached coursework is saved.');
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

main().catch(error => {
  const message = `${error.code || 'error'}: ${error.message}`;
  if (['setup', 'start'].includes(process.argv[2]) && process.stdout.isTTY) log.error(message);
  else console.error(message);
  process.exitCode = 1;
});
