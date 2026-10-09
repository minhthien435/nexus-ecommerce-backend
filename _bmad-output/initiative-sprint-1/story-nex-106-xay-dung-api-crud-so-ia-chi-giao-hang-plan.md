---
title: 'NEX-106: API CRUD sổ địa chỉ giao hàng'
type: 'feature'
ticket: '2'
created: '2026-10-09'
status: 'built'
baseline_revision: '026e17a4ab3adbf32bb71457b7c7b8fb536ed681'
route: 'full'
route_source: 'auto'
risk: 'high'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context:
  - '_bmad-output/initiative-sprint-1/story-nex-106-xay-dung-api-crud-so-ia-chi-giao-hang.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Người dùng chưa thể quản lý sổ địa chỉ qua API, và dự án chưa có TypeORM runtime hoặc current-user contract để thực thi ownership an toàn.

**Approach:** Thêm Address module hoàn chỉnh với bốn endpoint CRUD, TypeORM configuration, validation và `CurrentUserId` đọc từ `request.user.id`. Mọi thao tác nhạy cảm chạy trong transaction có PostgreSQL advisory lock theo user để giữ giới hạn 5 địa chỉ và duy nhất một địa chỉ mặc định khi request đồng thời.

## Boundaries & Constraints

**Always:** Chỉ truy vấn theo cả `userId` và address ID; missing/foreign ID cùng trả 404; create bắt buộc `recipientName`; update partial nhưng body rỗng bị từ chối; request thiếu `request.user.id` trả 401; create/default transition dùng transaction và per-user advisory lock.

**Never:** Không triển khai đăng nhập/JWT/refresh token, không nhận `userId` từ body/header, không tự chọn default sau khi xóa, không dùng database Supabase thật trong automated tests, không tạo migration hay thay đổi schema.

## I/O & Edge-Case Matrix

| Scenario               | Input / State                    | Expected Output / Behavior                    | Error Handling               |
| ---------------------- | -------------------------------- | --------------------------------------------- | ---------------------------- |
| List                   | Authenticated user               | Chỉ địa chỉ của user                          | Thiếu user: 401              |
| Create                 | Hợp lệ, user có 0–4 địa chỉ      | Tạo cho user; `recipientName` được lưu        | Validation: 400              |
| Limit concurrent       | Hai create khi user có 4 địa chỉ | Chỉ một request tạo thành công; tổng tối đa 5 | Request còn lại: 409         |
| Set default concurrent | Hai request cùng đặt default     | Kết thúc với tối đa một default               | Transaction rollback khi lỗi |
| Partial update         | Một trường hợp lệ                | Chỉ trường đó thay đổi                        | Body rỗng/sai: 400           |
| Foreign or missing     | PATCH/DELETE ID không thuộc user | Không đọc/sửa/xóa dữ liệu                     | 404 giống nhau               |
| Delete default         | Xóa default thuộc user           | Địa chỉ bị xóa; không tự promote              | 204                          |

</frozen-after-approval>

## Code Map

- `src/config/typeorm.config.ts` -- tạo `TypeOrmModuleOptions` từ `ConfigService`; PostgreSQL, SSL theo env, `autoLoadEntities`, `synchronize:false`, không log secret.
- `src/app.module.ts`, `src/main.ts` -- đăng ký Config/TypeORM/AddressModule và global `ValidationPipe` transform + whitelist + forbid unknown fields; giữ route đúng `/users/addresses`.
- `src/common/auth/current-user-id.decorator.ts` -- đọc UUID từ `request.user.id`, trả 401 khi thiếu; đây là integration seam cho auth ticket sau.
- `src/modules/identity/dto/*.ts` -- thêm `recipientName` required/optional và giữ validation NEX-105; update rỗng được controller/service từ chối sau whitelist.
- `src/modules/identity/address/address.module.ts`, `address.controller.ts`, `address.service.ts` -- CRUD, ownership, 404 concealment, max-five/default invariants; service dùng `DataSource.transaction` và `pg_advisory_xact_lock(hashtextextended(...))` trước count/update/save.
- `src/modules/identity/address/*.spec.ts`, `test/address.e2e-spec.ts` -- mock repository/transaction manager và HTTP service seam; không kết nối Supabase. Fake transactional lock điều phối concurrent calls để chứng minh matrix race cases.
- `test/app.e2e-spec.ts` -- cô lập hello endpoint khỏi AppModule database bootstrap để e2e không chạm database thật.

## Tasks & Acceptance

**Execution:**

- [ ] `src/config/typeorm.config.ts`, `src/app.module.ts`, `src/main.ts` -- thêm runtime database và global validation an toàn.
- [ ] `src/common/auth/current-user-id.decorator.ts` -- cung cấp current-user seam với 401 mặc định.
- [ ] `src/modules/identity/dto/*.ts` -- hoàn thiện `recipientName` và empty-update contract.
- [ ] `src/modules/identity/address/*` -- triển khai module/controller/service cùng ownership, transaction và khóa theo user.
- [ ] `src/modules/identity/**/*.spec.ts`, `test/*.e2e-spec.ts` -- kiểm thử DTO, service, controller HTTP và toàn bộ matrix, bao gồm concurrency giả lập có serialization.

**Acceptance Criteria:**

- Given hai user riêng biệt, when list/update/delete được gọi, then mọi repository predicate đều giới hạn theo current user và foreign ID trả 404.
- Given create/default requests chạy đồng thời, when transaction manager thực thi, then advisory lock xảy ra trước count hoặc reset/save và invariant cuối cùng vẫn đúng.
- Given request hợp lệ, invalid, rỗng hoặc thiếu user, when đi qua HTTP layer, then status lần lượt tuân theo 2xx, 400, 400 và 401; delete thành công trả 204.
- Given runtime production config, when app khởi động, then TypeORM dùng env PostgreSQL/SSL, auto-load entity và không synchronize schema.

## Implementation Notes

## Plan Change Log

## Review Triage Log

- Review pass 1: 0 high, 0 medium, 0 low, 0 false, 0 maybe-false; quick review found no unmet acceptance criteria, broken rules, or functional bugs.

## Design Notes

Advisory lock được lấy trong transaction trước khi đọc count hoặc thay đổi default, nên cả user chưa có address row vẫn được serialize. Tests không dùng database thật: transaction manager giả lập ghi nhận thứ tự SQL và áp dụng mutex theo user cho hai promise đồng thời. Auth tương lai chỉ cần gắn `{ id }` vào `request.user`; NEX-106 không tự xác thực token.

## Verification

**Commands:**

- `npm test -- src/modules/identity` -- unit tests entity/DTO/service/controller pass.
- `npm run test:e2e` -- HTTP contracts pass mà không mở kết nối database thật.
- `npm run lint` -- không có lint error.
- `npm run typecheck` -- strict TypeScript pass.
- `npm run build` -- Nest build pass.
- `npm run validate` -- toàn bộ suite hiện có pass.
