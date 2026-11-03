import { execFile } from 'node:child_process';
import { createUiServer } from './ui-server.mjs';
import { sync } from './connector.mjs';

function openBrowser(url) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `Start-Process -FilePath '${url}' -WindowStyle Hidden`], { windowsHide: true, timeout: 15_000 },
    error => error ? reject(error) : resolve());
  });
}

export async function runApp(connector, { onUpdate, server = createUiServer(),
  open = openBrowser, signals = process, port = 4173, log = console.log } = {}) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  signals.on('SIGINT', stop);
  signals.on('SIGTERM', stop);
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolve);
    });
    const url = `http://127.0.0.1:${server.address().port}`;
    log(`dd2l: ${url}\nKeep this terminal open. Ctrl+C stops the app and sync.`);
    log('Collecting coursework now; the first view may be empty. Collection is incremental, up to five courses per pass, every 15 minutes.');
    try { await open(url); }
    catch { log(`Could not open your browser. Open ${url} manually.`); }
    await sync(connector, { all: true }, { signal: controller.signal, onUpdate });
  } finally {
    signals.off('SIGINT', stop);
    signals.off('SIGTERM', stop);
    await new Promise(resolve => server.close(resolve));
  }
}
