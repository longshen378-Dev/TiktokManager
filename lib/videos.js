import { parseUsername, fetchPublicHtml, ProfileError } from './tiktok.js';

export function parseVideoLink(input, expectedUsername) {
  let url;
  try { url = new URL(String(input).trim()); } catch { throw new ProfileError('INVALID_VIDEO_LINK', 'Dùng link đầy đủ https://www.tiktok.com/@username/video/ID.'); }
  const match = url.pathname.match(/^\/@([A-Za-z0-9._]+)\/video\/(\d{10,22})\/?$/);
  if (!['www.tiktok.com', 'tiktok.com'].includes(url.hostname) || !['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port || !match) {
    throw new ProfileError('INVALID_VIDEO_LINK', 'Chỉ chấp nhận link video đầy đủ trên tiktok.com.');
  }
  const username = parseUsername(match[1]);
  if (expectedUsername && username !== parseUsername(expectedUsername)) throw new ProfileError('VIDEO_ACCOUNT_MISMATCH', 'Link video phải thuộc tài khoản đang xem.');
  return { username, id: match[2], url: `https://www.tiktok.com/@${username}/video/${match[2]}` };
}

function hydration(html) {
  const results = [];
  for (const [, content] of html.matchAll(/<script\b[^>]*\bid\s*=\s*["'](?:__UNIVERSAL_DATA_FOR_REHYDRATION__|SIGI_STATE|__FRONTITY_CONNECT_STATE__)["'][^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    try { results.push(JSON.parse(content)); } catch { /* Try the next supported public script. */ }
  }
  return results;
}
function count(value) {
  if (!['number', 'string'].includes(typeof value) || String(value).trim() === '') return null;
  const result = Number(value);
  return Number.isSafeInteger(result) && result >= 0 ? result : null;
}
function https(value) { return typeof value === 'string' && value.startsWith('https://') ? value : null; }
function author(item) { return typeof item.author === 'string' ? item.author : item.author?.uniqueId || item.authorInfos?.uniqueId; }
function normalize(item, username, expectedId) {
  const id = String(item.id ?? item.itemInfos?.id ?? '');
  if (!/^\d{10,22}$/.test(id) || (expectedId && id !== expectedId)) return null;
  if (typeof (item.id ?? item.itemInfos?.id) === 'number' && !Number.isSafeInteger(item.id ?? item.itemInfos?.id)) return null;
  const owner = author(item);
  if (!owner || owner.toLowerCase() !== username) return null;
  const stats = [item.statsV2, item.stats, item.itemInfos].filter(Boolean);
  const metric = (camel, snake) => stats.map(source => count(source[camel] ?? source[snake])).find(value => value != null) ?? null;
  const video = item.video || item.videoMeta || {};
  const seconds = count(item.createTime ?? item.itemInfos?.createTime);
  const duration = Number(video.duration ?? item.itemInfos?.video?.duration);
  const publishedAt = seconds && seconds < 8_640_000_000_000 ? new Date(seconds * 1000).toISOString() : null;
  return { id, username, url: `https://www.tiktok.com/@${username}/video/${id}`, source: 'public-page',
    caption: String(item.desc ?? item.itemInfos?.text ?? ''), publishedAt,
    duration: Number.isFinite(duration) && duration >= 0 ? duration : null,
    cover: https(video.cover || video.originCover || item.itemInfos?.covers?.[0]),
    views: metric('playCount','play_count'), likes: metric('diggCount','digg_count'),
    comments: metric('commentCount','comment_count'), shares: metric('shareCount','share_count'),
    saves: metric('collectCount','collect_count'),
  };
}

export function extractChannelVideoData(data, username) {
  const objects = [
    ...(Array.isArray(data.itemList) ? data.itemList : []),
    ...(Array.isArray(data.item_list) ? data.item_list : []),
    ...(Array.isArray(data.data?.itemList) ? data.data.itemList : []),
    data.itemInfo?.itemStruct, data.item_info?.item_struct,
    ...candidates(data, username),
  ].filter(Boolean);
  return objects.map(item => normalize(item, username)).filter(Boolean);
}

function candidates(data, username) {
  const scope = data.__DEFAULT_SCOPE__ || {};
  const detail = scope['webapp.video-detail']?.itemInfo?.itemStruct;
  const userInfo = scope['webapp.user-detail']?.userInfo;
  const post = scope['webapp.user-post'];
  const result = [detail, ...Object.values(data.ItemModule || {}), ...(userInfo?.itemList || []), ...(post?.itemList || [])].filter(Boolean);
  for (const [path, state] of Object.entries(data.source?.data || {})) {
    if (path === `/embed/@${username}` || path.startsWith('/embed/v2/')) {
      if (Array.isArray(state.videoList)) result.push(...state.videoList);
      if (state.videoData) result.push(state.videoData);
    }
  }
  return result;
}

export function extractVideo(html, username, id) {
  username = parseUsername(username);
  for (const data of hydration(html)) {
    for (const item of candidates(data, username)) {
      const video = normalize(item, username, id);
      if (video) return video;
    }
  }
  if (/captcha|verify you are human|security check|wafchallenge|SlardarWAF/i.test(html)) throw new ProfileError('TIKTOK_CHALLENGE', 'TikTok yêu cầu xác minh. Chưa đọc được chỉ số video; thử lại sau.');
  throw new ProfileError('VIDEO_UNAVAILABLE', 'Chưa đọc được video hoặc chưa xác minh được video thuộc kênh. TikTok có thể đã giới hạn truy cập.');
}

export function extractChannelVideos(html, username) {
  username = parseUsername(username);
  const videos = new Map(), links = new Map();
  for (const data of hydration(html)) {
    for (const item of candidates(data, username)) {
      const video = normalize(item, username);
      if (video) { videos.set(video.id, video); links.set(video.id, video.url); }
    }
  }
  for (const match of html.matchAll(/(?:https:\/\/www\.tiktok\.com)?\/@([A-Za-z0-9._]+)\/video\/(\d{10,22})/g)) {
    if (match[1].toLowerCase() === username) links.set(match[2], `https://www.tiktok.com/@${username}/video/${match[2]}`);
  }
  return { videos: [...videos.values()], links: [...links.values()] };
}

export async function fetchVideo(link, username, fetcher = fetch) {
  const parsed = parseVideoLink(link, username);
  let primaryError;
  try {
    const html = await fetchPublicHtml(`/@${parsed.username}/video/${parsed.id}`, fetcher);
    return { ...extractVideo(html, parsed.username, parsed.id), source: 'public-page' };
  } catch (error) { primaryError = error; }
  // Official oEmbed can still identify the video when its regular page is blocked.
  // It supplies metadata, never performance counters. Do not infer counters from it.
  try {
    const raw = await fetchPublicHtml(`/oembed?url=${encodeURIComponent(parsed.url)}`, fetcher);
    const data = JSON.parse(raw);
    if (data.type !== 'video' || !data.author_url || parseUsername(data.author_url) !== parsed.username ||
        !String(data.html || '').includes(`data-video-id="${parsed.id}"`)) throw new Error('Unverified oEmbed');
    return { ...parsed, caption: String(data.title || ''), cover: https(data.thumbnail_url),
      metadataOnly: true, metricsError: 'Đã lấy mô tả/ảnh từ oEmbed, nhưng chưa lấy được lượt xem và tương tác. ' + primaryError.message,
      source: 'oembed' };
  } catch { throw primaryError; }
}

export async function discoverChannelVideos(username, fetcher = fetch) {
  username = parseUsername(username);
  const profile = extractChannelVideos(await fetchPublicHtml(`/@${username}`, fetcher), username);
  if (profile.links.length) return { ...profile, source: 'profile' };
  const embed = extractChannelVideos(await fetchPublicHtml(`/embed/@${username}`, fetcher), username);
  if (embed.links.length) return { ...embed, source: 'creator-embed' };
  throw new ProfileError('VIDEO_LIST_UNAVAILABLE', 'TikTok không trả về danh sách video trong trang công khai. Dán link video bên dưới để theo dõi; không thể kết luận kênh không có video.');
}

export function engagementRate(video) {
  if (!(video.views > 0) || ['likes', 'comments', 'shares'].some(key => video[key] == null)) return null;
  return (video.likes + video.comments + video.shares) / video.views * 100;
}

export function summarizeVideos(videos, days = 0, now = Date.now()) {
  const selected = videos.filter(video => !days || (video.publishedAt && Date.parse(video.publishedAt) >= now - days * 86_400_000 && Date.parse(video.publishedAt) <= now));
  const result = { tracked: videos.length, selected: selected.length, dateUnknown: videos.filter(v => !v.publishedAt).length, days,
    totals: {}, coverage: {}, averageViews: null, medianViews: null, engagementRate: null, engagementCoverage: 0, bestVideo: null };
  for (const key of ['views', 'likes', 'comments', 'shares', 'saves']) {
    const known = selected.filter(video => video[key] != null);
    result.coverage[key] = known.length;
    result.totals[key] = known.length ? known.reduce((sum, video) => sum + video[key], 0) : null;
  }
  const viewed = selected.filter(v => v.views != null).sort((a,b) => a.views - b.views);
  if (viewed.length) {
    result.averageViews = result.totals.views / viewed.length;
    const middle = Math.floor(viewed.length / 2);
    result.medianViews = viewed.length % 2 ? viewed[middle].views : (viewed[middle - 1].views + viewed[middle].views) / 2;
    result.bestVideo = viewed.at(-1);
  }
  const complete = selected.filter(video => engagementRate(video) != null);
  result.engagementCoverage = complete.length;
  if (complete.length) result.engagementRate = complete.reduce((sum,v) => sum + v.likes + v.comments + v.shares, 0) / complete.reduce((sum,v) => sum + v.views, 0) * 100;
  return result;
}
