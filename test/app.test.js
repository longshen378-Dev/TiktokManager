import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseUsername, extractProfile, fetchProfile, ProfileError } from '../lib/tiktok.js';
import { createStore } from '../lib/store.js';
import { createApp, exportCsv } from '../server.js';

const profile = { displayName: 'Kênh thử nghiệm', bio: 'Bio thử nghiệm', avatar: null, verified: false, privateAccount: false, followers: 120, following: 5, likes: 900, videos: 12 };
// Synthetic fixtures test parsing; the application never seeds accounts or statistics.
function hydration(user, stats) {
  return `<html><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({ __DEFAULT_SCOPE__: { 'webapp.user-detail': { userInfo: { user, stats } } } })}</script></html>`;
}
test('normalizes profile links and rejects videos, credentials, ports and arbitrary hosts', () => {
  assert.equal(parseUsername(' https://www.tiktok.com/@nopro0609?lang=vi '), 'nopro0609');
  assert.equal(parseUsername('@Example_2'), 'example_2');
  assert.equal(parseUsername('HTTPS://www.tiktok.com/@Example_2'), 'example_2');
  for (const link of ['https://evil.com/@user', 'https://www.tiktok.com.evil.com/@user', 'https://www.tiktok.com/@user/video/1', 'https://user:pass@www.tiktok.com/@user', 'https://www.tiktok.com:8080/@user', 'http://127.0.0.1/', 'bad user', '@test.', 'https://vm.tiktok.com/abc/']) assert.throws(() => parseUsername(link), ProfileError);
});
test('extracts public profile and preserves missing counters as null', () => {
  const html = hydration({ uniqueId: 'nopro0609', nickname: 'Nopro', signature: 'Xin chào', verified: true }, { followerCount: '1234', heart: 0, followingCount: 5 });
  const data = extractProfile(html, 'nopro0609');
  assert.equal(data.followers, 1234); assert.equal(data.likes, 0); assert.equal(data.videos, null); assert.equal(data.verified, true);
  assert.throws(() => extractProfile(html, 'someone_else'), /Chưa đọc/);
  assert.throws(() => extractProfile('<p>verify you are human captcha</p>', 'nopro0609'), error => error.code === 'TIKTOK_CHALLENGE');
});
test('supports SIGI_STATE and malformed or partial hydration', () => {
  const data = { UserModule: { users: { nopro0609: { id: '123', uniqueId: 'nopro0609', nickname: 'Nopro' } }, stats: { '123': { followerCount: 9, videoCount: 2 } } } };
  assert.equal(extractProfile(`<script id='SIGI_STATE'>${JSON.stringify(data)}</script>`, 'nopro0609').followers, 9);
  assert.throws(() => extractProfile('<script id="SIGI_STATE">not json</script>', 'nopro0609'), ProfileError);
  const partial = extractProfile(hydration({ uniqueId: 'nopro0609' }, { followerCount: -1, videoCount: ' ', heartCount: 'bad' }), 'nopro0609');
  assert.equal(partial.followers, null); assert.equal(partial.videos, null); assert.equal(partial.likes, null);
});
test('fetches only a canonical destination and reports HTTP, network and challenge failures', async () => {
  const result = await fetchProfile('nopro0609', async (url, options) => {
    assert.equal(url, 'https://www.tiktok.com/@nopro0609'); assert.equal(options.redirect, 'manual');
    return new Response(hydration({ uniqueId: 'nopro0609' }, { followerCount: 7 }));
  });
  assert.equal(result.followers, 7);
  await assert.rejects(fetchProfile('nopro0609', async () => new Response('', { status: 403 })), error => error.code === 'ACCESS_BLOCKED');
  await assert.rejects(fetchProfile('nopro0609', async () => { throw new Error('proxy credential must not leak'); }), error => error.code === 'NETWORK_ERROR' && !error.message.includes('credential'));
  await assert.rejects(fetchProfile('nopro0609', async () => new Response('', { status: 302, headers: { Location: 'http://localhost/' } })), error => error.code === 'HTTP_ERROR');
  await assert.rejects(fetchProfile('nopro0609', async () => new Response('x'.repeat(4_000_001))), error => error.code === 'RESPONSE_TOO_LARGE');
});
test('persists accounts and snapshots across restart, retains old data on failure and cascades deletion', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tiktok-store-')); const path = join(dir, 'data.sqlite');
  let store = createStore(path);
  try {
    store.add('nopro0609'); store.add('nopro0609'); assert.equal(store.list().length, 1);
    store.edit('nopro0609', { notes: 'Nội dung tuần tới', group: 'Kênh chính', status: 'review' });
    store.success('nopro0609', profile); store.success('nopro0609', { ...profile, followers: 125 });
    store.failure('nopro0609', new ProfileError('ACCESS_BLOCKED', 'Bị chặn'));
    assert.equal(store.get('nopro0609').followers, 125); assert.equal(store.history('nopro0609').length, 2);
    store.close(); store = createStore(path);
    assert.equal(store.get('nopro0609').notes, 'Nội dung tuần tới'); assert.equal(store.get('nopro0609').syncCode, 'ACCESS_BLOCKED');
    store.remove('nopro0609'); assert.equal(store.history('nopro0609').length, 0);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('HTTP workflow: import, deduplicate, refresh, edit, history, export, validation and delete', async () => {
  const store = createStore(':memory:'); let blocked = false;
  const { server } = createApp({ store, profileFetcher: async () => { if (blocked) throw new ProfileError('ACCESS_BLOCKED', 'Không lấy được dữ liệu'); return profile; } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, method = 'GET', body, headers = {}) => fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  try {
    assert.equal((await request('/api/health')).status, 200);
    assert.equal((await request('/')).status, 200);
    let response = await request('/api/accounts', 'POST', { links: ['https://www.tiktok.com/@nopro0609', '@nopro0609', '@second'] });
    assert.equal(response.status, 201); assert.equal((await response.json()).results.length, 2);
    response = await request('/api/accounts/nopro0609/refresh', 'POST', {});
    assert.equal((await response.json()).account.followers, 120);
    response = await request('/api/accounts/nopro0609', 'PATCH', { group: 'Bán hàng', notes: '=HYPERLINK("evil")', status: 'paused', followers: 99999 });
    const edited = (await response.json()).account; assert.equal(edited.group, 'Bán hàng'); assert.equal(edited.followers, 120);
    assert.equal((await (await request('/api/accounts/nopro0609/history')).json()).history.length, 1);
    const csv = await (await request('/api/export.csv')).text(); assert.match(csv, /Bán hàng/); assert.match(csv, /'=HYPERLINK/);
    blocked = true;
    const failed = (await (await request('/api/accounts/nopro0609/refresh', 'POST', {})).json()).account;
    assert.equal(failed.followers, 120); assert.equal(failed.syncCode, 'ACCESS_BLOCKED');
    assert.equal((await request('/api/accounts', 'POST', { links: ['@valid', 'https://evil.com/@test'] })).status, 400);
    assert.equal(store.get('valid'), null, 'invalid batch must not partially save');
    assert.equal((await request('/api/accounts', 'POST', { links: ['@third'] }, { Origin: 'https://evil.com' })).status, 403);
    assert.equal((await request('/api/accounts/nopro0609', 'PATCH', { status: 'fake' })).status, 400);
    assert.equal((await request('/api/accounts/nopro0609', 'DELETE', {})).status, 200);
    assert.equal((await request('/api/accounts/nopro0609/history')).status, 404);
    assert.equal(store.list().length, 1);
  } finally { await new Promise(resolve => server.close(resolve)); store.close(); }
});
test('CSV escapes quotes, line breaks, formulas and unknown values', () => {
  const csv = exportCsv([{ username: 'user', notes: '  =1+1', bio: 'a,"b"\nline', followers: null }]);
  assert.match(csv, /'  =1\+1/); assert.match(csv, /a,""b""\nline/);
});
