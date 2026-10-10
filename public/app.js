import { openVideos as openVideoPanel } from './videos.js';
const $ = selector => document.querySelector(selector);
const state = { accounts: [], syncing: new Set(), detail: null, refreshingAll: false };
const statuses = { active: 'Đang hoạt động', paused: 'Tạm dừng', review: 'Cần xem lại' };
const number = value => value == null ? '—' : new Intl.NumberFormat('vi-VN').format(value);
const compact = value => value == null ? '—' : new Intl.NumberFormat('vi-VN', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
const date = value => value ? new Date(value).toLocaleString('vi-VN') : 'Chưa cập nhật';
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
let toastTimer;
function toast(message, error = false) {
  $('#toast').textContent = message; $('#toast').className = error ? 'error' : ''; $('#toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').hidden = true, 6000);
}
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Không thể thực hiện yêu cầu.');
  return data;
}
function upsert(account) {
  const index = state.accounts.findIndex(item => item.username === account.username);
  if (index < 0) state.accounts.push(account); else state.accounts[index] = account;
}
function avatar(account) {
  if (account.avatar && account.avatar.startsWith('https://')) return `<img class="avatar" src="${escape(account.avatar)}" alt="" loading="lazy" referrerpolicy="no-referrer">`;
  return `<span class="avatar">${escape(account.username.slice(0, 1).toUpperCase())}</span>`;
}
function visibleAccounts() {
  const query = $('#search').value.trim().toLowerCase();
  const group = $('#group-filter').value; const status = $('#status-filter').value;
  return state.accounts.filter(account => (!group || account.group === group) && (!status || account.status === status) &&
    [account.username, account.displayName, account.bio, account.notes, account.group].some(value => String(value || '').toLowerCase().includes(query)))
    .sort((a, b) => $('#sort').value === 'followers' ? (b.followers ?? -1) - (a.followers ?? -1) : $('#sort').value === 'name' ? a.username.localeCompare(b.username) : b.createdAt.localeCompare(a.createdAt));
}
function render() {
  const accounts = state.accounts;
  $('#total-accounts').textContent = accounts.length; $('#nav-count').textContent = accounts.length;
  $('#active-count').textContent = `${accounts.filter(a => a.status === 'active').length} đang hoạt động`;
  for (const [key, target] of [['followers', 'followers'], ['likes', 'likes']]) {
    const known = accounts.filter(a => a[key] != null);
    $(`#total-${target}`).textContent = known.length ? compact(known.reduce((sum, a) => sum + a[key], 0)) : '—';
    $(`#${target}-coverage`).textContent = known.length ? `Có số liệu ${known.length}/${accounts.length} kênh · số liệu lần lấy gần nhất` : 'Chưa có dữ liệu';
  }
  const pending = accounts.filter(a => !a.lastSuccessAt || a.syncError).length;
  $('#pending-count').textContent = pending;
  $('#sync-summary').textContent = accounts.length ? `${accounts.length - pending} kênh đã lấy dữ liệu thành công` : 'Thêm kênh để bắt đầu';
  const groupSelect = $('#group-filter'); const selected = groupSelect.value;
  const groups = [...new Set(accounts.map(a => a.group).filter(Boolean))].sort();
  groupSelect.innerHTML = '<option value="">Tất cả nhóm</option>' + groups.map(group => `<option value="${escape(group)}">${escape(group)}</option>`).join('');
  groupSelect.value = groups.includes(selected) ? selected : '';
  const visible = visibleAccounts();
  $('#list-count').textContent = accounts.length; $('#visible-count').textContent = `${visible.length} / ${accounts.length} tài khoản`;
  $('#empty').hidden = visible.length > 0;
  $('#empty h3').textContent = accounts.length ? 'Không tìm thấy tài khoản phù hợp' : 'Danh sách kênh của bạn bắt đầu ở đây';
  $('#empty p').textContent = accounts.length ? 'Thử đổi từ khóa hoặc bỏ bộ lọc.' : 'Thêm link TikTok đầu tiên để lưu thông tin, theo dõi chỉ số và quản lý công việc.';
  $('#empty-add').hidden = accounts.length > 0;
  $('#refresh-all').disabled = !accounts.length || state.refreshingAll;
  $('#refresh-all').textContent = state.refreshingAll ? '↻ Đang cập nhật…' : '↻ Cập nhật tất cả';
  $('#account-rows').innerHTML = visible.map(account => {
    const busy = state.syncing.has(account.username);
    const sync = busy ? 'Đang lấy dữ liệu…' : account.syncError ? 'Chưa lấy được dữ liệu' : account.lastSuccessAt ? 'Đã đồng bộ' : 'Chưa lấy dữ liệu';
    return `<tr><td><div class="profile-cell">${avatar(account)}<div><button class="profile-link" data-action="detail" data-user="${escape(account.username)}">${escape(account.displayName || account.username)}${account.verified ? '<span class="verified" title="Đã xác minh">✓</span>' : ''}</button><div class="username">@${escape(account.username)}</div></div></div></td><td class="num" title="${number(account.followers)}">${compact(account.followers)}</td><td class="num" title="${number(account.likes)}">${compact(account.likes)}</td><td class="num"><button class="video-entry" data-action="videos" data-user="${escape(account.username)}" aria-label="Hiệu suất video @${escape(account.username)}">${number(account.videos)} <span>Phân tích ↗</span></button></td><td><div class="group">${escape(account.group || 'Chưa phân nhóm')}</div><span class="status ${account.status}">${statuses[account.status]}</span></td><td><div class="sync-status ${account.syncError ? 'sync-error' : ''}" title="${escape(account.syncError || '')}">${sync}<span class="sync-time">${account.lastSuccessAt ? escape(date(account.lastSuccessAt)) : '—'}</span></div></td><td><div class="row-actions"><button class="icon-button" data-action="refresh" data-user="${escape(account.username)}" aria-label="Cập nhật @${escape(account.username)}" ${busy ? 'disabled' : ''}>↻</button><button class="icon-button" data-action="detail" data-user="${escape(account.username)}" aria-label="Chi tiết @${escape(account.username)}">⋯</button><button class="icon-button danger" data-action="delete" data-user="${escape(account.username)}" aria-label="Xóa @${escape(account.username)}">×</button></div></td></tr>`;
  }).join('');
  document.querySelectorAll('img.avatar').forEach(img => img.addEventListener('error', () => {
    const replacement = document.createElement('span'); replacement.className = 'avatar'; replacement.textContent = '♪'; img.replaceWith(replacement);
  }, { once: true }));
}
async function refreshAccount(username, notify = true) {
  if (state.syncing.has(username)) return false;
  state.syncing.add(username); render();
  try {
    const { account } = await api(`/api/accounts/${encodeURIComponent(username)}/refresh`, { method: 'POST', body: '{}' });
    upsert(account);
    if (notify) toast(account.syncError ? `@${username}: ${account.syncError}` : `Đã cập nhật @${username}`, Boolean(account.syncError));
    return !account.syncError;
  } catch (error) { if (notify) toast(error.message, true); return false; }
  finally { state.syncing.delete(username); render(); }
}
async function refreshMany(usernames) {
  if (state.refreshingAll) return;
  state.refreshingAll = true; render();
  let success = 0;
  for (const username of usernames) {
    if (state.accounts.some(a => a.username === username) && await refreshAccount(username, false)) success++;
  }
  state.refreshingAll = false; render();
  toast(`Cập nhật thành công ${success}/${usernames.length} tài khoản. ${success < usernames.length ? 'Xem chi tiết các tài khoản chưa lấy được dữ liệu.' : ''}`, success < usernames.length);
}
$('#add-form').addEventListener('submit', async event => {
  event.preventDefault(); const links = $('#links').value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  $('#add-button').disabled = true;
  try {
    const { results,scansStarted } = await api('/api/accounts', { method: 'POST', body: JSON.stringify({ links,scanVideos:$('#auto-scan').checked }) });
    results.forEach(({ account }) => upsert(account)); $('#links').value = ''; render();
    toast(`Đã lưu ${results.length} tài khoản.${scansStarted?.length?' Quét video đã chạy nền; bấm Phân tích để xem tiến độ.':''}`);
    const usernames = results.map(r => r.account.username);
    if (!state.refreshingAll) void refreshMany(usernames); else toast('Đã lưu tài khoản. Bấm cập nhật sau khi lượt hiện tại hoàn tất.');
  } catch (error) { toast(error.message, true); }
  finally { $('#add-button').disabled = false; }
});
for (const id of ['search', 'group-filter', 'status-filter', 'sort']) $(`#${id}`).addEventListener(id === 'search' ? 'input' : 'change', render);
$('#refresh-all').addEventListener('click', () => void refreshMany(state.accounts.map(a => a.username)));
$('#empty-add').addEventListener('click', () => $('#links').focus());
$('#account-rows').addEventListener('click', async event => {
  const button = event.target.closest('button[data-action]'); if (!button) return;
  const username = button.dataset.user;
  if (button.dataset.action === 'refresh') return void refreshAccount(username);
  if (button.dataset.action === 'detail') return void openDetail(username);
  if (button.dataset.action === 'videos') return void openVideos(username);
  if (button.dataset.action === 'delete' && confirm(`Xóa @${username} cùng ghi chú và lịch sử khỏi danh sách?`)) {
    try {
      await api(`/api/accounts/${encodeURIComponent(username)}`, { method: 'DELETE', body: '{}' });
      state.accounts = state.accounts.filter(a => a.username !== username); render(); toast('Đã xóa tài khoản khỏi danh sách.');
    } catch (error) { toast(error.message, true); }
  }
});
async function openDetail(username) {
  const account = state.accounts.find(a => a.username === username); if (!account) return;
  state.detail = username;
  $('#detail-profile').innerHTML = `<div class="detail-header">${avatar(account)}<div><h2>${escape(account.displayName || username)} ${account.verified ? '<span class="verified">✓</span>' : ''}</h2><div class="username">@${escape(username)}${account.privateAccount ? ' · Tài khoản riêng tư' : ''}</div></div></div><p class="detail-bio">${escape(account.bio ?? 'Chưa lấy được bio của tài khoản.')}</p><div class="detail-numbers">${[['followers','Người theo dõi'],['following','Đang theo dõi'],['likes','Lượt thích'],['videos','Video']].map(([key,label]) => `<div><strong>${number(account[key])}</strong><span>${label}</span></div>`).join('')}</div>${account.syncError ? `<div class="detail-warning">${escape(account.syncError)}<br>Lần thử gần nhất: ${escape(date(account.lastAttemptAt))}${account.lastSuccessAt ? `<br>Dữ liệu đang hiển thị được lấy lúc ${escape(date(account.lastSuccessAt))}.` : ''}</div>` : ''}`;
  $('#edit-group').value = account.group; $('#edit-status').value = account.status; $('#edit-notes').value = account.notes;
  $('#open-profile').href = account.profileUrl; $('#history-content').innerHTML = '<p>Đang tải lịch sử…</p>';
  if (!$('#detail-dialog').open) $('#detail-dialog').showModal();
  try {
    const { history } = await api(`/api/accounts/${encodeURIComponent(username)}/history`);
    if (state.detail !== username) return;
    if (!history.length) { $('#history-content').innerHTML = '<p>Lịch sử sẽ xuất hiện sau khi lấy dữ liệu thành công. Mỗi lần cập nhật thành công lưu một mốc; giữ tối đa 200 mốc gần nhất.</p>'; return; }
    const points = [...history].reverse().filter(h => h.followers != null);
    let chart = '';
    if (points.length > 1) {
      const min = Math.min(...points.map(p => p.followers)), max = Math.max(...points.map(p => p.followers));
      const coordinates = points.map((p,i) => `${10 + i / (points.length - 1) * 460},${90 - (p.followers - min) / (max - min || 1) * 75}`);
      chart = `<svg class="chart" viewBox="0 0 480 105" role="img" aria-label="Xu hướng người theo dõi theo các lần cập nhật"><polyline class="chart-line" points="${coordinates.join(' ')}"/>${coordinates.map(point => { const [cx,cy] = point.split(','); return `<circle class="chart-dot" cx="${cx}" cy="${cy}" r="2"/>`; }).join('')}</svg>`;
    }
    $('#history-content').innerHTML = chart + `<table><thead><tr><th>Thời điểm</th><th>Người theo dõi</th><th>Thay đổi</th></tr></thead><tbody>${history.slice(0, 15).map((item, index) => { const old = history[index+1]; const delta = old?.followers != null && item.followers != null ? item.followers - old.followers : null; return `<tr><td>${escape(date(item.capturedAt))}</td><td>${number(item.followers)}</td><td>${delta == null ? '—' : (delta > 0 ? '+' : '') + number(delta)}</td></tr>`; }).join('')}</tbody></table><p>Hiển thị 15 mốc mới nhất. Chỉ lưu dữ liệu thật từ những lần truy xuất thành công.</p>`;
  } catch (error) { if (state.detail === username) $('#history-content').textContent = error.message; }
}
function openVideos(username) {
  const account = state.accounts.find(item => item.username === username);
  if (account) return openVideoPanel(account, toast);
}
$('#close-dialog').addEventListener('click', () => $('#detail-dialog').close());
$('#detail-dialog').addEventListener('close', () => state.detail = null);
$('#edit-form').addEventListener('submit', async event => {
  event.preventDefault(); const username = state.detail; $('#save-button').disabled = true;
  try {
    const { account } = await api(`/api/accounts/${encodeURIComponent(username)}`, { method: 'PATCH', body: JSON.stringify({ group: $('#edit-group').value, status: $('#edit-status').value, notes: $('#edit-notes').value }) });
    upsert(account); render(); $('#detail-dialog').close(); toast('Đã lưu nhóm, trạng thái và ghi chú.');
  } catch (error) { toast(error.message, true); }
  finally { $('#save-button').disabled = false; }
});
try {
  const { accounts } = await api('/api/accounts'); state.accounts = accounts; render();
} catch (error) { $('#load-error').hidden = false; $('#load-error').textContent = `Không tải được danh sách: ${error.message} Hãy tải lại trang.`; }
