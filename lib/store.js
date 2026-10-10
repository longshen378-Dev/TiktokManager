import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function createStore(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS accounts (username TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY, username TEXT NOT NULL REFERENCES accounts(username) ON DELETE CASCADE,
      captured_at TEXT NOT NULL, data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS snapshot_user ON snapshots(username, id);`);
  const get = username => {
    const row = db.prepare('SELECT data FROM accounts WHERE username = ?').get(username);
    return row ? JSON.parse(row.data) : null;
  };
  const put = data => {
    db.prepare('INSERT INTO accounts(username,data) VALUES (?,?) ON CONFLICT(username) DO UPDATE SET data=excluded.data')
      .run(data.username, JSON.stringify(data));
    return data;
  };
  return {
    get,
    list: () => db.prepare('SELECT data FROM accounts ORDER BY username').all().map(row => JSON.parse(row.data)),
    add(username) {
      const existing = get(username);
      if (existing) return existing;
      return put({ username, profileUrl: `https://www.tiktok.com/@${username}`, displayName: null, bio: null,
        avatar: null, verified: null, privateAccount: null, followers: null, following: null, likes: null, videos: null,
        group: '', notes: '', status: 'active', createdAt: new Date().toISOString(),
        lastAttemptAt: null, lastSuccessAt: null, syncError: null, syncCode: null });
    },
    edit(username, updates) {
      const account = get(username);
      return account ? put({ ...account, ...updates }) : null;
    },
    success(username, profile) {
      const account = get(username);
      if (!account) return null;
      const now = new Date().toISOString();
      db.exec('BEGIN');
      try {
        const updated = put({ ...account, ...profile, lastAttemptAt: now, lastSuccessAt: now, syncError: null, syncCode: null });
        db.prepare('INSERT INTO snapshots(username,captured_at,data) VALUES (?,?,?)').run(username, now, JSON.stringify(profile));
        db.prepare('DELETE FROM snapshots WHERE username=? AND id NOT IN (SELECT id FROM snapshots WHERE username=? ORDER BY id DESC LIMIT 200)').run(username, username);
        db.exec('COMMIT'); return updated;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    failure(username, error) {
      const account = get(username);
      return account ? put({ ...account, lastAttemptAt: new Date().toISOString(), syncError: error.message, syncCode: error.code || 'FETCH_ERROR' }) : null;
    },
    history: username => db.prepare('SELECT captured_at, data FROM snapshots WHERE username=? ORDER BY id DESC LIMIT 200').all(username)
      .map(row => ({ capturedAt: row.captured_at, ...JSON.parse(row.data) })),
    remove: username => db.prepare('DELETE FROM accounts WHERE username=?').run(username).changes > 0,
    close: () => db.close(),
  };
}
