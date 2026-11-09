import { execFile } from 'node:child_process';
import { createUiServer } from './ui-server.mjs';
import { sync } from './connector.mjs';
import { log as terminalLog, spinner } from '@clack/prompts';

function openBrowser(url) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `Start-Process -FilePath '${url}' -WindowStyle Hidden`], { windowsHide: true, timeout: 15_000 },
    error => error ? reject(error) : resolve());
  });
}

export async function runApp(connector, { onUpdate, server,
  open = openBrowser, signals = process, port = 4173, log = terminalLog.info } = {}) {
  const controller = new AbortController();
  server ??= createUiServer({ connector, shutdownSignal: controller.signal });
  const progress = process.stdout.isTTY ? spinner({ signal: controller.signal }) : null;
  let firstPass = true;
  const stop = () => controller.abort();
  signals.on('SIGINT', stop);
  signals.on('SIGTERM', stop);
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolve);
    });
    const url = `http://127.0.0.1:${server.address().port}`;
    log(`Your workspace → ${url}\nKeep this terminal open; Ctrl+C stops the app and sync.`);
    try { await open(url); }
    catch { log(`Could not open your browser. Open ${url} manually.`); }
    log('Collecting up to 5 courses per pass, every 15 minutes.\nThe app may be empty until the first batch is ready.');
    progress?.start('Collecting your first batch of coursework');
    await sync(connector, { all: true }, { signal: controller.signal, onUpdate: async summary => {
      await onUpdate?.(summary);
      const message = summary.state === 'retry_wait'
        ? 'Collection delayed · will retry automatically'
        : 'Coursework saved · reopen Courses or search to see updates';
      if (progress && firstPass) {
        if (summary.state === 'retry_wait') { progress.clear(); terminalLog.warn(message); }
        else progress.stop(message);
      }
      else log(message);
      if (firstPass && summary.state !== 'retry_wait') {
        log('Local search is ready. Connect ChatGPT in Settings for AI answers.');
      }
      firstPass = false;
    } });
  } catch (error) {
    progress?.error('Collection stopped');
    throw error;
  } finally {
    progress?.clear();
    signals.off('SIGINT', stop);
    signals.off('SIGTERM', stop);
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  }
}
