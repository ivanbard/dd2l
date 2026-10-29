import { execFile } from 'node:child_process';
import { readFile, writeFile, rename, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AccessError, BrightspaceClient, SCHOOL, request, readJson } from './client.mjs';

// Secrets go through stdin, never command arguments or a plaintext temp file.
export function protect(bytes, decrypt = false) {
  if (process.platform !== 'win32') throw new Error('Protected session storage currently requires Windows.');
  const method = decrypt ? 'Unprotect' : 'Protect';
  const script = `Add-Type -AssemblyName System.Security; try { $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $r=[Security.Cryptography.ProtectedData]::${method}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($r)) } catch { exit 1 }`;
  return new Promise((resolve, reject) => {
    const child = execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, timeout: 30_000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
        if (error) reject(new Error('Windows could not protect or unlock this session. Sign in again if it belongs to another Windows account.'));
        else resolve(Buffer.from(stdout.trim(), 'base64'));
      });
    child.stdin.on('error', () => {});
    child.stdin.end(Buffer.from(bytes).toString('base64'));
  });
}

export async function atomicWrite(path, value) {
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, value, { mode: 0o600, flag: 'wx' });
    await rename(temp, path);
  } finally { await rm(temp, { force: true }); }
}

export class Session {
  constructor(directory, { origin = SCHOOL, fetchImpl = fetch, crypt = protect } = {}) {
    this.directory = directory;
    this.path = join(directory, 'session.dpapi');
    this.origin = origin;
    this.fetch = fetchImpl;
    this.crypt = crypt;
  }

  async load() {
    if (this.value) return this.value;
    let encrypted;
    try { encrypted = await readFile(this.path); }
    catch (error) {
      if (error.code === 'ENOENT') throw new AccessError('needs_login', 'Run npm run login to sign in.');
      throw error;
    }
    let value;
    try { value = JSON.parse((await this.crypt(encrypted, true)).toString()); }
    catch { throw new AccessError('needs_login', 'Saved session could not be unlocked. Run npm run login.'); }
    if (value.origin !== this.origin || !Array.isArray(value.cookies) || !value.csrf || !value.identity?.Identifier) {
      throw new AccessError('needs_login', 'Saved session does not match this school or is incomplete.');
    }
    this.value = value;
    return value;
  }

  async save(value) {
    await mkdir(this.directory, { recursive: true });
    await atomicWrite(this.path, await this.crypt(Buffer.from(JSON.stringify(value))));
    this.value = value;
  }

  async token(rejected) {
    const value = await this.load();
    if (value.token && value.expiresAt > Date.now() + 60_000 && value.token !== rejected) return value.token;
    if (!this.renewing) this.renewing = this.renew(value).finally(() => { this.renewing = null; });
    return this.renewing;
  }

  async renew(value) {
    const updated = await mintSession(this.origin, value, this.fetch);
    await this.save(updated);
    return updated.token;
  }
}

async function mintSession(origin, value, fetchImpl) {
    const url = new URL(origin);
    const cookies = value.cookies.filter(cookie => {
      const domain = String(cookie.domain).replace(/^\./, '');
      return (url.hostname === domain || url.hostname.endsWith(`.${domain}`)) &&
        (!cookie.expires || cookie.expires === -1 || cookie.expires > Date.now() / 1000) &&
        (cookie.path === '/' || '/d2l/lp/auth/oauth2/token'.startsWith(cookie.path));
    });
    if (!cookies.length) throw new AccessError('needs_login', 'School session has expired. Run npm run login.');
    const payload = await readJson(await request(`${origin}/d2l/lp/auth/oauth2/token`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded',
        cookie: cookies.map(c => `${c.name}=${c.value}`).join('; '), 'x-csrf-token': value.csrf },
      body: 'scope=*:*:*',
    }, fetchImpl));
    if (typeof payload.access_token !== 'string' || !payload.access_token) throw new AccessError('invalid_response', 'Token exchange did not return an API token.');
    let exp;
    try { exp = JSON.parse(Buffer.from(payload.access_token.split('.')[1], 'base64url')).exp * 1000; } catch {}
    const ttl = Number(payload.expires_in);
    const expiresAt = Number.isFinite(exp) && exp > Date.now() ? exp : Date.now() + (ttl > 0 && Number.isFinite(ttl) ? ttl : 300) * 1000;
    return { ...value, token: payload.access_token, expiresAt };
}

export async function login(session, client, { onProgress = console.error, expectedAccount } = {}) {
  const { chromium } = await import('playwright-core');
  const versions = await client.versions();
  onProgress('Opening Chrome. Complete your school sign-in and MFA in the browser.');
  const browser = await chromium.launch({ channel: 'chrome', headless: false, timeout: 30_000 });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${session.origin}/d2l/home`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const deadline = Date.now() + 5 * 60_000;
    while (Date.now() < deadline) {
      if (page.isClosed()) throw new AccessError('needs_login', 'Sign-in browser was closed before verification.');
      if (new URL(page.url()).origin === session.origin && /\/d2l\/(?:home|le\b|lms\b)/.test(new URL(page.url()).pathname)) {
        let csrf;
        try {
          csrf = await page.evaluate(() =>
            window.D2L?.LP?.Web?.Authentication?.Xsrf?.GetXsrfToken?.() ||
            localStorage.getItem('XSRF.Token') || document.querySelector('meta[name="d2l-xsrf-token"]')?.content);
        } catch { /* SSO navigation can replace the page during this read. */ }
        if (typeof csrf === 'string' && csrf) {
          const candidate = { origin: session.origin, csrf, cookies: await context.cookies(session.origin) };
          try {
            const verified = await mintSession(session.origin, candidate, session.fetch);
            const candidateClient = new BrightspaceClient({ token: async () => verified.token }, { origin: session.origin, fetchImpl: session.fetch });
            const identity = await candidateClient.get(`/d2l/api/lp/${versions.lp}/users/whoami`);
            if (!identity?.Identifier) throw new AccessError('invalid_response', 'Could not verify the signed-in identity.');
            if (expectedAccount && expectedAccount !== `${session.origin}:${identity.Identifier}`) {
              throw new AccessError('account_mismatch', 'Inventory belongs to another school account. Run logout before switching accounts.');
            }
            // Verify before persisting; a failed login must not overwrite a working session.
            await session.save({ ...verified, identity });
            onProgress('School identity verified; session saved with Windows protection.');
            return;
          } catch (error) {
            if (error.code !== 'needs_login') throw error;
          }
        }
      }
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    throw new AccessError('needs_login', 'Sign-in did not complete within five minutes.');
  } finally { await browser.close(); }
}
