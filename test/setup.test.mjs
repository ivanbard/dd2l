import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runApp } from '../src/app-runner.mjs';

test('combined app opens a loopback UI, syncs all courses and shuts down cleanly', async () => {
  const server = createServer((req, res) => res.end('ready'));
  const signals = new EventEmitter();
  const events = [];
  const connector = {
    store: { meta() {} },
    async audit(options) { assert.deepEqual(options, { all: true, course: undefined }); events.push('audit'); return { retryAfter: 0 }; },
  };
  await runApp(connector, { server, signals, port: 0, log() {},
    open: async url => {
      assert.match(url, /^http:\/\/127\.0\.0\.1:\d+$/);
      assert.equal(await (await fetch(url)).text(), 'ready');
      events.push('open');
    },
    onUpdate: summary => { assert.equal(summary.state, 'ready'); events.push('saved'); signals.emit('SIGINT'); },
  });
  assert.deepEqual(events, ['open', 'audit', 'saved']);
  assert.equal(server.listening, false);
  assert.equal(signals.listenerCount('SIGINT'), 0);
  assert.equal(signals.listenerCount('SIGTERM'), 0);
});

test('browser opening failure preserves the app; expired sessions close it', async () => {
  const server = createServer();
  const signals = new EventEmitter();
  const logs = [];
  const error = Object.assign(new Error('Sign in again'), { code: 'needs_login' });
  await assert.rejects(runApp({ store: { meta() {} }, audit: async () => { throw error; } }, {
    server, signals, port: 0, log: message => logs.push(message), open: async () => { throw new Error('no browser'); },
  }), error);
  assert.ok(logs.some(message => message.includes('manually')));
  assert.equal(server.listening, false);
  assert.equal(signals.listenerCount('SIGINT'), 0);
});

test('occupied port fails before opening a browser or reading school data', async () => {
  const occupied = createServer();
  await new Promise(resolve => occupied.listen(0, '127.0.0.1', resolve));
  const signals = new EventEmitter();
  try {
    await assert.rejects(runApp({}, { server: createServer(), signals, port: occupied.address().port,
      open: () => assert.fail('must not open browser'), log() {},
    }), { code: 'EADDRINUSE' });
    assert.equal(signals.listenerCount('SIGINT'), 0);
  } finally { await new Promise(resolve => occupied.close(resolve)); }
});

test('npm binary exposes setup and rejects unattended setup', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
  assert.equal(manifest.bin.dd2l, 'bin/dd2l.mjs');
  const bin = fileURLToPath(new URL('../bin/dd2l.mjs', import.meta.url));
  const help = execFileSync(process.execPath, [bin, '--help'], { encoding: 'utf8' });
  assert.match(help, /dd2l setup/);
  assert.match(help, /dd2l start/);
  const result = spawnSync(process.execPath, [bin, 'setup'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, process.platform === 'win32' ? /interactive terminal/ : /requires Windows/);
  assert.equal(manifest.scripts.postinstall, undefined);
});
