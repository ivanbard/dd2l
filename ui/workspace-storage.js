import { validComponentContext, componentSourceIds } from './component-contract.js';

export const validSavedWorkspace = record => !!record && /^[a-f0-9-]{36}$/.test(record.id) && /^[a-f0-9]{64}$/.test(record.scope) &&
  record.key === `${record.scope}:${record.id}` && Number.isSafeInteger(record.revision) && record.revision > 0 &&
  typeof record.updated === 'string' && Number.isFinite(Date.parse(record.updated)) &&
  typeof record.course === 'string' && (!record.course || /^\d+$/.test(record.course)) &&
  record.context && typeof record.context.goal === 'string' && record.context.goal.length <= 1000 &&
  Array.isArray(record.context.sourceIds) && record.context.sourceIds.length > 0 && record.context.sourceIds.length <= 24 &&
  record.context.sourceIds.every(id => /^[\w-]{24}$/.test(id)) &&
  validComponentContext({ program: record.program, state: record.state }) && componentSourceIds(record.program).every(id => record.context.sourceIds.includes(id));

export function createWorkspaceStore(scope) {
  if (!/^[a-f0-9]{64}$/.test(scope)) throw new Error('Saved work requires a school account or demo scope.');
  const database = new Promise((resolve, reject) => {
    const request = indexedDB.open('dd2l-workspaces-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('workspaces', { keyPath: 'key' });
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    request.onerror = () => reject(new Error('Browser storage could not open. Export your draft before leaving.'));
    request.onblocked = () => reject(new Error('Close other dd2l tabs to open saved work.'));
  });
  const run = async (mode, operation) => {
    const db = await database;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('workspaces', mode);
      let result, failure;
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = transaction.onerror = () => reject(failure || new Error('Your work could not be saved. Keep this page open and export your draft.'));
      const fail = error => { failure = error; transaction.abort(); };
      operation(transaction.objectStore('workspaces'), value => { result = value; }, fail);
    });
  };
  return {
    list: () => run('readonly', (store, done, fail) => {
      const request = store.getAll(IDBKeyRange.bound(`${scope}:`, `${scope}:\uffff`));
      request.onsuccess = () => {
        if (request.result.some(record => !validSavedWorkspace(record))) { fail(new Error('A saved workspace could not be verified. Its browser copy has been retained.')); return; }
        done(request.result.sort((a, b) => b.updated.localeCompare(a.updated)));
      };
    }),
    save: (record, revision) => run('readwrite', (store, done, fail) => {
      const key = `${scope}:${record.id}`;
      const request = store.get(key);
      request.onsuccess = () => {
        try {
          const existing = request.result;
          if ((existing?.revision || 0) !== revision) { fail(new Error('This workspace changed in another tab. Export your current draft, then reopen Saved work.')); return; }
          const next = { ...record, scope, key, revision: revision + 1, updated: new Date().toISOString() };
          if (!validSavedWorkspace(next)) { fail(new Error('The workspace could not be saved safely. Export your draft.')); return; }
          store.put(next); done(next);
        } catch { fail(new Error('Your work could not be saved. Keep this page open and export your draft.')); }
      };
    }),
    remove: (record) => run('readwrite', (store, done, fail) => {
      const request = store.get(`${scope}:${record.id}`);
      request.onsuccess = () => {
        if (request.result?.revision !== record.revision) { fail(new Error('The saved workspace changed. Refresh Saved work before deleting it.')); return; }
        store.delete(`${scope}:${record.id}`); done();
      };
    }),
  };
}

export function exportWorkspaceDraft(record) {
  const notes = record.program.sections.filter(section => section.type === 'notes').map(section => ({ title: section.title, text: record.state.values[section.id] }));
  const text = [record.program.title, record.state.draft, ...[...notes, ...record.state.archivedNotes].filter(note => note.text).map(note => `${note.title}\n${note.text}`)].join('\n\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = 'dd2l-draft.txt'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
