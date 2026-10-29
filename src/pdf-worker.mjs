import { parentPort, workerData } from 'node:worker_threads';
import { getDocumentProxy, extractText } from 'unpdf';

let document;
try {
  document = await getDocumentProxy(new Uint8Array(workerData));
  if (document.numPages > 250) throw new Error('page limit');
  const { text, totalPages } = await extractText(document, { mergePages: true });
  parentPort.postMessage({ text: text.slice(0, 1_000_000), pages: totalPages, truncated: text.length > 1_000_000 });
} catch {
  parentPort.postMessage({ error: 'PDF text extraction failed or exceeded the 250-page limit; bytes remain available.' });
} finally { await document?.destroy(); }
