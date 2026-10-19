# Nexus E-Commerce - Auth & Address Flow Postman Test Suite (NEX-116 / NEX-106)

Tài liệu hướng dẫn sử dụng bộ kiểm thử tự động Postman Collection Runner cho luồng Authentication, User Profile và Address trong hệ thống Nexus E-Commerce Backend.

---

## 1. Tổng quan bộ kiểm thử

Bộ kiểm thử được thiết kế để tự động hóa toàn bộ vòng đời xác thực của người dùng, kiểm tra cả các trường hợp thành công (Positive) và các trường hợp lỗi biên/bảo mật (Negative):

- **Tổng số folder:** 7 modules logic.
- **Tổng số request:** 26 HTTP requests có kịch bản tuần tự.
- **Cơ chế dữ liệu động:** Tự động sinh `testEmail`, `testPhone`, `testPassword`, `newPassword` ngẫu nhiên qua timestamp trong Pre-request Script để đảm bảo chạy lặp lại nhiều lần không bị lỗi trùng lặp dữ liệu (`409 Conflict`).
- **Cơ chế token:**
  - `accessToken` (JWT 8h) được lưu và truyền tự động qua biến môi trường `{{accessToken}}` trong header `Authorization: Bearer {{accessToken}}`.
  - `refreshToken` (HttpOnly Cookie 7 ngày) được quản lý tự động bởi Postman Native Cookie Jar. Tuyệt đối không đọc hoặc lưu lộ giá trị cookie bảo mật.
  - Kiểm thử cơ chế **Token Rotation** và **Token Invalidation** (khi đổi mật khẩu `tokenVersion` tăng làm vô hiệu hóa token cũ, và sau khi logout refresh token không thể tái sử dụng).
- **Vòng đời Address:** Kiểm tra xác thực, tạo/list/cập nhật/xóa, payload cập nhật rỗng, UUID không tồn tại, xóa lặp lại và xác nhận dữ liệu test đã được dọn trước khi logout.

---

## 2. Cấu trúc thư mục & Danh sách Requests

```text
Nexus E-Commerce - Auth Flow Automation
├── 01 - Register
│   ├── 01.1 - Register Success [201]
│   ├── 01.2 - Register Duplicate Email [409 Conflict]
│   └── 01.3 - Register Weak Password [400 Bad Request]
├── 02 - Login
│   ├── 02.1 - Login Incorrect Credentials [401 Unauthorized]
│   └── 02.2 - Login Success [200 OK]
├── 03 - Profile
│   ├── 03.1 - Get Profile Me Success [200 OK]
│   ├── 03.2 - Get Profile Me Missing Token [401 Unauthorized]
│   ├── 03.3 - Update Profile Success [200 OK]
│   └── 03.4 - Update Profile Empty Body [400 Bad Request]
├── 04 - Refresh Token
│   ├── 04.1 - Refresh Token Success [200 OK]
│   └── 04.2 - Get Profile With Refreshed Token [200 OK]
├── 05 - Password Change
│   ├── 05.1 - Change Password Wrong Current Password [400 Bad Request]
│   ├── 05.2 - Change Password Success [200 OK]
│   ├── 05.3 - Verify Old Access Token Invalidated [401 Unauthorized]
│   └── 05.4 - Login With New Password [200 OK]
├── 06 - Addresses
│   ├── 06.1 - List Addresses Missing Token [401 Unauthorized]
│   ├── 06.2 - Create Address [201 Created]
│   ├── 06.3 - List Addresses With Created Address [200 OK]
│   ├── 06.4 - Update Address Partially [200 OK]
│   ├── 06.5 - Update Address Empty Body [400 Bad Request]
│   ├── 06.6 - Update Unknown Address [404 Not Found]
│   ├── 06.7 - Delete Address [204 No Content]
│   ├── 06.8 - Delete Address Again [404 Not Found]
│   └── 06.9 - List Addresses After Delete [200 OK]
└── 07 - Logout & Invalidation
    ├── 07.1 - Logout Success [200 OK]
    └── 07.2 - Refresh Token After Logout [401 Unauthorized]
```

---

## 3. Các file cấu hình

| File                                                        | Mô tả                                                                                        |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `postman/Nexus_ECommerce_Auth_Flow.postman_collection.json` | Postman Collection Schema v2.1.0 chứa 26 requests, pre-request scripts và test assertions    |
| `postman/Nexus_ECommerce_Local.postman_environment.json`    | Environment cấu hình `baseUrl` và biến runtime (`accessToken`, `addressId`, `testEmail`,...) |

---

## 4. Điều kiện tiên quyết (Prerequisites)

1. **Khởi chạy Backend Server:**
   Đảm bảo backend đang chạy tại cổng mặc định `3000` (hoặc cổng được định nghĩa trong `.env`):

   ```bash
   # Tại thư mục gốc của dự án
   npm run start:dev
   # hoặc
   npm run dev
   ```

