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

## Truy xuất TikTok

Máy chủ truy cập đúng `https://www.tiktok.com/@username` và đọc dữ liệu JSON công khai trong trang (`__UNIVERSAL_DATA_FOR_REHYDRATION__` hoặc `SIGI_STATE`). Không dùng API nội bộ, cookie đăng nhập, dịch vụ bên thứ ba hoặc cơ chế vượt CAPTCHA. Các yêu cầu cập nhật được xếp hàng; không đồng bộ định kỳ tự động.

TikTok có thể trả về CAPTCHA, 403/429, trang thiếu dữ liệu hoặc thay đổi định dạng. Truy xuất trực tiếp **không được bảo đảm**. Khi thất bại, ứng dụng báo nguyên nhân, giữ dữ liệu thành công lần trước và thời điểm lấy dữ liệu; số liệu chưa biết là `—`, không tự tạo số liệu. Tổng chỉ cộng các kênh đã có số liệu và cho biết số kênh được tính. Không cung cấp email, số điện thoại, doanh thu, thông tin đăng nhập hoặc analytics riêng tư.

Môi trường cloud cần cho phép HTTPS tới `www.tiktok.com`. Đã lưu bổ sung tên miền này trong bản nháp cài đặt môi trường và kiểm tra truy xuất thành công `@nopro0609` trong máy hiện tại. Để dùng lại cấu hình, review/save rồi publish trong Environment Settings; lưu bản nháp không đồng nghĩa đã publish. Node được chạy với `--use-env-proxy` để sử dụng proxy do nền tảng cung cấp. Ảnh đại diện được tải trực tiếp bởi trình duyệt từ URL HTTPS trong hồ sơ; nếu tải ảnh lỗi, dùng avatar chữ.

## Kiểm tra

`npm test` kiểm thử phân tích link, trích xuất dữ liệu, lỗi mạng/TikTok, lưu trữ SQLite qua lần khởi động lại, giữ số liệu khi lỗi, chuỗi thao tác HTTP và xuất CSV. Các fixture trong kiểm thử là dữ liệu giả lập và không được nạp vào ứng dụng. Kiểm thử parser/API không chứng minh truy xuất trực tiếp TikTok thành công; cần thử link thật trong môi trường có quyền mạng.

Mã nguồn: `server.js` (HTTP API), `lib/tiktok.js` (truy xuất hồ sơ), `lib/store.js` (SQLite), `public/` (giao diện). Lịch sử giữ tối đa 200 mốc thành công/tài khoản. Xóa tài khoản cũng xóa lịch sử của tài khoản đó.
