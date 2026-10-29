import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { Parser } from 'htmlparser2';
import { AccessError } from './client.mjs';

export function htmlContent(html) {
  const parts = [];
  const links = [];
  const block = new Set(['p', 'div', 'br', 'li', 'tr', 'td', 'th', 'h1', 'h2', 'h3', 'h4', 'section']);
  const ignored = new Set(['head', 'script', 'style', 'template', 'noscript']);
  let hidden = 0;
  let anchor;
  const parser = new Parser({
    onopentag(name, attrs) {
      if (ignored.has(name)) hidden++;
      if (hidden) return;
      if (block.has(name)) parts.push('\n');
      if (name === 'a' && attrs.href) {
        anchor = { url: attrs.href, label: '' };
        links.push(anchor);
      }
      if (['iframe', 'embed', 'object'].includes(name) && (attrs.src || attrs.data)) {
        links.push({ url: attrs.src || attrs.data, label: attrs.title || '', embedded: true });
      }
    },
    ontext(value) { if (!hidden) { parts.push(value); if (anchor) anchor.label += value; } },
    onclosetag(name) {
      if (ignored.has(name)) hidden = Math.max(0, hidden - 1);
      if (!hidden && block.has(name)) parts.push('\n');
      if (name === 'a') anchor = undefined;
    },
  }, { decodeEntities: true });
  parser.end(String(html || ''));
  return { text: parts.join('').replace(/[\t \u00a0]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim(), links };
}

export function descriptionContent(description) {
  if (description?.Html) return htmlContent(description.Html);
  return { text: String(description?.Text || '').trim(), links: [] };
}

async function pdfText(bytes) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./pdf-worker.mjs', import.meta.url), {
      workerData: bytes, stdout: true, stderr: true, resourceLimits: { maxOldGenerationSizeMb: 256 },
    });
    worker.stdout.resume();
    worker.stderr.resume();
    let settled = false;
    const timer = setTimeout(() => finish(new AccessError('extraction_failed', 'PDF extraction exceeded its 30-second limit.')), 30_000);
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      if (error) reject(error); else resolve(value);
    };
    worker.once('message', value => value.error ? finish(new AccessError('extraction_failed', value.error)) : finish(null, value));
    worker.once('error', () => finish(new AccessError('extraction_failed', 'PDF text extraction failed.')));
    worker.once('exit', code => { if (code !== 0) finish(new AccessError('extraction_failed', 'PDF extraction worker stopped.')); });
  });
}

export async function readDocument(client, path) {
  const response = await client.response(path);
  const contentType = response.headers.get('content-type') || 'application/octet-stream';
  if (!response.body) throw new AccessError('invalid_response', 'Document response has no body.');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2 * 1024 * 1024) throw new AccessError('partial', 'Document exceeds the 2 MiB read limit.');
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof AccessError) throw error;
    throw new AccessError('retry_wait', 'Document body read failed or timed out.');
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = Buffer.concat(chunks);
  const isPdf = bytes.subarray(0, 5).toString() === '%PDF-' || /application\/pdf/i.test(contentType);
  const isHtml = /(?:text\/html|application\/xhtml\+xml)/i.test(contentType);
  if (isHtml && bytes.toString().includes('/d2l/login?sessionExpired=1')) throw new AccessError('needs_login', 'School session has expired.');
  const result = { contentType, size, sha256: createHash('sha256').update(bytes).digest('hex'),
    base64: bytes.toString('base64'), text: null, links: [], format: isPdf ? 'pdf' : isHtml ? 'html' : 'other', textStatus: 'unsupported' };
  if (isPdf) {
    try {
      const extracted = await pdfText(bytes);
      Object.assign(result, extracted);
      result.textStatus = extracted.truncated ? 'partial' : result.text.trim() ? 'available' : 'empty';
    } catch (error) {
      result.textStatus = 'failed';
      result.textError = error.message;
    }
  } else if (isHtml) {
    Object.assign(result, htmlContent(bytes.toString('utf8')));
    result.textStatus = result.text ? 'available' : 'empty';
  } else if (/^(?:text\/|application\/json)/i.test(contentType)) {
    result.text = bytes.toString('utf8').trim();
    result.format = 'text';
    result.textStatus = result.text ? 'available' : 'empty';
  }
  return result;
}
