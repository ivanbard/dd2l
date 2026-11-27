import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, extname } from 'node:path';
import { parseArgs } from 'node:util';

const dist = fileURLToPath(new URL('./dist/', import.meta.url));
const files = new Set(['index.html', 'host.css', 'host.js', 'daisy.html', 'mantine.html', 'fixtures.json', 'schema.json', 'manifest.json', 'THIRD_PARTY_NOTICES.txt']);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8' };
export function createComparisonServer() {
  return createServer(async (req, res) => {
    const authority = `127.0.0.1:${res.socket.localPort}`;
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Cross-Origin-Resource-Policy': 'same-origin' };
    const send = (status, body, type = 'text/plain; charset=utf-8') => { res.writeHead(status, { ...headers, 'Content-Type': type }); res.end(body); };
    if (req.headers.host !== authority || req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && !['null', `http://${authority}`].includes(req.headers.origin))) {
      send(403, 'Open the comparison using its local URL.'); return;
    }
    if (req.method !== 'GET') { send(405, 'This comparison is read-only.'); return; }
    let path;
    try { path = new URL(req.url, `http://${authority}`).pathname; }
    catch { send(400, 'Invalid request URL.'); return; }
    const name = path === '/' ? 'index.html' : path.slice(1);
    if (!files.has(name)) { send(404, 'Not found.'); return; }
    if (!['daisy.html', 'mantine.html'].includes(name)) {
      headers['Content-Security-Policy'] = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
      headers['X-Frame-Options'] = 'DENY';
    } else {
      headers['X-Frame-Options'] = 'SAMEORIGIN';
      // The frame's inline meta CSP pins its bundled bootstrap to a nonce and blocks networking.
      headers['Content-Security-Policy'] = "frame-ancestors 'self'";
    }
    try { send(200, await readFile(join(dist, name)), types[extname(name)]); }
    catch (error) { send(error.code === 'ENOENT' ? 404 : 500, 'Build the comparison with npm run compare first.'); }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({ options: { port: { type: 'string', default: '4174' } } });
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Port must be between 1024 and 65535.');
  const server = createComparisonServer();
  server.on('error', error => { console.error(`Could not start comparison: ${error.code}`); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`dd2l design-system comparison: http://127.0.0.1:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.close(); server.closeAllConnections(); });
}
