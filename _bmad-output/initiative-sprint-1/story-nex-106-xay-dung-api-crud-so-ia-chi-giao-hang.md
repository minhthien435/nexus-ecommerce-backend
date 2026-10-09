---
id: 2
type: story
title: 'NEX-106: Xây dựng API CRUD sổ địa chỉ giao hàng'
parent: initiative-sprint-1
after: [1]
refined: true
hitl: false
risk: high
---

# NEX-106: Xây dựng API CRUD sổ địa chỉ giao hàng

## Description

Cung cấp API để người dùng đã xác thực xem, tạo, cập nhật và xóa sổ địa chỉ của chính mình với giới hạn năm địa chỉ và duy nhất một địa chỉ mặc định.

## Acceptance Criteria

1. **Liệt kê địa chỉ của user hiện tại**
   **Given** một user đã xác thực có các địa chỉ giao hàng
   **When** user gọi `GET /users/addresses`
   **Then** hệ thống chỉ trả về địa chỉ thuộc user đó
2. **Tạo địa chỉ trong giới hạn**
   **Given** user đã xác thực có ít hơn 5 địa chỉ
   **When** user gửi dữ liệu hợp lệ tới `POST /users/addresses`
   **Then** địa chỉ được tạo cho chính user đó
   **And** `recipientName` là trường bắt buộc
3. **Từ chối địa chỉ thứ sáu**
   **Given** user đã có 5 địa chỉ
   **When** user gửi yêu cầu tạo thêm địa chỉ
   **Then** yêu cầu bị từ chối và không có địa chỉ mới được lưu
   **And** hai yêu cầu tạo đồng thời không thể làm tổng số địa chỉ vượt quá 5
4. **Chỉ có một địa chỉ mặc định**
   **Given** user có nhiều địa chỉ và một địa chỉ đang là mặc định
   **When** user tạo hoặc cập nhật một địa chỉ khác với `isDefault = true`
   **Then** địa chỉ mới được chọn là mặc định
   **And** mọi địa chỉ còn lại của user được chuyển thành `isDefault = false` trong cùng một transaction
   **And** các yêu cầu đặt mặc định đồng thời vẫn kết thúc với tối đa một địa chỉ mặc định
5. **Cập nhật địa chỉ thuộc sở hữu**
   **Given** một địa chỉ thuộc user hiện tại
   **When** user gửi dữ liệu cập nhật hợp lệ tới `PATCH /users/addresses/:id`
   **Then** chỉ các trường được gửi của địa chỉ đó được cập nhật
   **And** `recipientName` là optional nhưng phải hợp lệ khi được gửi
6. **Từ chối cập nhật rỗng**
   **Given** một địa chỉ thuộc user hiện tại
   **When** user gửi `PATCH` với body không có trường cập nhật
   **Then** hệ thống từ chối payload rỗng và không thay đổi địa chỉ
7. **Không cập nhật địa chỉ của user khác**
   **Given** ID địa chỉ không tồn tại hoặc không thuộc user hiện tại
   **When** user gọi endpoint cập nhật
   **Then** hệ thống trả về kết quả không tìm thấy và không tiết lộ địa chỉ có thuộc user khác hay không
8. **Xóa địa chỉ thuộc sở hữu**
   **Given** một địa chỉ thuộc user hiện tại
   **When** user gọi `DELETE /users/addresses/:id`
   **Then** địa chỉ đó bị xóa
9. **Không xóa địa chỉ của user khác**
   **Given** ID địa chỉ không tồn tại hoặc không thuộc user hiện tại
   **When** user gọi endpoint xóa
   **Then** hệ thống trả về kết quả không tìm thấy và không xóa dữ liệu

## Boundaries

- Không triển khai đăng ký, đăng nhập, phát hành token hoặc refresh token trong ticket này.
- Ticket được phép cấu hình TypeORM runtime và tạo `CurrentUserId` abstraction đọc `request.user.id`; request không có user đã xác thực phải bị từ chối.
- Không tự động chọn địa chỉ khác làm mặc định khi địa chỉ mặc định bị xóa; user có thể tạm thời không có địa chỉ mặc định.
- Không thay đổi giới hạn tối đa 5 địa chỉ bằng cấu hình trong phạm vi ticket này.
- Các thao tác tạo và đổi mặc định phải dùng transaction cùng khóa theo user để bảo toàn quy tắc khi request đồng thời.

## References

- parent — _bmad-output/initiative-sprint-1/initiative-sprint-1.md, Requirement NEX-106

## Notes

- Risk rationale: Lỗi ownership có thể cho phép user đọc hoặc sửa địa chỉ của người khác; lỗi transaction có thể tạo nhiều địa chỉ mặc định.
- External check: Chạy integration test với hai user riêng biệt, gồm request đồng thời, và kiểm tra trực tiếp trạng thái database sau thao tác tạo hoặc đổi địa chỉ mặc định.
- Decision: `recipientName` bắt buộc khi tạo và optional khi cập nhật (2026-10-09).
- Decision: NEX-106 bổ sung TypeORM runtime và `CurrentUserId` abstraction từ `request.user.id`, nhưng không triển khai đăng nhập hoặc token (2026-10-09).
- Decision: Transaction và khóa theo từng user phải bảo đảm giới hạn 5 địa chỉ và duy nhất một địa chỉ mặc định khi có request đồng thời (2026-10-09).
- Decision: `PATCH` với body không có trường cập nhật bị từ chối (2026-10-09).
- Known uncertainty: Không còn điểm chưa xác định trong phạm vi NEX-106.
