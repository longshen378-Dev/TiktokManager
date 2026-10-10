import { randomUUID } from 'node:crypto';
import { parseVideoLink } from './videos.js';
import { ProfileError } from './tiktok.js';

const active = job => job && ['queued','running'].includes(job.status);
export function createScanManager({store,discover,refresh}) {
  const jobs=new Map();let queue=Promise.resolve();
  const state=username=>{
    const job=jobs.get(username);if(!job)return null;
    const {controller,promise,seen,...publicState}=job;return publicState;
  };
  function start(username,{delaySeconds=5,limit=50}={}) {
    if(!Number.isInteger(delaySeconds)||delaySeconds<3||delaySeconds>60||!Number.isInteger(limit)||limit<1||limit>200)throw new ProfileError('BAD_REQUEST','Độ trễ cần 3–60 giây, số video cần 1–200.');
    if(active(jobs.get(username)))return state(username);
    const job={id:randomUUID(),username,status:'queued',phase:'queued',message:'Đã xếp hàng quét tự động.',delaySeconds,limit,
      found:0,withMetrics:0,processed:0,total:0,currentVideo:null,nextAt:null,startedAt:null,finishedAt:null,errorCode:null,errors:[],
      controller:new AbortController(),seen:new Map()};
    jobs.set(username,job);
    const cancelled=()=>job.controller.signal.aborted||!store.get(username);
    const remember=video=>{
      if(cancelled()||video.username!==username)return;
      const signature=JSON.stringify(video);const previous=job.seen.get(video.id);if(previous?.signature===signature)return;
      store.addVideo(username,video.id);store.videoSuccess(username,video.id,video);
      job.seen.set(video.id,{signature,hasViews:video.views!=null||previous?.hasViews===true});
      job.found=Math.max(job.found,job.seen.size);job.withMetrics=[...job.seen.values()].filter(item=>item.hasViews).length;
    };
    const run=async()=>{
      if(cancelled()){job.status='cancelled';job.finishedAt=new Date().toISOString();return;}
      job.status='running';job.startedAt=new Date().toISOString();
      const options={limit,delayMs:delaySeconds*1000,signal:job.controller.signal,
        onProgress:changes=>{if(!cancelled())Object.assign(job,changes);},onVideo:remember};
      try {
        const found=await discover(username,options);
        if(cancelled())throw new ProfileError('SCAN_CANCELLED','Đã dừng quét.');
        const parsed=found.links.map(link=>parseVideoLink(link,username));
        const links=[...new Map(parsed.map(video=>[video.id,video])).values()].slice(0,limit);
        if(!links.length)throw new ProfileError('VIDEO_LIST_UNAVAILABLE','TikTok chưa trả danh sách video. Quét chưa lấy được chỉ số.');
        job.found=links.length;job.total=links.length;
        for(const link of links)store.addVideo(username,link.id);
        (found.videos||[]).filter(v=>links.some(link=>link.id===v.id)).forEach(remember);
        const now=new Date().toISOString();store.setVideoSync(username,{lastAttemptAt:now,lastSuccessAt:now,syncError:null,syncCode:null,source:found.source,discovered:links.length,imported:links.length,limited:found.limited!==false});
        for(const link of links) {
          if(cancelled())throw new ProfileError('SCAN_CANCELLED','Đã dừng quét.');
          job.currentVideo=link.id;job.phase='reading';job.nextAt=null;job.message=`Đang đọc video ${job.processed+1}/${job.total}.`;
          if(!job.seen.get(link.id)?.hasViews) {
            try {remember(await refresh(link.url,username,options));}
            catch(error) {
              const safe=error instanceof ProfileError?error:new ProfileError('FETCH_ERROR','Không đọc được chỉ số video.');
              store.videoFailure(username,link.id,safe);job.errors.push({id:link.id,code:safe.code,message:safe.message});
              if(['RATE_LIMITED','BROWSER_TLS_ERROR','BROWSER_VERIFICATION_REQUIRED','BROWSER_NETWORK_ERROR'].includes(safe.code))throw safe;
            }
          }
          job.processed++;
        }
        job.withMetrics=links.filter(link=>job.seen.get(link.id)?.hasViews).length;
        job.status=job.withMetrics===links.length?'completed':'partial';
        job.message=`Quét xong ${job.processed}/${job.total} video; ${job.withMetrics} có số liệu lượt xem. ${found.limited!==false?'Danh sách có thể chưa đầy đủ.':''}`;
      } catch(error) {
        job.status=cancelled()?'cancelled':'failed';job.errorCode=cancelled()?'SCAN_CANCELLED':error.code||'FETCH_ERROR';
        job.message=cancelled()?'Đã dừng quét. Video đã lấy được vẫn được lưu.':error instanceof ProfileError?error.message:'Quét thất bại. Kiểm tra trình duyệt và mạng.';
        if(store.get(username))store.setVideoSync(username,{lastAttemptAt:new Date().toISOString(),syncError:job.message,syncCode:job.errorCode});
      } finally {job.phase=job.status;job.currentVideo=null;job.nextAt=null;job.finishedAt=new Date().toISOString();}
    };
    job.promise=queue.then(run);queue=job.promise.catch(()=>{});return state(username);
  }
  return {state,start,
    cancel(username){const job=jobs.get(username);if(active(job)){job.controller.abort();job.message='Đang dừng quét…';}return state(username);},
    done:username=>jobs.get(username)?.promise||Promise.resolve(),
    close(){for(const job of jobs.values())if(active(job))job.controller.abort();},
  };
}
