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
});
