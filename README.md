# NGUYENGAMESTORE — bản Server + Database

Bản này chuyển dữ liệu khỏi localStorage sang SQLite và có API/backend Node.js.

## Chạy trên máy
1. Cài Node.js 20+.
2. Mở terminal tại thư mục này.
3. `npm install`
4. Đặt biến môi trường `ADMIN_PASSWORD` thành mật khẩu admin thật.
5. `npm start`
6. Mở `http://localhost:3000`

Database tự tạo thành `store.db`.

## Đưa lên server
Có thể chạy trên VPS/Render/Railway/Fly.io hoặc máy chủ Node.js. Cần giữ file `store.db` trên persistent disk/volume nếu dùng SQLite.

## API
- GET `/api/products`
- POST `/api/orders/card`
- POST `/api/orders/bank`
- POST `/api/orders/topup`
- POST `/api/orders/buy`
- POST `/api/admin/login`
- Admin APIs dùng Bearer token.

## Lưu ý
- Không dùng mật khẩu mặc định.
- Đổi thông tin ngân hàng mẫu trước khi mở bán.
- API đổi thẻ/nạp game chưa tự xác minh thẻ hoặc tự nạp game; muốn tự động cần API nhà cung cấp/webhook tương ứng.
