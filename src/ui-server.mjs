import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { readInventory, searchInventory, homeInventory } from './ui-data.mjs';
import { demoInventory } from './ui-demo.mjs';
import { ChatGPT } from './llm.mjs';

const root = fileURLToPath(new URL('../ui/', import.meta.url));
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' };

function signInPage(connected, first = false) {
  const title = connected ? (first ? "You're using your ChatGPT plan" : 'ChatGPT connected') : 'Sign-in did not complete';
  const message = connected
    ? 'Eligible AI requests use your ChatGPT plan. You can manage limits in ChatGPT Settings → Usage.'
    : 'Return to dd2l and open Settings to try signing in again.';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark"><title>${title} · dd2l</title>
<link rel="icon" href="/assets/logo.svg" type="image/svg+xml"><link rel="stylesheet" href="/style.css"></head>
<body class="auth-page"><main class="auth-content" aria-labelledby="auth-heading">
<a class="auth-brand" href="/" aria-label="dd2l home"><img src="/assets/logo.svg" width="40" height="40" alt=""><span>dd2l</span></a>
<p class="auth-status">${connected ? 'Account connected' : 'Connection interrupted'}</p>
<h1 id="auth-heading">${title}</h1><p class="auth-message">${message}</p>
<a class="auth-return" href="/">${connected && first ? 'Got it — return to dd2l' : 'Return to dd2l'} <span aria-hidden="true">→</span></a>
${connected ? '<a class="auth-usage" href="https://chatgpt.com/settings/usage" target="_blank" rel="noopener noreferrer">Manage usage in ChatGPT ↗</a>' : ''}
</main></body></html>`;
}

export function createUiServer({ demo = false, inventoryPath = join(process.env.LOCALAPPDATA || '', 'dd2l', 'inventory.sqlite'),
  llm = demo ? null : new ChatGPT(join(process.env.LOCALAPPDATA || '', 'dd2l')) } = {}) {
  return createServer(async (req, res) => {
    const authority = `127.0.0.1:${res.socket.localPort}`;
    const send = (status, body, type = 'application/json') => {
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'same-origin', 'X-Frame-Options': 'DENY',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'" });
      res.end(type === 'application/json' ? JSON.stringify(body) : body);
    };
    const callback = req.method === 'GET' && req.url.startsWith('/auth/callback?');
    if (req.headers.host !== authority || (!callback && ((req.headers.origin && req.headers.origin !== `http://${authority}`) || req.headers['sec-fetch-site'] === 'cross-site'))) {
      send(403, { error: 'Open dd2l using its local URL.' }); return;
    }
    try {
      const url = new URL(req.url, `http://${authority}`);
      if (callback) {
        try {
          if (!llm || demo) throw new Error('disabled');
          const result = await llm.callback(url.searchParams);
          send(200, signInPage(true, result.first), 'text/html; charset=utf-8');
        } catch { send(400, signInPage(false), 'text/html; charset=utf-8'); }
        return;
      }
      if (url.pathname.startsWith('/api/llm/')) {
        if (!llm || demo) { send(200, { disabled: true, accounts: [], active: null }); return; }
        if (req.method === 'GET' && url.pathname === '/api/llm/status') { send(200, await llm.status()); return; }
        if (req.method === 'GET' && url.pathname === '/api/llm/models') { send(200, await llm.models()); return; }
        if (req.method !== 'POST') { send(405, { error: 'Use POST for AI actions.' }); return; }
        if (req.headers.origin !== `http://${authority}` || !/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) { send(403, { error: 'AI actions require a local JSON request.' }); return; }
        const chunks = [];
        let bytes = 0;
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > 8192) { send(413, { error: 'Request too large.' }); return; }
          chunks.push(chunk);
        }
        let data;
        try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { send(400, { error: 'Invalid JSON.' }); return; }
        if (!data || typeof data !== 'object' || Array.isArray(data)) { send(400, { error: 'Invalid request.' }); return; }
        if (['login', 'select'].includes(url.pathname.split('/').at(-1)) && data.id !== undefined && (typeof data.id !== 'string' || data.id.length > 300)) { send(400, { error: 'Invalid account.' }); return; }
        if (url.pathname === '/api/llm/login') send(200, await llm.login(`http://${authority}/auth/callback`, data.id));
        else if (url.pathname === '/api/llm/select') send(200, await llm.select(data.id));
        else if (url.pathname === '/api/llm/logout') send(200, await llm.logout());
        else if (url.pathname === '/api/llm/answer') {
          const { q, course = '', model, consent } = data;
          if (typeof q !== 'string' || !q.trim() || q.length > 500 || typeof course !== 'string' || (course && !/^\d+$/.test(course)) || typeof model !== 'string' || !model || model.length > 200 || consent !== true) {
            send(400, { error: 'Provide a question, course, model and permission to send excerpts to OpenAI.' }); return;
          }
          const inventory = readInventory(inventoryPath);
          if (course && !inventory.courses.some(c => c.id === course)) { send(404, { error: 'Course is not available in this inventory.' }); return; }
          const sources = searchInventory(inventory, q, course).results.slice(0, 8);
          const controller = new AbortController();
          const abort = () => controller.abort();
          res.on('close', abort);
          try { send(200, { ...await llm.answer(q, model, sources, AbortSignal.any([controller.signal, AbortSignal.timeout(90_000)])), sources }); }
          finally { res.off('close', abort); }
        } else send(404, { error: 'Not found.' });
        return;
      }
      if (req.method !== 'GET') { send(405, { error: 'This route is read-only.' }); return; }
      if (url.pathname.startsWith('/api/')) {
        if (!['/api/status', '/api/courses', '/api/search', '/api/home'].includes(url.pathname)) { send(404, { error: 'Not found.' }); return; }
        const query = url.searchParams.get('q') || '';
        const course = url.searchParams.get('course') || '';
        if (query.length > 500 || (course && !/^\d+$/.test(course))) { send(400, { error: 'Use a query of at most 500 characters and a valid course.' }); return; }
        const inventory = demo ? demoInventory() : readInventory(inventoryPath);
        if (course && !inventory.courses.some(item => item.id === course)) { send(404, { error: 'Course is not available in this inventory.' }); return; }
        if (url.pathname === '/api/status') send(200, { demo, state: inventory.state,
          courseCount: inventory.courses.length, sourceCount: inventory.sources.length,
          lastSuccess: inventory.sources.map(source => source.lastSuccess).filter(Boolean).sort().at(-1) || null });
        else if (url.pathname === '/api/home') send(200, { ...homeInventory(inventory), demo });
        else if (url.pathname === '/api/courses') send(200, { courses: inventory.courses });
        else send(200, { ...searchInventory(inventory, query, course), demo });
        return;
      }
      const path = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      if (!/^(?:index\.html|app\.js|widgets\.js|widget-layout\.js|style\.css|assets\/[a-z-]+\.(?:svg|png))$/.test(path)) { send(404, { error: 'Not found.' }); return; }
      send(200, await readFile(join(root, path)), mime[extname(path)]);
    } catch (error) {
      send(error.code === 'ENOENT' ? 404 : 503, { error: error.public ? error.message : error.code === 'ENOENT' ? 'Not found.' : 'Local data or AI service is unavailable. Retry after the current operation finishes.' });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({ options: { demo: { type: 'boolean' }, port: { type: 'string', default: '4173' } } });
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Port must be between 1024 and 65535.');
  if (!values.demo && !process.env.LOCALAPPDATA) throw new Error('Live inventory requires Windows LOCALAPPDATA. Use --demo for sample data.');
  const server = createUiServer({ demo: values.demo });
  server.on('error', error => { console.error(`Could not start UI: ${error.code}`); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`dd2l ${values.demo ? 'DEMO (sample data)' : '(local cached coursework)'}: http://127.0.0.1:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
}
