import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPackage } from '../scripts/check-package.mjs';

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
