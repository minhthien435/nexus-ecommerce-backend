# NEX-301.2 receipt integration

Cancellation and expiry use `InventoryReservationReceipt[]`: `{ skuId, quantity, warehouseId }`. Checkout persists the reservation warehouse on `commerce.order_items.warehouse_id`; both paths reconstruct receipts from persisted items and use `InventoryReservationApi.release(receipts, manager)` in the caller's transaction.

The temporary `OrderInventoryReleasePort` and unavailable fallback are removed. Buyer cancellation checks ownership, locks the order, permits only `PENDING_PAYMENT -> CANCELLED`, writes history and releases inventory atomically. A release error propagates so the transaction rolls back. Detail requires `ORDER.VIEW`; cancellation requires `ORDER.CANCEL`.

Missing warehouse data produces `503 ORDER_INVENTORY_RECEIPT_MISSING`. No partial release is attempted. Legacy rows with null warehouses require reconciliation of whether a reservation occurred and which warehouse was used. Never guess the current default warehouse or interpret null alone as proof that no stock was reserved.

The existing warehouse/outbox migration must be applied before using this flow; this change does not run migrations.

The state machine requires an active transaction and uses pessimistic locking. Expiry reads PostgreSQL time after locking; a due pending order persists `CANCELLED`, reason `PAYMENT_HOLD_EXPIRED`, and null `changedBy` (SYSTEM). It returns `{ outcome: 'EXPIRED', inventoryReceipts }`; the worker releases these receipts before committing. Other outcomes do not release stock. `NOT_DUE` supplies a future retry deadline, while a null deadline returns `SKIPPED`. The outcome discriminant replaces the previously proposed `changed` flag.

Supported transitions: pending to paid/cancelled, paid to processing, processing to shipped, shipped to delivered. Paid cancellation and refunds remain outside this feature.

Unit and HTTP tests verify decisions, receipt forwarding, missing warehouse rejection and error propagation using mocks. Real PostgreSQL rollback and concurrent payment/expiry behavior require isolated database integration tests.
