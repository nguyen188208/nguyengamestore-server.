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
