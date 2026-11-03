import { styleText } from 'node:util';

const bayer = [
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21],
];
const dots = [[0, 1, 2, 6], [3, 4, 5, 7]];
const glyphs = {
  d: ['00001', '00001', '01111', '10001', '10001', '10001', '01111'],
  2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  l: ['11000', '01000', '01000', '01000', '01000', '01000', '00110'],
};
const wordmark = Array.from({ length: 8 }, (_, y) =>
  [...'dd2l'].map(letter => glyphs[letter][y] ?? '00000').join('0') + '0');

function raster(width, row, pixel) {
  return Array.from({ length: width }, (_, cell) => {
    let mask = 0;
    for (let column = 0; column < 2; column++) {
      for (let dot = 0; dot < 4; dot++) {
        if (pixel(cell * 2 + column, row * 4 + dot)) mask |= 1 << dots[column][dot];
      }
    }
    // Keep even the dense areas on the dot grid to avoid a block-to-Braille seam.
    return String.fromCodePoint(0x2800 + mask);
  }).join('');
}

function bar(width, row, mirrored = false) {
  return raster(width, row, (x, y) => {
    if (mirrored) x = width * 2 - 1 - x;
    const t = Math.min(1, (x + 0.5) / (width * 2 * 0.85));
    const density = t * t * (3 - 2 * t);
    return density > (bayer[y][x % 8] + 0.5) / 64;
  });
}

export function renderBanner(columns = 80) {
  // Leave the last column free so the terminal doesn't wrap the banner.
  const width = Math.max(1, columns - 1);
  if (width < 31) {
    const title = 'dd2l'.slice(0, width);
    return ' '.repeat(Math.floor((width - title.length) / 2)) + styleText('bold', title);
  }
  const labelWidth = wordmark[0].length / 2;
  const barWidth = Math.min(20, Math.floor((width - labelWidth - 4) / 2));
  const padding = ' '.repeat(Math.floor((width - barWidth * 2 - labelWidth - 4) / 2));
  return [0, 1].map(row => {
    const label = raster(labelWidth, row, (x, y) => wordmark[y][x] === '1');
    return `${padding}${styleText('blueBright', bar(barWidth, row))}  ${label}  ${styleText('blueBright', bar(barWidth, row, true))}`;
  }).join('\n');
}
