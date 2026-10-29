import { parentPort, workerData } from 'node:worker_threads';
import { getDocumentProxy, extractText, renderPageAsImage } from 'unpdf';

let document;
try {
  document = await getDocumentProxy(new Uint8Array(workerData));
  if (document.numPages > 250) throw new Error('page limit');
  const { text: pageTexts, totalPages } = await extractText(document, { mergePages: false });
  const images = [];
  const links = [];
  let ocrLimited = false;
  for (let index = 0; index < pageTexts.length; index++) {
    const page = await document.getPage(index + 1);
    for (const annotation of await page.getAnnotations()) if (annotation.url && links.length < 200) links.push({ url: annotation.url, label: '', page: index + 1 });
    if (pageTexts[index].trim()) continue;
    if (!(await page.getOperatorList()).fnArray.length) continue;
    const viewport = page.getViewport({ scale: 1.5 });
    if (images.length === 10 || viewport.width * viewport.height > 16_000_000) { ocrLimited = true; continue; }
    images.push({ index, bytes: await renderPageAsImage(document, index + 1, { scale: 1.5, canvasImport: () => import('@napi-rs/canvas') }) });
  }
  const text = pageTexts.join('\n\n');
  parentPort.postMessage({ text: text.slice(0, 1_000_000), pageTexts: pageTexts.map(value => value.slice(0, 1_000_000)),
    pages: totalPages, truncated: text.length > 1_000_000 || ocrLimited, ocrLimited, images, links });
} catch {
  parentPort.postMessage({ error: 'PDF text extraction failed or exceeded the 250-page limit; bytes remain available.' });
} finally { await document?.loadingTask?.destroy(); }
