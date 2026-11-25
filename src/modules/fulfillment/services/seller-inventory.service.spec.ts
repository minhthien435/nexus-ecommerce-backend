import { createHash } from 'node:crypto';
import { SellerInventoryService } from './seller-inventory.service.js';

describe('SellerInventoryService', () => {
  const actorId = '11111111-1111-4111-8111-111111111111';
  const skuId = '22222222-2222-4222-8222-222222222222';
  const warehouseId = '33333333-3333-4333-8333-333333333333';
  const itemId = '44444444-4444-4444-8444-444444444444';

  function setup() {
    const warehouses = {
      find: vi.fn().mockResolvedValue([{ id: warehouseId }]),
    };
    const manager = {
      getRepository: vi.fn().mockReturnValue(warehouses),
      query: vi.fn(),
    };
    const dataSource = {
      manager,
      query: vi.fn(),
      transaction: vi.fn(async (work: (value: typeof manager) => unknown) =>
        work(manager),
      ),
    };
    const identity = { getUserRoles: vi.fn().mockResolvedValue(['SELLER']) };
    return {
      warehouses,
      manager,
      dataSource,
      identity,
      service: new SellerInventoryService(
        dataSource as never,
        identity as never,
      ),
    };
  }

  it('lists only seller-owned SKUs and projects missing inventory as zero', async () => {
    const s = setup();
    s.dataSource.query
      .mockResolvedValueOnce([
        {
          skuId,
          skuCode: 'SHIRT-BLACK',
          productName: 'Shirt',
          totalQuantity: 0,
          reservedQuantity: 0,
          unavailableQuantity: 0,
          availableQuantity: 0,
        },
      ])
      .mockResolvedValueOnce([{ total: 1 }]);
    await expect(
      s.service.list(actorId, { page: 1, limit: 20, search: 'shirt' }),
    ).resolves.toMatchObject({
      items: [{ skuId, totalQuantity: 0, isLowStock: true }],
      total: 1,
    });
    expect(s.dataSource.query.mock.calls[0][0]).toContain(
      'product.seller_id = $2::uuid',
    );
    expect(s.dataSource.query.mock.calls[0][1]).toEqual([
      warehouseId,
      actorId,
      'shirt',
      20,
      0,
    ]);
  });

  it('summarizes all seller-owned SKUs and counts missing inventory as low stock', async () => {
    const s = setup();
    s.dataSource.query.mockResolvedValueOnce([
      { totalSkus: 3, onHand: 18, reserved: 4, lowStock: 2 },
    ]);

    await expect(s.service.summary(actorId)).resolves.toEqual({
      totalSkus: 3,
      onHand: 18,
      reserved: 4,
      lowStock: 2,
    });
    const [sql, params] = s.dataSource.query.mock.calls[0];
    expect(sql).toContain('product.seller_id = $2::uuid');
    expect(sql).toContain('COALESCE(inventory.available_qty, 0) <= 5');
    expect(sql).not.toContain('SUM(inventory.total_qty), 0)::int');
    expect(sql).not.toContain('SUM(inventory.reserved_qty), 0)::int');
    expect(sql).not.toContain('LIMIT');
    expect(params).toEqual([warehouseId, actorId]);
  });

  it('summarizes every seller for an admin without an ownership filter', async () => {
    const s = setup();
    s.identity.getUserRoles.mockResolvedValue(['ADMIN']);
    s.dataSource.query.mockResolvedValueOnce([
      { totalSkus: '0', onHand: '0', reserved: '0', lowStock: '0' },
    ]);

    await expect(s.service.summary(actorId)).resolves.toEqual({
      totalSkus: 0,
      onHand: 0,
      reserved: 0,
      lowStock: 0,
    });
    const [sql, params] = s.dataSource.query.mock.calls[0];
    expect(sql).not.toContain('product.seller_id');
    expect(params).toEqual([warehouseId]);
  });

  it('atomically restocks an owned SKU and records the resulting quantities', async () => {
    const s = setup();
    const createdAt = new Date('2026-10-27T00:00:00Z');
    s.manager.query.mockImplementation((sql: string) => {
      if (sql.includes('pg_advisory_xact_lock')) return [];
      if (sql.includes('FROM catalog.product_skus')) return [{ id: skuId }];
      if (sql.includes('FROM fulfillment.seller_inventory_adjustments'))
        return [];
      if (sql.includes('INSERT INTO fulfillment.inventory_items'))
        return [
          {
            inventory_item_id: itemId,
            sku_id: skuId,
            warehouse_id: warehouseId,
            quantity_before: 7,
            total_quantity: 12,
            reserved_quantity: 2,
            unavailable_quantity: 1,
            available_quantity: 9,
          },
        ];
      if (sql.includes('INSERT INTO fulfillment.seller_inventory_adjustments'))
        return [{ created_at: createdAt }];
      throw new Error('Unexpected query');
    });
    await expect(
      s.service.restock(actorId, {
        skuId,
        quantity: 5,
        idempotencyKey: 'restock-1',
      }),
    ).resolves.toEqual({
      skuId,
      warehouseId,
      quantityDelta: 5,
      totalQuantity: 12,
      reservedQuantity: 2,
      unavailableQuantity: 1,
      availableQuantity: 9,
      idempotencyKey: 'restock-1',
      createdAt,
    });
    const updateSql = s.manager.query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO fulfillment.inventory_items'),
    )?.[0] as string;
    expect(updateSql).toContain('ON CONFLICT (sku_id, warehouse_id) DO UPDATE');
    expect(updateSql).toContain(
      'inventory_items.total_qty + EXCLUDED.total_qty',
    );
    expect(updateSql).toContain('unavailable_qty, version, updated_at');
    expect(updateSql).not.toContain('version, created_at, updated_at');
  });

  it('returns the original result for an idempotent retry without touching stock', async () => {
    const s = setup();
    const createdAt = new Date('2026-10-27T00:00:00Z');
    const fingerprint = createHash('sha256').update(`${skuId}:5`).digest('hex');
    s.manager.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: skuId }])
      .mockResolvedValueOnce([
        {
          inventory_item_id: itemId,
          sku_id: skuId,
          warehouse_id: warehouseId,
          quantity_delta: 5,
          total_quantity: 12,
          reserved_quantity: 2,
          unavailable_quantity: 1,
          available_quantity: 9,
          idempotency_key: 'restock-1',
          request_fingerprint: fingerprint,
          created_at: createdAt,
        },
      ]);
    await expect(
      s.service.restock(actorId, {
        skuId,
        quantity: 5,
        idempotencyKey: 'restock-1',
      }),
    ).resolves.toMatchObject({
      totalQuantity: 12,
      reservedQuantity: 2,
      availableQuantity: 9,
    });
    expect(s.manager.query).toHaveBeenCalledTimes(3);
  });

  it('rejects reuse of an idempotency key with another payload', async () => {
    const s = setup();
    s.manager.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: skuId }])
      .mockResolvedValueOnce([{ request_fingerprint: 'different' }]);
    await expect(
      s.service.restock(actorId, {
        skuId,
        quantity: 5,
        idempotencyKey: 'restock-1',
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: { errorCode: 'IDEMPOTENCY_KEY_REUSED' },
    });
  });

  it('hides another seller SKU and makes no inventory change', async () => {
    const s = setup();
    s.manager.query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await expect(
      s.service.restock(actorId, {
        skuId,
        quantity: 5,
        idempotencyKey: 'restock-1',
      }),
    ).rejects.toMatchObject({
      status: 404,
      response: { errorCode: 'SELLER_SKU_NOT_FOUND' },
    });
    expect(s.warehouses.find).not.toHaveBeenCalled();
  });

  it.each([
    { candidates: [] },
    { candidates: [{ id: warehouseId }, { id: itemId }] },
  ])(
    'rejects missing or ambiguous default warehouse and leaves stock unchanged',
    async ({ candidates }) => {
      const s = setup();
      s.warehouses.find.mockResolvedValue(candidates);
      s.manager.query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: skuId }])
        .mockResolvedValueOnce([]);
      await expect(
        s.service.restock(actorId, {
          skuId,
          quantity: 5,
          idempotencyKey: 'restock-1',
        }),
      ).rejects.toMatchObject({
        status: 503,
        response: { errorCode: 'DEFAULT_WAREHOUSE_NOT_CONFIGURED' },
      });
      expect(
        s.manager.query.mock.calls.some(([sql]) =>
          String(sql).includes('INSERT INTO fulfillment.inventory_items'),
        ),
      ).toBe(false);
    },
  );

  it('propagates ledger failure from the same transaction', async () => {
    const s = setup();
    s.manager.query.mockImplementation((sql: string) => {
      if (sql.includes('pg_advisory_xact_lock')) return [];
      if (sql.includes('FROM catalog.product_skus')) return [{ id: skuId }];
      if (sql.includes('FROM fulfillment.seller_inventory_adjustments'))
        return [];
      if (sql.includes('INSERT INTO fulfillment.inventory_items'))
        return [
          {
            inventory_item_id: itemId,
            sku_id: skuId,
            warehouse_id: warehouseId,
            quantity_before: 0,
            total_quantity: 5,
            reserved_quantity: 0,
            unavailable_quantity: 0,
            available_quantity: 5,
          },
        ];
      throw new Error('ledger failed');
    });
    await expect(
      s.service.restock(actorId, {
        skuId,
        quantity: 5,
        idempotencyKey: 'restock-1',
      }),
    ).rejects.toThrow('ledger failed');
    expect(s.dataSource.transaction).toHaveBeenCalledOnce();
  });

  describe('decrease', () => {
    it('atomically decreases available inventory and records MANUAL_DECREASE', async () => {
      const s = setup();
      s.manager.query
        .mockResolvedValueOnce([]) // lock
        .mockResolvedValueOnce([{ id: skuId }]) // ownership
        .mockResolvedValueOnce([]) // existing idempotency
        .mockResolvedValueOnce([
          [
            {
              inventory_item_id: itemId,
              sku_id: skuId,
              warehouse_id: warehouseId,
              quantity_before: 10,
              total_quantity: 7,
              reserved_quantity: 2,
              unavailable_quantity: 0,
              available_quantity: 5,
            },
          ],
          1,
        ]) // update inventory (TypeORM UPDATE ... RETURNING returns [rows, rowCount])
        .mockResolvedValueOnce([
          { created_at: new Date('2026-11-24T00:00:00Z') },
        ]); // insert ledger

      const res = await s.service.decrease(actorId, {
        skuId,
        quantity: 3,
        idempotencyKey: 'dec-1',
        note: 'Damaged item removed',
      });

      expect(res).toEqual({
        skuId,
        warehouseId,
        type: 'MANUAL_DECREASE',
        quantityDelta: -3,
        totalQuantity: 7,
        reservedQuantity: 2,
        unavailableQuantity: 0,
        availableQuantity: 5,
        note: 'Damaged item removed',
        idempotencyKey: 'dec-1',
        createdAt: new Date('2026-11-24T00:00:00Z'),
      });
      const updateCall = s.manager.query.mock.calls[3];
      expect(updateCall[0]).toContain('available_qty >= $3::int');
      expect(updateCall[1]).toEqual([skuId, warehouseId, 3]);

      const insertCall = s.manager.query.mock.calls[4];
      expect(insertCall[0]).toContain("'MANUAL_DECREASE'");
      expect(insertCall[1][4]).toBe(-3);
      expect(insertCall[1][12]).toBe('Damaged item removed');
    });

    it('rejects decrease when available stock is insufficient', async () => {
      const s = setup();
      s.manager.query
        .mockResolvedValueOnce([]) // lock
        .mockResolvedValueOnce([{ id: skuId }]) // ownership
        .mockResolvedValueOnce([]) // existing idempotency
        .mockResolvedValueOnce([[], 0]); // update returns empty tuple (insufficient stock in TypeORM)

      await expect(
        s.service.decrease(actorId, {
          skuId,
          quantity: 20,
          idempotencyKey: 'dec-2',
        }),
      ).rejects.toMatchObject({
        status: 409,
        response: { errorCode: 'INSUFFICIENT_STOCK' },
      });
    });

    it('returns existing response for idempotent decrease retry', async () => {
      const s = setup();
      const fingerprint = createHash('sha256')
        .update(`${skuId}:3:Damaged`)
        .digest('hex');
      s.manager.query
        .mockResolvedValueOnce([]) // lock
        .mockResolvedValueOnce([{ id: skuId }]) // ownership
        .mockResolvedValueOnce([
          {
            inventory_item_id: itemId,
            sku_id: skuId,
            warehouse_id: warehouseId,
            quantity_delta: -3,
            quantity_before: 10,
            total_quantity: 7,
            reserved_quantity: 1,
            unavailable_quantity: 0,
            available_quantity: 6,
            idempotency_key: 'dec-3',
            request_fingerprint: fingerprint,
            created_at: new Date('2026-11-24T00:00:00Z'),
            note: 'Damaged',
          },
        ]);

      const res = await s.service.decrease(actorId, {
        skuId,
        quantity: 3,
        idempotencyKey: 'dec-3',
        note: 'Damaged',
      });

      expect(res).toMatchObject({
        skuId,
        warehouseId,
        type: 'MANUAL_DECREASE',
        quantityDelta: -3,
        totalQuantity: 7,
        note: 'Damaged',
      });
      // Ensure no update was called
      expect(s.manager.query).toHaveBeenCalledTimes(3);
    });

    it('rejects reuse of idempotency key with different payload for decrease', async () => {
      const s = setup();
      s.manager.query
        .mockResolvedValueOnce([]) // lock
        .mockResolvedValueOnce([{ id: skuId }]) // ownership
        .mockResolvedValueOnce([
          {
            request_fingerprint: 'different_hash',
          },
        ]);

      await expect(
        s.service.decrease(actorId, {
          skuId,
          quantity: 5,
          idempotencyKey: 'dec-4',
        }),
      ).rejects.toMatchObject({
        status: 409,
        response: { errorCode: 'IDEMPOTENCY_KEY_REUSED' },
      });
    });

    it('rejects decrease on SKU not owned by seller', async () => {
      const s = setup();
      s.manager.query
        .mockResolvedValueOnce([]) // lock
        .mockResolvedValueOnce([]); // not owned

      await expect(
        s.service.decrease(actorId, {
          skuId,
          quantity: 1,
          idempotencyKey: 'dec-5',
        }),
      ).rejects.toMatchObject({
        status: 404,
        response: { errorCode: 'SELLER_SKU_NOT_FOUND' },
      });
    });
  });

  describe('history', () => {
    it('returns paginated stock history for seller with actorName fallback to System', async () => {
      const s = setup();
      s.dataSource.query
        .mockResolvedValueOnce([{ total: 1 }]) // count
        .mockResolvedValueOnce([
          {
            id: 'adj-1',
            skuId,
            skuCode: 'SKU-001',
            productName: 'T-Shirt',
            warehouseId,
            actorId: null,
            actorName: 'System',
            type: 'ORDER_DEDUCT',
            quantityDelta: -2,
            quantityBefore: 10,
            quantityAfter: 8,
            reservedAfter: 0,
            unavailableAfter: 0,
            availableAfter: 8,
            referenceType: 'ORDER',
            referenceId: 'order-1',
            note: 'Order payment stock deduction',
            idempotencyKey: 'deduct:order-1:sku-1',
            createdAt: new Date('2026-11-24T01:00:00Z'),
          },
        ]); // items

      const res = await s.service.history(actorId, { page: 1, limit: 10 });
      expect(res).toEqual({
        items: [
          {
            id: 'adj-1',
            skuId,
            skuCode: 'SKU-001',
            productName: 'T-Shirt',
            warehouseId,
            actorId: null,
            actorName: 'System',
            type: 'ORDER_DEDUCT',
            quantityDelta: -2,
            quantityBefore: 10,
            quantityAfter: 8,
            reservedAfter: 0,
            unavailableAfter: 0,
            availableAfter: 8,
            referenceType: 'ORDER',
            referenceId: 'order-1',
            note: 'Order payment stock deduction',
            idempotencyKey: 'deduct:order-1:sku-1',
            createdAt: new Date('2026-11-24T01:00:00Z'),
          },
        ],
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
      });

      const countSql = s.dataSource.query.mock.calls[0][0];
      expect(countSql).toContain('product.seller_id = $1::uuid');
      const dataSql = s.dataSource.query.mock.calls[1][0];
      expect(dataSql).toContain('LEFT JOIN identity.users');
      expect(dataSql).toContain("COALESCE(u.full_name, 'System')");
    });

    it('enforces ownership check when querying with a specific skuId for non-admin', async () => {
      const s = setup();
      s.dataSource.query
        .mockResolvedValueOnce([{ id: skuId }]) // ownership check passes
        .mockResolvedValueOnce([{ total: 0 }]) // count
        .mockResolvedValueOnce([]); // items

      await s.service.history(actorId, { page: 1, limit: 20, skuId });
      expect(s.dataSource.query.mock.calls[0][0]).toContain(
        'product.seller_id = $2::uuid',
      );
    });

    it('rejects history query for non-owned skuId', async () => {
      const s = setup();
      s.dataSource.query.mockResolvedValueOnce([]); // ownership check fails

      await expect(
        s.service.history(actorId, { page: 1, limit: 20, skuId }),
      ).rejects.toMatchObject({
        status: 404,
        response: { errorCode: 'SELLER_SKU_NOT_FOUND' },
      });
    });

    it('allows admin to query history without seller ownership restrictions', async () => {
      const s = setup();
      s.identity.getUserRoles.mockResolvedValue(['ADMIN']);
      s.dataSource.query
        .mockResolvedValueOnce([{ total: 5 }]) // count
        .mockResolvedValueOnce([]); // items

      await s.service.history(actorId, { page: 1, limit: 20 });
      const countSql = s.dataSource.query.mock.calls[0][0];
      expect(countSql).not.toContain('product.seller_id =');
    });

    it('includes soft-deleted products in history audit while maintaining seller isolation', async () => {
      const s = setup();
      s.dataSource.query
        .mockResolvedValueOnce([{ total: 3 }]) // count
        .mockResolvedValueOnce([]); // items

      await s.service.history(actorId, { page: 1, limit: 20 });
      const countSql = s.dataSource.query.mock.calls[0][0];
      expect(countSql).toContain('product.seller_id = $1::uuid');
      expect(countSql).not.toContain('product.deleted_at IS NULL');
    });
  });
});
