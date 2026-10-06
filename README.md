# NGUYENGAMESTORE

## Quan trọng: lỗi "Failed to fetch"
Nếu website đã đưa lên Railway mà đăng ký báo “Có lỗi máy chủ”, hãy kiểm tra log deploy. Bản này đã bổ sung migration cho database cũ, đặc biệt là các cột của bảng `users`, để tránh lỗi khi Railway đang giữ database từ bản trước. Nếu chạy local, không mở `public/index.html` trực tiếp bằng ZArchiver/Cốc Cốc.

### Chạy trên máy tính
1. Cài Node.js 20+
2. Mở Terminal/CMD trong thư mục dự án.
3. Chạy `npm install`
4. Chạy `npm start`
5. Mở `http://localhost:3000` trong trình duyệt.

Không mở file `public/index.html` trực tiếp.

### Tài khoản admin
Mặc định username là `admin`. Hãy đặt mật khẩu admin bằng biến môi trường `ADMIN_PASSWORD` trước khi chạy server. Không nên dùng mật khẩu mặc định `CHANGE_ME_NOW` khi đưa lên Internet.

### Railway / hosting
Hosting phải hỗ trợ Node.js và chạy được `npm start`. Nếu dùng database SQLite, cần lưu trữ persistent volume/disk để dữ liệu tài khoản và đơn hàng không mất sau khi server khởi động lại.

### Lưu ý database cũ
Nếu Railway dùng database cũ, server tự bổ sung các cột còn thiếu cho bảng users/products/orders khi khởi động. Sau khi deploy bản mới, thử đăng ký một tên tài khoản mới.


## Cập nhật v11
- Thêm dịch vụ Nạp game: Robux chính hãng và 120h.
- Hiển thị số tiền thanh toán tự động theo chiết khấu.
- Thêm phí rút cố định do admin cấu hình; ví dụ rút 100.000đ, phí 5.000đ thì tổng trừ ví 105.000đ.
- Phí rút mới được áp dụng tự động cho các yêu cầu rút mới.


## Tích hợp nạp thẻ tự động Thesieure

API Recharge được nối ở server, không đặt Partner Key trong frontend. Railway cần các biến môi trường:

- `THESIEURE_PARTNER_ID=27037193245`
- `THESIEURE_PARTNER_KEY=...` (Partner Key thật của Merchant)
- `THESIEURE_API_URL=https://thesieure.com/chargingws/v2`
- `THESIEURE_API_METHOD=GET` (đổi thành `POST` nếu API Merchant của bạn yêu cầu POST)

Callback URL cần khai báo trong Merchant là:
`https://<domain-Railway-cua-ban>/api/webhooks/thesieure/charging`

Server kiểm tra chữ ký callback khi Thesieure gửi chữ ký; nếu Merchant callback của bạn không gửi chữ ký, có thể dùng `THESIEURE_CALLBACK_TOKEN` và URL callback kèm `?token=...` (chỉ khi Merchant hỗ trợ query parameters). Server đối chiếu `request_id`, mã thẻ/serial và dùng transaction SQLite để đảm bảo callback trùng không cộng tiền lần hai. `provider_tx_id` cũng được unique để chống xử lý lại cùng giao dịch.

## Chuyển khoản tự động

Đơn chuyển khoản tạo nội dung duy nhất dạng `NGS XXXXXXXX`. Endpoint webhook của website là:
`/api/webhooks/bank`

Railway cần `BANK_WEBHOOK_SECRET`. Đơn vị ngân hàng/trung gian cần gửi `transaction_id`, `amount`, `content` và tùy chọn `type` (`IN`/`CREDIT`). Server chỉ tự cộng khi số tiền + nội dung khớp đúng một đơn pending và mã giao dịch chưa từng xử lý.

## Lưu ý

Thesieure phải kích hoạt API Merchant và callback cho tài khoản của bạn. URL/API cụ thể có thể khác theo cấu hình Merchant, vì vậy `THESIEURE_API_URL` và `THESIEURE_API_METHOD` được để cấu hình thay vì hard-code bắt buộc.

## Bảo vệ dữ liệu khi cập nhật
- Không đưa `store.db` vào ZIP deploy. Database phải nằm trên Railway Volume.
- Railway: tạo Volume và mount vào `/data`, sau đó đặt biến `DB_PATH=/data/store.db` và `BACKUP_DIR=/data/backups`.
- Server tự tạo backup lúc khởi động và mỗi 6 giờ, giữ tối đa 20 bản gần nhất.
- Admin có thể gọi chức năng backup/restore trong API quản trị; luôn nên backup trước khi cập nhật phiên bản.
- Không xóa Volume khi redeploy. Chỉ thay source code/ZIP.


## v34 UI/history changes
- Đưa form nạp/đổi thẻ lên trên, phần chiết khấu xuống dưới.
- Thêm cảnh báo: nếu sau 5 phút tiền chưa vào số dư, liên hệ Admin.
- Lịch sử đơn hàng và lịch sử nạp tiền hiển thị dạng bảng giống bố cục Thesieure: Mã đơn, Trước GD, Số tiền, Sau GD, Tiền tệ, Ngày tạo, Mô tả.
- Lưu số dư trước/sau giao dịch cho các giao dịch mới; dữ liệu cũ chưa có mốc số dư sẽ hiển thị 0 nếu chưa được ghi nhận.
- Cấu hình `trust proxy` cho Railway để tránh lỗi `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR`.
