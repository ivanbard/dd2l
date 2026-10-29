import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { BrightspaceClient } from './client.mjs';
import { Session, login, atomicWrite } from './session.mjs';
import { Store, lock } from './store.mjs';
import { Connector, sync } from './connector.mjs';

const help = `dd2l — direct, read-only Queen's onQ connector (Windows, Node 24+)

npm run login                       Open Edge for school sign-in and MFA
npm start -- courses                List your course IDs and names
npm run audit -- [--course ID]       Audit one course (defaults to an accessible active course)
npm run sync -- [--course ID]        Repeat that audit every 15 minutes until Ctrl+C
npm run status                      Show coverage and last successful reads
npm start -- logout                 Delete dd2l's session and local inventory

audit/sync: --from ISO --to ISO      Calendar window (default: past 30 / next 120 days)

Data: %LOCALAPPDATA%\\dd2l (session protected for this Windows user; inventory is private local data).
No MCP server, school password storage, or external model calls.`;

async function main() {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: {
    course: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, help: { type: 'boolean', short: 'h' },
  } });
  const command = positionals[0];
  if (values.help || !command) { console.log(help); return; }
  if (positionals.length > 1 || !['login', 'courses', 'audit', 'sync', 'status', 'logout'].includes(command)) throw new Error('Unknown command. Run npm start -- --help.');
  if (!['audit', 'sync'].includes(command) && Object.keys(values).length) throw new Error('Date/course options apply only to audit and sync.');
  if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) throw new Error('This first connector requires Windows with LOCALAPPDATA.');
  const directory = join(process.env.LOCALAPPDATA, 'dd2l');
  await mkdir(directory, { recursive: true });
  // Status is read-only and can inspect a running worker without taking its lock.
  const release = command === 'status' ? async () => {} : await lock(directory);
  let store;
  try {
    store = new Store(directory);
    const session = new Session(directory);
    const client = new BrightspaceClient(session);
    const connector = new Connector(client, store);
    if (command === 'login') {
      await login(session, client, { expectedAccount: store.getMeta('account') });
      store.meta('state', { state: 'ready', updatedAt: new Date().toISOString() });
    } else if (command === 'courses') {
      const { enrollments } = await connector.courses();
      console.log(JSON.stringify({ complete: enrollments.complete, courses: enrollments.data.map(item => ({
        id: item.OrgUnit?.Id, name: item.OrgUnit?.Name, active: item.Access?.IsActive, canAccess: item.Access?.CanAccess,
      })) }, null, 2));
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
    throw error;
  } finally { store?.close(); await release(); }
}

main().catch(error => { console.error(`${error.code || 'error'}: ${error.message}`); process.exitCode = 1; });
