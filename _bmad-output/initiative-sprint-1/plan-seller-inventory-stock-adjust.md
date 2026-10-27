---
title: 'Seller Inventory Stock Adjust'
type: 'feature'
ticket: ''
created: '2026-10-27'
status: 'built'
baseline_revision: 'e2840bb315810bbd1ab8f404a779e14b05591a79'
route: 'full'
route_source: 'auto'
risk: 'high'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Seller chưa có API xem tồn kho theo SKU và nhập thêm hàng, nên không thể vận hành trang `/seller/inventory` hoặc kiểm soát lượng hàng khả dụng một cách an toàn.

**Approach:** Bổ sung API fulfillment dành cho Seller để liệt kê tồn kho SKU thuộc shop và thực hiện `RESTOCK` vào kho mặc định trong một transaction, có khóa đồng thời, sổ cái và idempotency để retry không cộng kho hai lần.

## Boundaries & Constraints

**Always:** Lấy Seller từ access token; Seller chỉ thấy/chỉnh SKU của sản phẩm thuộc mình, còn ADMIN được dùng theo chính sách hiện tại; hiển thị `totalQuantity`, `reservedQuantity`, `unavailableQuantity`, `availableQuantity`; RESTOCK chỉ nhận số nguyên dương; dùng đúng một active default warehouse; khóa row tồn kho khi cập nhật; cập nhật tổng kho và ghi ledger nguyên tử; cùng actor và idempotency key phải trả lại kết quả cũ; lượng khả dụng vẫn do PostgreSQL tính từ total/reserved/unavailable.

**Never:** Nhận `sellerId` hoặc `warehouseId` từ client; cho Seller sửa reserved/unavailable/available trực tiếp; ghi vào `catalog.product_skus`; tạo frontend hoặc triển khai giảm/đặt lại tồn kho trong phạm vi này; sửa/xóa các tài liệu untracked hiện có.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| List | Seller có nhiều SKU, gồm SKU chưa có inventory row | Trả trang SKU thuộc shop; row thiếu tồn kho hiển thị các lượng bằng 0 | SKU shop khác không xuất hiện |
| Restock mới | SKU thuộc Seller, số lượng dương, key mới | Tạo/cập nhật inventory tại default warehouse và ledger `RESTOCK` trong một transaction | Rollback cả hai nếu bất kỳ bước nào lỗi |
| Retry | Cùng actor và idempotency key | Không cộng thêm; trả đúng kết quả lần đầu | Payload khác với key cũ trả 409 |
| Concurrent restock | Hai request hợp lệ cho cùng SKU | Cả hai delta được cộng chính xác, không lost update | Row được khóa/UPSERT nguyên tử |
| Ownership/config | SKU không thuộc Seller hoặc default warehouse thiếu/trùng | Không thay đổi tồn kho | 404 cho ownership; 503 cho cấu hình kho |

</frozen-after-approval>

## Code Map

- `src/modules/fulfillment/domain/entities/inventory-item.entity.ts` -- mở rộng mapping các cột total/reserved/unavailable/version; giữ `available_qty` read-only.
- `src/modules/fulfillment/domain/entities/warehouse.entity.ts` -- nguồn xác định đúng một active default warehouse.
- `src/modules/fulfillment/services/inventory-reservation.service.ts` -- mẫu khóa row, guarded SQL và transaction ownership; không thay đổi contract checkout.
- `src/modules/fulfillment/services/inventory-read.service.ts` -- mẫu xử lý default warehouse và dữ liệu available hiện tại.
- `src/modules/catalog/domain/entities/{product,product-sku}.entity.ts` -- join ownership Seller -> Product -> SKU.
- `src/modules/catalog/controllers/seller-product.controller.ts` -- mẫu guards, roles, permissions và `CurrentUserId` cần giữ nhất quán.
- `src/modules/fulfillment/fulfillment.module.ts` -- đăng ký controller/service/entity mới.
- `src/modules/identity/rbac/rbac.constants.ts` -- dùng quyền `PRODUCT.LIST` cho list và `PRODUCT.UPDATE` cho RESTOCK để tương thích role Seller đã có.

