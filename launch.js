import { spawn } from 'node:child_process';
import { createApp } from './server.js';

// Desktop entry point: open the browser only after the HTTP server is listening.
const { server, store } = createApp();
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 3000);
server.once('error', error => {
  console.error(error.code === 'EADDRINUSE'
    ? `Cổng ${port} đang được sử dụng. Dừng phiên đang chạy hoặc chọn PORT khác.`
    : `Không khởi động được máy chủ: ${error.message}`);
  store.close(); process.exitCode = 1;
});
server.listen(port, host, () => {
  const browserHost = host === '0.0.0.0' ? '127.0.0.1' : host;
  const url = `http://${browserHost}:${server.address().port}`;
  console.log(`TikTok Manager đã chạy. Địa chỉ trên máy của bạn: ${url}`);
  console.log('Giữ cửa sổ này mở trong khi sử dụng. Nhấn Ctrl+C để dừng.');
  if (process.env.BROWSER === 'none') return;
  const command = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const child = spawn(command, [url], { detached: true, stdio: 'ignore' });
  child.once('error', () => console.log('Không mở được trình duyệt tự động. Hãy nhập địa chỉ ở trên vào trình duyệt.'));
  child.unref();
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(() => { store.close(); process.exit(0); }));
