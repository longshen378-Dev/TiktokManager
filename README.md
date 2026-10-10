# TikTok Manager

Công cụ web tiếng Việt để quản lý nhiều tài khoản TikTok từ link hồ sơ công khai. Không cần mật khẩu TikTok hoặc API key.

## Chạy ứng dụng

### Trên máy cá nhân

Máy cloud chạy ứng dụng không đồng nghĩa máy cá nhân có thể mở ứng dụng đó; giao diện onboarding không cung cấp web preview. Khi mã nguồn đã có trên GitHub, bạn có thể tải toàn bộ dự án bằng **Code → Download ZIP**.

Giải nén gói mã nguồn, cài **Node.js 24.19 trở lên**, rồi:

- Windows: mở `start.bat` trong thư mục dự án.
- macOS/Linux: mở terminal trong thư mục dự án và chạy `sh start.sh`.
- Hoặc chạy `npm run open` trong thư mục dự án trên cả ba hệ điều hành.

Các cách này khởi động máy chủ trên máy của bạn, rồi mở trình duyệt sau khi máy chủ sẵn sàng. Giữ cửa sổ terminal mở khi sử dụng. Không cần chạy `npm install`. Nếu trình duyệt không tự mở, nhập `http://127.0.0.1:3000` vào thanh địa chỉ **trên máy vừa khởi động ứng dụng**. Không mở trực tiếp file `public/index.html` vì giao diện cần API của máy chủ.

### Trong workspace cloud

Yêu cầu **Node.js 24.19 trở lên**. Ứng dụng dùng HTTP và SQLite tích hợp sẵn, không có phụ thuộc npm cần cài.

```sh
cd /workspace/TiktokManager
npm test
npm start
```

Ứng dụng mặc định lắng nghe trên `127.0.0.1:3000`. Khi chạy trên máy cá nhân, truy cập địa chỉ đó bằng trình duyệt. `npm run dev` tự khởi động lại máy chủ khi sửa code.

Biến tùy chọn: `PORT` (mặc định `3000`), `HOST` (mặc định `127.0.0.1`), `DATA_FILE` (đường dẫn SQLite, mặc định `data/accounts.sqlite`). Dữ liệu tồn tại sau khi khởi động lại, không đưa vào Git. Sao lưu SQLite khi ứng dụng đã dừng; không chỉ sao chép file chính trong khi SQLite WAL đang hoạt động. Chỉ đặt `HOST=0.0.0.0` trong môi trường riêng được kiểm soát; ứng dụng chưa có đăng nhập/phân quyền và không dành cho triển khai công khai.

## Sử dụng

1. Dán `https://www.tiktok.com/@nopro0609` hoặc `@nopro0609`. Nhập nhiều tài khoản, mỗi dòng một link, tối đa 50 link/lần. Link video và link rút gọn không được hỗ trợ.
2. Bấm **Thêm tài khoản**. Link được lưu ngay; ứng dụng thử cập nhật dữ liệu từng tài khoản. Tài khoản trùng username không bị nhân đôi.
3. Bấm tên tài khoản hoặc nút `⋯` để xem bio, tên hiển thị, avatar, xác minh, trạng thái riêng tư, follower, following, lượt thích, số video và lịch sử. Thêm nhóm, trạng thái và ghi chú trong cửa sổ này.
4. Tìm kiếm, lọc theo nhóm/trạng thái, sắp xếp, cập nhật từng kênh hoặc tất cả; xuất dữ liệu bằng **Xuất CSV**.

## Theo dõi hiệu suất video

Ở cột **Video**, bấm **Phân tích ↗** để mở bảng hiệu suất của kênh:

- **Tìm video của kênh** thử lấy danh sách từ trang hồ sơ và trang nhúng công khai. Mỗi lần nhập tối đa 50 video có trong trang trả về. Danh sách có thể chỉ là một phần của kênh; không có phân trang tự động. Nếu TikTok không cung cấp danh sách, ứng dụng báo rõ thay vì kết luận kênh không có video.
- Dán link video của đúng kênh, mỗi dòng một link, rồi bấm **Thêm video**. Ví dụ: `https://www.tiktok.com/@nopro0609/video/7686876318604037384`. Link được lưu ngay và thử lấy số liệu. Link video của kênh khác hoặc link rút gọn bị từ chối.
- Video có mô tả, link mở TikTok, ngày đăng, thời lượng và lượt xem/thích/bình luận/chia sẻ/lưu khi nguồn công khai cung cấp. Không tải file video về máy. Bấm **Cập nhật video** hoặc nút `↻` từng video để lấy lại số liệu.
- Bảng tổng hợp hiển thị tổng/trung bình/trung vị lượt xem, tổng tương tác, video nổi bật và biểu đồ so sánh lượt xem. Mỗi chỉ số cho biết có số liệu của bao nhiêu video. Chỉ phân tích các video đã theo dõi, không đại diện cho toàn bộ kênh nếu danh sách thiếu.
- Tỷ lệ tương tác có trọng số = `(tổng lượt thích + tổng bình luận + tổng chia sẻ) / tổng lượt xem × 100%`, chỉ tính trên video đủ cả bốn chỉ số và lượt xem lớn hơn 0. Lượt lưu được trình bày riêng. Không lấy trung bình đơn giản các tỷ lệ của từng video.
- Bộ lọc **Đăng trong 7/30/90 ngày** chọn theo ngày đăng; các chỉ số vẫn là số tích lũy của video, **không phải lượt xem phát sinh trong khoảng ngày đó**. Video chưa biết ngày đăng chỉ hiển thị trong bộ lọc tất cả.
- **Tăng lượt xem** là chênh lệch giữa hai mốc số liệu thành công liên tiếp của video. Bấm `▥` để xem thời điểm, nguồn và lịch sử; giữ tối đa 100 mốc/video. Các mốc có thể đến từ truy xuất công khai hoặc nhập tay, được đánh dấu riêng.
- Nếu truy xuất bị giới hạn, cửa sổ `▥` cho phép **Lưu số liệu nhập tay**. Lượt xem là bắt buộc; chỉ số chưa biết để trống. Đây là số liệu bạn cung cấp, không được gắn nhãn truy xuất từ TikTok.
- **Xuất CSV video** xuất các video trong bộ lọc đang chọn, kèm nguồn số liệu, thời điểm và lỗi cập nhật. Xóa video chỉ xóa dữ liệu theo dõi/lịch sử trong công cụ, không xóa video trên TikTok.