## Tasks & Acceptance

**Execution:**
- [x] `src/database/migrations/*-CreateInventoryLedger.ts` và specs -- tạo ledger RESTOCK cùng unique `(actor_id, idempotency_key)`, request fingerprint, before/after quantity và index tra cứu.
- [x] `src/modules/fulfillment/domain/entities/{inventory-item,inventory-ledger}.entity.ts` -- map dữ liệu ghi/đọc, không cho ORM ghi generated available.
- [x] `src/modules/fulfillment/dtos/seller-inventory.dto.ts` -- validate phân trang, tìm kiếm, SKU UUID, quantity và idempotency key.
- [x] `src/modules/fulfillment/services/seller-inventory.service.ts` -- ownership-scoped list và RESTOCK transaction-safe/idempotent tại default warehouse.
- [x] `src/modules/fulfillment/controllers/seller-inventory.controller.ts` và `fulfillment.module.ts` -- expose GET `/api/v1/fulfillment/seller/inventory` và POST `/adjust` với guards hiện có.
- [x] Unit/controller và E2E tests -- phủ list, ownership, zero-row projection, locking/upsert, ledger rollback, retry, key conflict và cấu hình warehouse.

**Acceptance Criteria:**
- Given hai Seller có SKU riêng, when một Seller liệt kê hoặc restock, then không thể quan sát hay thay đổi SKU của Seller kia.
- Given một RESTOCK hợp lệ, when transaction commit, then total tăng đúng delta, available phản ánh công thức DB và có đúng một ledger tương ứng.
- Given request được retry cùng idempotency key, when xử lý lại, then tồn kho không tăng lần hai và response ổn định.
- Given các request đồng thời hoặc một lỗi ghi ledger, when xử lý, then không lost update và không để lại thay đổi tồn kho một phần.
- Given checkout reservation/release hiện có, when toàn bộ suite chạy, then hành vi giữ/hoàn tồn kho không bị thay đổi.

## Implementation Notes

- Implemented Seller/Admin inventory list with zero-stock projection and low-stock flag.
- Implemented atomic RESTOCK with advisory idempotency locking, ownership enforcement, overflow guard and ledger persistence.
- Quick review found and fixed replay ownership leakage and unstable retry responses; no work was deferred.
- Full unit suite passed 669 tests. Focused Seller Inventory E2E passed 3 tests; full E2E passed 175/176, with only the pre-existing startup test timing out while repeatedly attempting unavailable local Redis on port 6379.

## Plan Change Log

## Review Triage Log

- `medium` / `patch` — `seller-inventory.service.ts` replay path skipped the current ownership/deleted-product check, so a former owner could replay an old key and observe stored quantities; ownership is now checked before ledger replay.
- `medium` / `patch` — initial and replay responses differed only through `idempotentReplay`; that field was removed so a valid retry returns the same persisted result shape and values.
- `false` — `seller-inventory.e2e-spec.ts` follows the repository's controller-E2E convention for real guards/DTO routing with a mocked service; ownership, SQL locking/upsert, retry, rollback and warehouse failures are covered in the service spec, while the full existing inventory reservation/release suite supplies compatibility coverage. The plan does not require a live-database E2E harness.

## Design Notes

RESTOCK là delta tăng tồn kho, không phải giá trị tuyệt đối. Idempotency được neo theo actor để hai Seller có thể dùng cùng chuỗi key độc lập; fingerprint ngăn cùng key bị tái sử dụng cho SKU hoặc quantity khác.

## Verification

**Commands:**
- `npm run lint` -- expected: không có lint errors.
- `npm run typecheck` -- expected: TypeScript hoàn tất không lỗi.
- `npm test` -- expected: toàn bộ unit tests, gồm fulfillment mới, đều pass.
- `npm run test:e2e` -- expected: Seller inventory ownership/RBAC và compatibility pass.
- `npm run build` -- expected: Nest production build thành công.
