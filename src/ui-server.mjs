import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { readInventory, searchInventory } from './ui-data.mjs';
import { demoInventory } from './ui-demo.mjs';

const root = fileURLToPath(new URL('../ui/', import.meta.url));
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' };

export function createUiServer({ demo = false, inventoryPath = join(process.env.LOCALAPPDATA || '', 'dd2l', 'inventory.sqlite') } = {}) {
  return createServer(async (req, res) => {
    const authority = `127.0.0.1:${res.socket.localPort}`;
    const send = (status, body, type = 'application/json') => {
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'same-origin', 'X-Frame-Options': 'DENY',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'" });
      res.end(type === 'application/json' ? JSON.stringify(body) : body);
    };
    if (req.headers.host !== authority || (req.headers.origin && req.headers.origin !== `http://${authority}`) || req.headers['sec-fetch-site'] === 'cross-site') {
      send(403, { error: 'Open dd2l using its local URL.' }); return;
    }
    if (req.method !== 'GET') { send(405, { error: 'This prototype is read-only.' }); return; }
    try {
      const url = new URL(req.url, `http://${authority}`);
      if (url.pathname.startsWith('/api/')) {
        if (!['/api/status', '/api/courses', '/api/search'].includes(url.pathname)) { send(404, { error: 'Not found.' }); return; }
        const query = url.searchParams.get('q') || '';
        const course = url.searchParams.get('course') || '';
        if (query.length > 500 || (course && !/^\d+$/.test(course))) { send(400, { error: 'Use a query of at most 500 characters and a valid course.' }); return; }
        const inventory = demo ? demoInventory() : readInventory(inventoryPath);
        if (course && !inventory.courses.some(item => item.id === course)) { send(404, { error: 'Course is not available in this inventory.' }); return; }
        if (url.pathname === '/api/status') send(200, { demo, state: inventory.state,
          courseCount: inventory.courses.length, sourceCount: inventory.sources.length,
          lastSuccess: inventory.sources.map(source => source.lastSuccess).filter(Boolean).sort().at(-1) || null });
        else if (url.pathname === '/api/courses') send(200, { courses: inventory.courses });
        else send(200, { ...searchInventory(inventory, query, course), demo });
        return;
      }
      const path = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      if (!/^(?:index\.html|app\.js|style\.css|assets\/[a-z-]+\.(?:svg|png))$/.test(path)) { send(404, { error: 'Not found.' }); return; }
      send(200, await readFile(join(root, path)), mime[extname(path)]);
    } catch (error) {
      send(error.code === 'ENOENT' ? 404 : 503, { error: error.code === 'ENOENT' ? 'Not found.' : 'Local inventory could not be read. Retry after the current connector operation finishes.' });
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
