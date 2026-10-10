import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { createStore } from './lib/store.js';
import { parseUsername, fetchProfile, ProfileError } from './lib/tiktok.js';
import { parseVideoLink, fetchVideo, discoverChannelVideos, engagementRate, summarizeVideos } from './lib/videos.js';
import { createBrowserScanner } from './lib/browser-scanner.js';
import { createScanManager } from './lib/scans.js';

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

export function exportVideosCsv(videos) {
  const keys = ['username', 'id', 'url', 'caption', 'publishedAt', 'duration', 'views', 'likes', 'comments', 'shares', 'saves', 'engagementRate', 'viewGrowth', 'growthSince', 'source', 'lastSuccessAt', 'lastMetadataAt', 'syncError'];
  const cell = value => {
    let text = value == null ? '' : String(value);
    if (/^\s*[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return '\uFEFF' + [keys.join(','), ...videos.map(video => keys.map(key => cell(video[key])).join(','))].join('\r\n');
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

export function createApp({ store = createStore(process.env.DATA_FILE || join(root, 'data/accounts.sqlite')), profileFetcher = fetchProfile,
  videoFetcher = fetchVideo, videoDiscoverer = discoverChannelVideos, browserScanner } = {}) {
  const browser=browserScanner||createBrowserScanner({dataDir:join(root,'data/browser-profile')});
  const defaultProviders=videoFetcher===fetchVideo&&videoDiscoverer===discoverChannelVideos;
  const useBrowser=defaultProviders&&process.env.TIKTOK_SCAN_MODE!=='http';
  const discover=(username,options)=>useBrowser?browser.discover(username,options):videoDiscoverer(username,videoDiscoverer===discoverChannelVideos?options?.fetcher:options);
  const refresh=(link,username,options)=>useBrowser?browser.video(link,username,options):videoFetcher(link,username,videoFetcher===fetchVideo?options?.fetcher:options);
  const scans=createScanManager({store,discover,refresh});
  let queue = Promise.resolve();
  const running = new Map();
  function queued(key, action) {
    if (running.has(key)) return running.get(key);
    const pending = queue.then(action);
    running.set(key, pending);
    queue = pending.catch(() => {});
    pending.finally(() => running.delete(key)).catch(() => {});
    return pending;
  }
  function sync(username) {
    return queued(`profile:${username}`, async () => {
      if (!store.get(username)) return null;
      try { return store.success(username, await profileFetcher(username)); }
      catch (error) {
        const safeError = error instanceof ProfileError ? error : new ProfileError('FETCH_ERROR', 'Không thể cập nhật hồ sơ. Hãy thử lại sau.');
        return store.failure(username, safeError);
      }
    });
  }
  function annotatedVideo(video) {
    const history = store.videoHistory(video.username, video.id);
    const previous = history[1];
    return { ...video, engagementRate: engagementRate(video),
      viewGrowth: previous?.views != null && history[0]?.views != null ? history[0].views - previous.views : null,
      growthSince: previous?.capturedAt || null };
  }
  function videoPayload(username, days = 0) {
    const videos = store.listVideos(username).map(annotatedVideo);
    return { videos, summary: summarizeVideos(videos, days), discovery: store.getVideoSync(username), scan:scans.state(username), browserAvailable:browser.available };
  }
  function syncVideo(username, id) {
    return queued(`video:${username}:${id}`, async () => {
      const video = store.getVideo(username,id);
      if (!video) return null;
      try { return store.videoSuccess(username,id,await refresh(video.url,username)); }
      catch (error) { return store.videoFailure(username,id,error instanceof ProfileError ? error : new ProfileError('FETCH_ERROR','Không cập nhật được video. Hãy thử lại sau.')); }
    });
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
      if (request.method === 'GET' && path === '/api/accounts') return send(200, { accounts: store.list().map(account=>({...account,videoScan:scans.state(account.username)})) });
      if (request.method === 'GET' && path === '/api/export.csv') {
        response.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="tiktok-accounts.csv"', 'Cache-Control': 'no-store' });
        return response.end(exportCsv(store.list()));
      }
      if (request.method === 'POST' && path === '/api/accounts') {
        const body = await jsonBody(request);
        if (!Array.isArray(body.links) || body.links.length < 1 || body.links.length > 50) throw new ProfileError('BAD_REQUEST', 'Nhập từ 1 đến 50 link mỗi lần.');
        const usernames = [...new Set(body.links.map(parseUsername))];
        if('scanVideos' in body&&typeof body.scanVideos!=='boolean')throw new ProfileError('BAD_REQUEST','Tùy chọn quét video cần là true hoặc false.');
        const newUsernames=usernames.filter(username=>!store.get(username));
        const results = usernames.map(username => ({ account: store.add(username) }));
        const scansStarted=body.scanVideos===true?newUsernames.map(username=>scans.start(username)):[];
        // Persist links immediately; sync is explicit so importing many accounts never blocks the UI.
        return send(201, { results,scansStarted });
      }
      const videoMatch = path.match(/^\/api\/accounts\/([^/]+)\/videos(?:\/(scan|discover|export\.csv|\d{10,22})(?:\/(refresh|history|metrics|cancel))?)?$/);
      if (videoMatch) {
        const username = parseUsername(decodeURIComponent(videoMatch[1]));
        if (!store.get(username)) return send(404, { error: 'Không tìm thấy tài khoản.' });
        const action = videoMatch[2]; const subaction = videoMatch[3];
        const days = Number(url.searchParams.get('days') || 0);
        if (![0,7,30,90].includes(days)) throw new ProfileError('BAD_REQUEST','Khoảng ngày không hợp lệ.');
        if (request.method === 'GET' && !action) return send(200,videoPayload(username,days));
        if(action==='scan') {
          if(request.method==='GET'&&!subaction)return send(200,{scan:scans.state(username)});
          if(request.method==='POST'&&!subaction){const body=await jsonBody(request);return send(202,{scan:scans.start(username,{delaySeconds:body.delaySeconds??5,limit:body.limit??50})});}
          if(request.method==='POST'&&subaction==='cancel'){await jsonBody(request);return send(200,{scan:scans.cancel(username)});}
        }
        if (request.method === 'GET' && action === 'export.csv' && !subaction) {
          const videos = store.listVideos(username).map(annotatedVideo).filter(video => !days || (video.publishedAt && Date.parse(video.publishedAt) >= Date.now() - days * 86_400_000 && Date.parse(video.publishedAt) <= Date.now()));
          response.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${username}-videos.csv"`, 'Cache-Control':'no-store' });
          return response.end(exportVideosCsv(videos));
        }
        if (request.method === 'POST' && !action) {
          const body = await jsonBody(request);
          if (!Array.isArray(body.links) || !body.links.length || body.links.length > 50) throw new ProfileError('BAD_REQUEST','Nhập từ 1 đến 50 link video mỗi lần.');
          const parsed = body.links.map(link => parseVideoLink(link,username));
          const ids = [...new Set(parsed.map(video => video.id))];
          ids.forEach(id => store.addVideo(username,id));
          return send(201,{ ...videoPayload(username,days), addedIds: ids });
        }
        if (request.method === 'POST' && action === 'discover' && !subaction) {
          await jsonBody(request);
          const result = await queued(`discover:${username}`, async () => {
            try {
              const found = await videoDiscoverer(username);
              if (!store.get(username)) return null;
              const parsed = found.links.map(link => parseVideoLink(link,username));
              const unique = [...new Map(parsed.map(video => [video.id,video])).values()];
              if (!unique.length) throw new ProfileError('VIDEO_LIST_UNAVAILABLE','Không lấy được danh sách video. Bạn có thể dán link video để theo dõi.');
              const selected = unique.slice(0,50);
              for (const video of selected) {
                store.addVideo(username,video.id);
                const data = found.videos.find(item => item.id === video.id);
                if (data) store.videoSuccess(username,video.id,data);
              }
              const now = new Date().toISOString();
              store.setVideoSync(username,{lastAttemptAt:now,lastSuccessAt:now,syncError:null,syncCode:null,source:found.source,discovered:unique.length,imported:selected.length});
              return { importedIds: selected.map(video => video.id), needsRefresh: selected.filter(video => !found.videos.some(item => item.id === video.id)).map(video => video.id), limited: true };
            } catch (error) {
              if (!store.get(username)) return null;
              const safe = error instanceof ProfileError ? error : new ProfileError('FETCH_ERROR','Không lấy được danh sách video.');
              store.setVideoSync(username,{lastAttemptAt:new Date().toISOString(),syncError:safe.message,syncCode:safe.code});
              return { importedIds: [], needsRefresh: [], limited: true };
            }
          });
          return result ? send(200,{ ...videoPayload(username,days), ...result }) : send(404,{error:'Tài khoản đã bị xóa.'});
        }
        if (/^\d+$/.test(action || '')) {
          const id = action;
          if (!store.getVideo(username,id)) return send(404,{error:'Video chưa được theo dõi.'});
          if (request.method === 'GET' && subaction === 'history') return send(200,{history:store.videoHistory(username,id)});
          if (request.method === 'POST' && subaction === 'refresh') {
            await jsonBody(request); const video = await syncVideo(username,id);
            return video ? send(200,{video:annotatedVideo(video)}) : send(404,{error:'Video đã bị xóa.'});
          }
          if (request.method === 'POST' && subaction === 'metrics') {
            const body = await jsonBody(request); const values = {};
            for (const key of ['views','likes','comments','shares','saves']) {
              const value = body[key] ?? null;
              if (value !== null && (!Number.isSafeInteger(value) || value < 0)) throw new ProfileError('BAD_REQUEST',`${key} phải là số nguyên không âm hoặc để trống.`);
              values[key] = value;
            }
            if (values.views == null) throw new ProfileError('BAD_REQUEST','Cần nhập lượt xem để lưu mốc theo dõi.');
            const video = store.videoSuccess(username,id,{ ...values, source:'manual' });
            return send(200,{video:annotatedVideo(video)});
          }
          if (request.method === 'DELETE' && !subaction) {
            await jsonBody(request);store.removeVideo(username,id);return send(200,{ok:true});
          }
        }
        return send(404,{error:'Đường dẫn video không tồn tại.'});
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
      const staticFiles = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/videos.js': ['videos.js', 'text/javascript'], '/styles.css': ['styles.css', 'text/css'] };
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
  server.on('close',()=>{scans.close();void browser.close().catch(()=>{});});
  return { server, store, scans };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { server, store } = createApp();
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '127.0.0.1';
  server.listen(port, host, () => console.log(`TikTok Manager listening on ${host}:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(() => { store.close(); process.exit(0); }));
}
