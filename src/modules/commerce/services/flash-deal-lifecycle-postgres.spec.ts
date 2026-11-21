import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Webhook, WebhookData } from '@payos/node';
import {
  createTestPostgres,
  hasTestPostgres,
} from '../../../../test/support/isolated-postgres.js';
import { CreateFlashDeals1794960000000 } from '../../../database/migrations/1794960000000-CreateFlashDeals.js';
import { ExtendFlashDealFoundation1795104000000 } from '../../../database/migrations/1795104000000-ExtendFlashDealFoundation.js';
import { CartItemEntity } from '../domain/entities/cart-item.entity.js';
import { CheckoutSessionEntity } from '../domain/entities/checkout-session.entity.js';
import { OrderEntity } from '../domain/entities/order.entity.js';
import { OrderItemEntity } from '../domain/entities/order-item.entity.js';
import { OrderStatusHistoryEntity } from '../domain/entities/order-status-history.entity.js';
import { PaymentCallbackEntity } from '../domain/entities/payment-callback.entity.js';
import { PaymentEntity } from '../domain/entities/payment.entity.js';
import { FlashDealQuotaService } from './flash-deal-quota.service.js';
import { OrderStateMachineService } from './order-state-machine.service.js';
import { PaymentWebhookService } from './payment-webhook.service.js';
import type { PayosClientService } from './payos-client.service.js';
import type { CartSku } from '../../catalog/catalog-cart.api.js';

