import { tiktokPacer, retryAfterMs } from './pacer.js';

export class ProfileError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export function parseUsername(input) {
  if (typeof input !== 'string' || input.length > 2048) throw new ProfileError('INVALID_LINK', 'Hãy nhập link hồ sơ TikTok hoặc @username.');
  let value = input.trim();
  if (/^(?:https?:\/\/|www\.|tiktok\.com)/i.test(value)) {
    let url;
    try { url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`); }
    catch { throw new ProfileError('INVALID_LINK', 'Link hồ sơ không hợp lệ.'); }
    if (!['tiktok.com', 'www.tiktok.com'].includes(url.hostname) || url.username || url.password || url.port || !['https:', 'http:'].includes(url.protocol)) {
      throw new ProfileError('INVALID_LINK', 'Chỉ chấp nhận link hồ sơ trên tiktok.com.');
    }
    const match = url.pathname.match(/^\/@([A-Za-z0-9._]+)\/?$/);
    if (!match) throw new ProfileError('INVALID_LINK', 'Dùng link hồ sơ dạng https://www.tiktok.com/@username, không dùng link video.');
    value = match[1];
  } else value = value.replace(/^@/, '');
  if (!/^[A-Za-z0-9._]{2,24}$/.test(value) || value.endsWith('.')) {
    throw new ProfileError('INVALID_LINK', 'Username cần 2–24 ký tự: chữ, số, dấu chấm hoặc gạch dưới; không kết thúc bằng dấu chấm.');
  }
  return value.toLowerCase();
}

function count(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

export function extractProfile(html, username) {
  const scripts = html.matchAll(/<script\b[^>]*\bid\s*=\s*["'](__UNIVERSAL_DATA_FOR_REHYDRATION__|SIGI_STATE)["'][^>]*>([\s\S]*?)<\/script\s*>/gi);
  for (const [, id, content] of scripts) {
    let data;
    try { data = JSON.parse(content); } catch { continue; }
    let user, stats;
    if (id === '__UNIVERSAL_DATA_FOR_REHYDRATION__') {
      const info = data.__DEFAULT_SCOPE__?.['webapp.user-detail']?.userInfo;
      user = info?.user;
      stats = info?.stats || info?.statsV2;
    } else {
      user = Object.values(data.UserModule?.users || {}).find(u => u.uniqueId?.toLowerCase() === username.toLowerCase());
      stats = user && (data.UserModule?.stats?.[user.id] || data.UserModule?.stats?.[user.uniqueId]);
    }
    if (!user?.uniqueId || user.uniqueId.toLowerCase() !== username.toLowerCase()) continue;
    const safeAvatar = /^https:\/\//.test(user.avatarMedium || '') ? user.avatarMedium : null;
    return {
      displayName: String(user.nickname || user.uniqueId),
      bio: String(user.signature || ''), avatar: safeAvatar,
      verified: typeof user.verified === 'boolean' ? user.verified : null,
      privateAccount: typeof user.privateAccount === 'boolean' ? user.privateAccount : null,
      followers: count(stats?.followerCount), following: count(stats?.followingCount),
      likes: count(stats?.heartCount ?? stats?.heart), videos: count(stats?.videoCount),
    };
  }
  if (/captcha|verify you are human|security check/i.test(html)) {
    throw new ProfileError('TIKTOK_CHALLENGE', 'TikTok yêu cầu xác minh truy cập. Hãy mở hồ sơ và thử cập nhật lại sau.');
  }
  throw new ProfileError('PROFILE_UNAVAILABLE', 'Chưa đọc được dữ liệu hồ sơ. Tài khoản có thể không tồn tại hoặc TikTok đã chặn/thay đổi trang.');
}

export async function fetchPublicHtml(path, fetcher = fetch) {
  if (!/^\/(?:@[a-z0-9._]+(?:\/video\/\d+)?|embed\/(?:@[a-z0-9._]+|v2\/\d+)|oembed\?url=https%3A%2F%2Fwww\.tiktok\.com%2F%40[a-z0-9._]+%2Fvideo%2F\d+)$/.test(path)) {
    throw new ProfileError('INVALID_LINK', 'Đường dẫn TikTok không hợp lệ.');
  }
  let response;
  try {
    if(fetcher===fetch)await tiktokPacer.wait();
    response = await fetcher(`https://www.tiktok.com${path}`, {
      redirect: 'manual', signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html', 'Accept-Language': 'en-US,en;q=0.9' },
    });
  } catch {
    throw new ProfileError('NETWORK_ERROR', 'Không kết nối được TikTok. Kiểm tra mạng và quyền truy cập www.tiktok.com của môi trường.');
  }
  if(response.status===429){if(fetcher===fetch)tiktokPacer.cooldown(retryAfterMs(response.headers.get('retry-after')));throw new ProfileError('RATE_LIMITED','TikTok báo giới hạn 429. Đã tạm ngưng yêu cầu; chờ rồi thử lại.');}
  if (response.status === 403) {
    throw new ProfileError('ACCESS_BLOCKED', 'TikTok hoặc mạng từ chối truy cập (403/429). Tài khoản vẫn được lưu; thử lại sau.');
  }
  if (!response.ok) throw new ProfileError('HTTP_ERROR', `TikTok trả về HTTP ${response.status}. Chưa lấy được dữ liệu.`);
  if (!response.body) throw new ProfileError('PROFILE_UNAVAILABLE', 'TikTok trả về trang rỗng.');
  const reader = response.body.getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 4_000_000) throw new ProfileError('RESPONSE_TOO_LARGE', 'Trang hồ sơ vượt giới hạn xử lý.');
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof ProfileError) throw error;
    throw new ProfileError('NETWORK_ERROR', 'Kết nối bị ngắt khi đọc hồ sơ TikTok.');
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks).toString('utf8');
}

export async function fetchProfile(username, fetcher = fetch) {
  // Always construct the destination from a validated username; never fetch a supplied URL.
  username = parseUsername(username);
  return extractProfile(await fetchPublicHtml(`/@${username}`, fetcher), username);
}
