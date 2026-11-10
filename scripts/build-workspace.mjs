import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const result = await build({ absWorkingDir: root, entryPoints: ['frontend/workspace.jsx'], outfile: 'ui/assets/workspace.js',
  bundle: true, minify: true, metafile: true, format: 'iife', target: 'es2022', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'eof' });
const packages = new Set();
for (const input of Object.keys(result.metafile.inputs)) {
  const match = input.replaceAll('\\', '/').match(/node_modules\/((?:@[^/]+\/)?[^/]+)\//);
  if (match) packages.add(match[1]);
}
let notices = 'Bundled workspace dependencies. Original license notices follow.\n';
for (const name of [...packages].sort()) {
  const directory = join(root, 'node_modules', name);
  let license;
  for (const filename of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'license.md', 'LICENSE.MIT']) {
    try { license = await readFile(join(directory, filename), 'utf8'); break; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (!license && name === 'react-remove-scroll-bar') license = await readFile(join(root, 'scripts/react-remove-scroll-bar-LICENSE.txt'), 'utf8');
  if (!license) throw new Error(`Missing license for bundled dependency: ${name}`);
  const metadata = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  notices += `\n--- ${name}@${metadata.version} ---\n${license}\n`;
}
await writeFile(join(root, 'ui/assets/workspace-LICENSE.txt'), notices);
console.log('Built the local Mantine workspace and bundled dependency notices.');
