#!/usr/bin/env node
if (Number(process.versions.node.split('.')[0]) < 24) {
  console.error('dd2l requires Node.js 24 or newer. Install it from https://nodejs.org, then retry.');
  process.exitCode = 1;
} else {
  await import('../src/cli.mjs');
}
