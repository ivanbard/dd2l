import { parseArgs } from 'node:util';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Session, atomicWrite } from '../src/session.mjs';
import { BrightspaceClient } from '../src/client.mjs';
import { Store, lock } from '../src/store.mjs';
import { Connector, sync } from '../src/connector.mjs';

const { values } = parseArgs({ options: { minutes: { type: 'string', default: '60' } } });
const minutes = Number(values.minutes);
if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) throw new Error('--minutes must be between 1 and 1440.');
const directory = join(process.env.LOCALAPPDATA, 'dd2l');
const output = resolve('.dd2l/soak-summary.json');
await mkdir(resolve('.dd2l'), { recursive: true });
const release = await lock(directory);
let store;
const controller = new AbortController();
const stop = () => controller.abort();
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
const timer = setTimeout(stop, minutes * 60_000);
const report = { startedAt: new Date().toISOString(), requestedMinutes: minutes, cycles: [],
  note: 'Production 15-minute cadence; a current bounded audit finishes before shutdown. This does not force or bypass school session expiry.' };
try {
  store = new Store(directory);
  const connector = new Connector(new BrightspaceClient(new Session(directory)), store);
  await sync(connector, {}, { signal: controller.signal, onUpdate: async result => {
    report.cycles.push({ at: new Date().toISOString(), state: result.state, complete: result.complete, resourceCount: result.resources?.length,
      limitedPhases: Object.entries(result.traversal || {}).filter(([, value]) => value.limited).map(([name]) => name), message: result.message });
    await atomicWrite(output, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report.cycles.at(-1)));
  } });
} catch (error) {
  report.error = { code: error.code, message: error.message };
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
  process.off('SIGINT', stop); process.off('SIGTERM', stop);
  report.finishedAt = new Date().toISOString();
  report.finalState = store?.getMeta('state');
  try { await atomicWrite(output, JSON.stringify(report, null, 2)); }
  finally { store?.close(); await release(); }
  console.log(JSON.stringify({ finished: true, cycleCount: report.cycles.length, error: report.error?.code }));
}
