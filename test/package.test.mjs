import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPackage } from '../scripts/check-package.mjs';
import { checkRelease } from '../scripts/check-release.mjs';

test('published releases require an exact stable package version tag', () => {
  for (const version of ['0.1.0', '1.0.0', '2.3.4']) checkRelease(`v${version}`, version);
  for (const tag of [undefined, '1.0.0', 'v2.0.0', 'v1.0.0; echo unsafe', 'v1.0.0\n']) {
    assert.throws(() => checkRelease(tag, '1.0.0'), /must match/);
  }
  for (const version of ['1.0.0-beta.1', '1.0.0+build', '01.0.0', '1.0', '1.0.0\n']) {
    assert.throws(() => checkRelease(`v${version}`, version), /Only stable/);
  }
});

const files = ['package.json', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md',
  'bin/dd2l.mjs', 'src/cli.mjs', 'src/app-runner.mjs', 'src/ui-server.mjs',
  'src/windows-ocr.ps1', 'src/pdf-worker.mjs', 'ui/index.html', 'ui/app.js',
  'ui/style.css', 'ui/assets/LUCIDE-LICENSE.txt'].map(path => ({ path }));

test('release rejects missing runtime files and accidentally packaged private or development files', () => {
  checkPackage(files);
  assert.throws(() => checkPackage(files.filter(file => file.path !== 'bin/dd2l.mjs')), /missing bin\/dd2l.mjs/);
  for (const path of ['.env', 'src/.env', 'src/session.dpapi', 'inventory.sqlite',
    '.npmrc', '.github/workflows/publish.yml', 'test/connector.test.mjs', 'src/private.json', 'ui/assets/cache.sqlite']) {
    assert.throws(() => checkPackage([...files, { path }]), /Unexpected package file/);
  }
});
