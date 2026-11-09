export const SCHOOL = 'https://onq.queensu.ca';

export function schoolOrigin(value) {
  const message = 'Enter a valid Brightspace address (HTTPS only, no embedded username or password).';
  if (typeof value !== 'string' || /[\u0000-\u0020\u007f\\]/.test(value.trim())) throw new Error(message);
  const address = value.trim().replace(/^\/\//, '');
  let url;
  try { url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(address) ? address : `https://${address}`); } catch { throw new Error(message); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error(message);
  return url.origin;
}

export class AccessError extends Error {
  constructor(code, message, { status, retryAfter = 0 } = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

// Never attach response bodies, headers, or credential-bearing URLs to errors.
export async function request(url, options = {}, fetchImpl = fetch) {
  options.signal?.throwIfAborted();
  let response;
  try {
    response = await fetchImpl(url, {
      ...options, redirect: 'manual', signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
    });
  } catch {
    options.signal?.throwIfAborted();
    throw new AccessError('retry_wait', 'Network request failed or timed out.');
  }
  return checkedResponse(response, url);
}

export function checkedResponse(response, url) {
  if (response.status === 401) throw new AccessError('needs_login', 'School sign-in is required.', { status: 401 });
  if (response.status >= 300 && response.status < 400) {
    const target = new URL(response.headers.get('location') || '/', url);
    const login = /\/d2l\/(?:login|lms\/auth)/i.test(target.pathname) || target.hostname === 'login.microsoftonline.com';
    throw new AccessError(login ? 'needs_login' : 'redirect', login ? 'School sign-in is required.' : 'Unexpected redirect was not followed.', { status: response.status });
  }
  if (response.status === 403) throw new AccessError('denied', 'Brightspace denied access to this resource.', { status: 403 });
  if (response.status === 404) throw new AccessError('unavailable', 'Resource or API route is unavailable; absence is not established.', { status: 404 });
  if (response.status === 429 || response.status >= 500) {
    const raw = response.headers.get('retry-after');
    const seconds = raw && /^\d+$/.test(raw) ? Number(raw) : Math.max(0, (Date.parse(raw) - Date.now()) / 1000);
    throw new AccessError('retry_wait', `Brightspace returned HTTP ${response.status}.`, {
      status: response.status, retryAfter: Number.isFinite(seconds) ? seconds * 1000 : 0,
    });
  }
  if (!response.ok) throw new AccessError('failed', `Brightspace returned HTTP ${response.status}.`, { status: response.status });
  return response;
}

export async function readJson(response) {
  const text = await response.text();
  if (!/\bapplication\/(?:[\w.+-]*\+)?json\b/i.test(response.headers.get('content-type') || '')) {
    if (text.includes('/d2l/login?sessionExpired=1')) throw new AccessError('needs_login', 'School session has expired.');
    throw new AccessError('invalid_response', 'Expected JSON; received a different response format.');
  }
  try { return JSON.parse(text); }
  catch { throw new AccessError('invalid_response', 'Brightspace returned invalid JSON.'); }
}

export function apiUrl(origin, path) {
  const url = new URL(path, origin);
  if (url.origin !== origin || url.username || url.password || url.hash || !url.pathname.startsWith('/d2l/api/')) {
    throw new AccessError('invalid_link', 'Refused a link outside this school’s API.');
  }
  return url;
}

export class BrightspaceClient {
  constructor(session, { origin = SCHOOL, fetchImpl = fetch, signal } = {}) {
    this.session = session;
    this.origin = schoolOrigin(origin);
    this.fetch = fetchImpl;
    this.signal = signal;
  }

  async versions() {
    const data = await readJson(await request(`${this.origin}/d2l/api/versions/`, { signal: this.signal }, this.fetch));
    const versions = {};
    for (const product of ['lp', 'le']) {
      const value = data?.find?.(item => item.ProductCode === product)?.LatestVersion;
      if (!/^\d+\.\d+$/.test(value || '')) throw new AccessError('invalid_response', 'Missing supported API versions.');
      versions[product] = value;
    }
    return versions;
  }

  async response(path) {
    this.signal?.throwIfAborted();
    const url = apiUrl(this.origin, path);
    let token = await this.session.token();
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await request(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, signal: this.signal }, this.fetch);
      } catch (error) {
        if (error.code !== 'needs_login' || attempt) throw error;
        token = await this.session.token(token);
      }
    }
  }

  async get(path) { return readJson(await this.response(path)); }

  async collection(path) {
    const data = [];
    const seen = new Set();
    let next = apiUrl(this.origin, path);
    let pages = 0;
    try {
      while (next) {
        if (pages === 200 || seen.has(next.href)) throw new AccessError('partial', 'Pagination stopped at a loop or page limit.');
        seen.add(next.href);
        const result = await this.get(next.href);
        pages++;
        if (Array.isArray(result)) {
          data.push(...result);
          next = null;
        } else if (Array.isArray(result?.Items) && result.PagingInfo && typeof result.PagingInfo.HasMoreItems === 'boolean') {
          data.push(...result.Items);
          if (!result.PagingInfo.HasMoreItems) next = null;
          else {
            const bookmark = result.PagingInfo.Bookmark;
            if (typeof bookmark !== 'string' || !bookmark) throw new AccessError('partial', 'More pages were advertised without a bookmark.');
            next = apiUrl(this.origin, path);
            next.searchParams.set('bookmark', bookmark);
          }
        } else if (Array.isArray(result?.Objects) && Object.hasOwn(result, 'Next')) {
          data.push(...result.Objects);
          if (!result.Next) next = null;
          else if (typeof result.Next !== 'string') throw new AccessError('invalid_response', 'Invalid next-page marker.');
          else if (/^(?:https?:|\/)/i.test(result.Next)) next = apiUrl(this.origin, result.Next);
          else {
            next = apiUrl(this.origin, path);
            next.searchParams.set('bookmark', result.Next);
          }
        } else throw new AccessError('invalid_response', 'Unrecognized collection response; completeness cannot be established.');
      }
      return { data, pages, complete: true };
    } catch (error) {
      if (!(error instanceof AccessError) || error.code === 'needs_login' || error.status === 429 || !pages) throw error;
      return { data, pages, complete: false, error: error.code, message: error.message, retryAfter: error.retryAfter };
    }
  }
}
