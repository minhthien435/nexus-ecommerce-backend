# Hướng dẫn tích hợp API Upload hình ảnh lên Supabase Storage

Tài liệu hướng dẫn dành cho Frontend (Web/Mobile) và QA để tích hợp tính năng tải ảnh (ảnh sản phẩm, logo/banner cửa hàng, ảnh đại diện) lên Supabase Storage qua Backend Nexus E-Commerce.

---

## 1. Tổng quan Endpoint

| Phương thức | Đường dẫn API                   |       Xác thực       |   Định dạng Payload   | Mục đích                                                          |
| :---------- | :------------------------------ | :------------------: | :-------------------: | :---------------------------------------------------------------- |
| `POST`      | `/api/v1/media/upload`          | `Bearer AccessToken` | `multipart/form-data` | Tải 1 ảnh (ảnh đại diện, avatar, logo shop, ảnh chính sản phẩm)   |
| `POST`      | `/api/v1/media/upload-multiple` | `Bearer AccessToken` | `multipart/form-data` | Tải nhiều ảnh cùng lúc (tối đa 10 ảnh cho gallery/album sản phẩm) |

---

## 2. Giới hạn & Ràng buộc bảo mật

- **Dung lượng tối đa**: 5MB / file (`5 * 1024 * 1024 bytes`).
- **Định dạng cho phép**: `image/jpeg`, `image/png`, `image/webp`, `image/gif`.
- **Lưu trữ**: Supabase Storage bucket `nexus-media` (Public bucket, CDN caching tự động).
- **Phân thư mục (`folder`)**:
  - `products` (mặc định): Ảnh sản phẩm, thumbnail, gallery.
  - `shops`: Logo shop, banner cửa hàng.
  - `avatars`: Ảnh đại diện người dùng.

---

## 3. Chi tiết API

### 3.1. Upload 1 ảnh (`POST /api/v1/media/upload`)

#### Headers

```http
Authorization: Bearer <access_token>
Content-Type: multipart/form-data
```

#### Request Form Data (Body)

| Field    | Type            | Bắt buộc | Mô tả                                                                     |
| :------- | :-------------- | :------: | :------------------------------------------------------------------------ |
| `file`   | `File` (Binary) |    Có    | File ảnh cần upload (jpg, png, webp, gif)                                 |
| `folder` | `String`        |  Không   | Thư mục lưu (ví dụ: `products`, `shops`, `avatars`). Mặc định: `products` |

#### Response thành công (`201 Created`)

```json
{
  "success": true,
  "statusCode": 201,
  "message": "Tải ảnh lên thành công",
  "data": {
    "url": "https://plldmvgztekeiwcweiti.supabase.co/storage/v1/object/public/nexus-media/products/1793715684206-a5170d47-66a1-4328-98e3-4d693bfb5883.png",
    "key": "products/1793715684206-a5170d47-66a1-4328-98e3-4d693bfb5883.png",
    "size": 154230,
    "mimetype": "image/png"
  }
}
```

---

### 3.2. Upload nhiều ảnh (`POST /api/v1/media/upload-multiple`)

#### Headers

```http
Authorization: Bearer <access_token>
Content-Type: multipart/form-data
```

#### Request Form Data (Body)

| Field    | Type                    | Bắt buộc | Mô tả                              |
| :------- | :---------------------- | :------: | :--------------------------------- |
| `files`  | `File[]` (Binary array) |    Có    | Danh sách file ảnh (tối đa 10 ảnh) |
| `folder` | `String`                |  Không   | Thư mục lưu (mặc định: `products`) |

#### Response thành công (`201 Created`)

```json
{
  "success": true,
  "statusCode": 201,
  "message": "Tải danh sách ảnh lên thành công",
  "data": {
    "urls": [
      "https://plldmvgztekeiwcweiti.supabase.co/storage/v1/object/public/nexus-media/products/1793715684206-xxx.png",
      "https://plldmvgztekeiwcweiti.supabase.co/storage/v1/object/public/nexus-media/products/1793715684207-yyy.png"
    ],
    "files": [
      {
        "url": "https://plldmvgztekeiwcweiti.supabase.co/storage/v1/object/public/nexus-media/products/1793715684206-xxx.png",
        "key": "products/1793715684206-xxx.png",
        "size": 154230,
        "mimetype": "image/png"
      },
      {
        "url": "https://plldmvgztekeiwcweiti.supabase.co/storage/v1/object/public/nexus-media/products/1793715684207-yyy.png",
        "key": "products/1793715684207-yyy.png",
        "size": 128400,
        "mimetype": "image/png"
      }
    ]
  }
}
```

---

## 4. Ví dụ gọi API từ React / Axios

```typescript
import axios from 'axios';

// 1. Upload ảnh đơn
export async function uploadSingleImage(
  file: File,
  folder = 'products',
): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('folder', folder);

  const res = await axios.post('/api/v1/media/upload', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
      Authorization: `Bearer ${localStorage.getItem('accessToken')}`,
    },
  });

  return res.data.data.url; // Trả về link ảnh công khai
}

// 2. Upload nhiều ảnh sản phẩm
export async function uploadMultipleImages(
  files: File[],
  folder = 'products',
): Promise<string[]> {
  const formData = new FormData();
  for (const file of files) {
    formData.append('files', file);
  }
  formData.append('folder', folder);

  const res = await axios.post('/api/v1/media/upload-multiple', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
      Authorization: `Bearer ${localStorage.getItem('accessToken')}`,
    },
  });

  return res.data.data.urls; // Mảng URL công khai
}
```