oEmbed chính thức có thể lấy mô tả/ảnh và xác minh chủ video khi trang video yêu cầu xác minh truy cập. oEmbed **không cung cấp lượt xem và tương tác**: trường hợp này chỉ cập nhật mô tả, giữ số liệu cũ nếu có, báo `METRICS_UNAVAILABLE` và không tạo mốc hiệu suất giả. Trong lần kiểm tra cloud, link ví dụ ở trên lấy được mô tả `#khangrong #tranbinh`, nhưng trang video bị WAF và trang nhúng danh sách trả HTTP 503. Chưa xác nhận được truy xuất lượt xem của video này trong cloud.

Khi cập nhật phiên bản, giữ nguyên thư mục `data/` của bản đang dùng. Các bảng video mới được tạo bổ sung khi khởi động, giữ nguyên tài khoản và ghi chú cũ.

## Truy xuất TikTok

Máy chủ truy cập hồ sơ/video, trang nhúng của TikTok và oEmbed chính thức trên `www.tiktok.com`, đọc dữ liệu công khai (`__UNIVERSAL_DATA_FOR_REHYDRATION__`, `SIGI_STATE`, `__FRONTITY_CONNECT_STATE__`). Không dùng API nội bộ, cookie đăng nhập, dịch vụ bên thứ ba hoặc cơ chế vượt CAPTCHA/WAF. Các yêu cầu cập nhật được xếp hàng; không đồng bộ định kỳ tự động.

TikTok có thể trả về CAPTCHA, 403/429, trang thiếu dữ liệu hoặc thay đổi định dạng. Truy xuất trực tiếp **không được bảo đảm**. Khi thất bại, ứng dụng báo nguyên nhân, giữ dữ liệu thành công lần trước và thời điểm lấy dữ liệu; số liệu chưa biết là `—`, không tự tạo số liệu. Tổng chỉ cộng các kênh đã có số liệu và cho biết số kênh được tính. Không cung cấp email, số điện thoại, doanh thu, thông tin đăng nhập hoặc analytics riêng tư.

Môi trường cloud cần cho phép HTTPS tới `www.tiktok.com`. Đã lưu bổ sung tên miền này trong bản nháp cài đặt môi trường và kiểm tra truy xuất thành công `@nopro0609` trong máy hiện tại. Để dùng lại cấu hình, review/save rồi publish trong Environment Settings; lưu bản nháp không đồng nghĩa đã publish. Node được chạy với `--use-env-proxy` để sử dụng proxy do nền tảng cung cấp. Ảnh đại diện được tải trực tiếp bởi trình duyệt từ URL HTTPS trong hồ sơ; nếu tải ảnh lỗi, dùng avatar chữ.

## Kiểm tra

`npm test` chạy 15 kiểm thử về link hồ sơ/video, trích xuất dữ liệu, oEmbed chỉ cung cấp metadata, tính hiệu suất và phạm vi ngày đăng, lỗi mạng/TikTok, nâng cấp SQLite từ bản cũ và lưu dữ liệu qua lần khởi động lại, giữ số liệu khi lỗi, chuỗi thao tác HTTP, nguồn nhập tay và xuất CSV. Các fixture trong kiểm thử là dữ liệu giả lập và không được nạp vào ứng dụng. Kiểm thử parser/API không chứng minh truy xuất trực tiếp TikTok thành công; cần thử link thật trong môi trường có quyền mạng.

Mã nguồn: `server.js` (HTTP API), `lib/tiktok.js` (truy xuất hồ sơ), `lib/videos.js` (truy xuất và tính hiệu suất video), `lib/store.js` (SQLite), `public/` (giao diện). Lịch sử hồ sơ giữ tối đa 200 mốc/tài khoản, lịch sử hiệu suất giữ 100 mốc/video. Xóa tài khoản cũng xóa các video theo dõi và lịch sử của tài khoản đó.
