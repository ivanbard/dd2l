import { AccessError, checkedResponse } from './client.mjs';
import { readDocument } from './documents.mjs';
import { courseNodes } from './discovery.mjs';

// Only observed public reference hosts; private providers need their own sign-in.
const publicHosts = new Set(['www.queensu.ca', 'smithengineering.queensu.ca', 'www.cs.queensu.ca',
  'www.cs.cmu.edu', 'www.perfeng.com', 'sunnyday.mit.edu', 'www.instructables.com',
  'www.sciencedaily.com', 'www.protoexpress.com', 'www.youtube.com', 'www.youtube-nocookie.com', 'youtu.be']);

export function linkUrl(client, target, base = client.origin) {
  let url;
  try { url = new URL(target, base); } catch { throw new AccessError('invalid_link', 'Invalid document link.'); }
  if (url.username || url.password) throw new AccessError('invalid_link', 'Credentials in a document URL are not supported.');
  url.hash = '';
  if (/%(?:2f|5c|25(?:2e|2f|5c))/i.test(url.pathname)) throw new AccessError('invalid_link', 'Encoded path traversal is not a supported document target.');
  if (url.username || url.password || url.protocol !== 'https:') {
    if (url.protocol === 'http:' && publicHosts.has(url.hostname)) url.protocol = 'https:';
    else throw new AccessError('unsupported_link', 'Only HTTPS document links can be read.');
  }
  if (url.origin === client.origin && (url.pathname.startsWith('/content/') || url.pathname.startsWith('/shared/'))) return url;
  if (url.origin !== client.origin && publicHosts.has(url.hostname) && (!url.port || url.port === '443')) {
    for (const key of [...url.searchParams.keys()]) if (/token|session|csrf|xsrf|authorization/i.test(key)) url.searchParams.delete(key);
    return url;
  }
  throw new AccessError('external_auth_required', 'Link needs a provider-specific reader or is an unsupported school action; it was not followed.');
}

export function actionLink(target, origin) {
  try {
    const url = new URL(target, origin);
    return ['mailto:', 'tel:', 'javascript:'].includes(url.protocol) || target.startsWith('#') ||
      (url.origin === origin && /quickLink\.d2l$/i.test(url.pathname) &&
        /survey|enroll|dropbox|quiz|discussion/i.test(url.searchParams.get('type') || ''));
  } catch { return false; }
}

export async function linkedResponse(client, target) {
  let url = linkUrl(client, target);
  for (let redirects = 0; redirects <= 5; redirects++) {
    const headers = { accept: '*/*' };
    if (url.origin === client.origin) {
      const session = await client.session.load();
      headers.cookie = session.cookies.filter(cookie => {
        const domain = cookie.domain.replace(/^\./, '');
        const path = cookie.path || '/';
        return (url.hostname === domain || url.hostname.endsWith(`.${domain}`)) &&
          (url.pathname === path || url.pathname.startsWith(path.endsWith('/') ? path : `${path}/`)) &&
          (cookie.expires === -1 || !cookie.expires || cookie.expires > Date.now() / 1000);
      }).map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
    }
    let response;
    try { response = await client.fetch(url, { headers, redirect: 'manual', signal: client.signal ? AbortSignal.any([client.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000) }); }
    catch { throw new AccessError('retry_wait', 'Linked document request failed or timed out.'); }
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get('location');
      await response.body?.cancel();
      if (!next) throw new AccessError('invalid_link', 'Redirect did not identify a target.');
      url = linkUrl(client, next, url);
      continue;
    }
    if ([401, 403].includes(response.status) && url.origin !== client.origin) throw new AccessError('external_auth_required', 'Public provider refused the reader or requires its own sign-in.');
    return checkedResponse(response, url);
  }
  throw new AccessError('partial', 'Linked document exceeded the redirect limit.');
}

export async function readLinkedDocument(client, target, { le, courseId, tree, base = client.origin } = {}) {
  let url;
  try { url = new URL(target, base); } catch { throw new AccessError('invalid_link', 'Invalid document link.'); }
  const topic = url.origin === client.origin && url.pathname.match(/^\/d2l\/le\/content\/(\d+)\/viewContent\/(\d+)\/(?:View|Home)\/?$/i);
  const apiFile = url.origin === client.origin && url.pathname.match(/^\/d2l\/api\/le\/\d+\.\d+\/(\d+)\/(?:content\/topics\/(\d+)\/file|overview\/attachment)$/);
  const linkedCourse = topic?.[1] || apiFile?.[1];
  const linkedTopic = topic?.[2] || apiFile?.[2];
  if (linkedCourse && linkedCourse !== String(courseId)) throw new AccessError('unsupported_link', 'Linked document belongs to a different course.');
  const known = courseNodes(tree).find(node => {
    if (linkedTopic) return String(node.TopicId) === linkedTopic;
    try { return node.Url && new URL(node.Url, client.origin).href === url.href; } catch { return false; }
  });
  if (known?.restricted) throw new AccessError('restricted', 'Linked source or its ancestor is outside release conditions.');
  if (known?.ActivityType === 1 && /^\d+$/.test(String(known.TopicId))) return readDocument(client, `${le}/content/topics/${known.TopicId}/file`);
  if (apiFile) return readDocument(client, linkedTopic ? `${le}/content/topics/${linkedTopic}/file` : `${le}/overview/attachment`);
  if (topic) {
    if (topic[1] !== String(courseId)) throw new AccessError('unsupported_link', 'Linked topic belongs to a different course.');
    const path = `${le}/content/topics/${topic[2]}`;
    const metadata = await client.get(path);
    if (metadata.IsHidden || metadata.IsLocked || Date.parse(metadata.StartDate) > Date.now() || Date.parse(metadata.EndDate) < Date.now()) {
      throw new AccessError('restricted', 'Linked topic is outside its release conditions.');
    }
    if (metadata.Type === 1 || metadata.ActivityType === 1) return readDocument(client, `${path}/file`);
    if (metadata.Url && metadata.Url !== target && metadata.Url !== url.href) {
      // File/static/public links only here; another topic cannot create a recursion loop.
      return readDocument({ response: value => linkedResponse(client, value) }, linkUrl(client, metadata.Url).href);
    }
    throw new AccessError('unsupported_link', 'Linked topic has no directly readable document target.');
  }
  const safe = linkUrl(client, url.href);
  const document = await readDocument({ response: value => linkedResponse(client, value) }, safe.href);
  return { ...document, resolvedUrl: safe.href };
}
