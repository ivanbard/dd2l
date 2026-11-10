import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

export async function componentDocument() {
  const [js, css] = await Promise.all(['js', 'css'].map(extension => readFile(new URL(`../ui/assets/workspace.${extension}`, import.meta.url), 'utf8')));
  const nonce = randomBytes(24).toString('base64');
  return { policy: `sandbox allow-scripts; default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; frame-ancestors 'self'; form-action 'none'; base-uri 'none'`,
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css.replaceAll('</style', '<\\/style')}</style></head><body><main id="root"></main><script nonce="${nonce}">${js.replaceAll('</script', '<\\/script')}</script></body></html>` };
}
