import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { Parser } from 'htmlparser2';
import { AccessError } from './client.mjs';
import { officeText } from './office.mjs';
import { recognizeImage } from './ocr.mjs';

export function htmlContent(html) {
  html = String(html || '');
  let mainStart = -1, mainEnd, depth = 0, elements = 0;
  const scan = new Parser({ onopentag(name, attrs) {
    if (++elements > 100_000) throw new AccessError('partial', 'HTML exceeds the extraction element limit.');
    if (mainStart < 0 && (name === 'main' || attrs.role === 'main')) { mainStart = scan.startIndex; depth = 1; }
    else if (depth) depth++;
  }, onclosetag() { if (depth && --depth === 0) mainEnd = scan.endIndex + 1; } });
  scan.end(html);
  if (mainStart >= 0) html = html.slice(mainStart, mainEnd);
  const parts = [];
  const links = [];
  const block = new Set(['p', 'div', 'br', 'li', 'tr', 'td', 'th', 'h1', 'h2', 'h3', 'h4', 'section']);
  const ignored = new Set(['head', 'script', 'style', 'template', 'noscript', 'nav', 'footer']);
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
      if (size > 20 * 1024 * 1024) throw new AccessError('partial', 'Document exceeds the 20 MiB read limit.');
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof AccessError) throw error;
    throw new AccessError('retry_wait', 'Document body read failed or timed out.');
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = Buffer.concat(chunks);
  const isPdf = bytes.subarray(0, 5).toString() === '%PDF-' || /application\/pdf/i.test(contentType);
  const isHtml = /(?:text\/html|application\/xhtml\+xml)/i.test(contentType);
  const isOffice = /openxmlformats|msword|ms-excel|ms-powerpoint/i.test(contentType) || bytes.subarray(0, 2).toString() === 'PK';
  if (isHtml && bytes.toString().includes('/d2l/login?sessionExpired=1')) throw new AccessError('needs_login', 'School session has expired.');
  const result = { contentType, size, sha256: createHash('sha256').update(bytes).digest('hex'),
    base64: size <= 2 * 1024 * 1024 ? bytes.toString('base64') : undefined, bytesRetained: size <= 2 * 1024 * 1024,
    text: null, links: [], resolvedUrl: response.url || undefined,
    format: isPdf ? 'pdf' : isHtml ? 'html' : 'other', textStatus: 'unsupported' };
  if (isPdf) {
    try {
      const extracted = await pdfText(bytes);
      const { images, pageTexts, ...metadata } = extracted;
      let ocrFailed = false;
      let ocrPages = 0;
      for (const image of images) {
        try { pageTexts[image.index] = await recognizeImage(image.bytes); ocrPages++; }
        catch (error) { ocrFailed = true; result.textError = error.message; break; }
      }
      if (images.length) {
        metadata.text = pageTexts.join('\n\n').slice(0, 1_000_000);
        metadata.ocrPages = ocrPages;
        metadata.ocrPendingPages = images.length - ocrPages;
        metadata.needsReview = true;
        metadata.extractionMethod = 'embedded_text_and_windows_ocr';
      }
      if (ocrFailed) metadata.truncated = true;
      Object.assign(result, metadata);
      result.textStatus = metadata.truncated ? 'partial' : result.text.trim() ? 'available' : 'empty';
    } catch (error) {
      result.textStatus = 'failed';
      result.textError = error.message;
    }
  } else if (isOffice) {
    try {
      Object.assign(result, officeText(bytes));
      result.textStatus = result.truncated ? 'partial' : result.text ? 'available' : 'empty';
    } catch (error) {
      result.textStatus = /No supported/.test(error.message) ? 'unsupported' : 'failed';
      result.format = result.textStatus === 'unsupported' ? 'archive' : 'other';
      result.textError = result.textStatus === 'unsupported' ? 'Archive has no supported Office document parts; archive contents were not extracted.' :
        'Office extraction failed, exceeded safety limits, or uses a legacy binary format; export to DOCX/PPTX/XLSX or PDF.';
    }
  } else if (/^image\/(?:png|jpeg|bmp|tiff)/i.test(contentType)) {
    try {
      result.text = await recognizeImage(bytes);
      Object.assign(result, { format: 'image', extractionMethod: 'windows_ocr', needsReview: true, textStatus: result.text ? 'available' : 'empty' });
    } catch (error) { result.textStatus = 'failed'; result.textError = error.message; }
  } else if (isHtml) {
    Object.assign(result, htmlContent(bytes.toString('utf8')));
    result.textStatus = result.text ? 'available' : 'empty';
  } else if (/^(?:text\/|application\/json)/i.test(contentType)) {
    const text = bytes.toString('utf8').trim();
    result.text = text.slice(0, 1_000_000);
    result.format = 'text';
    result.textStatus = text.length > 1_000_000 ? 'partial' : result.text ? 'available' : 'empty';
  }
  if (result.text?.length > 1_000_000) { result.text = result.text.slice(0, 1_000_000); result.textStatus = 'partial'; result.truncated = true; }
  if (result.links.length > 200) { result.links = result.links.slice(0, 200); result.linksLimited = true; }
  return result;
}
