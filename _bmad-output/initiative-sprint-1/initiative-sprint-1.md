---
type: initiative
title: Sprint 1
parent: none
---

# Sprint 1

## Requirement NEX-105

Tạo `UserAddressEntity` ánh xạ bảng `identity.user_addresses` cùng `CreateAddressDto` và `UpdateAddressDto` theo mã hành chính Việt Nam.

- Hỗ trợ `provinceCode`, `districtCode`, `wardCode`, `addressLine` và `isDefault`.
- Số điện thoại người nhận phải gồm đúng 10 chữ số.

## Requirement NEX-106

Xây dựng API CRUD sổ địa chỉ giao hàng qua `GET /users/addresses`, `POST /users/addresses`, `PATCH /users/addresses/:id` và `DELETE /users/addresses/:id`.

- Mỗi user lưu tối đa 5 địa chỉ.
- Khi một địa chỉ được đặt làm mặc định, các địa chỉ khác của cùng user tự động chuyển `isDefault` về `false`.
- User chỉ được sửa hoặc xóa địa chỉ do chính mình tạo.
