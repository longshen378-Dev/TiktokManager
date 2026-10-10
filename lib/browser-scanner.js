import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseUsername, ProfileError } from './tiktok.js';
import { parseVideoLink, extractVideo, extractChannelVideos, extractChannelVideoData } from './videos.js';
import { tiktokPacer, retryAfterMs, DEFAULT_DELAY_SECONDS } from './pacer.js';

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
export function browserSandboxEnabled(platform = process.platform, root = process.getuid?.() === 0, containerOverride = process.env.TIKTOK_BROWSER_SANDBOX === '0') {
  return !(platform === 'linux' && (root || containerOverride));
}
export async function hasVisibleChallenge(page) {
  const html = await page.content();
  if (/wafchallenge|SlardarWAF/i.test(html)) return true;
  const selectors = '[class*="captcha-verify"], [id*="captcha-verify"], #captcha_container, #captcha-verify-container, [data-e2e="captcha"], iframe[src*="captcha"], iframe[src*="verify"]';
  for (const element of await page.locator(selectors).all()) if (await element.isVisible()) return true;
  const text = (await page.locator('body').innerText()).slice(0,15000);
  return /verify you are human|security verification|complete the captcha|drag the puzzle|xác minh bảo mật|kéo thanh trượt/i.test(text);
}

export function createBrowserScanner({ dataDir, browserPath = findBrowser(), headless = process.env.TIKTOK_HEADLESS === '1' ||
  (process.platform === 'linux' && !process.env.DISPLAY), pacer = tiktokPacer, settleMs = 1500,
  verificationTimeoutMs = 300_000,
  launchContext = (directory,options)=>chromium.launchPersistentContext(directory,options) } = {}) {
  let context, opening, sharedPage, closed = false;
  async function open() {
    if (closed) throw new ProfileError('BROWSER_CLOSED','Phiên quét đã dừng.');
    if (!browserPath) throw new ProfileError('BROWSER_NOT_FOUND','Cần cài Chrome hoặc Edge trên máy chạy công cụ để tự quét video.');
    if (context) return context;
    if (opening) return opening;
    opening = (async () => {
      mkdirSync(dataDir,{recursive:true});
      const options = { executablePath: browserPath, headless, ignoreHTTPSErrors: false,
        chromiumSandbox: browserSandboxEnabled() };
      const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
      if (proxy) {
        const url = new URL(proxy);
        options.proxy = { server:`${url.protocol}//${url.hostname}${url.port?':'+url.port:''}`,
          ...(url.username ? {username:decodeURIComponent(url.username),password:decodeURIComponent(url.password)} : {}) };
      }
      try {
        context = await launchContext(dataDir,options);
        context.on('close',()=>{context=null;sharedPage=null;});
        return context;
      } catch { throw new ProfileError('BROWSER_START_FAILED','Không mở được Chrome/Edge. Đóng phiên quét cũ, kiểm tra trình duyệt đã cài và thử lại.'); }
    })();
    try { return await opening; } finally { opening=null; }
  }

  async function read(username,{id=null,limit=50,delayMs=DEFAULT_DELAY_SECONDS*1000,signal,onProgress=()=>{},onVideo=()=>{}}={}) {
    username=parseUsername(username);
    const videos=new Map(), links=new Map(), ranks=new Map(), pending=new Set(), inFlight=new Set();
    let page, rateError=null, hasMore=true;
    const emit=updates=>onProgress({found:links.size,withMetrics:[...videos.values()].filter(v=>v.views!=null).length,...updates});
    const cancelled=()=>{if(signal?.aborted||closed)throw new ProfileError('SCAN_CANCELLED','Đã dừng quét theo yêu cầu.');};
    const wait=async()=>{
      cancelled();if(rateError)throw rateError;
      await pacer.wait({delayMs,signal,onWait:nextAt=>emit({phase:'waiting',nextAt,message:'Đang nghỉ trước lượt tải tiếp theo.'})});
      cancelled();if(rateError)throw rateError;
    };
    const add=(video,rank,metricSource)=>{
      if(id&&video.id!==id)return;
      if(!links.has(video.id)&&links.size>=limit)return;
      if((ranks.get(video.id)??-1)>rank)return;
      const value={...video,source:'browser',metricSource};
      const old=videos.get(video.id);
      if(old?.views!=null&&value.views==null)return;
      const {observedAt,...previous}=old||{};
      if(JSON.stringify(previous)===JSON.stringify(value))return;
      value.observedAt=new Date().toISOString();
      videos.set(video.id,value);ranks.set(video.id,rank);links.set(video.id,video.url);
      // A detail refresh returns only the final settled result, never provisional HTML counters.
      if(!id)onVideo(value);
    };
    const relevant=url=>{
      try {const parsed=new URL(url);return parsed.hostname==='www.tiktok.com'&&
        (id?/^\/api\/(?:item|video)\/detail\//.test(parsed.pathname):/^\/api\/(?:post\/item_list|item\/detail)\//.test(parsed.pathname));}
      catch{return false;}
    };
    const onRequest=request=>{if(relevant(request.url()))inFlight.add(request);};
    const onFinished=request=>inFlight.delete(request);
    const onResponse=response=>{
      if(!relevant(response.url()))return;
      if(response.status()===429){pacer.cooldown(retryAfterMs(response.headers()['retry-after']));rateError=new ProfileError('RATE_LIMITED','TikTok báo giới hạn 429. Đã dừng quét; chờ rồi thử lại.');return;}
      if(!response.headers()['content-type']?.includes('json')||Number(response.headers()['content-length']||0)>4_000_000)return;
      const task=response.json().then(data=>{
        for(const video of extractChannelVideoData(data,username))add(video,id?3:1,id?'video-detail':'channel-list');
        if(!id&&typeof data.hasMore==='boolean')hasMore=data.hasMore;
      }).catch(()=>{}).finally(()=>pending.delete(task));pending.add(task);
    };
    const settle=async()=>{
      await new Promise(resolve=>setTimeout(resolve,settleMs));
      const deadline=Date.now()+8000;
      while(inFlight.size&&Date.now()<deadline){cancelled();if(rateError)throw rateError;await new Promise(resolve=>setTimeout(resolve,200));}
      await Promise.allSettled([...pending]);
      cancelled();if(rateError)throw rateError;
    };
    const verify=async()=>{
      if(!await hasVisibleChallenge(page))return false;
      pacer.cooldown(Math.max(delayMs,60_000));
      if(headless)throw new ProfileError('BROWSER_VERIFICATION_REQUIRED','TikTok yêu cầu CAPTCHA. Quét đã dừng, giữ số liệu cũ. Chạy trên máy cá nhân để xác minh trong Chrome/Edge.');
      await page.bringToFront();
      emit({phase:'verification',nextAt:null,message:'Đang tạm dừng vì CAPTCHA. Hoàn tất xác minh trong tab TikTok đang mở; công cụ chờ tối đa 5 phút và không tải trang khác.'});
      const deadline=Date.now()+verificationTimeoutMs;
      while(await hasVisibleChallenge(page)){
        cancelled();if(Date.now()>=deadline)throw new ProfileError('BROWSER_VERIFICATION_REQUIRED','Chưa hoàn tất CAPTCHA. Tab được giữ mở để bạn xác minh; quét lại sau khi hoàn tất.');
        await new Promise(resolve=>setTimeout(resolve,500));
      }
      await settle();
      return true;
    };
    const abort=()=>void page?.close().catch(()=>{});
    try {
      // Do not open a blank browser while the action waits in the queue.
      await wait();emit({phase:'opening',nextAt:null,message:'Đang mở trang TikTok bằng trình duyệt.'});
      const ctx=await open();cancelled();
      if(!sharedPage||sharedPage.isClosed())sharedPage=ctx.pages().find(p=>p.url()==='about:blank')||await ctx.newPage();
      page=sharedPage;
      for(const blank of ctx.pages())if(blank!==page&&blank.url()==='about:blank')await blank.close();
      signal?.addEventListener('abort',abort,{once:true});
      page.on('request',onRequest);page.on('requestfinished',onFinished);page.on('requestfailed',onFinished);page.on('response',onResponse);
      // Never navigate away from an unfinished verification screen from the previous action.
      if(page.url()!=='about:blank'&&await verify())await wait();
      try {
        const response=await page.goto(id?`https://www.tiktok.com/@${username}/video/${id}`:`https://www.tiktok.com/@${username}`,{waitUntil:'domcontentloaded',timeout:45_000});
        if(response?.status()===429){pacer.cooldown(retryAfterMs(response.headers()['retry-after']));throw new ProfileError('RATE_LIMITED','TikTok báo giới hạn 429. Đã dừng quét.');}
      } catch(error) {
        if(error instanceof ProfileError)throw error;
        cancelled();
        if(/ERR_CERT_AUTHORITY_INVALID|ERR_CERT_/i.test(error.message))throw new ProfileError('BROWSER_TLS_ERROR','Trình duyệt chưa tin cậy chứng chỉ proxy cloud. Hãy chạy trên máy cá nhân hoặc cấu hình CA được phê duyệt.');
        if(page.isClosed())throw new ProfileError('BROWSER_CLOSED','Cửa sổ quét đã bị đóng. Bấm cập nhật lại để mở phiên mới.');
        throw new ProfileError('BROWSER_NETWORK_ERROR','Không tải được TikTok. Kiểm tra mạng hoặc proxy trên máy chạy công cụ.');
      }
      let unchanged=0;
      for(let step=0;step<(id?1:Math.min(30,Math.ceil(limit/8)+6));step++) {
        await settle();await verify();cancelled();
        const html=await page.content();
        if(id){try{add(extractVideo(html,username,id),2,'video-detail');}catch(error){if(!videos.has(id)&&error.code==='TIKTOK_CHALLENGE')throw error;}}
        else {
          const embedded=extractChannelVideos(html,username);
          embedded.videos.forEach(video=>add(video,0,'channel-list'));
          for(const link of [...embedded.links,...await page.locator('a[href*="/video/"]').evaluateAll(elements=>elements.map(element=>element.href))]) {
            try{const parsed=parseVideoLink(link,username);if(links.has(parsed.id)||links.size<limit)links.set(parsed.id,parsed.url);}catch{}
          }
        }
        emit({phase:'collecting',nextAt:null,message:`Đã tìm ${links.size} video, ${[...videos.values()].filter(v=>v.views!=null).length} có lượt xem.`});
        if(id||links.size>=limit||(!hasMore&&videos.size))break;
        const size=links.size;
        // Pause after completion of a load, not just from navigation start.
        pacer.cooldown(delayMs);await wait();await verify();
        await page.evaluate(()=>window.scrollBy(0,innerHeight*1.5));
        await settle();
        if(links.size===size)unchanged++;else unchanged=0;
        if(unchanged>=4)break;
      }
      await Promise.allSettled([...pending]);await verify();
      if(rateError)throw rateError;
      if(id&&(inFlight.size||!videos.get(id)||videos.get(id).views==null))throw new ProfileError('METRICS_UNAVAILABLE','Trang video chưa cung cấp lượt xem mới. Giữ số liệu lần trước, không coi là cập nhật thành công.');
      if(!links.size)throw new ProfileError('VIDEO_LIST_UNAVAILABLE','Trang TikTok chưa cung cấp danh sách video. Có thể cần xác minh hoặc tài khoản bị giới hạn.');
      return {videos:[...videos.values()],links:[...links.values()],source:'browser',limited:links.size>=limit||hasMore};
    } catch(error) {
      cancelled();if(error instanceof ProfileError)throw error;
      if(page?.isClosed())throw new ProfileError('BROWSER_CLOSED','Cửa sổ quét đã bị đóng. Bấm cập nhật lại để mở phiên mới.');
      throw new ProfileError('BROWSER_READ_ERROR','Không đọc được trang TikTok. Số liệu cũ được giữ; thử lại sau.');
    } finally {
      signal?.removeEventListener('abort',abort);
      if(page){page.off('request',onRequest);page.off('requestfinished',onFinished);page.off('requestfailed',onFinished);page.off('response',onResponse);}
      // Keep the loaded tab and verification visible. Later actions reuse it.
      pacer.cooldown(delayMs);
    }
  }
  let tasks=Promise.resolve();
  function scheduledRead(username,options){const task=tasks.then(()=>read(username,options));tasks=task.catch(()=>{});return task;}
  return { available:!!browserPath, read:scheduledRead,
    discover:(username,options)=>scheduledRead(username,options),
    async video(link,username,options){const parsed=parseVideoLink(link,username);const result=await scheduledRead(username,{...options,id:parsed.id,limit:1});return result.videos.find(video=>video.id===parsed.id);},
    close:async()=>{closed=true;await context?.close();context=null;sharedPage=null;},
  };
}
