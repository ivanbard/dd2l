import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function recognizeImage(bytes) {
  if (process.platform !== 'win32') throw new Error('Local OCR requires Windows.');
  const directory = await mkdtemp(join(tmpdir(), 'dd2l-ocr-'));
  try {
    const path = join(directory, 'page.png');
    await writeFile(path, bytes, { mode: 0o600 });
    return await new Promise((resolve, reject) => {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
        fileURLToPath(new URL('./windows-ocr.ps1', import.meta.url)), path], { windowsHide: true, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
        if (error) reject(new Error('Windows OCR is unavailable or timed out; an installed OCR language is required.'));
        else resolve(Buffer.from(stdout.trim(), 'base64').toString('utf8').trim());
      });
    });
  } finally {
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('dd2l-ocr-')) throw new Error('Unexpected OCR temporary directory.');
    await rm(directory, { recursive: true, force: true });
  }
}
