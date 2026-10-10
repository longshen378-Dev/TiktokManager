import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { parseVideoLink, extractVideo, extractChannelVideos, discoverChannelVideos, fetchVideo, summarizeVideos, engagementRate } from '../lib/videos.js';
import { createStore } from '../lib/store.js';
import { createApp } from '../server.js';
import { ProfileError } from '../lib/tiktok.js';

const id='7686876318604037384';const username='nopro0609';const url=`https://www.tiktok.com/@${username}/video/${id}`;
const video={id,username,url,caption:'Fixture video',cover:null,duration:30,publishedAt:new Date('2026-10-08T08:00:00Z').toISOString(),views:1000,likes:100,comments:20,shares:10,saves:5,source:'public-page'};
const item=(changes={})=>({id,author:{uniqueId:username},desc:'Fixture video',createTime:1791446400,video:{duration:30,cover:'https://example.com/cover.jpg'},stats:{playCount:1000,diggCount:100,commentCount:20,shareCount:10,collectCount:5},...changes});
const html=scope=>`<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">${JSON.stringify({__DEFAULT_SCOPE__:scope})}</script>`;

test('video links retain exact string IDs and reject wrong account or untrusted destination',()=>{
  assert.equal(parseVideoLink(url+'?lang=vi',username).id,id);
  for(const bad of ['https://evil.com/@nopro0609/video/'+id,'https://www.tiktok.com/@other/video/'+id,'https://vm.tiktok.com/short','https://www.tiktok.com:8080/@nopro0609/video/'+id])assert.throws(()=>parseVideoLink(bad,username),ProfileError);
});
test('extracts video hydration with counts, date, duration; unknown counters are null',()=>{
  const parsed=extractVideo(html({'webapp.video-detail':{itemInfo:{itemStruct:item()}}}),username,id);
  assert.equal(parsed.views,1000);assert.equal(parsed.comments,20);assert.equal(parsed.duration,30);assert.ok(parsed.publishedAt);
  const partial=extractVideo(html({'webapp.video-detail':{itemInfo:{itemStruct:item({stats:{playCount:0,shareCount:-1}})}}}),username,id);
  assert.equal(partial.views,0);assert.equal(partial.likes,null);assert.equal(partial.shares,null);
  const mixed=extractVideo(html({'webapp.video-detail':{itemInfo:{itemStruct:item({statsV2:{playCount:'2200000',diggCount:null}})}}}),username,id);
  assert.equal(mixed.views,2200000);assert.equal(mixed.likes,100);assert.equal(mixed.comments,20);
  assert.throws(()=>extractVideo(html({'webapp.video-detail':{itemInfo:{itemStruct:item({author:{uniqueId:'other'}})}}}),username,id));
  assert.throws(()=>extractVideo('<p class="_wafchallengeid">Please wait</p>',username,id),e=>e.code==='TIKTOK_CHALLENGE');
});
test('discovers only videos and links belonging to channel, with SIGI and creator embed support',()=>{
  const h=html({'webapp.user-detail':{userInfo:{itemList:[item(),item({id:'7686876318604037385',author:{uniqueId:'other'}})]}}});
  assert.equal(extractChannelVideos(h,username).videos.length,1);
  const legacy=`<script id="SIGI_STATE">${JSON.stringify({ItemModule:{[id]:item()}})}</script>`;
  assert.equal(extractChannelVideos(legacy,username).videos[0].id,id);
  const embed=`<script id="__FRONTITY_CONNECT_STATE__">${JSON.stringify({source:{data:{['/embed/@'+username]:{videoList:[item()]}}}})}</script>`;
  assert.equal(extractChannelVideos(embed,username).videos.length,1);
  const links=extractChannelVideos(`<a href="/@${username}/video/${id}"></a><a href="/@other/video/7686876318604037385"></a>`,username);
  assert.deepEqual(links.links,[url]);
});
test('discovery does not treat an empty TikTok list as proof of zero channel videos',async()=>{
  let calls=0;
  await assert.rejects(discoverChannelVideos(username,async()=>{calls++;return new Response(html({'webapp.user-detail':{userInfo:{itemList:[]}}}));}),e=>e.code==='VIDEO_LIST_UNAVAILABLE');
  assert.equal(calls,2);
});
test('oEmbed supplies verified metadata only; no metrics or performance snapshots are invented',async()=>{
  const result=await fetchVideo(url,username,async destination=>destination.includes('/oembed?')?new Response(JSON.stringify({type:'video',author_url:'https://www.tiktok.com/@'+username,title:'Real metadata',html:`data-video-id="${id}"`,thumbnail_url:'https://example.com/image'})):new Response('<p class="_wafchallengeid">Please wait</p>'));
  assert.equal(result.caption,'Real metadata');assert.equal(result.metadataOnly,true);assert.equal(result.views,undefined);
  await assert.rejects(fetchVideo(url,username,async destination=>destination.includes('/oembed?')?new Response(JSON.stringify({type:'video',author_url:'https://www.tiktok.com/@other',html:`data-video-id="${id}"`})):new Response('captcha')),e=>e.code==='TIKTOK_CHALLENGE');
});
test('calculates weighted engagement, coverage and publication filters without turning unknown values into zero',()=>{
  const now=Date.parse('2026-10-10T08:00:00Z');
  const videos=[video,{...video,id:'2',views:10000,likes:500,comments:30,shares:20,publishedAt:'2026-08-01T08:00:00Z'},{...video,id:'3',views:100,likes:null,comments:null,shares:null,publishedAt:null}];
  const summary=summarizeVideos(videos,0,now);assert.equal(summary.totals.views,11100);assert.equal(summary.averageViews,3700);assert.equal(summary.medianViews,1000);
  assert.equal(summary.engagementCoverage,2);assert.ok(Math.abs(summary.engagementRate-(680/11000*100))<1e-9);assert.equal(summary.bestVideo.id,'2');
  const recent=summarizeVideos(videos,7,now);assert.equal(recent.selected,1);assert.equal(recent.totals.views,1000);assert.equal(recent.dateUnknown,1);
  assert.equal(engagementRate({...video,views:0}),null);assert.equal(engagementRate({...video,comments:null}),null);
  assert.equal(summarizeVideos([{...video,views:null,likes:null,comments:null,shares:null,saves:null}]).totals.views,null);
});
test('video storage migrates an existing account DB, survives restart and preserves metrics through metadata-only updates',()=>{
  const dir=mkdtempSync(join(tmpdir(),'tiktok-video-store-'));const path=join(dir,'db.sqlite');
  const old=new DatabaseSync(path);old.exec('CREATE TABLE accounts(username TEXT PRIMARY KEY,data TEXT NOT NULL)');
  old.prepare('INSERT INTO accounts(username,data) VALUES (?,?)').run(username,JSON.stringify({username,notes:'Keep this'}));old.close();
  let store=createStore(path);
  try{assert.equal(store.get(username).notes,'Keep this');store.addVideo(username,id);
    store.videoSuccess(username,id,video);store.videoSuccess(username,id,{...video,views:1300});
    store.videoSuccess(username,id,{metadataOnly:true,caption:'Updated caption',metricsError:'Metrics blocked'});
    assert.equal(store.getVideo(username,id).views,1300);assert.equal(store.videoHistory(username,id).length,2);
    store.videoFailure(username,id,new ProfileError('ACCESS_BLOCKED','blocked'));store.close();store=createStore(path);
    assert.equal(store.get(username).notes,'Keep this');assert.equal(store.getVideo(username,id).views,1300);
    store.remove(username);assert.equal(store.listVideos(username).length,0);assert.equal(store.videoHistory(username,id).length,0);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test('HTTP video workflow validates import atomically, discovers, snapshots, exports and records manual source',async()=>{
  const store=createStore(':memory:');store.add(username);let views=1000;let blocked=false;
  const {server}=createApp({store,videoFetcher:async()=>{if(blocked)throw new ProfileError('ACCESS_BLOCKED','blocked');return {...video,views};},videoDiscoverer:async()=>({links:[url],videos:[],source:'profile'})});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}/api/accounts/${username}/videos`;
  const request=(tail='',method='GET',body)=>fetch(base+tail,{method,headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  try{
    assert.equal((await request('','POST',{links:[url,'https://evil.com/@test/video/'+id]})).status,400);assert.equal(store.listVideos(username).length,0);
    let data=await(await request('/discover','POST',{})).json();assert.deepEqual(data.needsRefresh,[id]);
    data=await(await request('/'+id+'/refresh','POST',{})).json();assert.equal(data.video.views,1000);assert.equal(data.video.viewGrowth,null);
    views=1400;data=await(await request('/'+id+'/refresh','POST',{})).json();assert.equal(data.video.viewGrowth,400);
    assert.equal((await(await request('/'+id+'/history')).json()).history.length,2);
    data=await(await request()).json();assert.equal(data.summary.totals.views,1400);assert.equal(data.summary.engagementCoverage,1);
    assert.match(await(await request('/export.csv')).text(),/Fixture video/);
    assert.equal((await request('','POST',{links:[url,url]})).status,201);assert.equal(store.listVideos(username).length,1);
    blocked=true;data=await(await request('/'+id+'/refresh','POST',{})).json();assert.equal(data.video.views,1400);assert.equal(data.video.syncCode,'ACCESS_BLOCKED');
    assert.equal((await request('/'+id+'/metrics','POST',{views:-1})).status,400);
    assert.equal((await request('/'+id+'/metrics','POST',{views:2000,likes:100,comments:10,shares:5})).status,200);
    assert.equal(store.getVideo(username,id).source,'manual');assert.equal(store.videoHistory(username,id).length,3);
    store.videoSuccess(username,id,{metadataOnly:true,caption:'oEmbed caption',metricsError:'No counters'});
    assert.equal(store.getVideo(username,id).source,'manual');assert.equal(store.getVideo(username,id).views,2000);
    assert.equal((await request('/'+id,'DELETE',{})).status,200);assert.equal(store.videoHistory(username,id).length,0);
  }finally{await new Promise(resolve=>server.close(resolve));store.close();}
});
test('cached channel-list metrics cannot replace an existing detail snapshot or change its timestamp',()=>{
 const store=createStore(':memory:');store.add(username);store.addVideo(username,id);
 try{
  const exact=store.videoSuccess(username,id,{...video,views:2200000,likes:217600,source:'browser',metricSource:'video-detail'});
  const retained=store.videoSuccess(username,id,{...video,source:'browser',metricSource:'channel-list',caption:'New caption'});
  assert.equal(retained.views,2200000);assert.equal(retained.likes,217600);assert.equal(retained.caption,'New caption');assert.equal(retained.lastSuccessAt,exact.lastSuccessAt);assert.equal(store.videoHistory(username,id).length,1);
  store.videoSuccess(username,id,{...video,views:2200100,source:'browser',metricSource:'video-detail'});assert.equal(store.getVideo(username,id).views,2200100);assert.equal(store.videoHistory(username,id).length,2);
  const manual=store.videoSuccess(username,id,{views:123,source:'manual'});assert.equal(manual.metricSource,null);assert.equal(manual.source,'manual');
 }finally{store.close();}
});
test('view growth compares matching sources rather than treating a list-to-detail correction as new views',async()=>{
 const store=createStore(':memory:');store.add(username);store.addVideo(username,id);
 store.videoSuccess(username,id,{...video,source:'browser',metricSource:'channel-list'});
 const {server}=createApp({store});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const request=()=>fetch(`http://127.0.0.1:${server.address().port}/api/accounts/${username}/videos`).then(r=>r.json());
 try{
  store.videoSuccess(username,id,{...video,views:2200000,source:'browser',metricSource:'video-detail'});
  assert.equal((await request()).videos[0].viewGrowth,null);
  store.videoSuccess(username,id,{...video,views:2200200,source:'browser',metricSource:'video-detail'});
  assert.equal((await request()).videos[0].viewGrowth,200);
 }finally{await new Promise(resolve=>server.close(resolve));store.close();}
});