describe.skipIf(!hasTestPostgres)(
  'Flash deal actual lifecycle services (isolated PostgreSQL)',
  () => {
    let database: Awaited<ReturnType<typeof createTestPostgres>>;
    let quota: FlashDealQuotaService;
    let stateMachine: OrderStateMachineService;
    let webhook: PaymentWebhookService;
    let orderId: string;
    let itemId: string;
    let sessionId: string;
    const buyerId = randomUUID();
    const sellerId = randomUUID();
    const productId = randomUUID();
    const skuId = randomUUID();
    const warehouseId = randomUUID();
    let queue: { getJob: ReturnType<typeof vi.fn> };
    let notifications: { notifyMany: ReturnType<typeof vi.fn> };

    beforeEach(async () => {
      // Commerce persistence is generated from the real entity definitions. Deal persistence
      // uses the real migrations; only the external Catalog/PayOS/queue/notification ports are stubbed.
      database = await createTestPostgres({
        entities: [
          CheckoutSessionEntity,
          OrderEntity,
          OrderItemEntity,
          OrderStatusHistoryEntity,
          CartItemEntity,
          PaymentEntity,
          PaymentCallbackEntity,
        ],
      });
      await database.db
        .query(`CREATE SCHEMA commerce; CREATE SCHEMA identity; CREATE SCHEMA catalog;
      CREATE TABLE identity.users(id uuid PRIMARY KEY);
      CREATE TABLE catalog.products(id uuid PRIMARY KEY,seller_id uuid NOT NULL REFERENCES identity.users(id));
      CREATE TABLE catalog.product_skus(id uuid PRIMARY KEY,product_id uuid NOT NULL REFERENCES catalog.products(id),price numeric(18,2) NOT NULL,original_price numeric(18,2));`);
      await database.db.synchronize();
      await database.db.query('INSERT INTO identity.users VALUES ($1),($2)', [
        buyerId,
        sellerId,
      ]);
      await database.db.query('INSERT INTO catalog.products VALUES ($1,$2)', [
        productId,
        sellerId,
      ]);
      await database.db.query(
        'INSERT INTO catalog.product_skus VALUES ($1,$2,100,120)',
        [skuId, productId],
      );
      const runner = database.db.createQueryRunner();
      try {
        await new CreateFlashDeals1794960000000().up(runner);
        await new ExtendFlashDealFoundation1795104000000().up(runner);
      } finally {
        await runner.release();
      }
      const [{ id: campaignId }] = await database.db.query(
        `INSERT INTO catalog.flash_deal_campaigns(title,slug,status,starts_at,ends_at,created_by) VALUES ('Deal','deal','ACTIVE',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour',$1) RETURNING id`,
        [sellerId],
      );
      [{ id: itemId }] = await database.db.query(
        `INSERT INTO catalog.flash_deal_items(campaign_id,sku_id,product_id,seller_id,original_price_snapshot,flash_price,quota_qty,max_per_buyer) VALUES ($1,$2,$3,$4,120,80,3,2) RETURNING id`,
        [campaignId, skuId, productId, sellerId],
      );
      const [{ expiresAt }] = await database.db.query(
        `SELECT clock_timestamp()+interval '15 minutes' AS "expiresAt"`,
      );
      const session = await database.db
        .getRepository(CheckoutSessionEntity)
        .save({ buyerId, shippingAddress: {}, expiresAt });
      sessionId = session.id;
      const order = await database.db.getRepository(OrderEntity).save({
        orderNumber: 'FD-' + randomUUID(),
        checkoutSessionId: sessionId,
        buyerId,
        sellerId,
        shippingAddressSnapshot: {},
        subtotal: '80.00',
        total: '80.00',
        holdExpiresAt: expiresAt,
      });
      orderId = order.id;
      await database.db.getRepository(OrderItemEntity).save({
        orderId,
        productId,
        skuId,
        warehouseId,
        productNameSnapshot: 'Product',
        quantity: 1,
        unitPrice: '80.00',
        lineTotal: '80.00',
      });
      await database.db.getRepository(CartItemEntity).save({
        cartId: randomUUID(),
        productId,
        skuId,
        sellerId,
        quantity: 1,
        unitPriceSnapshot: '100.00',
        reservedOrderId: orderId,
        reservationExpiresAt: expiresAt,
      });
      await database.db.getRepository(PaymentEntity).save({
        orderId,
        checkoutSessionId: sessionId,
        provider: 'PAYOS',
        providerPaymentId: '314159',
        amount: '80.00',
        status: 'PENDING',
      });
      const sku: CartSku = {
        id: skuId,
        productId,
        sellerId,
        skuCode: 'SKU',
        variantAttributes: null,
        price: '100.00',
        currency: 'VND',
        isActive: true,
        productName: 'Product',
        productSlug: 'product',
        productStatus: 'ACTIVE',
        productDeletedAt: null,
      };
      quota = new FlashDealQuotaService(database.db, {
        getCartSkus: async () => [sku],
      });
      stateMachine = new OrderStateMachineService(quota);
      queue = { getJob: vi.fn().mockResolvedValue(null) };
      notifications = { notifyMany: vi.fn().mockResolvedValue(undefined) };
      webhook = new PaymentWebhookService(
        database.db,
        {
          verifyWebhook: async (body: Webhook) => body.data,
        } as PayosClientService,
        quota,
        queue as never,
        notifications as never,
      );
      await database.db.transaction((manager) =>
        quota.reserve(manager, {
          buyerId,
          orders: [{ orderId, items: [{ itemId, skuId, quantity: 1 }] }],
        }),
      );
    });
    afterEach(async () => database?.close());

    function event(reference = 'payment-success'): Webhook {
      return {
        code: '00',
        desc: 'success',
        success: true,
        signature: 'external-signature-stub',
        data: {
          orderCode: 314159,
          amount: 80,
          reference,
          paymentLinkId: 'link',
          code: '00',
          desc: 'success',
          description: 'Order',
          accountNumber: 'masked',
          transactionDateTime: '2026-11-21 10:00:00',
          currency: 'VND',
        } as WebhookData,
      };
    }
    async function snapshot() {
      const order = await database.db
        .getRepository(OrderEntity)
        .findOneByOrFail({ id: orderId });
      const payment = await database.db
        .getRepository(PaymentEntity)
        .findOneByOrFail({ orderId });
      const [{ sold_qty: sold }] = await database.db.query(
        'SELECT sold_qty FROM catalog.flash_deal_items WHERE id=$1',
        [itemId],
      );
      const [{ status: reservation }] = await database.db.query(
        'SELECT status FROM catalog.flash_deal_reservations WHERE order_id=$1',
        [orderId],
      );
      return {
        order: order.status,
        payment: payment.status,
        failureReason: payment.failureReason,
        sold,
        reservation,
        cart: await database.db.getRepository(CartItemEntity).count(),
        callbacks: await database.db
          .getRepository(PaymentCallbackEntity)
          .count(),
        history: await database.db
          .getRepository(OrderStatusHistoryEntity)
          .count(),
      };
    }
    async function cancel() {
      return database.db.transaction((manager) =>
        stateMachine.transition(manager, {
          orderId,
          toStatus: 'CANCELLED',
          actorId: buyerId,
          expectedBuyerId: buyerId,
          reason: 'CHECKOUT_CANCELLED_BY_BUYER',
        }),
      );
    }
    async function makeHoldDue() {
      await database.db.query(
        `UPDATE commerce.orders SET hold_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1`,
        [orderId],
      );
    }

    it('commits quota and order/payment/history/cart cleanup atomically, then deduplicates the same callback', async () => {
      expect(await webhook.handlePayosWebhook(event())).toEqual({
        received: true,
      });
      expect(await snapshot()).toEqual({
        order: 'PAID',
        payment: 'SUCCEEDED',
        failureReason: null,
        sold: 1,
        reservation: 'COMMITTED',
        cart: 0,
        callbacks: 1,
        history: 1,
      });
      const history = await database.db
        .getRepository(OrderStatusHistoryEntity)
        .findOneByOrFail({ orderId });
      expect(history).toMatchObject({
        fromStatus: 'PENDING_PAYMENT',
        toStatus: 'PAID',
        changedBy: null,
      });
      expect(history.reason).toContain('PayOS payment confirmed');
      expect(queue.getJob).toHaveBeenCalledOnce();
      expect(notifications.notifyMany).toHaveBeenCalledOnce();
      expect(await webhook.handlePayosWebhook(event())).toEqual({
        received: true,
        duplicate: true,
      });
      expect(await snapshot()).toMatchObject({
        sold: 1,
        reservation: 'COMMITTED',
        callbacks: 1,
        history: 1,
        cart: 0,
      });
      expect(queue.getJob).toHaveBeenCalledOnce();
      expect(notifications.notifyMany).toHaveBeenCalledOnce();
    });

    it('recovers a new success event for an already PAID order with a still RESERVED row', async () => {
      // Represent a previously persisted PAID order whose quota hook has not been recovered yet.
      await database.db
        .getRepository(OrderEntity)
        .update(orderId, { status: 'PAID' });
      expect(await webhook.handlePayosWebhook(event('recovery'))).toEqual({
        received: true,
      });
      expect(await snapshot()).toMatchObject({
        order: 'PAID',
        payment: 'SUCCEEDED',
        reservation: 'COMMITTED',
        sold: 1,
        callbacks: 1,
        history: 0,
        cart: 0,
      });
      await webhook.handlePayosWebhook(event('second-recovery'));
      expect(await snapshot()).toMatchObject({
        reservation: 'COMMITTED',
        sold: 1,
        callbacks: 2,
        history: 0,
      });
    });

    it('releases real unpaid cancellation centrally and never revives released quota on late payment', async () => {
      await cancel();
      expect(await snapshot()).toMatchObject({
        order: 'CANCELLED',
        payment: 'PENDING',
        reservation: 'RELEASED',
        sold: 0,
        history: 1,
        callbacks: 0,
      });
      expect(
        await database.db
          .getRepository(OrderStatusHistoryEntity)
          .findOneByOrFail({ orderId }),
      ).toMatchObject({
        fromStatus: 'PENDING_PAYMENT',
        toStatus: 'CANCELLED',
        reason: 'CHECKOUT_CANCELLED_BY_BUYER',
        changedBy: buyerId,
      });
      await webhook.handlePayosWebhook(event('late-success'));
      expect(await snapshot()).toMatchObject({
        order: 'CANCELLED',
        payment: 'SUCCEEDED',
        reservation: 'RELEASED',
        sold: 0,
        callbacks: 1,
        history: 1,
      });
      expect((await snapshot()).failureReason).toContain('state CANCELLED');
    });

    it('expires the database-clock hold, records the expiry reason and finalizes real cart/session rows', async () => {
      await makeHoldDue();
      const result = await database.db.transaction(async (manager) => {
        const expired = await stateMachine.expire(orderId, manager);
        await stateMachine.finalizeExpiry(orderId, manager);
        return expired;
      });
      expect(result).toEqual({
        outcome: 'EXPIRED',
        inventoryReceipts: [{ skuId, quantity: 1, warehouseId }],
      });
      expect(await snapshot()).toMatchObject({
        order: 'CANCELLED',
        reservation: 'RELEASED',
        sold: 0,
        history: 1,
      });
      expect(
        await database.db
          .getRepository(OrderStatusHistoryEntity)
          .findOneByOrFail({ orderId }),
      ).toMatchObject({ reason: 'PAYMENT_HOLD_EXPIRED' });
      expect(
        await database.db
          .getRepository(CartItemEntity)
          .findOneByOrFail({ skuId }),
      ).toMatchObject({ reservedOrderId: null, reservationExpiresAt: null });
      expect(
        await database.db
          .getRepository(CheckoutSessionEntity)
          .findOneByOrFail({ id: sessionId }),
      ).toMatchObject({ status: 'CANCELLED' });
      expect(
        await database.db.transaction((manager) =>
          stateMachine.expire(orderId, manager),
        ),
      ).toEqual({ outcome: 'SKIPPED' });
      expect(await snapshot()).toMatchObject({ sold: 0, history: 1 });
    });

    it('releases committed quota on a full refund through actual persisted state transitions', async () => {
      await webhook.handlePayosWebhook(event());
      for (const toStatus of [
        'PROCESSING',
        'SHIPPED',
        'DELIVERED',
        'REFUND_REQUESTED',
        'REFUNDED',
      ] as const) {
        await database.db.transaction((manager) =>
          stateMachine.transition(manager, {
            orderId,
            toStatus,
            actorId: sellerId,
            reason: 'Lifecycle integration fixture',
          }),
        );
      }
      expect(await snapshot()).toMatchObject({
        order: 'REFUNDED',
        reservation: 'RELEASED',
        sold: 0,
        payment: 'SUCCEEDED',
        callbacks: 1,
        history: 6,
      });
      expect(
        await database.db
          .getRepository(OrderStatusHistoryEntity)
          .findOneByOrFail({ orderId, toStatus: 'REFUNDED' }),
      ).toMatchObject({ fromStatus: 'REFUND_REQUESTED' });
      await database.db.transaction((manager) =>
        quota.releaseByOrderId(manager, orderId),
      );
      expect(await snapshot()).toMatchObject({
        sold: 0,
        reservation: 'RELEASED',
        history: 6,
      });
    });

    it('rolls back the actual webhook transaction if a real database quota update fails', async () => {
      await database.db
        .query(`CREATE FUNCTION catalog.reject_quota_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='COMMITTED' THEN RAISE EXCEPTION 'fixture quota commit failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_quota_commit BEFORE UPDATE ON catalog.flash_deal_reservations FOR EACH ROW EXECUTE FUNCTION catalog.reject_quota_commit();`);
      const before = await snapshot();
      await expect(webhook.handlePayosWebhook(event())).rejects.toThrow(
        'fixture quota commit failure',
      );
      expect(await snapshot()).toEqual(before);
      expect(queue.getJob).not.toHaveBeenCalled();
      expect(notifications.notifyMany).not.toHaveBeenCalled();
    });

    it.each(['cancel', 'expiry', 'refund'] as const)(
      'rolls back status/history/reservation updates when %s quota release underflows',
      async (path) => {
        if (path === 'refund') {
          await webhook.handlePayosWebhook(event());
          for (const toStatus of [
            'PROCESSING',
            'SHIPPED',
            'DELIVERED',
            'REFUND_REQUESTED',
          ] as const)
            await database.db.transaction((manager) =>
              stateMachine.transition(manager, {
                orderId,
                toStatus,
                actorId: sellerId,
              }),
            );
        }
        if (path === 'expiry') await makeHoldDue();
        await database.db.query(
          'UPDATE catalog.flash_deal_items SET sold_qty=0 WHERE id=$1',
          [itemId],
        );
        const before = await snapshot();
        const action =
          path === 'cancel'
            ? cancel()
            : database.db.transaction(async (manager) =>
                path === 'expiry'
                  ? await stateMachine.expire(orderId, manager)
                  : await stateMachine.transition(manager, {
                      orderId,
                      toStatus: 'REFUNDED',
                      actorId: sellerId,
                    }),
              );
        await expect(action).rejects.toMatchObject({
          response: { errorCode: 'FLASH_DEAL_COUNTER_UNDERFLOW' },
        });
        expect(await snapshot()).toEqual(before);
      },
    );

    it('serializes actual PayOS success against actual hold expiry on the real order lock', async () => {
      await makeHoldDue();
      const blocker = database.db.createQueryRunner();
      await blocker.connect();
      await blocker.startTransaction();
      await blocker.query(
        'SELECT id FROM commerce.orders WHERE id=$1 FOR UPDATE',
        [orderId],
      );
      const payment = webhook.handlePayosWebhook(event('racing-success'));
      const expiry = database.db.transaction(async (manager) => {
        await manager.query(
          `SET LOCAL statement_timeout='5s'; SET LOCAL deadlock_timeout='100ms'`,
        );
        return stateMachine.expire(orderId, manager);
      });
      let waiters = 0;
      try {
        for (let attempts = 0; attempts < 100; attempts++) {
          [{ waiters }] = await database.db.query(
            `SELECT count(*)::int AS waiters FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'`,
          );
          if (waiters >= 2) break;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      } finally {
        await blocker.commitTransaction();
        await blocker.release();
      }
      const [paymentResult, expiryResult] = await Promise.all([
        payment,
        expiry,
      ]);
      expect(waiters).toBeGreaterThanOrEqual(2);
      expect(paymentResult).toEqual({ received: true });
      const persisted = await snapshot();
      expect(persisted).toMatchObject({
        payment: 'SUCCEEDED',
        callbacks: 1,
        history: 1,
      });
      if (expiryResult.outcome === 'EXPIRED') {
        expect(persisted).toMatchObject({
          order: 'CANCELLED',
          reservation: 'RELEASED',
          sold: 0,
        });
        expect(persisted.failureReason).toContain('state CANCELLED');
      } else {
        expect(expiryResult).toEqual({ outcome: 'SKIPPED' });
        expect(persisted).toMatchObject({
          order: 'PAID',
          reservation: 'COMMITTED',
          sold: 1,
          failureReason: null,
          cart: 0,
        });
      }
    });
  },
);
