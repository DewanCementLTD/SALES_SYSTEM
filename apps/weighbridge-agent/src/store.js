// Local store of the agent (node:sqlite, no native dependency): captured readings waiting for
// upload (kept after upload for 30 days, for checks) and the last device configuration from the
// server (used when the API is not reachable at start-up).
import { DatabaseSync } from 'node:sqlite';

export class AgentStore {
  /** @param {string} file path, or ':memory:' in tests */
  constructor(file) {
    this.db = new DatabaseSync(file);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS reading (
        reading_id TEXT PRIMARY KEY,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL,
        tries INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        uploaded_at TEXT,
        failed INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
    `);
  }

  add(body, now = new Date()) {
    this.db
      .prepare('INSERT OR IGNORE INTO reading (reading_id, body, created_at) VALUES (?, ?, ?)')
      .run(body.readingId, JSON.stringify(body), now.toISOString());
  }

  /** Oldest first; failed ones (refused by the API) are not retried. */
  pending(limit = 20) {
    return this.db
      .prepare(
        'SELECT reading_id, body FROM reading WHERE uploaded_at IS NULL AND failed = 0 ORDER BY created_at LIMIT ?',
      )
      .all(limit)
      .map((r) => JSON.parse(String(r.body)));
  }

  uploaded(readingId, now = new Date()) {
    this.db
      .prepare(
        'UPDATE reading SET uploaded_at = ?, tries = tries + 1, last_error = NULL WHERE reading_id = ?',
      )
      .run(now.toISOString(), readingId);
  }

  /** @param {boolean} permanent the API refused it (4xx): stop retrying */
  error(readingId, message, permanent) {
    this.db
      .prepare(
        'UPDATE reading SET tries = tries + 1, last_error = ?, failed = ? WHERE reading_id = ?',
      )
      .run(String(message).slice(0, 500), permanent ? 1 : 0, readingId);
  }

  counts() {
    const r = this.db
      .prepare(
        `SELECT SUM(CASE WHEN uploaded_at IS NULL AND failed = 0 THEN 1 ELSE 0 END) AS pending,
                SUM(failed) AS failed FROM reading`,
      )
      .get();
    return { pending: Number(r.pending ?? 0), failed: Number(r.failed ?? 0) };
  }

  purge(days = 30, now = new Date()) {
    const cut = new Date(now.getTime() - days * 86400000).toISOString();
    this.db
      .prepare('DELETE FROM reading WHERE uploaded_at IS NOT NULL AND uploaded_at < ?')
      .run(cut);
  }

  get(k) {
    const r = this.db.prepare('SELECT v FROM kv WHERE k = ?').get(k);
    return r ? JSON.parse(String(r.v)) : null;
  }

  set(k, v) {
    this.db.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)').run(k, JSON.stringify(v));
  }

  close() {
    this.db.close();
  }
}
