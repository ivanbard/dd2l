import { DatabaseSync } from 'node:sqlite';
import { mkdir, open, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export function withoutCredentials(value) {
  return JSON.parse(JSON.stringify(value, (key, item) => {
    if (/^(?:access_token|refresh_token|authorization|cookie|csrfToken|xsrfToken)$/i.test(key)) return '[redacted]';
    if (typeof item === 'string') return item.replace(/([?&](?:amp;)?(?:d2lSessionVal|access_token|refresh_token|csrf|xsrf|token)=)[^&\s"'<>]*/gi, '$1[redacted]');
    return item;
  }));
}

export async function lock(directory) {
  await mkdir(directory, { recursive: true });
  const path = join(directory, 'worker.lock');
  const id = randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(path, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify({ pid: process.pid, id })); } finally { await handle.close(); }
      return async () => {
        const current = JSON.parse(await readFile(path, 'utf8'));
        if (current.id === id) await rm(path);
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let owner;
      try { owner = JSON.parse(await readFile(path, 'utf8')); } catch {}
      if (!owner?.pid || attempt) throw new Error('Another dd2l command owns this data directory.');
      try { process.kill(owner.pid, 0); }
      catch (error) {
        if (error.code === 'ESRCH') { await rm(path, { force: true }); continue; }
      }
      throw new Error('Another dd2l command is running. Stop it before starting this command.');
    }
  }
}

export class Store {
  constructor(directory) {
    this.db = new DatabaseSync(join(directory, 'inventory.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS resources (
        key TEXT PRIMARY KEY, course TEXT, category TEXT NOT NULL,
        data TEXT, last_success TEXT, checked_at TEXT NOT NULL, outcome TEXT NOT NULL,
        observation TEXT NOT NULL, last_source TEXT
      );`);
    // Preserve inventories created before source-window tracking was added.
    if (!this.db.prepare('PRAGMA table_info(resources)').all().some(column => column.name === 'last_source')) {
      this.db.exec('ALTER TABLE resources ADD COLUMN last_source TEXT');
    }
  }

  getMeta(key) {
    const row = this.db.prepare('SELECT value FROM meta WHERE key=?').get(key);
    return row ? JSON.parse(row.value) : null;
  }
  meta(key, value) { this.db.prepare('INSERT OR REPLACE INTO meta VALUES (?, ?)').run(key, JSON.stringify(value)); }

  commit(identity, origin, observations, summary, enrollments) {
    const account = `${origin}:${identity.Identifier}`;
    const previous = this.getMeta('account');
    if (previous && previous !== account) throw new Error('This data directory belongs to another school account. Sign out before switching accounts.');
    const stamp = new Date().toISOString();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.meta('account', account);
      for (const raw of observations) {
        const observation = withoutCredentials(raw);
        const successful = observation.outcome === 'available';
        const cleared = ['denied', 'not_configured'].includes(observation.outcome);
        const prior = this.db.prepare('SELECT data,last_success,last_source FROM resources WHERE key=?').get(observation.key);
        this.db.prepare('INSERT OR REPLACE INTO resources (key,course,category,data,last_success,checked_at,outcome,observation,last_source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
          observation.key, observation.course ?? null, observation.category,
          successful ? JSON.stringify(observation.data) : cleared ? null : prior?.data ?? null,
          successful ? stamp : cleared ? null : prior?.last_success ?? null,
          stamp, observation.outcome, JSON.stringify(observation),
          successful ? observation.source ?? null : cleared ? null : prior?.last_source ?? null);
      }
      // Only a complete, unfiltered enrollment read can establish loss of course access.
      if (enrollments?.complete) {
        const allowed = new Set(enrollments.data.filter(x => x.Access?.CanAccess !== false).map(x => String(x.OrgUnit.Id)));
        for (const row of this.db.prepare('SELECT DISTINCT course FROM resources WHERE course IS NOT NULL').all()) {
          if (!allowed.has(row.course)) this.db.prepare("UPDATE resources SET data=NULL,last_success=NULL,last_source=NULL,outcome='denied',observation=? WHERE course=?")
            .run(JSON.stringify({ outcome: 'denied', message: 'Course access is no longer confirmed by complete enrollments.' }), row.course);
        }
      }
      this.meta('last_run', summary);
      this.meta('state', { state: summary.retryAfter ? 'retry_wait' : 'ready', updatedAt: stamp });
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  status() {
    return { state: this.getMeta('state'), lastRun: this.getMeta('last_run'),
      resources: this.db.prepare('SELECT category,outcome,checked_at,last_success FROM resources ORDER BY category').all() };
  }
  clear() { this.db.exec('BEGIN; DELETE FROM resources; DELETE FROM meta; COMMIT;'); }
  close() { this.db.close(); }
}
