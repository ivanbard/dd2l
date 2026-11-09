import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function checkRelease(tag, version) {
  assert.equal(version.trim(), version, 'Only stable release versions can be published.');
  assert.match(version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, 'Only stable release versions can be published.');
  assert.equal(tag, `v${version}`, 'Release tag must match the package version (vX.Y.Z).');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cwd = fileURLToPath(new URL('../', import.meta.url));
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  checkRelease(process.env.RELEASE_TAG, version);
  const ancestry = spawnSync('git', ['merge-base', '--is-ancestor', 'HEAD', 'origin/main'], { cwd, encoding: 'utf8' });
  if (ancestry.error) throw ancestry.error;
  assert.equal(ancestry.status, 0, `Release commit must belong to origin/main. ${ancestry.stderr}`);
  console.log(`Release ${process.env.RELEASE_TAG} matches the package version and belongs to main.`);
}
