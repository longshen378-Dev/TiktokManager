import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(import.meta.url);
let ready=false;
try{ready=require('playwright-core/package.json').version==='1.64.0';}catch{}
if(!ready){
  console.log('Đang cài thành phần quét trình duyệt từ lockfile. Cần Internet ở lần chạy đầu.');
  const command=process.platform==='win32'?'cmd.exe':'npm';
  const args=process.platform==='win32'?['/d','/s','/c','npm ci --no-audit --no-fund']:['ci','--no-audit','--no-fund'];
  const result=spawnSync(command,args,{cwd:root,stdio:'inherit'});
  if(result.error||result.status!==0){console.error('Chưa cài được thành phần quét. Kiểm tra kết nối registry.npmjs.org rồi chạy lại.');process.exit(result.status||1);}
}
