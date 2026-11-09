import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { execFileSync, spawnSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import { runApp } from '../src/app-runner.mjs';

test('school selection and custom URL entry can be cancelled without creating school data',
  { skip: process.platform !== 'win32', timeout: 10_000 }, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'dd2l-school-menu-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    for (const keys of ['\u001b[B\r', '\u0003']) {
      const child = spawn(process.execPath, ['--input-type=module', '-e', `
        process.stdin.isTTY = true;
        process.stdin.setRawMode = () => {};
        process.stdout.isTTY = true;
        await import(${JSON.stringify(new URL('../src/cli.mjs', import.meta.url).href)});
      `, 'setup'], { env: { ...process.env, LOCALAPPDATA: directory }, stdio: ['pipe', 'pipe', 'pipe'] });
      t.after(() => { if (child.exitCode === null) child.kill(); });
      let output = '';
      let sent = false;
      let urlCancelled = false;
      child.stdout.on('data', chunk => {
        output += chunk;
        if (!sent && stripVTControlCharacters(output).includes('Enter: confirm')) { sent = true; child.stdin.write(keys); }
        if (!urlCancelled && output.includes('Your school\'s Brightspace URL')) {
          urlCancelled = true;
          child.stdin.write('\u0003');
        }
        if (/Setup cancelled/.test(output)) child.stdin.end();
      });
      const [code] = await once(child, 'close');
      assert.equal(code, 0);
      assert.match(output, /Queen's University/);
      assert.match(output, /Setup cancelled/);
      if (keys !== '\u0003') assert.match(output, /Your school's Brightspace URL/);
      await assert.rejects(access(join(directory, 'dd2l')), { code: 'ENOENT' });
    }
  });

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

test('app shutdown closes an unfinished browser request on SIGINT and SIGTERM', { timeout: 5000 }, async () => {
  for (const signal of ['SIGINT', 'SIGTERM']) {
    const server = createServer((req, res) => res.write('still loading'));
    const signals = new EventEmitter();
    let socket;
    let closed;
    try {
      await runApp({ store: { meta() {} }, audit: async () => ({ retryAfter: 0 }) }, {
        server, signals, port: 0, log() {},
        open: async url => {
          socket = connect(Number(new URL(url).port), '127.0.0.1');
          closed = once(socket, 'close');
          socket.write('GET / HTTP/1.1\r\nHost: localhost\r\n\r\n');
          await once(socket, 'data');
        },
        onUpdate: () => signals.emit(signal),
      });
      await closed;
      assert.equal(server.listening, false);
      assert.equal(signals.listenerCount(signal), 0);
    } finally { socket?.destroy(); server.closeAllConnections(); server.close(); }
  }
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

test('failed report persistence closes the UI without claiming coursework was saved', async () => {
  const server = createServer();
  const signals = new EventEmitter();
  const logs = [];
  await assert.rejects(runApp({ store: { meta() {} }, audit: async () => ({ retryAfter: 0 }) }, {
    server, signals, port: 0, open: async () => {}, log: message => logs.push(message),
    onUpdate: async () => { throw new Error('Disk full'); },
  }), /Disk full/);
  assert.ok(!logs.some(message => message.includes('Coursework saved')));
  assert.equal(server.listening, false);
  assert.equal(signals.listenerCount('SIGINT'), 0);
});

test('npm binary exposes setup and rejects unattended setup', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
  assert.equal(manifest.bin.dd2l, 'bin/dd2l.mjs');
  const bin = fileURLToPath(new URL('../bin/dd2l.mjs', import.meta.url));
  const help = execFileSync(process.execPath, [bin, '--help'], { encoding: 'utf8' });
  assert.match(help, /dd2l setup/);
  assert.match(help, /dd2l start/);
  assert.match(help, /npx @ivanbard\/dd2l/);
  const result = spawnSync(process.execPath, [bin, 'setup'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, process.platform === 'win32' ? /interactive terminal/ : /requires Windows/);
  assert.equal(manifest.scripts.postinstall, undefined);
});
