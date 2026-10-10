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
    CREATE INDEX IF NOT EXISTS snapshot_user ON snapshots(username, id);
    CREATE TABLE IF NOT EXISTS videos (
      username TEXT NOT NULL REFERENCES accounts(username) ON DELETE CASCADE,
      video_id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(username,video_id)
    );
    CREATE TABLE IF NOT EXISTS video_snapshots (
      id INTEGER PRIMARY KEY, username TEXT NOT NULL, video_id TEXT NOT NULL,
      captured_at TEXT NOT NULL, data TEXT NOT NULL,
      FOREIGN KEY(username,video_id) REFERENCES videos(username,video_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS video_snapshot_user ON video_snapshots(username,video_id,id);
    CREATE TABLE IF NOT EXISTS video_sync (
      username TEXT PRIMARY KEY REFERENCES accounts(username) ON DELETE CASCADE, data TEXT NOT NULL
    );`);
  const get = username => {
    const row = db.prepare('SELECT data FROM accounts WHERE username = ?').get(username);
    return row ? JSON.parse(row.data) : null;
  };
  const put = data => {
    db.prepare('INSERT INTO accounts(username,data) VALUES (?,?) ON CONFLICT(username) DO UPDATE SET data=excluded.data')
      .run(data.username, JSON.stringify(data));
    return data;
  };
  const getVideo = (username, id) => {
    const row = db.prepare('SELECT data FROM videos WHERE username=? AND video_id=?').get(username, id);
    return row ? JSON.parse(row.data) : null;
  };
  const putVideo = video => {
    db.prepare('INSERT INTO videos(username,video_id,data) VALUES (?,?,?) ON CONFLICT(username,video_id) DO UPDATE SET data=excluded.data')
      .run(video.username, video.id, JSON.stringify(video));
    return video;
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
    getVideo,
    listVideos: username => db.prepare('SELECT data FROM videos WHERE username=? ORDER BY video_id DESC').all(username).map(row => JSON.parse(row.data)),
    addVideo(username, id) {
      if (!get(username)) return null;
      return getVideo(username, id) || putVideo({ username, id, url: `https://www.tiktok.com/@${username}/video/${id}`,
        caption: '', cover: null, publishedAt: null, duration: null, views: null, likes: null, comments: null, shares: null, saves: null,
        createdAt: new Date().toISOString(), lastSuccessAt: null, lastMetadataAt: null, lastAttemptAt: null, syncError: null, syncCode: null });
    },
    videoSuccess(username, id, data) {
      const video = getVideo(username, id);
      if (!video) return null;
      const now = new Date().toISOString();
      if (data.metadataOnly || ['views','likes','comments','shares','saves'].every(key => data[key] == null)) {
        return putVideo({ ...video, caption: data.caption ?? video.caption, cover: data.cover ?? video.cover,
          publishedAt: data.publishedAt ?? video.publishedAt, duration: data.duration ?? video.duration,
          lastMetadataAt: now, lastAttemptAt: now, syncError: data.metricsError || 'Đã đọc thông tin video nhưng TikTok không cung cấp các chỉ số hiệu suất.', syncCode: 'METRICS_UNAVAILABLE' });
      }
      db.exec('BEGIN');
      try {
        const result = putVideo({ ...video, ...data, id, username, lastAttemptAt: now, lastMetadataAt: now, lastSuccessAt: now, syncError: null, syncCode: null });
        db.prepare('INSERT INTO video_snapshots(username,video_id,captured_at,data) VALUES (?,?,?,?)').run(username,id,now,JSON.stringify(data));
        db.prepare('DELETE FROM video_snapshots WHERE username=? AND video_id=? AND id NOT IN (SELECT id FROM video_snapshots WHERE username=? AND video_id=? ORDER BY id DESC LIMIT 100)').run(username,id,username,id);
        db.exec('COMMIT'); return result;
      } catch(error) { db.exec('ROLLBACK'); throw error; }
    },
    videoFailure(username, id, error) {
      const video = getVideo(username, id);
      return video ? putVideo({ ...video, lastAttemptAt: new Date().toISOString(), syncError: error.message, syncCode: error.code || 'FETCH_ERROR' }) : null;
    },
    videoHistory: (username, id) => db.prepare('SELECT captured_at,data FROM video_snapshots WHERE username=? AND video_id=? ORDER BY id DESC LIMIT 100')
      .all(username,id).map(row => ({ capturedAt: row.captured_at, ...JSON.parse(row.data) })),
    removeVideo: (username, id) => db.prepare('DELETE FROM videos WHERE username=? AND video_id=?').run(username,id).changes > 0,
    getVideoSync(username) {
      const row = db.prepare('SELECT data FROM video_sync WHERE username=?').get(username);
      return row ? JSON.parse(row.data) : { lastAttemptAt: null, lastSuccessAt: null, syncError: null, syncCode: null };
    },
    setVideoSync(username, changes) {
      if (!get(username)) return null;
      const row = db.prepare('SELECT data FROM video_sync WHERE username=?').get(username);
      const data = { ...(row ? JSON.parse(row.data) : {}), ...changes };
      db.prepare('INSERT INTO video_sync(username,data) VALUES (?,?) ON CONFLICT(username) DO UPDATE SET data=excluded.data').run(username,JSON.stringify(data));
      return data;
    },
    remove: username => db.prepare('DELETE FROM accounts WHERE username=?').run(username).changes > 0,
    close: () => db.close(),
  };
}
