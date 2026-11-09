import { dirname, basename } from 'node:path';
import { Connector } from './connector.mjs';
import { BrightspaceClient, SCHOOL } from './client.mjs';
import { Session } from './session.mjs';
import { Store, lock } from './store.mjs';
import { matches } from '../ui/answer-view.js';

export const researchActions = { type: 'array', minItems: 0, maxItems: 2, items: { anyOf: [
  { type: 'object', additionalProperties: false, required: ['action', 'course', 'section', 'query'], properties: {
    action: { type: 'string', enum: ['browse'] }, course: { type: 'string', maxLength: 20 },
    section: { type: 'string', enum: ['courses', 'content', 'assignments', 'quizzes', 'announcements', 'grades', 'calendar', 'overview', 'discussions'] },
    query: { type: 'string', maxLength: 200 },
  } },
  { type: 'object', additionalProperties: false, required: ['action', 'resource'], properties: {
    action: { type: 'string', enum: ['read'] }, resource: { type: 'string', maxLength: 24 },
  } },
] } };

async function localBrowse(path, action, options) {
  if (basename(path) !== 'inventory.sqlite') throw new Error('Live reading requires the standard inventory cache.');
  const directory = dirname(path);
  let release;
  try { release = await lock(directory); }
  catch { throw Object.assign(new Error('Another dd2l command owns the inventory. Use the UI opened by dd2l start to share its connector.'), { code: 'busy' }); }
  let store;
  try {
    store = new Store(directory);
    const origin = store.getMeta('school_origin') || SCHOOL;
    const connector = new Connector(new BrightspaceClient(new Session(directory, { origin }), { origin }), store);
    return await connector.browse(action, options);
  } finally { store?.close(); await release(); }
}

// A request owns its discovered handles and budget; the model never supplies a network URL.
export function createResearch({ connector, inventoryPath, scope = '', accountScope = '', signal }) {
  const resources = new Map(), history = [], keys = new Set();
  let available = true, used = 0;
  return {
    history, keys,
    get available() { return available && used < 8; },
    get remaining() { return Math.max(0, 8 - used); },
    async execute(action) {
      signal?.throwIfAborted();
      if (!available || used >= 8) throw new Error('Live read budget is exhausted.');
      if (!matches([action], researchActions)) throw new Error('Invalid Brightspace read request.');
      used++;
      let result;
      try {
        const options = { scope, accountScope, resources, signal };
        result = connector ? await connector.browse(action, options) : await localBrowse(inventoryPath, action, options);
        for (const key of result.resourceKeys || []) keys.add(key);
        accountScope ||= result.accountScope || '';
        const { resourceKeys, accountScope: account, ...safe } = result;
        result = safe;
      } catch (error) {
        signal?.throwIfAborted();
        const stopped = !['denied', 'restricted', 'invalid_link', 'unavailable', 'partial', 'external_auth_required', 'unsupported_link'].includes(error.code);
        if (stopped) available = false;
        result = { outcome: error.code || 'busy', message: error.code === 'needs_login'
          ? 'School sign-in is required. Run setup again; cached sources may still be used.'
          : error.code === 'retry_wait' ? 'Brightspace is temporarily unavailable or rate limited. Further live reads stopped.'
            : error.code === 'busy' ? error.message
              : !stopped ? error.message : 'Live reading is unavailable. Cached evidence may still be used.',
          retryAfter: error.retryAfter || 0, resources: [] };
      }
      history.push({ action, result });
      return result;
    },
  };
}
