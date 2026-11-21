import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type EntityManager } from 'typeorm';
import {
  createTestPostgres,
  hasTestPostgres,
} from '../../../../test/support/isolated-postgres.js';
import { CreateFlashDeals1794960000000 } from '../../../database/migrations/1794960000000-CreateFlashDeals.js';
import { ExtendFlashDealFoundation1795104000000 } from '../../../database/migrations/1795104000000-ExtendFlashDealFoundation.js';
import { FlashDealQuotaService } from './flash-deal-quota.service.js';
import { CartService } from './cart.service.js';
import type { CartSku } from '../../catalog/catalog-cart.api.js';

describe.skipIf(!hasTestPostgres)(
  'Flash deal quota (isolated PostgreSQL)',
  () => {
    let database: Awaited<ReturnType<typeof createTestPostgres>>;
    let service: FlashDealQuotaService;
    const seller = randomUUID();
    const buyer = randomUUID();
    const otherBuyer = randomUUID();
    const product = randomUUID();
    const skuId = randomUUID();
    let campaign: string;
    let item: string;
    let sku: CartSku;
    beforeEach(async () => {
      database = await createTestPostgres();
      await database.db
        .query(`CREATE SCHEMA identity; CREATE SCHEMA catalog; CREATE SCHEMA commerce;
      CREATE TABLE identity.users(id uuid PRIMARY KEY);
      CREATE TABLE commerce.orders(id uuid PRIMARY KEY, buyer_id uuid NOT NULL, seller_id uuid NOT NULL, source text NOT NULL DEFAULT 'CART', status text NOT NULL DEFAULT 'PENDING_PAYMENT');
      CREATE TABLE commerce.order_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES commerce.orders(id), sku_id uuid NOT NULL, product_id uuid NOT NULL, quantity integer NOT NULL, unit_price numeric(18,2) NOT NULL);
      CREATE TABLE catalog.products(id uuid PRIMARY KEY, seller_id uuid NOT NULL REFERENCES identity.users(id));
      CREATE TABLE catalog.product_skus(id uuid PRIMARY KEY, product_id uuid NOT NULL REFERENCES catalog.products(id), price numeric(18,2) NOT NULL, original_price numeric(18,2));`);
      await database.db.query(
        'INSERT INTO identity.users VALUES ($1),($2),($3)',
        [seller, buyer, otherBuyer],
      );
      await database.db.query('INSERT INTO catalog.products VALUES ($1,$2)', [
        product,
        seller,
      ]);
      await database.db.query(
        'INSERT INTO catalog.product_skus VALUES ($1,$2,100,120)',
        [skuId, product],
      );
      const runner = database.db.createQueryRunner();
      try {
        await new CreateFlashDeals1794960000000().up(runner);
        await new ExtendFlashDealFoundation1795104000000().up(runner);
      } finally {
        await runner.release();
      }
      [{ id: campaign }] = await database.db.query(
        `INSERT INTO catalog.flash_deal_campaigns(title,slug,status,starts_at,ends_at,created_by) VALUES ('Deal','deal','ACTIVE',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour',$1) RETURNING id`,
        [seller],
      );
      item = await addDeal(campaign);
      sku = {
        id: skuId,
        productId: product,
        sellerId: seller,
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
      service = new FlashDealQuotaService(database.db, {
        getCartSkus: vi.fn(async () => [sku]),
      });
    });
    afterEach(async () => database?.close());
    async function addDeal(campaignId: string) {
      const [{ id }] = await database.db.query(
        `INSERT INTO catalog.flash_deal_items(campaign_id,sku_id,product_id,seller_id,original_price_snapshot,flash_price,quota_qty,max_per_buyer) VALUES ($1,$2,$3,$4,120,80,3,2) RETURNING id`,
        [campaignId, skuId, product, seller],
      );
      return id as string;
    }
    async function addOrder(buyerId = buyer, quantity = 1) {
      const id = randomUUID();
      await database.db.query(
        'INSERT INTO commerce.orders(id,buyer_id,seller_id) VALUES ($1,$2,$3)',
        [id, buyerId, seller],
      );
      await database.db.query(
        'INSERT INTO commerce.order_items(order_id,sku_id,product_id,quantity,unit_price) VALUES ($1,$2,$3,$4,80)',
        [id, skuId, product, quantity],
      );
      return id;
    }
    async function reserve(
      manager: EntityManager,
      orderId: string,
      buyerId = buyer,
      quantity = 1,
    ) {
      if (manager.queryRunner?.isTransactionActive)
        await manager.query(
          `SET LOCAL statement_timeout='5s'; SET LOCAL deadlock_timeout='100ms'`,
        );
      return service.reserve(manager, {
        buyerId,
        orders: [{ orderId, items: [{ itemId: item, skuId, quantity }] }],
      });
    }
    async function state() {
      const [counter] = await database.db.query(
        'SELECT sold_qty FROM catalog.flash_deal_items WHERE id=$1',
        [item],
      );
      const reservations = await database.db.query(
        'SELECT quantity,status FROM catalog.flash_deal_reservations ORDER BY order_id',
      );
      return { sold: counter.sold_qty, reservations };
    }
    it('serializes two buyers competing for the last unit', async () => {
      await database.db.query(
        'UPDATE catalog.flash_deal_items SET quota_qty=1 WHERE id=$1',
        [item],
      );
      const orders = await Promise.all([addOrder(), addOrder(otherBuyer)]);
      const results = await Promise.allSettled(
        orders.map((order, index) =>
          database.db.transaction((manager) =>
            reserve(manager, order, index ? otherBuyer : buyer),
          ),
        ),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
      expect(await state()).toEqual({
        sold: 1,
        reservations: [{ quantity: 1, status: 'RESERVED' }],
      });
    });
    it('serializes concurrent duplicate reserve and release calls without charging or releasing twice', async () => {
      const order = await addOrder();
      await Promise.all(
        [1, 2].map(() =>
          database.db.transaction((manager) => reserve(manager, order)),
        ),
      );
      expect(await state()).toEqual({
        sold: 1,
        reservations: [{ quantity: 1, status: 'RESERVED' }],
      });
      await Promise.all(
        [1, 2].map(() =>
          database.db.transaction((manager) =>
            service.releaseByOrderId(manager, order),
          ),
        ),
      );
      expect(await state()).toEqual({
        sold: 0,
        reservations: [{ quantity: 1, status: 'RELEASED' }],
      });
    });
    it('handles concurrent multi-order two-SKU batches supplied in reverse key order', async () => {
      const secondSku = { ...sku, id: randomUUID() };
      await database.db.query(
        'INSERT INTO catalog.product_skus VALUES ($1,$2,100,120)',
        [secondSku.id, product],
      );
      const [{ id: secondCampaign }] = await database.db.query(
        `INSERT INTO catalog.flash_deal_campaigns(title,slug,status,starts_at,ends_at,created_by) VALUES ('Second','second','ACTIVE',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour',$1) RETURNING id`,
        [seller],
      );
      const [{ id: secondItem }] = await database.db.query(
        `INSERT INTO catalog.flash_deal_items(campaign_id,sku_id,product_id,seller_id,original_price_snapshot,flash_price,quota_qty,max_per_buyer) VALUES ($1,$2,$3,$4,120,80,3,2) RETURNING id`,
        [secondCampaign, secondSku.id, product, seller],
      );
      service = new FlashDealQuotaService(database.db, {
        getCartSkus: async () => [sku, secondSku],
      });
      const orders = await Promise.all([
        addOrder(),
        addOrder(),
        addOrder(otherBuyer),
        addOrder(otherBuyer),
      ]);
      await database.db.query(
        'UPDATE commerce.order_items SET sku_id=$1 WHERE order_id = ANY($2::uuid[])',
        [secondSku.id, [orders[1], orders[3]]],
      );
      const batches = [0, 1].map((index) => ({
        buyerId: index ? otherBuyer : buyer,
        orders: [
          {
            orderId: orders[index * 2],
            items: [{ itemId: item, skuId, quantity: 1 }],
          },
          {
            orderId: orders[index * 2 + 1],
            items: [{ itemId: secondItem, skuId: secondSku.id, quantity: 1 }],
          },
        ],
      }));
      batches[1].orders.reverse();
      await Promise.all(
        batches.map((input) =>
          database.db.transaction(async (manager) => {
            await manager.query(
              `SET LOCAL statement_timeout='5s'; SET LOCAL deadlock_timeout='100ms'`,
            );
            await service.reserve(manager, input);
          }),
        ),
      );
      expect(
        (
          await database.db.query(
            'SELECT sold_qty FROM catalog.flash_deal_items ORDER BY id',
          )
        ).map((row: { sold_qty: number }) => row.sold_qty),
      ).toEqual([2, 2]);
      expect(
        (
          await database.db.query(
            'SELECT count(*)::int AS count FROM catalog.flash_deal_reservations',
          )
        )[0].count,
      ).toBe(4);
    });
    it('serializes same-buyer cumulative RESERVED and COMMITTED usage', async () => {
      await database.db.query(
        'UPDATE catalog.flash_deal_items SET max_per_buyer=1 WHERE id=$1',
        [item],
      );
      const orders = await Promise.all([addOrder(), addOrder()]);
      const results = await Promise.allSettled(
        orders.map((order) =>
          database.db.transaction((manager) => reserve(manager, order)),
        ),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const failure = results.find(
        (r) => r.status === 'rejected',
      ) as PromiseRejectedResult;
      expect(failure.reason.response.errorCode).toBe(
        'FLASH_DEAL_LIMIT_EXCEEDED',
      );
      expect((await state()).sold).toBe(1);
    });
    it('prelocks cancellation siblings in campaigns B,A against a reserve batch in A,B without deadlock', async () => {
      const secondSku = { ...sku, id: randomUUID() };
      await database.db.query(
        'INSERT INTO catalog.product_skus VALUES ($1,$2,100,120)',
        [secondSku.id, product],
      );
      const [{ id: secondCampaign }] = await database.db.query(
        `INSERT INTO catalog.flash_deal_campaigns(title,slug,status,starts_at,ends_at,created_by) VALUES ('Second','second','ACTIVE',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour',$1) RETURNING id`,
        [seller],
      );
      const [{ id: secondItem }] = await database.db.query(
        `INSERT INTO catalog.flash_deal_items(campaign_id,sku_id,product_id,seller_id,original_price_snapshot,flash_price,quota_qty,max_per_buyer) VALUES ($1,$2,$3,$4,120,80,3,2) RETURNING id`,
        [secondCampaign, secondSku.id, product, seller],
      );
      service = new FlashDealQuotaService(database.db, {
        getCartSkus: async () => [sku, secondSku],
      });
      const [a, b] = [
        { campaign, itemId: item, skuId },
        { campaign: secondCampaign, itemId: secondItem, skuId: secondSku.id },
      ].sort((left, right) => left.campaign.localeCompare(right.campaign));
      const cancelIds = (await Promise.all([addOrder(), addOrder()])).sort();
      const reserveIds = await Promise.all([
        addOrder(otherBuyer),
        addOrder(otherBuyer),
      ]);
      for (const [orderId, key] of [
        [cancelIds[0], b],
        [cancelIds[1], a],
        [reserveIds[0], a],
        [reserveIds[1], b],
      ] as const) {
        await database.db.query(
          'UPDATE commerce.order_items SET sku_id=$1 WHERE order_id=$2',
          [key.skuId, orderId],
        );
      }
      await database.db.transaction((manager) =>
        service.reserve(manager, {
          buyerId: buyer,
          orders: [
            {
              orderId: cancelIds[0],
              items: [{ itemId: b.itemId, skuId: b.skuId, quantity: 1 }],
            },
            {
              orderId: cancelIds[1],
              items: [{ itemId: a.itemId, skuId: a.skuId, quantity: 1 }],
            },
          ],
        }),
      );
      let firstLock!: () => void;
      let continueReserve!: () => void;
      let cancellationWaiting!: () => void;
      const ready = new Promise<void>((resolve) => {
        firstLock = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        continueReserve = resolve;
      });
      const waiting = new Promise<void>((resolve) => {
        cancellationWaiting = resolve;
      });
      const campaignLockSql = 'SELECT id FROM catalog.flash_deal_campaigns';
      const reservation = database.db.transaction(async (manager) => {
        await manager.query(
          `SET LOCAL statement_timeout='5s'; SET LOCAL deadlock_timeout='100ms'`,
        );
        // Pause the real reserve algorithm after its first campaign lock, before the rest of the sorted union.
        const originalQuery = manager.query.bind(manager);
        let intercepted = false;
        manager.query = async (sql, parameters) => {
          if (!intercepted && sql.startsWith(campaignLockSql)) {
            intercepted = true;
            await originalQuery(
              'SELECT id FROM catalog.flash_deal_campaigns WHERE id=$1 FOR UPDATE',
              [a.campaign],
            );
            firstLock();
            await gate;
          }
          return originalQuery(sql, parameters);
        };
        await service.reserve(manager, {
          buyerId: otherBuyer,
          orders: [
            {
              orderId: reserveIds[0],
              items: [{ itemId: a.itemId, skuId: a.skuId, quantity: 1 }],
            },
            {
              orderId: reserveIds[1],
              items: [{ itemId: b.itemId, skuId: b.skuId, quantity: 1 }],
            },
          ],
        });
      });
      await ready;
      const cancellation = database.db.transaction(async (manager) => {
        await manager.query(
          `SET LOCAL statement_timeout='5s'; SET LOCAL deadlock_timeout='100ms'`,
        );
        const originalQuery = manager.query.bind(manager);
        manager.query = async (sql, parameters) => {
          if (sql.startsWith(campaignLockSql)) cancellationWaiting();
          return originalQuery(sql, parameters);
        };
        await service.prelockByOrderIds(manager, cancelIds);
        // Match cancelOrder's sibling ordering: first B, then A.
        for (const orderId of cancelIds) {
          await service.releaseByOrderId(manager, orderId, true);
          await manager.query(
            `UPDATE commerce.orders SET status='CANCELLED' WHERE id=$1`,
            [orderId],
          );
        }
      });
      try {
        await waiting;
      } finally {
        continueReserve();
      }
      await Promise.all([reservation, cancellation]);
      expect(
        (
          await database.db.query(
            'SELECT sold_qty FROM catalog.flash_deal_items ORDER BY id',
          )
        ).map((row: { sold_qty: number }) => row.sold_qty),
      ).toEqual([1, 1]);
      expect(
        await database.db.query(
          'SELECT status,count(*)::int AS count FROM catalog.flash_deal_reservations GROUP BY status ORDER BY status',
        ),
      ).toEqual([
        { status: 'RELEASED', count: 2 },
        { status: 'RESERVED', count: 2 },
      ]);
    });
    it('supports exact retries, commit and release without double counting; excludes RELEASED usage', async () => {
      const order = await addOrder();
      await database.db.transaction(async (manager) => {
        await reserve(manager, order);
        await reserve(manager, order);
      });
      await database.db.query(
        `UPDATE commerce.orders SET status='PAID' WHERE id=$1`,
        [order],
      );
      await database.db.transaction(async (manager) => {
        await service.commitByOrderId(manager, order);
        await service.commitByOrderId(manager, order);
      });
      expect(await state()).toEqual({
        sold: 1,
        reservations: [{ quantity: 1, status: 'COMMITTED' }],
      });
      await database.db.transaction((manager) =>
        service.releaseByOrderId(manager, order, true),
      );
      expect((await state()).sold).toBe(1);
      await database.db.transaction(async (manager) => {
        await service.releaseByOrderId(manager, order);
        await service.releaseByOrderId(manager, order);
      });
      expect(await state()).toEqual({
        sold: 0,
        reservations: [{ quantity: 1, status: 'RELEASED' }],
      });
      await expect(
        database.db.transaction((manager) => reserve(manager, order)),
      ).rejects.toMatchObject({
        response: { errorCode: 'FLASH_DEAL_RESERVATION_RETRY_MISMATCH' },
      });
      await expect(
        database.db.transaction((manager) =>
          service.commitByOrderId(manager, order),
        ),
      ).rejects.toMatchObject({
        response: { errorCode: 'FLASH_DEAL_RESERVATION_RELEASED' },
      });
      const next = await addOrder(buyer, 2);
      await database.db.transaction((manager) =>
        reserve(manager, next, buyer, 2),
      );
      expect((await state()).sold).toBe(2);
    });
    it('rolls back increments and reservation insert with the caller transaction', async () => {
      const order = await addOrder();
      await expect(
        database.db.transaction(async (manager) => {
          await reserve(manager, order);
          throw new Error('rollback');
        }),
      ).rejects.toThrow('rollback');
      expect(await state()).toEqual({ sold: 0, reservations: [] });
      await database.db.transaction((manager) => reserve(manager, order));
      await database.db.query(
        'UPDATE catalog.flash_deal_items SET sold_qty=0 WHERE id=$1',
        [item],
      );
      await expect(
        database.db.transaction((manager) =>
          service.releaseByOrderId(manager, order),
        ),
      ).rejects.toMatchObject({
        response: { errorCode: 'FLASH_DEAL_COUNTER_UNDERFLOW' },
      });
      expect(await state()).toEqual({
        sold: 0,
        reservations: [{ quantity: 1, status: 'RESERVED' }],
      });
    });
    it('rejects wrong buyer/source/SKU/quantity/price and validates the complete batch before writes', async () => {
      const order = await addOrder();
      await expect(
        database.db.transaction((manager) =>
          reserve(manager, order, otherBuyer),
        ),
      ).rejects.toMatchObject({
        response: { errorCode: 'FLASH_DEAL_ORDER_MISMATCH' },
      });
      await expect(
        database.db.transaction((manager) => reserve(manager, order, buyer, 2)),
      ).rejects.toMatchObject({
        response: { errorCode: 'FLASH_DEAL_ORDER_ITEM_MISMATCH' },
      });
      await database.db.query(
        `UPDATE commerce.orders SET source='AUCTION' WHERE id=$1`,
        [order],
      );
      await expect(
        database.db.transaction((manager) => reserve(manager, order)),
      ).rejects.toMatchObject({
        response: { errorCode: 'FLASH_DEAL_ORDER_MISMATCH' },
      });
      await database.db.query(
        `UPDATE commerce.orders SET source='CART' WHERE id=$1`,
        [order],
      );
      const request = {
        buyerId: buyer,
        orders: [
          {
            orderId: order,
            items: [
              { itemId: item, skuId, quantity: 1 },
              { itemId: randomUUID(), skuId, quantity: 1 },
            ],
          },
        ],
      };
      await expect(
        database.db.transaction((manager) => service.reserve(manager, request)),
      ).rejects.toMatchObject({
        response: { errorCode: 'FLASH_DEAL_ITEM_MISMATCH' },
      });
      sku = { ...sku, sellerId: otherBuyer };
      await expect(
        database.db.transaction((manager) => reserve(manager, order)),
      ).rejects.toMatchObject({
        response: { errorCode: 'FLASH_DEAL_ITEM_MISMATCH' },
      });
      sku = { ...sku, sellerId: seller };
      await database.db.query(
        'UPDATE commerce.order_items SET unit_price=100 WHERE order_id=$1',
        [order],
      );
      await expect(
        database.db.transaction((manager) => reserve(manager, order)),
      ).rejects.toMatchObject({
        response: { errorCode: 'FLASH_DEAL_ORDER_ITEM_MISMATCH' },
      });
      expect(await state()).toEqual({ sold: 0, reservations: [] });
    });
    it('uses database time after waiting for campaign locks', async () => {
      const order = await addOrder();
      let unlock!: () => void;
      let locked!: () => void;
      const ready = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        unlock = resolve;
      });
      const editor = database.db.transaction(async (manager) => {
        await manager.query(
          'SELECT id FROM catalog.flash_deal_campaigns WHERE id=$1 FOR UPDATE',
          [campaign],
        );
        await manager.query(
          `UPDATE catalog.flash_deal_campaigns SET ends_at=clock_timestamp() WHERE id=$1`,
          [campaign],
        );
        locked();
        await gate;
      });
      await ready;
      const reservation = database.db.transaction((manager) =>
        reserve(manager, order),
      );
      unlock();
      await editor;
      await expect(reservation).rejects.toMatchObject({
        response: { errorCode: 'FLASH_DEAL_ENDED' },
      });
      expect((await state()).sold).toBe(0);
    });
    it('locks multi-order batches deterministically and rejects inconsistent retries', async () => {
      const orders = await Promise.all([addOrder(), addOrder()]);
      const input = {
        buyerId: buyer,
        orders: orders.reverse().map((orderId) => ({
          orderId,
          items: [{ itemId: item, skuId, quantity: 1 }],
        })),
      };
      await database.db.transaction((manager) =>
        service.reserve(manager, input),
      );
      await database.db.transaction((manager) =>
        service.reserve(manager, input),
      );
      // A quantity mismatch always fails even on a previously reserved order.
      await expect(
        database.db.transaction((manager) =>
          reserve(manager, orders[0], buyer, 2),
        ),
      ).rejects.toMatchObject({ status: 409 });
      expect((await state()).sold).toBe(2);
    });
    it('serializes cancellation against payment without reviving released reservations', async () => {
      const order = await addOrder();
      await database.db.transaction((manager) => reserve(manager, order));
      await database.db.transaction(async (manager) => {
        await manager.query(
          'SELECT id FROM commerce.orders WHERE id=$1 FOR UPDATE',
          [order],
        );
        await service.releaseByOrderId(manager, order, true);
        await manager.query(
          `UPDATE commerce.orders SET status='CANCELLED' WHERE id=$1`,
          [order],
        );
      });
      await expect(
        database.db.transaction(async (manager) => {
          await manager.query(
            `UPDATE commerce.orders SET status='PAID' WHERE id=$1`,
            [order],
          );
          await service.commitByOrderId(manager, order);
        }),
      ).rejects.toMatchObject({
        response: { errorCode: 'FLASH_DEAL_RESERVATION_RELEASED' },
      });
      expect(
        (
          await database.db.query(
            'SELECT status FROM commerce.orders WHERE id=$1',
            [order],
          )
        )[0].status,
      ).toBe('CANCELLED');
      expect(await state()).toEqual({
        sold: 0,
        reservations: [{ quantity: 1, status: 'RELEASED' }],
      });
    });
    it.each(['cancel', 'payment'] as const)(
      'serializes concurrent payment/cancellation when %s obtains the order lock first',
      async (first) => {
        const order = await addOrder();
        await database.db.transaction((manager) => reserve(manager, order));
        let locked!: () => void;
        let unlock!: () => void;
        const ready = new Promise<void>((resolve) => {
          locked = resolve;
        });
        const gate = new Promise<void>((resolve) => {
          unlock = resolve;
        });
        async function apply(
          manager: EntityManager,
          action: 'cancel' | 'payment',
          hold = false,
        ) {
          await manager.query(
            `SET LOCAL statement_timeout='5s'; SET LOCAL deadlock_timeout='100ms'`,
          );
          const [row] = await manager.query(
            'SELECT status FROM commerce.orders WHERE id=$1 FOR UPDATE',
            [order],
          );
          if (hold) {
            locked();
            await gate;
          }
          if (row.status !== 'PENDING_PAYMENT') return;
          if (action === 'cancel') {
            await service.releaseByOrderId(manager, order, true);
            await manager.query(
              `UPDATE commerce.orders SET status='CANCELLED' WHERE id=$1`,
              [order],
            );
          } else {
            await manager.query(
              `UPDATE commerce.orders SET status='PAID' WHERE id=$1`,
              [order],
            );
            await service.commitByOrderId(manager, order);
          }
        }
        const winner = database.db.transaction((manager) =>
          apply(manager, first, true),
        );
        await ready;
        const contender = database.db.transaction((manager) =>
          apply(manager, first === 'cancel' ? 'payment' : 'cancel'),
        );
        unlock();
        await Promise.all([winner, contender]);
        expect(await state()).toEqual(
          first === 'cancel'
            ? { sold: 0, reservations: [{ quantity: 1, status: 'RELEASED' }] }
            : { sold: 1, reservations: [{ quantity: 1, status: 'COMMITTED' }] },
        );
      },
    );
    it('safely handles orders without reservations and requires active caller transactions', async () => {
      const order = await addOrder();
      await database.db.transaction(async (manager) => {
        await service.commitByOrderId(manager, order);
        await service.releaseByOrderId(manager, order);
      });
      await expect(reserve(database.db.manager, order)).rejects.toMatchObject({
        response: { errorCode: 'FLASH_DEAL_TRANSACTION_REQUIRED' },
      });
      await expect(
        service.commitByOrderId(database.db.manager, order),
      ).rejects.toMatchObject({ status: 500 });
      await expect(
        service.releaseByOrderId(database.db.manager, order),
      ).rejects.toMatchObject({ status: 500 });
    });
    it('projects a mixed cart with exact money, metadata and no quota writes', async () => {
      const regularSku = { ...sku, id: randomUUID(), price: '0.10' };
      const rows = [
        {
          id: randomUUID(),
          skuId,
          productId: product,
          quantity: 2,
          unitPriceSnapshot: '100.00',
        },
        {
          id: randomUUID(),
          skuId: regularSku.id,
          productId: product,
          quantity: 3,
          unitPriceSnapshot: '0.10',
        },
      ];
      const cart = new CartService(
        {} as never,
        { find: async () => rows } as never,
        { getCartSkus: async () => [sku, regularSku] },
        {
          getDefaultWarehouseStock: async () => [
            { skuId, availableQuantity: 5 },
            { skuId: regularSku.id, availableQuantity: 5 },
          ],
        },
        service,
      );
      const projected = await cart.projectCart({
        id: randomUUID(),
        userId: buyer,
      } as never);
      expect(projected.subtotal).toBe('160.30');
      expect(projected.items[0]).toMatchObject({
        unitPrice: '80.00',
        flashDeal: {
          itemId: item,
          flashPrice: '80.00',
          regularPrice: '120.00',
          remainingQuota: 3,
          maxPerBuyer: 2,
        },
      });
      expect(projected.items[1].flashDeal).toBeNull();
      expect(await state()).toEqual({ sold: 0, reservations: [] });
    });
    it.each([
      ['UPDATE catalog.flash_deal_items SET sold_qty=3', 'SOLD_OUT'],
      ["UPDATE catalog.flash_deal_items SET status='PAUSED'", 'PAUSED'],
      ["UPDATE catalog.flash_deal_items SET status='CANCELLED'", 'INVALID'],
      [
        'UPDATE catalog.flash_deal_campaigns SET ends_at=clock_timestamp()',
        'ENDED',
      ],
      [
        "UPDATE catalog.flash_deal_campaigns SET starts_at=clock_timestamp()+interval '10 minutes'",
        'UPCOMING',
      ],
      [
        "UPDATE catalog.flash_deal_campaigns SET status='SCHEDULED'",
        'UPCOMING',
      ],
      ["UPDATE catalog.flash_deal_campaigns SET status='DRAFT'", 'INVALID'],
    ])('withholds flash pricing and warns for %s', async (sql, code) => {
      await database.db.query(sql);
      const projected = (
        await service.projectForCart([sku], new Map([[skuId, 1]]), buyer)
      ).get(skuId)!;
      expect(projected).toMatchObject({
        flashDeal: null,
        warningCode: `FLASH_DEAL_${code}`,
      });
      await expect(
        database.db.transaction((manager) =>
          addOrder().then((id) => reserve(manager, id)),
        ),
      ).rejects.toMatchObject({
        response: { errorCode: `FLASH_DEAL_${code}` },
      });
    });
    it('enforces remaining buyer usage on cart reads and requires sign-in', async () => {
      const order = await addOrder();
      await database.db.transaction((manager) => reserve(manager, order));
      const quantity = new Map([[skuId, 2]]);
      expect(
        (await service.projectForCart([sku], quantity, buyer)).get(skuId)
          ?.warningCode,
      ).toBe('FLASH_DEAL_LIMIT_EXCEEDED');
      expect(
        (await service.projectForCart([sku], quantity, null)).get(skuId)
          ?.warningCode,
      ).toBe('FLASH_DEAL_SIGN_IN_REQUIRED');
      expect(
        (
          await service.projectForCart([sku], new Map([[skuId, 3]]), otherBuyer)
        ).get(skuId)?.warningCode,
      ).toBe('FLASH_DEAL_SOLD_OUT');
    });
    it('withholds ambiguous overlapping eligible prices rather than choosing a winner', async () => {
      const [{ id }] = await database.db.query(
        `INSERT INTO catalog.flash_deal_campaigns(title,slug,status,starts_at,ends_at,created_by) VALUES ('Second','second','ACTIVE',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour',$1) RETURNING id`,
        [seller],
      );
      await addDeal(id);
      expect(
        (await service.projectForCart([sku], new Map([[skuId, 1]]), buyer)).get(
          skuId,
        ),
      ).toMatchObject({ flashDeal: null, warningCode: 'FLASH_DEAL_AMBIGUOUS' });
      expect(
        (
          await service.projectForCart(
            [{ ...sku, sellerId: otherBuyer }],
            new Map([[skuId, 1]]),
            buyer,
          )
        ).get(skuId)?.warningCode,
      ).toBe('FLASH_DEAL_INVALID');
    });
  },
);
