const $ = selector => document.querySelector(selector);
const num = value => value == null ? '—' : new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(value);
const percent = value => value == null ? '—' : `${num(value)}%`;
const date = value => value ? new Date(value).toLocaleString('vi-VN') : 'Chưa biết';
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
const source = value => value === 'manual' ? 'Nhập tay' : value === 'public-page' ? 'TikTok công khai' : 'Chưa có số liệu';
const state = { username: null, videos: [], summary: null, discovery: {}, busy: new Set(), batch: false, discovering: false, detail: null, loadToken: 0 };
let notify = console.info;
async function api(path, options = {}) {
  const r = await fetch(path,{...options,headers:{'Content-Type':'application/json'}});
  const data = await r.json(); if(!r.ok) throw new Error(data.error || 'Không tải được dữ liệu video.'); return data;
}
const path = username => `/api/accounts/${encodeURIComponent(username)}/videos`;
function update(video) { const i = state.videos.findIndex(v => v.id === video.id); if(i < 0) state.videos.push(video); else state.videos[i] = video; }
async function load(username = state.username) {
  const token = ++state.loadToken;
  const data = await api(`${path(username)}?days=${$('#video-period').value}`);
  if(state.username !== username || token !== state.loadToken) return;
  state.videos = data.videos; state.summary = data.summary; state.discovery = data.discovery; render();
}
function selected() {
  const days = Number($('#video-period').value);const now=Date.now();const key=$('#video-sort').value;
  return state.videos.filter(v=>!days||(v.publishedAt&&Date.parse(v.publishedAt)>=now-days*86400000&&Date.parse(v.publishedAt)<=now))
    .sort((a,b)=>key==='publishedAt' ? (Date.parse(b.publishedAt)||0)-(Date.parse(a.publishedAt)||0) : (b[key]??-Infinity)-(a[key]??-Infinity));
}
function render() {
  const summary = state.summary; if(!summary) return;
  const total = $('#video-dialog').dataset.channelTotal || 'chưa biết';
  $('#video-coverage').textContent = `Đang theo dõi ${summary.tracked} video / tổng video trên hồ sơ: ${total}. Bộ lọc đang chọn ${summary.selected} video. ${summary.dateUnknown ? `${summary.dateUnknown} video chưa biết ngày đăng.` : ''}`;
  $('#video-warning').hidden = !state.discovery.syncError;
  $('#video-warning').textContent = state.discovery.syncError || '';
  const cards=[['Tổng lượt xem',num(summary.totals.views),`${summary.coverage.views}/${summary.selected} video có số liệu`],['Lượt xem trung bình',num(summary.averageViews),'Trên các video có lượt xem'],['Trung vị lượt xem',num(summary.medianViews),'Mức giữa của mẫu đã theo dõi'],['Tỷ lệ tương tác',percent(summary.engagementRate),`${summary.engagementCoverage}/${summary.selected} video đủ số liệu`],['Lượt thích',num(summary.totals.likes),`${summary.coverage.likes}/${summary.selected} video`],['Bình luận',num(summary.totals.comments),`${summary.coverage.comments}/${summary.selected} video`],['Chia sẻ',num(summary.totals.shares),`${summary.coverage.shares}/${summary.selected} video`],['Lượt lưu',num(summary.totals.saves),`${summary.coverage.saves}/${summary.selected} video`]];
  $('#video-summary').innerHTML=cards.map(([label,value,note])=>`<div><span>${label}</span><strong>${value}</strong><small>${note}</small></div>`).join('');
  const videos=selected();const top=videos.filter(v=>v.views!=null).sort((a,b)=>b.views-a.views).slice(0,8);const max=Math.max(...top.map(v=>v.views),1);
  $('#video-chart').innerHTML=top.length?`<svg viewBox="0 0 800 ${top.length*34+8}" class="video-bars" role="img" aria-label="So sánh lượt xem của các video đang theo dõi">${top.map((v,i)=>`<text x="0" y="${i*34+24}">${escape((v.caption||v.id).slice(0,25))}</text><rect x="245" y="${i*34+10}" width="${v.views/max*435}" height="20" rx="4"/><text x="${250+v.views/max*435}" y="${i*34+24}" class="bar-value">${num(v.views)}</text>`).join('')}</svg>`:'<p class="helper">Biểu đồ xuất hiện khi có số liệu lượt xem.</p>';
  $('#video-rows').innerHTML=videos.map(video=>{const busy=state.busy.has(`${state.username}:${video.id}`);return `<tr><td><a href="${escape(video.url)}" target="_blank" rel="noopener noreferrer" class="video-caption">${escape(video.caption||'Video chưa lấy được mô tả')} ↗</a><small class="video-id">${video.id}</small><span class="video-source ${video.source==='manual'?'manual':''}">${source(video.source)}</span>${video.syncError?`<small class="video-inline-error" title="${escape(video.syncError)}">Chưa cập nhật được chỉ số</small>`:''}<small class="video-id">${video.lastSuccessAt?escape(date(video.lastSuccessAt)):video.lastMetadataAt?'Đã lấy mô tả · chưa có chỉ số':'Chưa cập nhật'}</small></td><td>${escape(video.publishedAt?new Date(video.publishedAt).toLocaleDateString('vi-VN'):'—')}<small class="video-id">${video.duration==null?'':`${num(video.duration)} giây`}</small></td><td class="num">${num(video.views)}</td><td title="${video.growthSince?'So với '+escape(date(video.growthSince)):''}">${video.viewGrowth==null?'—':(video.viewGrowth>0?'+':'')+num(video.viewGrowth)}</td><td>${percent(video.engagementRate)}</td><td>${num(video.likes)}</td><td>${num(video.comments)}</td><td>${num(video.shares)}</td><td>${num(video.saves)}</td><td><div class="row-actions"><button class="icon-button" data-video-action="refresh" data-id="${video.id}" aria-label="Cập nhật video ${video.id}" ${busy?'disabled':''}>↻</button><button class="icon-button" data-video-action="history" data-id="${video.id}" aria-label="Lịch sử và nhập số liệu video ${video.id}">▥</button><button class="icon-button danger" data-video-action="delete" data-id="${video.id}" aria-label="Xóa video ${video.id}">×</button></div></td></tr>`;}).join('');
  $('#video-empty').hidden=videos.length>0;
  $('#video-empty').textContent=state.videos.length?'Không có video phù hợp với bộ lọc ngày đăng. Video chưa có ngày đăng chỉ hiển thị ở “Tất cả ngày đăng”.':'Chưa theo dõi video nào. Tìm video của kênh hoặc dán link video để bắt đầu.';
  $('#refresh-videos').disabled=state.batch||!state.videos.length;
  $('#refresh-videos').textContent=state.batch?'↻ Đang cập nhật…':'↻ Cập nhật video';
  $('#discover-videos').disabled=state.discovering||state.batch;
  $('#export-videos').href=`${path(state.username)}/export.csv?days=${$('#video-period').value}`;
}
async function refreshOne(username,id) {
  const key=`${username}:${id}`;if(state.busy.has(key))return false;state.busy.add(key);if(state.username===username)render();
  try {const data=await api(`${path(username)}/${id}/refresh`,{method:'POST',body:'{}'});if(state.username===username)update(data.video);return !data.video.syncError;}
  catch(error){notify(error.message,true);return false;}
  finally{state.busy.delete(key);if(state.username===username)render();}
}
async function refreshMany(username,ids) {
  if(state.batch)return;state.batch=true;render();let success=0;
  try {for(const id of ids)if(await refreshOne(username,id))success++;await load(username);notify(`Lấy được chỉ số ${success}/${ids.length} video. ${success<ids.length?'Xem lịch sử/chi tiết để biết nguyên nhân.':''}`,success<ids.length);}
  catch(error){notify(error.message,true);}finally{state.batch=false;if(state.username)render();}
}
export async function openVideos(account,toast) {
  notify=toast;state.username=account.username;state.summary=null;state.videos=[];
  $('#video-dialog').dataset.channelTotal=account.videos??'';$('#video-channel-name').textContent=`${account.displayName||account.username} · @${account.username}`;
  $('#video-links').placeholder=`https://www.tiktok.com/@${account.username}/video/ID`;
  $('#video-period').value='0';$('#video-sort').value='views';$('#video-summary').innerHTML='';$('#video-rows').innerHTML='';$('#video-chart').innerHTML='';$('#video-warning').hidden=true;$('#video-coverage').textContent='Đang tải dữ liệu…';
  if(!$('#video-dialog').open)$('#video-dialog').showModal();
  try{await load(account.username);}catch(error){$('#video-warning').hidden=false;$('#video-warning').textContent=error.message;}
}
$('#close-videos').addEventListener('click',()=>$('#video-dialog').close());
$('#video-dialog').addEventListener('close',()=>{state.username=null;state.loadToken++;});
$('#video-period').addEventListener('change',()=>void load().catch(error=>notify(error.message,true)));
$('#video-sort').addEventListener('change',render);
$('#refresh-videos').addEventListener('click',()=>void refreshMany(state.username,state.videos.map(v=>v.id)));
$('#discover-videos').addEventListener('click',async()=>{
  const username=state.username;state.discovering=true;render();
  try{const data=await api(`${path(username)}/discover`,{method:'POST',body:'{}'});if(state.username!==username)return;await load(username);
    if(data.discovery.syncError)notify(data.discovery.syncError,true);else{notify(`Đã tìm và theo dõi ${data.importedIds.length} video từ trang công khai. Danh sách có thể chưa đầy đủ.`);if(data.needsRefresh.length)void refreshMany(username,data.needsRefresh);}}
  catch(error){notify(error.message,true);}finally{state.discovering=false;if(state.username)render();}
});
$('#video-add-form').addEventListener('submit',async event=>{
  event.preventDefault();const username=state.username;$('#add-video-button').disabled=true;
  try{const links=$('#video-links').value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);const data=await api(path(username),{method:'POST',body:JSON.stringify({links})});if(state.username!==username)return;$('#video-links').value='';await load(username);notify(`Đã lưu ${data.addedIds.length} link video.`);if(!state.batch)void refreshMany(username,data.addedIds);else notify('Đã lưu link. Bấm cập nhật video sau khi lượt hiện tại hoàn tất.');}
  catch(error){notify(error.message,true);}finally{$('#add-video-button').disabled=false;}
});
$('#video-rows').addEventListener('click',async event=>{
  const button=event.target.closest('[data-video-action]');if(!button)return;const id=button.dataset.id;const username=state.username;
  if(button.dataset.videoAction==='refresh'){await refreshOne(username,id);await load(username);return;}
  if(button.dataset.videoAction==='history')return void openHistory(username,id);
  if(button.dataset.videoAction==='delete'&&confirm('Xóa video và lịch sử khỏi danh sách theo dõi?')){
    try{await api(`${path(username)}/${id}`,{method:'DELETE',body:'{}'});await load(username);notify('Đã xóa video khỏi danh sách.');}catch(error){notify(error.message,true);}}
});
async function openHistory(username,id) {
  const video=state.videos.find(v=>v.id===id);if(!video)return;state.detail={username,id};
  $('#video-detail-link').href=video.url;$('#video-detail-link').textContent=(video.caption||id)+' ↗';
  $('#video-detail-error').hidden=!video.syncError;$('#video-detail-error').textContent=video.syncError||'';
  for(const key of ['views','likes','comments','shares','saves'])$(`#manual-${key}`).value=video[key]??'';
  $('#video-history').textContent='Đang tải lịch sử…';$('#video-detail-dialog').showModal();
  try{const {history}=await api(`${path(username)}/${id}/history`);if(state.detail?.id!==id||state.detail.username!==username)return;
    $('#video-history').innerHTML=history.length?`<div class="table-wrap"><table><thead><tr><th>Thời điểm</th><th>Xem</th><th>Thích</th><th>Bình luận</th><th>Chia sẻ</th><th>Nguồn</th></tr></thead><tbody>${history.map(item=>`<tr><td>${escape(date(item.capturedAt))}</td><td>${num(item.views)}</td><td>${num(item.likes)}</td><td>${num(item.comments)}</td><td>${num(item.shares)}</td><td>${source(item.source)}</td></tr>`).join('')}</tbody></table></div>`:'<p>Chưa có mốc số liệu. Mô tả từ oEmbed không được coi là mốc hiệu suất.</p>';
  }catch(error){$('#video-history').textContent=error.message;}
}
$('#close-video-detail').addEventListener('click',()=>$('#video-detail-dialog').close());
$('#video-detail-dialog').addEventListener('close',()=>state.detail=null);
$('#video-metrics-form').addEventListener('submit',async event=>{
  event.preventDefault();const detail=state.detail;if(!detail)return;$('#save-video-metrics').disabled=true;
  try{const values=Object.fromEntries(['views','likes','comments','shares','saves'].map(key=>[key,$(`#manual-${key}`).value===''?null:Number($(`#manual-${key}`).value)]));await api(`${path(detail.username)}/${detail.id}/metrics`,{method:'POST',body:JSON.stringify(values)});await load(detail.username);$('#video-detail-dialog').close();notify('Đã lưu mốc số liệu với nguồn “Nhập tay”.');}
  catch(error){notify(error.message,true);}finally{$('#save-video-metrics').disabled=false;}
});
