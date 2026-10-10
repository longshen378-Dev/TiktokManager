# TikTok Manager

Công cụ web tiếng Việt để quản lý nhiều tài khoản TikTok từ link hồ sơ công khai. Không cần mật khẩu TikTok hoặc API key.

## Chạy ứng dụng

### Trên máy cá nhân

Máy cloud chạy ứng dụng không đồng nghĩa máy cá nhân có thể mở ứng dụng đó; giao diện onboarding không cung cấp web preview. Khi mã nguồn đã có trên GitHub, bạn có thể tải toàn bộ dự án bằng **Code → Download ZIP**.

Giải nén gói mã nguồn, cài **Node.js 24.19 trở lên** và **Google Chrome hoặc Microsoft Edge**, rồi:

- Windows: mở `start.bat` trong thư mục dự án.
- macOS/Linux: mở terminal trong thư mục dự án và chạy `sh start.sh`.
- Hoặc chạy `npm run open` trong thư mục dự án trên cả ba hệ điều hành.

Lần đầu chạy, công cụ tự cài `playwright-core` theo lockfile (cần Internet), dùng Chrome/Edge đã có trên máy, rồi mở giao diện sau khi máy chủ sẵn sàng. Giữ cửa sổ terminal mở khi sử dụng. Nếu trình duyệt không tự mở, nhập `http://127.0.0.1:3000` vào thanh địa chỉ **trên máy vừa khởi động ứng dụng**. Không mở trực tiếp file `public/index.html` vì giao diện cần API của máy chủ.

### Trong workspace cloud

Yêu cầu **Node.js 24.19 trở lên**, Chrome/Edge/Chromium và phụ thuộc trong lockfile. Ứng dụng dùng HTTP và SQLite tích hợp sẵn.

```sh
cd /workspace/TiktokManager
npm ci --cache /workspace/.npm-cache --no-audit --no-fund
npm test
npm start
```

Ứng dụng mặc định lắng nghe trên `127.0.0.1:3000`. Khi chạy trên máy cá nhân, truy cập địa chỉ đó bằng trình duyệt. `npm run dev` tự khởi động lại máy chủ khi sửa code.

Biến tùy chọn: `PORT` (mặc định `3000`), `HOST` (mặc định `127.0.0.1`), `DATA_FILE` (đường dẫn SQLite, mặc định `data/accounts.sqlite`), `TIKTOK_BROWSER_PATH` (đường dẫn Chrome/Edge nếu không tự tìm thấy), `TIKTOK_HEADLESS=1` (không mở cửa sổ trình duyệt), `TIKTOK_SCAN_MODE=http` (chế độ HTML cũ, thường thiếu danh sách/chỉ số). Linux không có DISPLAY tự dùng headless. Dữ liệu tồn tại sau khi khởi động lại, không đưa vào Git. Sao lưu SQLite khi ứng dụng đã dừng; không chỉ sao chép file chính trong khi SQLite WAL đang hoạt động. Chỉ đặt `HOST=0.0.0.0` trong môi trường riêng được kiểm soát; ứng dụng chưa có đăng nhập/phân quyền và không dành cho triển khai công khai.

## Sử dụng

1. Dán `https://www.tiktok.com/@nopro0609` hoặc `@nopro0609`. Nhập nhiều tài khoản, mỗi dòng một link, tối đa 50 link/lần. Link video và link rút gọn không được hỗ trợ.
2. Bấm **Thêm tài khoản**. Link được lưu ngay; ứng dụng thử cập nhật dữ liệu từng tài khoản. Tùy chọn **Tự quét video khi thêm kênh** mặc định bật, xếp các kênh mới vào hàng đợi quét nền. Tài khoản trùng username không bị nhân đôi; kênh đã có có thể quét lại trong bảng Phân tích.
3. Bấm tên tài khoản hoặc nút `⋯` để xem bio, tên hiển thị, avatar, xác minh, trạng thái riêng tư, follower, following, lượt thích, số video và lịch sử. Thêm nhóm, trạng thái và ghi chú trong cửa sổ này.
4. Tìm kiếm, lọc theo nhóm/trạng thái, sắp xếp, cập nhật từng kênh hoặc tất cả; xuất dữ liệu bằng **Xuất CSV**.

## Theo dõi hiệu suất video

Ở cột **Video**, bấm **Phân tích ↗** để mở bảng hiệu suất của kênh:

- **Quét tự động** mở hồ sơ bằng Chrome/Edge, đọc dữ liệu do trang TikTok tải và cuộn trang để tìm thêm video. Không cần nhập từng link. Mặc định quét tối đa 50 video; có thể chọn 20/50/100/200. Danh sách vẫn có thể chỉ là một phần của kênh, không bảo đảm đủ mọi video.
- Chọn khoảng nghỉ **5/10/15/30 giây** giữa các lượt điều hướng/cuộn. Mặc định 5 giây, các kênh quét lần lượt. Đây là cách giảm tần suất thao tác, không bảo đảm tránh giới hạn: trang vẫn tự tải tài nguyên và API. Nếu gặp HTTP 429, công cụ dừng quét, giữ dữ liệu đã lấy và áp dụng thời gian chờ `Retry-After` (mặc định 60 giây, tối thiểu 30 giây).
- Tiến độ hiển thị video đã tìm thấy, video có lượt xem, video đã xử lý, thời gian chờ và nguyên nhân lỗi. Các thông số xuất hiện ngay khi lấy được. **Dừng quét** giữ dữ liệu đã thu thập. Đóng bảng Phân tích không dừng tác vụ nền; khởi động lại máy chủ không tự tiếp tục tác vụ cũ.
- Nếu TikTok yêu cầu xác minh, hoàn tất trong cửa sổ Chrome/Edge mà công cụ mở trên máy cá nhân (chờ tối đa 2 phút). Môi trường headless không tự giải xác minh. Không thay đổi cookie hay cấu hình trình duyệt cá nhân: công cụ dùng hồ sơ riêng trong `data/browser-profile/`.
- Mục **Thêm link video thủ công (tùy chọn)** vẫn hỗ trợ link video của đúng kênh, mỗi dòng một link. Ví dụ: `https://www.tiktok.com/@nopro0609/video/7686876318604037384`. Link được lưu ngay và thử lấy số liệu. Link video của kênh khác hoặc link rút gọn bị từ chối.
- Video có mô tả, link mở TikTok, ngày đăng, thời lượng và lượt xem/thích/bình luận/chia sẻ/lưu khi nguồn công khai cung cấp. Không tải file video về máy. Bấm **Cập nhật video** hoặc nút `↻` từng video để lấy lại số liệu.
- Bảng tổng hợp hiển thị tổng/trung bình/trung vị lượt xem, tổng tương tác, video nổi bật và biểu đồ so sánh lượt xem. Mỗi chỉ số cho biết có số liệu của bao nhiêu video. Chỉ phân tích các video đã theo dõi, không đại diện cho toàn bộ kênh nếu danh sách thiếu.
- Tỷ lệ tương tác có trọng số = `(tổng lượt thích + tổng bình luận + tổng chia sẻ) / tổng lượt xem × 100%`, chỉ tính trên video đủ cả bốn chỉ số và lượt xem lớn hơn 0. Lượt lưu được trình bày riêng. Không lấy trung bình đơn giản các tỷ lệ của từng video.
- Bộ lọc **Đăng trong 7/30/90 ngày** chọn theo ngày đăng; các chỉ số vẫn là số tích lũy của video, **không phải lượt xem phát sinh trong khoảng ngày đó**. Video chưa biết ngày đăng chỉ hiển thị trong bộ lọc tất cả.
- **Tăng lượt xem** là chênh lệch giữa hai mốc số liệu thành công liên tiếp của video. Bấm `▥` để xem thời điểm, nguồn và lịch sử; giữ tối đa 100 mốc/video. Các mốc có thể đến từ truy xuất công khai hoặc nhập tay, được đánh dấu riêng.
- Nếu truy xuất bị giới hạn, cửa sổ `▥` cho phép **Lưu số liệu nhập tay**. Lượt xem là bắt buộc; chỉ số chưa biết để trống. Đây là số liệu bạn cung cấp, không được gắn nhãn truy xuất từ TikTok.
- **Xuất CSV video** xuất các video trong bộ lọc đang chọn, kèm nguồn số liệu, thời điểm và lỗi cập nhật. Xóa video chỉ xóa dữ liệu theo dõi/lịch sử trong công cụ, không xóa video trên TikTok.

