import test from 'node:test';
import assert from 'node:assert/strict';
import { stripVTControlCharacters } from 'node:util';
import { renderBanner } from '../src/cli-banner.mjs';

test('banner stays centered and fits narrow and wide terminals', () => {
  for (const columns of [1, 4, 8, 16, 32, 48, 80, 160]) {
    const banner = stripVTControlCharacters(renderBanner(columns));
    const lines = banner.split('\n');
    for (const line of lines) assert.ok(line.length <= Math.max(1, columns - 1));
    if (columns >= 8 && columns < 32) {
      assert.ok(banner.includes('dd2l'));
      assert.ok(Math.abs(banner.indexOf('dd2l') + 2 - (columns - 1) / 2) <= 1);
    }
    if (columns >= 32) {
      assert.equal(lines.length, 2);
      for (const line of lines) {
        const padding = line.length - line.trimStart().length;
        assert.ok(Math.abs(padding - (columns - 1 - line.length)) <= 1);
      }
    }
  }
});

test('bars and wordmark share a dot grid, with mirrored fades and no solid-block seam', () => {
  // Mirroring each Braille cell swaps its left and right dot columns.
  const swap = cell => {
    const mask = cell.codePointAt(0) - 0x2800;
    const mirrored = ((mask & 7) << 3) | ((mask & 56) >> 3) | ((mask & 64) << 1) | ((mask & 128) >> 1);
    return String.fromCodePoint(0x2800 + mirrored);
  };
  const rows = stripVTControlCharacters(renderBanner(80)).split('\n');
  for (const row of rows) {
    const [left, wordmark, right] = row.trim().split('  ');
    assert.equal(left.length, right.length);
    assert.equal(wordmark.length, 12);
    assert.match(wordmark, /^[\u2800-\u28ff]+$/);
    assert.ok(!row.includes('█'));
    assert.ok(left.endsWith('⣿'));
    assert.ok(right.startsWith('⣿'));
    assert.equal([...left].reverse().map(swap).join(''), right);
    const countDots = text => [...text].reduce((sum, cell) => sum + (cell.codePointAt(0) - 0x2800).toString(2).replaceAll('0', '').length, 0);
    assert.ok(countDots(left.slice(0, 5)) < countDots(left.slice(5, 10)));
    assert.ok(countDots(left.slice(5, 10)) < countDots(left.slice(10, 15)));
  }
});
