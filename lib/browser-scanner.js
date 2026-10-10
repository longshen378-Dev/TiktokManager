import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseUsername, ProfileError } from './tiktok.js';
import { parseVideoLink, extractChannelVideos, extractChannelVideoData } from './videos.js';
import { tiktokPacer, retryAfterMs } from './pacer.js';

export function findBrowser() {
  const paths = [process.env.TIKTOK_BROWSER_PATH,
    process.env.PROGRAMFILES && join(process.env.PROGRAMFILES,'Google/Chrome/Application/chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && join(process.env['PROGRAMFILES(X86)'],'Microsoft/Edge/Application/msedge.exe'),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA,'Google/Chrome/Application/chrome.exe'),
    'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser'];
  return paths.find(path => path && existsSync(path)) || null;
}
export function createBrowserScanner({ dataDir, browserPath = findBrowser(), headless = process.env.TIKTOK_HEADLESS === '1' ||
  (process.platform === 'linux' && !process.env.DISPLAY), pacer = tiktokPacer,
  launchContext = (directory,options)=>chromium.launchPersistentContext(directory,options) } = {}) {
  let context, opening;
  async function open() {
    if (!browserPath) throw new ProfileError('BROWSER_NOT_FOUND','Cần cài Chrome hoặc Edge trên máy chạy công cụ để tự quét video.');
    if (context) return context;
    if (opening) return opening;
    opening = (async () => {
      mkdirSync(dataDir,{recursive:true});
      const options = { executablePath: browserPath, headless, ignoreHTTPSErrors: false,
        ...(process.getuid?.() === 0 ? { args:['--no-sandbox'] } : {}) };
      const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
      if (proxy) {
        const url = new URL(proxy);
        options.proxy = { server:`${url.protocol}//${url.hostname}${url.port?':'+url.port:''}`,
          ...(url.username ? {username:decodeURIComponent(url.username),password:decodeURIComponent(url.password)} : {}) };
      }
      try {
        context = await launchContext(dataDir,options);
        context.on('close',()=>context=null);
        return context;
      } catch { throw new ProfileError('BROWSER_START_FAILED','Không mở được Chrome/Edge. Đóng phiên quét cũ, kiểm tra trình duyệt đã cài và thử lại.'); }
    })();
    try { return await opening; } finally { opening=null; }
  }
  async function read(username,{id=null,limit=50,delayMs=5000,signal,onProgress=()=>{},onVideo=()=>{}}={}) {
    username=parseUsername(username);
    const ctx=await open();const page=await ctx.newPage();const videos=new Map(),links=new Map(),pending=new Set();
    let rateError=null,hasMore=true;
    const emit=updates=>onProgress({found:links.size,withMetrics:[...videos.values()].filter(v=>v.views!=null).length,...updates});
    const collect=data=>{
      for(const video of extractChannelVideoData(data,username)) {
        if(id&&video.id!==id)continue;
        if(!links.has(video.id)&&links.size>=limit)continue;
        const value={...video,source:'browser'};
        const old=videos.get(video.id);
        // A later metadata-only response must not erase counters already seen during this scan.
        if(old?.views!=null&&value.views==null)continue;
        videos.set(video.id,value);links.set(video.id,video.url);
        if(JSON.stringify(old)!==JSON.stringify(value))onVideo(value);
      }
      if(typeof data.hasMore==='boolean')hasMore=data.hasMore;
      emit({phase:'collecting',message:'Đang đọc danh sách và chỉ số video từ trang TikTok.'});
    };
    page.on('response',response=>{
      const url=new URL(response.url());
      if(url.hostname!=='www.tiktok.com'||!url.pathname.startsWith('/api/'))return;
      if(response.status()===429){const ms=retryAfterMs(response.headers()['retry-after']);pacer.cooldown(ms);rateError=new ProfileError('RATE_LIMITED','TikTok báo giới hạn 429. Đã dừng quét; chờ thời gian nghỉ rồi thử lại.');return;}
      if(!response.headers()['content-type']?.includes('json'))return;
      if(Number(response.headers()['content-length']||0)>4_000_000)return;
      const task=response.json().then(collect).catch(()=>{}).finally(()=>pending.delete(task));pending.add(task);
    });
    const wait=()=>pacer.wait({delayMs,signal,onWait:nextAt=>emit({phase:'waiting',nextAt,message:'Đang nghỉ giữa các lượt tải để giảm số yêu cầu.'})});
    const cancelled=()=>{if(signal?.aborted)throw new ProfileError('SCAN_CANCELLED','Đã dừng quét theo yêu cầu.');};
    const abort=()=>void page.close().catch(()=>{});
    signal?.addEventListener('abort',abort,{once:true});
    try {
      await wait();cancelled();emit({phase:'opening',message:'Đang mở trang TikTok bằng trình duyệt.'});
      try {
        const response=await page.goto(id?`https://www.tiktok.com/@${username}/video/${id}`:`https://www.tiktok.com/@${username}`,{waitUntil:'domcontentloaded',timeout:30_000});
        if(response?.status()===429){pacer.cooldown(retryAfterMs(response.headers()['retry-after']));throw new ProfileError('RATE_LIMITED','TikTok báo giới hạn 429. Đã dừng quét.');}
      } catch(error) {
        if(error instanceof ProfileError)throw error;
        if(/ERR_CERT_AUTHORITY_INVALID|ERR_CERT_/i.test(error.message))throw new ProfileError('BROWSER_TLS_ERROR','Trình duyệt chưa tin cậy chứng chỉ của proxy cloud. Không tắt xác minh TLS. Hãy chạy trên máy cá nhân hoặc cấu hình CA được phê duyệt.');
        throw new ProfileError('BROWSER_NETWORK_ERROR','Không tải được TikTok trong trình duyệt. Kiểm tra mạng hoặc proxy trên máy chạy công cụ.');
      }
      let unchanged=0;
      for(let step=0;step<Math.min(30,Math.ceil(limit/8)+6);step++) {
        cancelled();if(rateError)throw rateError;
        const html=await page.content();
        const embedded=extractChannelVideos(html,username);
        embedded.videos.forEach(video=>collect({itemList:[{id:video.id,author:{uniqueId:username},desc:video.caption,createTime:video.publishedAt?Date.parse(video.publishedAt)/1000:null,video:{duration:video.duration,cover:video.cover},stats:{playCount:video.views,diggCount:video.likes,commentCount:video.comments,shareCount:video.shares,collectCount:video.saves}}]}));
        for(const link of [...embedded.links,...await page.locator('a[href*="/video/"]').evaluateAll(elements=>elements.map(element=>element.href))]) {
          try{const parsed=parseVideoLink(link,username);if((!id||parsed.id===id)&&(links.has(parsed.id)||links.size<limit))links.set(parsed.id,parsed.url);}catch{}
        }
        await Promise.allSettled([...pending]);
        const challenge=/wafchallenge|SlardarWAF|verify you are human|security verification|captcha-verify-container/i.test(html);
        if(challenge&&!videos.size) {
          if(headless)throw new ProfileError('BROWSER_VERIFICATION_REQUIRED','TikTok yêu cầu xác minh trong trình duyệt. Chạy công cụ trên máy cá nhân, hoàn tất xác minh rồi quét lại.');
          emit({phase:'verification',message:'TikTok yêu cầu xác minh. Hoàn tất trong cửa sổ Chrome/Edge đang mở; công cụ chờ tối đa 2 phút.'});
          const until=Date.now()+120_000;
          while(Date.now()<until){cancelled();await new Promise(resolve=>setTimeout(resolve,1000));const current=await page.content();if(!/wafchallenge|SlardarWAF|verify you are human|security verification|captcha-verify-container/i.test(current))break;}
          if(/wafchallenge|SlardarWAF|verify you are human|security verification|captcha-verify-container/i.test(await page.content()))throw new ProfileError('BROWSER_VERIFICATION_REQUIRED','Chưa hoàn tất xác minh TikTok. Quét đã dừng; thử lại sau khi xác minh.');
          continue;
        }
        emit({phase:'collecting',nextAt:null,message:`Đã tìm ${links.size} video, ${[...videos.values()].filter(v=>v.views!=null).length} có lượt xem.`});
        if(id&&videos.has(id))break;
        if(links.size>=limit||(!hasMore&&videos.size))break;
        const size=links.size;
        await wait();cancelled();await page.evaluate(()=>window.scrollBy(0,innerHeight*1.5));
        await new Promise(resolve=>setTimeout(resolve,700));await Promise.allSettled([...pending]);
        if(links.size===size)unchanged++;else unchanged=0;
        if(unchanged>=4)break;
      }
      await Promise.allSettled([...pending]);
      if(rateError)throw rateError;
      if(!links.size)throw new ProfileError('VIDEO_LIST_UNAVAILABLE','Trang TikTok chưa cung cấp danh sách video cho trình duyệt. Có thể cần xác minh hoặc tài khoản bị giới hạn.');
      if(id&&!videos.has(id))throw new ProfileError('VIDEO_UNAVAILABLE','Đã mở video nhưng TikTok chưa cung cấp chỉ số.');
      return {videos:[...videos.values()],links:[...links.values()],source:'browser',limited:links.size>=limit||hasMore};
    }finally{signal?.removeEventListener('abort',abort);await page.close().catch(()=>{});}
  }
  let tasks=Promise.resolve();
  function scheduledRead(username,options){const task=tasks.then(()=>read(username,options));tasks=task.catch(()=>{});return task;}
  return { available:!!browserPath, read:scheduledRead,
    discover:(username,options)=>scheduledRead(username,options),
    async video(link,username,options){const parsed=parseVideoLink(link,username);const result=await scheduledRead(username,{...options,id:parsed.id,limit:1});return result.videos.find(video=>video.id===parsed.id);},
    close:async()=>{await context?.close();context=null;},
  };
}
