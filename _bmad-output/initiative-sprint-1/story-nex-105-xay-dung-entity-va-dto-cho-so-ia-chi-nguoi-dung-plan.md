---
title: 'NEX-105: Entity và DTO cho sổ địa chỉ người dùng'
type: 'feature'
ticket: '1'
created: '2026-10-09'
status: 'built'
baseline_revision: '648d2d027a6ff585bec2078d0e3503d4e4321c54'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context:
  - '_bmad-output/initiative-sprint-1/story-nex-105-xay-dung-entity-va-dto-cho-so-ia-chi-nguoi-dung.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Dự án chưa có mô hình TypeORM hoặc DTO cho địa chỉ giao hàng, nên các API hồ sơ và sổ địa chỉ chưa có hợp đồng dữ liệu an toàn để sử dụng.

**Approach:** Thêm `UserAddressEntity` bám đúng metadata hiện có của `identity.user_addresses`, cùng DTO tạo/cập nhật sử dụng validation rõ ràng. Bổ sung unit test cho ánh xạ cột, giá trị mặc định và các nhánh validation.

## Boundaries & Constraints

**Always:** Dùng tên property camelCase và ánh xạ rõ sang cột snake_case; `recipientPhone` ánh xạ cột `phone`; mã hành chính là chuỗi; create bắt buộc mã hành chính, địa chỉ và số điện thoại; update là partial; `isDefault` mặc định `false`.

**Never:** Không tạo controller/service/API NEX-106, migration, module/database bootstrap hoặc `UserEntity`; không thay đổi schema database; không sửa các tài liệu và thay đổi đang tồn tại ngoài phạm vi.

## I/O & Edge-Case Matrix

| Scenario              | Input / State                                                      | Expected Output / Behavior              | Error Handling                      |
| --------------------- | ------------------------------------------------------------------ | --------------------------------------- | ----------------------------------- |
| Tạo hợp lệ            | Mã hành chính và addressLine là chuỗi, recipientPhone đủ 10 chữ số | DTO hợp lệ; isDefault mặc định false    | Không lỗi                           |
| Thiếu trường bắt buộc | Create thiếu một trường bắt buộc                                   | DTO không hợp lệ                        | Trả lỗi validation tại trường thiếu |
| Điện thoại sai        | Có chữ cái hoặc không đủ/ quá 10 chữ số                            | DTO không hợp lệ                        | Trả lỗi validation recipientPhone   |
| Cập nhật từng phần    | Update chỉ có một trường                                           | DTO hợp lệ nếu giá trị trường đó hợp lệ | Trường không gửi không bị bắt buộc  |
| Mã có số 0 đầu        | province/district/ward code như `001`                              | Giữ nguyên chuỗi                        | Không ép kiểu số                    |

</frozen-after-approval>

## Code Map

- `package.json` và `package-lock.json` -- thêm dependency trực tiếp `class-validator` và `class-transformer`; giữ nguyên mọi thay đổi package lock hiện hữu ngoài phần npm cập nhật.
- `src/modules/identity/entities/user-address.entity.ts` -- entity mới; ánh xạ bảng/schema và đầy đủ các cột đang tồn tại: UUID, user ID, recipient name/phone, địa chỉ, cờ mặc định, timestamps. Không tạo relation vì chưa có `UserEntity`.
- `src/modules/identity/dto/create-address.dto.ts` -- hợp đồng create theo quyết định ticket; default `isDefault=false` và regex điện thoại 10 chữ số.
- `src/modules/identity/dto/update-address.dto.ts` -- hợp đồng partial update, giữ nguyên validator của các giá trị được cung cấp; triển khai tường minh để không thêm mapped-types.
- `src/modules/identity/**/*.spec.ts` -- unit test metadata TypeORM và validation DTO theo matrix; dùng Vitest hiện có.
- `src/app.module.ts` -- không đăng ký entity/module trong NEX-105 vì dự án chưa có cấu hình datasource và ticket không yêu cầu bootstrap runtime.

## Tasks & Acceptance

**Execution:**

- [ ] `package.json`, `package-lock.json` -- cài dependency validation trực tiếp để decorator DTO hoạt động ổn định.
- [ ] `src/modules/identity/entities/user-address.entity.ts` -- ánh xạ entity theo metadata thật của bảng `identity.user_addresses`, bao gồm default/nullability chính xác.
- [ ] `src/modules/identity/dto/create-address.dto.ts`, `update-address.dto.ts` -- triển khai required/optional/default và validation đã chốt.
- [ ] `src/modules/identity/entities/user-address.entity.spec.ts`, `src/modules/identity/dto/address.dto.spec.ts` -- kiểm thử metadata và toàn bộ happy/error/partial cases.

**Acceptance Criteria:**

- Given TypeORM đọc `UserAddressEntity`, when metadata được dựng, then schema/table, tên cột, kiểu, nullability và default `is_default=false` khớp bảng hiện có.
- Given create payload hợp lệ, when validate/transform, then mã có số 0 đầu được giữ nguyên và `isDefault` nhận `false` nếu không được truyền.
- Given create payload thiếu trường hoặc điện thoại không đúng 10 chữ số, when validate, then lỗi gắn đúng property.
- Given update payload chỉ chứa một trường, when validate, then payload hợp lệ; nếu trường được gửi sai định dạng thì vẫn bị từ chối.

## Implementation Notes

## Plan Change Log

## Review Triage Log

- medium | patch | `UpdateAddressDto` dùng `IsOptional`, decorator này bỏ qua cả `null`; payload có trường được gửi với `null` vượt validation dù hợp đồng yêu cầu giá trị được cung cấp phải hợp lệ. Sửa trực tiếp điều kiện optional để chỉ bỏ qua `undefined`.
- medium | patch | Transform của `CreateAddressDto.isDefault` dùng `?? false`, biến `null` thành `false` trước `IsBoolean`; chỉ trường bị bỏ qua mới được nhận default. Sửa transform để giữ `null` cho validator từ chối.

## Design Notes

Database metadata được đọc chỉ-read từ `information_schema` để tránh đoán cấu trúc bảng. DTO dùng tên nghiệp vụ `recipientPhone`, còn entity ánh xạ property đó vào cột hiện hữu `phone`. Entity cũng ánh xạ các cột bắt buộc hiện hữu (`user_id`, `recipient_name`, timestamps), nhưng DTO NEX-105 chỉ áp dụng phạm vi trường đã được người dùng chốt.

## Verification

**Commands:**

- `npm test -- src/modules/identity` -- tất cả unit test entity/DTO mới pass.
- `npm run lint` -- không có lỗi lint trong source/test.
- `npm run typecheck` -- TypeScript strict pass.
- `npm run build` -- Nest build thành công.
- `npm run validate` -- toàn bộ validation hiện có của repository pass.
