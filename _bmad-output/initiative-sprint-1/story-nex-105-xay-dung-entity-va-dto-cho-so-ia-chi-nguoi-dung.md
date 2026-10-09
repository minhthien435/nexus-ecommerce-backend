---
id: 1
type: story
title: 'NEX-105: Xây dựng Entity và DTO cho sổ địa chỉ người dùng'
parent: initiative-sprint-1
after: []
refined: true
hitl: false
risk: medium
---

# NEX-105: Xây dựng Entity và DTO cho sổ địa chỉ người dùng

## Description

Tạo mô hình lưu trữ địa chỉ giao hàng của người dùng trong schema `identity` và các DTO phục vụ thao tác tạo, cập nhật. Dữ liệu địa chỉ sử dụng mã đơn vị hành chính Việt Nam và kiểm tra số điện thoại người nhận.

## Acceptance Criteria

1. **Ánh xạ được địa chỉ người dùng**
   **Given** ứng dụng khởi tạo metadata cho mô hình dữ liệu
   **When** metadata của địa chỉ người dùng được kiểm tra
   **Then** entity ánh xạ vào bảng `user_addresses` thuộc schema `identity`
   **And** entity lưu `provinceCode`, `districtCode`, `wardCode`, `addressLine`, `recipientPhone` và `isDefault`
2. **DTO tạo nhận đủ dữ liệu địa chỉ**
   **Given** dữ liệu tạo một địa chỉ giao hàng
   **When** dữ liệu được kiểm tra qua `CreateAddressDto`
   **Then** `provinceCode`, `districtCode`, `wardCode`, `addressLine` và `recipientPhone` là các chuỗi bắt buộc
   **And** các mã hành chính giữ nguyên số 0 ở đầu
   **And** `isDefault` là boolean optional với giá trị mặc định `false`
3. **DTO cập nhật cho phép cập nhật từng phần**
   **Given** dữ liệu chỉ chứa một phần các trường của địa chỉ giao hàng
   **When** dữ liệu được kiểm tra qua `UpdateAddressDto`
   **Then** mỗi trường địa chỉ và `recipientPhone` đều là optional
   **And** giá trị được cung cấp vẫn phải thỏa mãn quy tắc validation tương ứng
4. **Số điện thoại người nhận hợp lệ**
   **Given** dữ liệu địa chỉ có số điện thoại người nhận
   **When** số điện thoại gồm đúng 10 chữ số
   **Then** dữ liệu vượt qua bước kiểm tra định dạng
5. **Từ chối số điện thoại người nhận sai định dạng**
   **Given** dữ liệu địa chỉ có số điện thoại chứa ký tự không phải chữ số hoặc có độ dài khác 10
   **When** dữ liệu được kiểm tra
   **Then** DTO báo lỗi kiểm tra dữ liệu cho trường số điện thoại

## Boundaries

- Không triển khai controller, service hoặc các endpoint CRUD của NEX-106.
- Không kiểm tra tính tồn tại thực tế của mã tỉnh, huyện hoặc xã trong danh mục hành chính ở phạm vi ticket này.

## Verification

- Kiểm tra metadata của TypeORM cho tên bảng, schema, toàn bộ cột địa chỉ, nullability và giá trị mặc định `false` của `isDefault`.
- Chạy kiểm thử validation cho trường bắt buộc khi tạo, trường optional khi cập nhật, giá trị mặc định của `isDefault`, và các số điện thoại sai ký tự hoặc sai độ dài.

## References

- parent — _bmad-output/initiative-sprint-1/initiative-sprint-1.md, Requirement NEX-105

## Notes

- Decision: Phạm vi và tiêu chí nghiệm thu được lấy từ GitLab issue NEX-105 do người dùng cung cấp ngày 2026-10-09.
- Risk rationale: Sai ánh xạ hoặc validation có thể làm mất dữ liệu địa chỉ hoặc từ chối địa chỉ hợp lệ khi checkout.
- Decision: Trường số điện thoại người nhận có tên `recipientPhone`, bắt buộc khi tạo và optional khi cập nhật (2026-10-09).
- Decision: `UpdateAddressDto` cho phép cập nhật từng phần; mọi trường đều optional nhưng giá trị được cung cấp vẫn phải hợp lệ (2026-10-09).
- Decision: Các mã hành chính và `addressLine` là chuỗi bắt buộc khi tạo; mã hành chính giữ được số 0 đầu (2026-10-09).
- Decision: `isDefault` là optional và mặc định `false` khi tạo (2026-10-09).
- Known uncertainty: Không còn điểm chưa xác định trong phạm vi NEX-105.
