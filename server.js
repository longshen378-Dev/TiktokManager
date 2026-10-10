import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { createStore } from './lib/store.js';
import { parseUsername, fetchProfile, ProfileError } from './lib/tiktok.js';

const root = dirname(fileURLToPath(import.meta.url));
const fields = ['username', 'displayName', 'profileUrl', 'followers', 'following', 'likes', 'videos', 'verified', 'privateAccount', 'bio', 'group', 'status', 'notes', 'lastSuccessAt', 'syncError'];
export function exportCsv(accounts) {
  const cell = value => {
    let text = value == null ? '' : String(value);
    if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return '\uFEFF' + [fields.join(','), ...accounts.map(account => fields.map(key => cell(account[key])).join(','))].join('\r\n');
}

async function jsonBody(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new ProfileError('BAD_REQUEST', 'Yêu cầu cần dữ liệu JSON.');
  let size = 0; const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64_000) throw new ProfileError('BAD_REQUEST', 'Dữ liệu quá lớn (tối đa 64 KB).');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString()); }
  catch { throw new ProfileError('BAD_REQUEST', 'JSON không hợp lệ.'); }
}

export function createApp({ store = createStore(process.env.DATA_FILE || join(root, 'data/accounts.sqlite')), profileFetcher = fetchProfile } = {}) {
  let queue = Promise.resolve();
  const running = new Map();
  function sync(username) {
    if (running.has(username)) return running.get(username);
    const pending = queue.then(async () => {
      if (!store.get(username)) return null;
      try { return store.success(username, await profileFetcher(username)); }
      catch (error) {
        const safeError = error instanceof ProfileError ? error : new ProfileError('FETCH_ERROR', 'Không thể cập nhật hồ sơ. Hãy thử lại sau.');
        return store.failure(username, safeError);
      }
    });
    running.set(username, pending);
    queue = pending.catch(() => {});
    pending.finally(() => running.delete(username)).catch(() => {});
    return pending;
  }
  const server = createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const send = (status, data) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(data));
    };
    try {
      const url = new URL(request.url, 'http://localhost');
      const path = url.pathname;
      if (!['GET', 'HEAD'].includes(request.method)) {
        const origin = request.headers.origin;
        if (request.headers['sec-fetch-site'] === 'cross-site' || (origin && origin !== `http://${request.headers.host}` && origin !== `https://${request.headers.host}`)) {
          return send(403, { error: 'Không chấp nhận yêu cầu từ website khác.' });
        }
      }
      if (request.method === 'GET' && path === '/api/health') return send(200, { ok: true, accounts: store.list().length });
      if (request.method === 'GET' && path === '/api/accounts') return send(200, { accounts: store.list() });
      if (request.method === 'GET' && path === '/api/export.csv') {
        response.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="tiktok-accounts.csv"', 'Cache-Control': 'no-store' });
        return response.end(exportCsv(store.list()));
      }
      if (request.method === 'POST' && path === '/api/accounts') {
        const body = await jsonBody(request);
        if (!Array.isArray(body.links) || body.links.length < 1 || body.links.length > 50) throw new ProfileError('BAD_REQUEST', 'Nhập từ 1 đến 50 link mỗi lần.');
        const usernames = [...new Set(body.links.map(parseUsername))];
        const results = usernames.map(username => ({ account: store.add(username) }));
        // Persist links immediately; sync is explicit so importing many accounts never blocks the UI.
        return send(201, { results });
      }
      const match = path.match(/^\/api\/accounts\/([^/]+)(?:\/(refresh|history))?$/);
      if (match) {
        const username = parseUsername(decodeURIComponent(match[1]));
        if (!store.get(username)) return send(404, { error: 'Không tìm thấy tài khoản.' });
        if (request.method === 'GET' && match[2] === 'history') return send(200, { history: store.history(username) });
        if (request.method === 'POST' && match[2] === 'refresh') {
          await jsonBody(request);
          const account = await sync(username);
          return account ? send(200, { account }) : send(404, { error: 'Tài khoản đã bị xóa.' });
        }
        if (request.method === 'PATCH' && !match[2]) {
          const body = await jsonBody(request); const changes = {};
          for (const [key, limit] of [['group', 80], ['notes', 5000]]) {
            if (key in body) {
              if (typeof body[key] !== 'string' || body[key].length > limit) throw new ProfileError('BAD_REQUEST', `${key} vượt giới hạn ${limit} ký tự.`);
              changes[key] = body[key].trim();
            }
          }
          if ('status' in body) {
            if (!['active', 'paused', 'review'].includes(body.status)) throw new ProfileError('BAD_REQUEST', 'Trạng thái không hợp lệ.');
            changes.status = body.status;
          }
          return send(200, { account: store.edit(username, changes) });
        }
        if (request.method === 'DELETE' && !match[2]) {
          await jsonBody(request); store.remove(username); return send(200, { ok: true });
        }
      }
      const staticFiles = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/styles.css': ['styles.css', 'text/css'] };
      if (request.method === 'GET' && staticFiles[path]) {
        const [file, type] = staticFiles[path];
        const content = await readFile(join(root, 'public', file));
        response.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` }); return response.end(content);
      }
      send(404, { error: 'Đường dẫn không tồn tại.' });
    } catch (error) {
      if (error instanceof ProfileError || error instanceof URIError) return send(400, { error: error.message });
      console.error('Request failed:', error.name);
      send(500, { error: 'Lỗi máy chủ. Vui lòng thử lại.' });
    }
  });
  server.requestTimeout = 30_000;
  return { server, store };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { server, store } = createApp();
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '127.0.0.1';
  server.listen(port, host, () => console.log(`TikTok Manager listening on ${host}:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(() => { store.close(); process.exit(0); }));
}
