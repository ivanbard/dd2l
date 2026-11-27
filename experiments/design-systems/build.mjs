import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import { fixtures } from './fixtures.mjs';
import { planSchema, validPlan } from './model.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, 'dist');
await mkdir(dist, { recursive: true });
for (const plan of Object.values(fixtures.scenarios)) {
  if (!validPlan(plan, fixtures.sources)) throw new Error('Invalid comparison fixture.');
}
const dependencies = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).dependencies;
const manifest = { versions: { daisy: dependencies.daisyui, mantine: dependencies['@mantine/core'], react: dependencies.react },
  scope: 'Minified production builds; each frame bundles its own renderer, contract and complete library CSS. Gzip is per frame HTML including inline assets. No shared CDN or browser cache assumed.', renderers: {} };
const packages = new Set();
for (const id of ['daisy', 'mantine', 'host']) {
  const result = await build({ absWorkingDir: root, entryPoints: [id === 'mantine' ? 'mantine.jsx' : `${id}.mjs`],
    outfile: join(dist, `${id}.js`), bundle: true, minify: true, write: false, metafile: true,
    format: id === 'host' ? 'esm' : 'iife', target: 'es2022', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'eof' });
  for (const input of Object.keys(result.metafile.inputs)) {
    const match = input.replaceAll('\\', '/').match(/node_modules\/((?:@[^/]+\/)?[^/]+)\//);
    if (match) packages.add(match[1]);
  }
  const js = result.outputFiles.find(file => file.path.endsWith('.js')).text;
  const css = result.outputFiles.find(file => file.path.endsWith('.css'))?.text || '';
  if (id === 'host') { await writeFile(join(dist, 'host.js'), js); continue; }
  const nonce = randomBytes(24).toString('base64');
  const policy = `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${policy}"><title>${id} workspace</title><style>${css.replaceAll('</style', '<\\/style')}</style></head><body><main id="root"></main><script nonce="${nonce}">${js.replaceAll('</script', '<\\/script')}</script></body></html>`;
  await writeFile(join(dist, `${id}.html`), html);
  manifest.renderers[id] = { bytes: Buffer.byteLength(html), gzip: gzipSync(html).length, jsBytes: Buffer.byteLength(js), cssBytes: Buffer.byteLength(css) };
}
let notices = 'Third-party source is bundled only in this local comparison. Original notices follow.\n';
for (const name of [...packages].sort()) {
  const directory = join(root, 'node_modules', name);
  let license;
  for (const filename of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'license.md', 'LICENSE.MIT']) {
    try { license = await readFile(join(directory, filename), 'utf8'); break; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (!license) license = await readFile(join(root, 'licenses', `${name.replaceAll('/', '-')}.txt`), 'utf8');
  const metadata = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  notices += `\n--- ${name}@${metadata.version} ---\n${license}\n`;
}
await writeFile(join(dist, 'THIRD_PARTY_NOTICES.txt'), notices);
for (const name of ['index.html', 'host.css']) await writeFile(join(dist, name), await readFile(join(root, name)));
for (const [name, data] of Object.entries({ fixtures, schema: planSchema, manifest })) await writeFile(join(dist, `${name}.json`), JSON.stringify(data, null, 2));
console.log(JSON.stringify(manifest, null, 2));
