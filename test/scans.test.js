import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright-core';
import {createPacer,retryAfterMs} from '../lib/pacer.js';
import {createScanManager} from '../lib/scans.js';
import {createBrowserScanner,findBrowser} from '../lib/browser-scanner.js';
import {extractChannelVideoData} from '../lib/videos.js';
import {createStore} from '../lib/store.js';
import {createApp} from '../server.js';
import {ProfileError} from '../lib/tiktok.js';

const username='nopro0609',id='7686876318604037384';
const url=`https://www.tiktok.com/@${username}/video/${id}`;
const video={id,username,url,views:1000,likes:100,comments:10,shares:5,source:'browser'};
const item={id,author:{uniqueId:username},desc:'Browser fixture',createTime:1791446400,video:{duration:20},stats:{playCount:1000,diggCount:100,commentCount:10,shareCount:5}};

test('pacer spaces concurrent actions and respects longer rate-limit cooldown with cancellation',async()=>{
 let time=1000;const pacer=createPacer({now:()=>time,sleep:async ms=>{await new Promise(resolve=>setImmediate(resolve));time+=ms;}});const starts=[];
 await Promise.all([1,2,3].map(async()=>{await pacer.wait();starts.push(time);}));assert.deepEqual(starts,[1000,6000,11000]);
 pacer.cooldown(60000);await pacer.wait();assert.equal(time,71000);
 const controller=new AbortController();controller.abort();await assert.rejects(pacer.wait({signal:controller.signal}),/SCAN_CANCELLED/);
 assert.equal(retryAfterMs('120'),120000);assert.equal(retryAfterMs('bad'),60000);
});
test('browser response extraction keeps exact IDs, validates author and reads actual metrics',()=>{
 const videos=extractChannelVideoData({itemList:[item,{...item,id:'7686876318604037385',author:{uniqueId:'other'}}]},username);
 assert.equal(videos.length,1);assert.equal(videos[0].views,1000);assert.equal(videos[0].id,id);
});
test('scan persists live discovery metrics once, fetches missing items and exposes completion',async()=>{
 const store=createStore(':memory:');store.add(username);const second={...video,id:'7686876318604037385',url:`https://www.tiktok.com/@${username}/video/7686876318604037385`};let refreshes=0;
 const scans=createScanManager({store,discover:async(name,options)=>{options.onVideo(video);options.onVideo(video);return{links:[url,second.url],videos:[video],source:'browser',limited:false};},refresh:async()=>{refreshes++;return second;}});
 try{const first=scans.start(username);assert.equal(scans.start(username).id,first.id);await scans.done(username);const result=scans.state(username);assert.equal(result.status,'completed');assert.equal(result.withMetrics,2);assert.equal(refreshes,1);assert.equal(store.videoHistory(username,id).length,1);assert.equal('controller' in result,false);assert.equal('seen' in result,false);}
 finally{scans.close();store.close();}
});
test('scan stops on verification/limit errors, retains partial results and supports cancellation',async()=>{
 const store=createStore(':memory:');store.add(username);
 let release;const gated=new Promise(resolve=>release=resolve);
 const scans=createScanManager({store,discover:async(name,options)=>{options.onVideo(video);await gated;return{links:[url],videos:[video]};},refresh:async()=>video});
 try{scans.start(username);await new Promise(resolve=>setImmediate(resolve));scans.cancel(username);release();await scans.done(username);assert.equal(scans.state(username).status,'cancelled');assert.equal(store.getVideo(username,id).views,1000);}
 finally{scans.close();store.close();}
 const next=createStore(':memory:');next.add(username);let calls=0;
 const limited=createScanManager({store:next,discover:async()=>({links:[url,`https://www.tiktok.com/@${username}/video/7686876318604037385`],videos:[]}),refresh:async()=>{calls++;throw new ProfileError('RATE_LIMITED','Too many requests');}});
 try{limited.start(username);await limited.done(username);assert.equal(limited.state(username).status,'failed');assert.equal(limited.state(username).errorCode,'RATE_LIMITED');assert.equal(calls,1);}finally{limited.close();next.close();}
});
test('scan does not count retained old metrics as newly collected metrics',async()=>{
 const store=createStore(':memory:');store.add(username);store.addVideo(username,id);store.videoSuccess(username,id,{...video,source:'manual'});
 const metadata={id,username,url,caption:'Only metadata',metadataOnly:true};
 const scans=createScanManager({store,discover:async()=>({links:[url],videos:[metadata],source:'browser',limited:false}),refresh:async()=>metadata});
 try{scans.start(username);await scans.done(username);assert.equal(scans.state(username).status,'partial');assert.equal(scans.state(username).withMetrics,0);assert.equal(store.getVideo(username,id).views,1000);assert.equal(store.videoHistory(username,id).length,1);}
 finally{scans.close();store.close();}
});
test('HTTP scan starts in background, discovers without pasted links and validates delay settings',async()=>{
 const store=createStore(':memory:');const{server,scans}=createApp({store,videoDiscoverer:async()=>({links:[url],videos:[video],source:'browser',limited:false}),videoFetcher:async()=>video});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 const post=(path,body)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{let response=await post('/api/accounts',{links:['@'+username],scanVideos:true});assert.equal(response.status,201);assert.equal((await response.json()).scansStarted.length,1);await scans.done(username);
  response=await fetch(base+`/api/accounts/${username}/videos`);const data=await response.json();assert.equal(data.videos[0].views,1000);assert.equal(data.scan.status,'completed');
  assert.equal((await post(`/api/accounts/${username}/videos/scan`,{delaySeconds:1})).status,400);
 }finally{await new Promise(resolve=>server.close(resolve));store.close();}
});
test('real Chromium loads JavaScript video list and captures counters from public-page responses', {skip:!findBrowser()}, async()=>{
 const directory=mkdtempSync(join(tmpdir(),'tiktok-browser-fixture-'));const pacer=createPacer({intervalMs:0});
 const scanner=createBrowserScanner({dataDir:directory,headless:true,pacer,launchContext:async(dir,options)=>{
   const context=await chromium.launchPersistentContext(dir,{...options,proxy:undefined});
   await context.route('https://www.tiktok.com/**',route=>route.request().url().includes('/api/')?
     route.fulfill({contentType:'application/json',body:JSON.stringify({itemList:[item],hasMore:false})}):
     route.fulfill({contentType:'text/html',body:`<html><body><script>fetch('/api/post/item_list/').then(r=>r.json()).then(data=>{const a=document.createElement('a');a.href='${url}';a.textContent=data.itemList[0].desc;document.body.append(a);});</script></body></html>`}));
   return context;
 }});
 try{const collected=[];const result=await scanner.discover(username,{limit:1,delayMs:0,onVideo:value=>collected.push(value)});assert.equal(result.videos[0].views,1000);assert.equal(result.videos[0].source,'browser');assert.equal(result.links[0],url);assert.equal(collected.length,1);}
 finally{await scanner.close();rmSync(directory,{recursive:true,force:true});}
});
