import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function checkPackage(files) {
  const paths = new Set(files.map(file => file.path));
  for (const required of ['package.json', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md',
    'bin/dd2l.mjs', 'src/cli.mjs', 'src/app-runner.mjs', 'src/ui-server.mjs',
    'src/windows-ocr.ps1', 'src/pdf-worker.mjs', 'ui/index.html', 'ui/app.js',
    'ui/style.css', 'ui/assets/LUCIDE-LICENSE.txt']) {
    assert.ok(paths.has(required), `Package is missing ${required}`);
  }
  for (const path of paths) {
    assert.match(path, /^(?:package\.json|README\.md|LICENSE|THIRD_PARTY_NOTICES\.md|docs\/README\.md|bin\/dd2l\.mjs|src\/[\w-]+\.(?:mjs|ps1)|ui\/[\w-]+\.(?:html|js|css)|ui\/assets\/[\w-]+\.(?:svg|png|txt))$/, `Unexpected package file: ${path}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assert.ok(process.env.npm_execpath, 'Run this check with npm run package:check.');
  const packed = spawnSync(process.execPath, [process.env.npm_execpath, 'pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), encoding: 'utf8',
  });
  if (packed.error) throw packed.error;
  assert.equal(packed.status, 0, packed.stderr);
  const [bundle] = JSON.parse(packed.stdout);
  checkPackage(bundle.files);
  console.log(`Package check passed: ${bundle.filename}, ${bundle.files.length} runtime/documentation files.`);
  console.log('This checks package contents, not whether the security audit has passed.');
}
