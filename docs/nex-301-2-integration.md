# NEX-301.2 order state integration

## Public buyer API

- `GET /api/v1/commerce/orders/:orderId` requires `ORDER.VIEW`.
- `PATCH /api/v1/commerce/orders/:orderId/cancel` requires `ORDER.CANCEL`.
- Both routes derive the buyer from the access token. Query-string and request-body buyer or actor identifiers are ignored.
- Missing orders and orders owned by another buyer both return `ORDER_NOT_FOUND` (404).
- PostgreSQL `numeric` values are projected with `::text`, so all monetary response fields are decimal strings.

NEX-301.2 does not modify Dev 1's checkout implementation or Dev 3's inventory implementation. Buyer cancellation calls the Commerce-owned `OrderInventoryReleasePort` with persisted order-item quantities and the current transaction manager. If no adapter is configured, cancellation fails with `ORDER_INVENTORY_RELEASE_UNAVAILABLE` and the transaction rolls back.

## Existing schema mapping

This delivery reads the existing `commerce.orders`, `commerce.order_items`, and `commerce.order_status_history` tables; it does not create or migrate them.

- `orders.buyer_id` is the ownership boundary.
- `orders.hold_expires_at` is compared with PostgreSQL `clock_timestamp()` after a pessimistic write lock is acquired.
- `orders.order_number`, all monetary columns, `currency`, and `shipping_address_snapshot` are returned from persisted snapshots.
- `order_items.product_name_snapshot`, `sku_attributes_snapshot`, prices, discounts, quantity, and line total are returned without a live Catalog lookup.
- History uses nullable `from_status`, non-null `to_status`, optional `reason`, and nullable `changed_by`. A null actor means SYSTEM.

`EXPIRED` is a worker outcome, not an order status. When a payment deadline is due, Commerce persists `CANCELLED`, records reason `PAYMENT_HOLD_EXPIRED` with `changed_by = NULL`, and returns outcome `EXPIRED` so the worker releases inventory exactly once.

## Caller-owned transaction contract

`OrderStateMachineService` never starts or commits a transaction. Every mutation caller must pass an `EntityManager` whose query runner has an active transaction. Calls without one fail with `ORDER_TRANSACTION_REQUIRED` before reading the order.

Payment example:

```ts
await dataSource.transaction('READ COMMITTED', async (manager) => {
  await orderStateMachine.transition(manager, {
    orderId,
    toStatus: 'PAID',
    actorId: authenticatedOrTrustedServiceActorId,
    reason: 'Payment confirmed',
  });
  // Write the payment record with the same manager before returning.
});
```

Expiry worker example:

```ts
await dataSource.transaction('READ COMMITTED', async (manager) => {
  const result = await orderStateMachine.expire(orderId, manager);
  if (result.outcome === 'EXPIRED') {
    await inventoryReservation.release(result.inventoryItems, manager);
  } else if (result.outcome === 'NOT_DUE') {
    // Reschedule using worker policy.
  }
  // SKIPPED and NOT_FOUND must not release inventory.
});
```

The state machine returns persisted `{ skuId, quantity }` release items only for a changed `EXPIRED` outcome. The worker releases those reservations with the same manager before the transaction commits. Any release failure must escape the callback so the status and history insert roll back.

## Fulfillment integration boundary

The agreed hand-off document proposes `release(items, manager)`, while the current Dev 3 branch exposes `release(receipts, manager)` and requires `warehouseId`. NEX-301.2 deliberately does not rewrite that API. Dev 3 or the Tech Lead must resolve how reservation receipts are persisted and supplied before configuring `ORDER_INVENTORY_RELEASE_ADAPTER`.

The eventual adapter must:

1. Use only the supplied active `EntityManager`.
2. Resolve the exact warehouse reservation without guessing or defaulting to another warehouse.
3. Release only the persisted SKU quantities supplied by Commerce.
4. Throw on partial or unavailable updates so the order transition and history roll back.

Retry safety is owned by the locked order transition: only the first `PENDING_PAYMENT -> CANCELLED` result has `changed: true` and carries inventory items to the caller. `SKIPPED`, `NOT_DUE`, and `NOT_FOUND` have `changed: false` and never release inventory. A pending order with no hold deadline is `SKIPPED` so a worker cannot enter an immediate retry loop.

## Supported transitions

- `PENDING_PAYMENT -> PAID`
- `PENDING_PAYMENT -> CANCELLED` (buyer cancellation or payment expiry)
- `PAID -> PROCESSING`
- `PROCESSING -> SHIPPED`
- `SHIPPED -> DELIVERED`

`COMPLETED`, `PAYMENT_FAILED`, `REFUND_REQUESTED`, and `REFUNDED` are recognized persisted statuses but are terminal for this state machine until their business rules are approved. Paid cancellation, refunds, and Stripe behavior remain outside this delivery.

## Verification boundary

Unit and HTTP tests use mocked repositories, transactions, authentication, and inventory services. They prove routing, authorization, ownership filtering, transition decisions, call ordering, rollback propagation, and retry/no-op contracts without external I/O.

They do not prove PostgreSQL lock contention or rollback against a live database. Run a dedicated integration suite against isolated PostgreSQL before claiming payment-expiry race acceptance; do not interpret the mocked suite as concurrency evidence.