Trong chế độ HTML cũ, oEmbed chính thức có thể lấy mô tả/ảnh và xác minh chủ video. oEmbed **không cung cấp lượt xem và tương tác**: chỉ cập nhật mô tả, giữ số liệu cũ nếu có, báo `METRICS_UNAVAILABLE` và không tạo mốc hiệu suất giả. Với link ví dụ ở trên, lần kiểm tra HTML lấy được mô tả `#khangrong #tranbinh`, nhưng trang video bị WAF và trang nhúng trả HTTP 503. Bộ quét trình duyệt mới đã qua kiểm thử Chromium với trang/JSON giả lập; **chưa xác nhận được số liệu video thật trong cloud**, vì Chromium chưa tin cậy chứng chỉ proxy (`BROWSER_TLS_ERROR`). Thao tác thêm CA vào kho tin cậy đã bị duyệt tự động từ chối và chưa được thực hiện. Không tắt xác minh TLS; có thể chạy trên máy cá nhân với Chrome/Edge và mạng bình thường.

Khi cập nhật phiên bản, giữ nguyên thư mục `data/` của bản đang dùng. Các bảng video mới được tạo bổ sung khi khởi động, giữ nguyên tài khoản và ghi chú cũ.

## Truy xuất TikTok

Hồ sơ tài khoản đọc HTML công khai; video mặc định dùng Chrome/Edge để đọc dữ liệu nhúng và phản hồi JSON do chính trang TikTok tải bình thường trên `www.tiktok.com`. Công cụ không tự ký/gọi API nội bộ, dùng dịch vụ bên thứ ba hay vượt CAPTCHA/WAF. Các yêu cầu được xếp hàng và có khoảng nghỉ; không đồng bộ định kỳ tự động. Hồ sơ trình duyệt riêng có thể chứa trạng thái xác minh/đăng nhập nếu bạn thao tác trong cửa sổ đó; giữ riêng thư mục `data/`, không gửi lên Git.

TikTok có thể trả về CAPTCHA, 403/429, trang thiếu dữ liệu hoặc thay đổi định dạng. Truy xuất trực tiếp **không được bảo đảm**. Khi thất bại, ứng dụng báo nguyên nhân, giữ dữ liệu thành công lần trước và thời điểm lấy dữ liệu; số liệu chưa biết là `—`, không tự tạo số liệu. Tổng chỉ cộng các kênh đã có số liệu và cho biết số kênh được tính. Không cung cấp email, số điện thoại, doanh thu, thông tin đăng nhập hoặc analytics riêng tư.

Môi trường cloud cần cho phép HTTPS tới `www.tiktok.com`. Đã lưu bổ sung tên miền này trong bản nháp cài đặt môi trường và kiểm tra truy xuất thành công `@nopro0609` trong máy hiện tại. Để dùng lại cấu hình, review/save rồi publish trong Environment Settings; lưu bản nháp không đồng nghĩa đã publish. Node được chạy với `--use-env-proxy` để sử dụng proxy do nền tảng cung cấp. Ảnh đại diện được tải trực tiếp bởi trình duyệt từ URL HTTPS trong hồ sơ; nếu tải ảnh lỗi, dùng avatar chữ.

## Kiểm tra

`npm test` chạy 22 kiểm thử về link hồ sơ/video, trích xuất dữ liệu, oEmbed chỉ cung cấp metadata, tính hiệu suất và phạm vi ngày đăng, lỗi mạng/TikTok, nâng cấp SQLite từ bản cũ, giữ số liệu khi lỗi, chuỗi thao tác HTTP, nguồn nhập tay, CSV, hàng đợi quét, hủy tác vụ, khoảng nghỉ và cooldown. Một kiểm thử mở Chromium thật với trang/JSON giả lập để xác nhận đọc danh sách video JavaScript và chỉ số; bài này được bỏ qua nếu máy chưa cài trình duyệt. Trong cloud hiện tại cả 22 bài đã chạy và qua. Các fixture không được nạp vào ứng dụng và không chứng minh truy xuất trực tiếp TikTok thành công.

Mã nguồn: `server.js` (HTTP API), `lib/tiktok.js` (hồ sơ), `lib/videos.js` (parser và hiệu suất), `lib/browser-scanner.js` (Chrome/Edge), `lib/scans.js` (tác vụ quét nền), `lib/pacer.js` (khoảng nghỉ), `lib/store.js` (SQLite), `public/` (giao diện). Lịch sử hồ sơ giữ tối đa 200 mốc/tài khoản, lịch sử hiệu suất giữ 100 mốc/video. Xóa tài khoản cũng xóa các video theo dõi và lịch sử của tài khoản đó.