2. **Cơ sở dữ liệu Database:**
   Backend kết nối thành công tới cơ sở dữ liệu PostgreSQL (Supabase hoặc local) với đầy đủ các bảng trong schema `identity`. Bạn có thể kiểm tra kết nối bằng lệnh:

   ```bash
   npm run db:test
   ```

3. **Công cụ chạy test:**
   - Cài đặt ứng dụng **Postman Desktop** (khuyến nghị phiên bản mới nhất), HOẶC
   - Cài đặt **Newman CLI** nếu muốn chạy từ terminal / CI/CD:
     ```bash
     npm install -g newman
     ```

---

## 5. Hướng dẫn chạy bằng Postman Desktop (Collection Runner)

1. **Import vào Postman:**
   - Mở Postman Desktop.
   - Nhấn nút **Import** ở góc trên bên trái.
   - Chọn cả 2 file:
     - `postman/Nexus_ECommerce_Auth_Flow.postman_collection.json`
     - `postman/Nexus_ECommerce_Local.postman_environment.json`
2. **Chọn Environment:**
   - Ở góc trên bên phải giao diện Postman, trong menu dropdown môi trường, chọn **"Nexus E-Commerce Local"**.
   - Kiểm tra giá trị `baseUrl` (mặc định là `http://localhost:3000`).
3. **Mở Collection Runner:**
   - Nhấp chuột vào collection **"Nexus E-Commerce - Auth Flow Automation"**.
   - Nhấn nút **Run** (hoặc biểu tượng `...` -> **Run collection**).
4. **Cấu hình Runner:**
   - Chọn tất cả 26 requests theo đúng thứ tự mặc định.
   - **Run configuration:**
     - Iterations: `1`
     - Delay: `50 ms` (khuyến nghị để database hoàn tất các async transaction)
     - Data file: Không cần (dữ liệu được sinh tự động)
     - Tích chọn: **Persist responses for a session** và **Keep variable values**.
5. **Chạy test:**
   - Nhấn **Run Nexus E-Commerce - Auth Flow Automation**.
   - Theo dõi kết quả: Tất cả assertions đều có màu xanh lá (Pass).

---

## 6. Hướng dẫn chạy bằng Newman CLI (Command Line)

Chạy trực tiếp từ thư mục gốc dự án:

```bash
# Chạy với Newman CLI
npx newman run postman/Nexus_ECommerce_Auth_Flow.postman_collection.json \
  -e postman/Nexus_ECommerce_Local.postman_environment.json \
  --delay-request 50 \
  --reporters cli
```

Nếu muốn xuất báo cáo HTML:

```bash
npx newman run postman/Nexus_ECommerce_Auth_Flow.postman_collection.json \
  -e postman/Nexus_ECommerce_Local.postman_environment.json \
  --delay-request 50 \
  --reporters cli,htmlextra
```

> **Lưu ý về Cookie trong Newman:** Newman mặc định bật tính năng Cookie Jar, cho phép cookie HttpOnly `refreshToken` lưu và gửi tự động giữa các request cùng domain `localhost`.

---

## 7. Giải thích các assertions & luồng nghiệp vụ quan trọng

1. **Chuẩn hóa Envelope Response:**
   Mọi response thành công đều được xác thực qua envelope `{ success: true, data: ... }` do `TransformInterceptor` sinh ra. Mọi response lỗi đều được xác thực qua envelope `{ success: false, statusCode: ..., message: ..., error: ... }` do `HttpExceptionFilter` định dạng.
2. **Bảo vệ Cookie HttpOnly:**
   Không dùng mã script để can thiệp hoặc in giá trị của cookie `refreshToken`. Header `Set-Cookie` được kiểm tra sự hiện diện và cờ `HttpOnly` mà không làm lộ dữ liệu nhạy cảm.
3. **Kiểm tra Token Invalidation (`tokenVersion`):**
   Tại bước 05.2, `oldAccessToken` được lưu lại trước khi đổi mật khẩu. Tại bước 05.3, request gửi `oldAccessToken` tới `/api/v1/auth/me` và bắt buộc nhận về `401 Unauthorized`. Điều này chứng minh backend đã tăng `user.tokenVersion` và hủy quyền truy cập của token cũ thành công.
4. **Kiểm tra Refresh Token Revocation:**
   Sau khi gọi `/api/v1/auth/logout` ở bước 07.1, backend xóa cookie và cập nhật `revokedAt` trong bảng `identity.refresh_tokens`. Tại bước 07.2, khi cố gắng refresh lại, request sẽ bị từ chối với `401 Unauthorized`.
5. **Kiểm tra Address và dọn dữ liệu:**
   Folder 06 dùng access token mới từ bước 05.4, lưu duy nhất `addressId` được backend sinh ra để chạy cập nhật/xóa, kiểm tra các envelope lỗi `401`/`400`/`404`, sau đó xác nhận địa chỉ không còn trong danh sách. Biến `addressId` được xóa khỏi environment ở request cuối để lần chạy sau bắt đầu sạch.
