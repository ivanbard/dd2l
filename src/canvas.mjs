import { randomBytes } from 'node:crypto';
import { canvasRuntime } from '../ui/canvas-runtime.js';
import { validCanvasState } from '../ui/canvas-contract.js';

export function canvasDocument() {
  const nonce = randomBytes(24).toString('base64');
  return {
    policy: `sandbox allow-scripts; default-src 'none'; script-src 'nonce-${nonce}' 'unsafe-eval'; worker-src blob:; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`,
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
      :root { color-scheme: dark; font-family: system-ui,sans-serif; color:#e8e9e6; background:#222; }
      * { box-sizing:border-box; } body { margin:0; overflow-wrap:anywhere; } #canvas { padding:20px; }
      button,input,select,textarea { font:inherit; } button { cursor:pointer; } :focus-visible { outline:2px solid #9bd1df; outline-offset:3px; }
      pre { white-space:pre-wrap; } svg { max-width:100%; } input,textarea,select { max-width:100%; }
      @media(prefers-reduced-motion:reduce) { *,*::before,*::after { animation:none!important; transition:none!important; } }
      </style><style id="generated-style"></style></head><body><main id="canvas"></main><script nonce="${nonce}">(${canvasRuntime.toString()})(${validCanvasState.toString()});</script></body></html>`,
  };
}
