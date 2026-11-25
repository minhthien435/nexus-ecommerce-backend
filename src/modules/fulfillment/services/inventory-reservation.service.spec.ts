import { WarehouseEntity } from '../domain/entities/warehouse.entity.js';
import { InventoryReservationService } from './inventory-reservation.service.js';

describe('InventoryReservationService', () => {
  const firstSku = '11111111-1111-4111-8111-111111111111';
  const secondSku = '22222222-2222-4222-8222-222222222222';
  const firstWarehouse = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const secondWarehouse = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  function setup(rows: { sku_id: string }[] = []) {
    const warehouses = {
      find: vi.fn().mockResolvedValue([{ id: firstWarehouse }]),
    };
    const manager = {
      getRepository: vi.fn().mockReturnValue(warehouses),
      query: vi.fn().mockResolvedValue(rows),
    };
    return { service: new InventoryReservationService(), warehouses, manager };
  }

  it.each([[[]], [[{ id: 'one' }, { id: 'two' }]]] as const)(
    'rejects an absent or ambiguous default warehouse without updating: %j',
    async (candidates) => {
      const s = setup();
      s.warehouses.find.mockResolvedValue(candidates);
      await expect(
        s.service.reserve(
          [{ skuId: firstSku, quantity: 1 }],
          s.manager as never,
        ),
      ).rejects.toMatchObject({
        status: 503,
        response: { errorCode: 'DEFAULT_WAREHOUSE_NOT_CONFIGURED' },
      });
      expect(s.manager.query).not.toHaveBeenCalled();
    },
  );

  it('aggregates duplicate SKUs, normalizes IDs, and updates in stable SKU order', async () => {
    const s = setup([{ sku_id: firstSku }, { sku_id: secondSku }]);
    const receipts = await s.service.reserve(
      [
        { skuId: secondSku, quantity: 1 },
        { skuId: firstSku.toUpperCase(), quantity: 2 },
        { skuId: firstSku, quantity: 3 },
      ],
      s.manager as never,
    );
    expect(s.manager.getRepository).toHaveBeenCalledWith(WarehouseEntity);
    expect(s.manager.query).toHaveBeenCalledOnce();
    expect(s.manager.query.mock.calls[0][1]).toEqual([
      firstWarehouse,
      firstSku,
      5,
      secondSku,
      1,
    ]);
    const sql = s.manager.query.mock.calls[0][0] as string;
    const updateStart = sql.indexOf('UPDATE fulfillment.inventory_items');
    expect(updateStart).toBeGreaterThan(-1);
    expect(sql.slice(updateStart)).toContain(
      'inventory.available_qty >= requested.quantity',
    );
    expect(sql.slice(updateStart)).toContain(
      'reserved_qty = inventory.reserved_qty + requested.quantity',
    );
    expect(sql).toContain(
      'ORDER BY inventory.sku_id\n  FOR UPDATE OF inventory',
    );
    expect(sql).toContain('JOIN locked ON locked.sku_id = requested.sku_id');
    expect(receipts).toEqual([
      { skuId: firstSku, quantity: 5, warehouseId: firstWarehouse },
      { skuId: secondSku, quantity: 1, warehouseId: firstWarehouse },
    ]);
  });

  it('reports insufficient stock when the guarded atomic update misses any SKU', async () => {
    const s = setup([{ sku_id: firstSku }]);
    await expect(
      s.service.reserve(
        [
          { skuId: firstSku, quantity: 2 },
          { skuId: secondSku, quantity: 1 },
        ],
        s.manager as never,
      ),
    ).rejects.toMatchObject({
      status: 409,
      response: { errorCode: 'INSUFFICIENT_STOCK' },
    });
  });

  it('aggregates by warehouse and atomically releases each reserved row', async () => {
    const s = setup([{ sku_id: firstSku }, { sku_id: secondSku }]);
    await s.service.release(
      [
        { warehouseId: secondWarehouse, skuId: secondSku, quantity: 4 },
        { warehouseId: firstWarehouse, skuId: firstSku, quantity: 1 },
        { warehouseId: secondWarehouse, skuId: secondSku, quantity: 2 },
      ],
      s.manager as never,
    );
    expect(s.manager.query.mock.calls[0][1]).toEqual([
      firstWarehouse,
      firstSku,
      1,
      secondWarehouse,
      secondSku,
      6,
    ]);
    expect(s.manager.query.mock.calls[0][0]).toContain(
      'reserved_qty = inventory.reserved_qty - requested.quantity',
    );
    expect(s.manager.query.mock.calls[0][0]).toContain(
      'inventory.reserved_qty >= requested.quantity',
    );
    expect(s.manager.getRepository).not.toHaveBeenCalled();
  });

  it('releases to the warehouse captured at reserve even if the default changes', async () => {
    const s = setup([{ sku_id: firstSku }]);
    const receipts = await s.service.reserve(
      [{ skuId: firstSku, quantity: 2 }],
      s.manager as never,
    );
    s.warehouses.find.mockResolvedValue([{ id: secondWarehouse }]);
    s.manager.query.mockResolvedValue([{ sku_id: firstSku }]);

    await s.service.release(receipts, s.manager as never);

    expect(s.manager.query.mock.calls[1][1]).toEqual([
      firstWarehouse,
      firstSku,
      2,
    ]);
    expect(s.warehouses.find).toHaveBeenCalledOnce();
  });

  it('writes an immutable cancellation ledger entry in the same transaction', async () => {
    const s = setup([
      {
        inventory_item_id: '55555555-5555-4555-8555-555555555555',
        warehouse_id: firstWarehouse,
        sku_id: firstSku,
        quantity: 2,
        total_qty: 10,
        reserved_qty: 1,
        unavailable_qty: 0,
        available_qty: 9,
      } as never,
    ]);
    await s.service.release(
      [{ warehouseId: firstWarehouse, skuId: firstSku, quantity: 2 }],
      s.manager as never,
    );
    expect(s.manager.query).toHaveBeenCalledTimes(1);
    expect(s.manager.query.mock.calls[0][0]).toContain(
      'UPDATE fulfillment.inventory_items',
    );
    expect(s.manager.query.mock.calls[0][0]).toContain(
      'reserved_qty = inventory.reserved_qty - requested.quantity',
    );
  });

  it('rejects a missing release row', async () => {
    const s = setup([]);
    await expect(
      s.service.release(
        [{ warehouseId: firstWarehouse, skuId: firstSku, quantity: 1 }],
        s.manager as never,
      ),
    ).rejects.toMatchObject({
      status: 503,
      response: { errorCode: 'INVALID_INVENTORY_DATA' },
    });
  });

  it('rejects an invalid warehouse receipt before touching inventory', async () => {
    const s = setup();
    await expect(
      s.service.release(
        [{ warehouseId: 'not-a-uuid', skuId: firstSku, quantity: 1 }],
        s.manager as never,
      ),
    ).rejects.toMatchObject({
      status: 400,
      response: { errorCode: 'INVALID_INVENTORY_RESERVATION' },
    });
    expect(s.manager.getRepository).not.toHaveBeenCalled();
    expect(s.manager.query).not.toHaveBeenCalled();
  });

  it.each([
    [[{ skuId: 'not-a-uuid', quantity: 1 }]],
    [[{ skuId: firstSku, quantity: 0 }]],
    [[{ skuId: firstSku, quantity: 1.5 }]],
    [[{ skuId: firstSku, quantity: 2_147_483_648 }]],
    [
      [
        { skuId: firstSku, quantity: 2_147_483_647 },
        { skuId: firstSku, quantity: 1 },
      ],
    ],
  ])('rejects invalid reservation input: %j', async (items) => {
    const s = setup();
    await expect(
      s.service.reserve(items, s.manager as never),
    ).rejects.toMatchObject({
      status: 400,
      response: { errorCode: 'INVALID_INVENTORY_RESERVATION' },
    });
    expect(s.manager.getRepository).not.toHaveBeenCalled();
  });

  it('does nothing for an empty list', async () => {
    const s = setup();
    await expect(s.service.reserve([], s.manager as never)).resolves.toEqual(
      [],
    );
    await expect(
      s.service.release([], s.manager as never),
    ).resolves.toBeUndefined();
    await expect(
      s.service.deduct([], s.manager as never, { orderId: 'ord-1' }),
    ).resolves.toBeUndefined();
    expect(s.manager.getRepository).not.toHaveBeenCalled();
    expect(s.manager.query).not.toHaveBeenCalled();
  });

  describe('deduct', () => {
    it('deducts total and reserved quantity and records ORDER_DEDUCT adjustment for system actor', async () => {
      const s = setup();
      s.manager.query
        .mockResolvedValueOnce([]) // advisory lock
        .mockResolvedValueOnce([]) // pre-check SELECT id (not existing)
        .mockResolvedValueOnce([
          {
            inventory_item_id: 'inv-item-1',
            warehouse_id: firstWarehouse,
            sku_id: firstSku,
            quantity_before: 10,
            quantity_after: 8,
            reserved_after: 0,
            unavailable_after: 0,
            available_after: 8,
          },
        ]) // update
        .mockResolvedValueOnce([]); // insert ledger

      await s.service.deduct(
        [{ warehouseId: firstWarehouse, skuId: firstSku, quantity: 2 }],
        s.manager as never,
        {
          orderId: '55555555-5555-4555-8555-555555555555',
          actorId: null,
          note: 'Paid order deduction',
        },
      );

      expect(s.manager.query).toHaveBeenCalledTimes(4);
      expect(s.manager.query.mock.calls[0][0]).toContain(
        'pg_advisory_xact_lock',
      );
      expect(s.manager.query.mock.calls[1][0]).toContain(
        'WHERE idempotency_key = $1',
      );

      const updateCall = s.manager.query.mock.calls[2];
      expect(updateCall[0]).toContain(
        'total_qty = inventory.total_qty - $3::int',
      );
      expect(updateCall[0]).toContain(
        'reserved_qty = GREATEST(0, inventory.reserved_qty - $3::int)',
      );
      expect(updateCall[1]).toEqual([firstWarehouse, firstSku, 2]);

      const insertCall = s.manager.query.mock.calls[3];
      expect(insertCall[0]).toContain("'ORDER_DEDUCT'");
      expect(insertCall[1][3]).toBeNull(); // actor_id is null
      expect(insertCall[1][4]).toBe(-2); // delta is negative
      expect(insertCall[1][12]).toBe('55555555-5555-4555-8555-555555555555');
      expect(insertCall[1][13]).toBe('Paid order deduction');
    });

    it('supports seller-initiated events (actor_id IS NOT NULL) in deduct', async () => {
      const s = setup();
      const sellerId = '44444444-4444-4444-8444-444444444444';
      s.manager.query
        .mockResolvedValueOnce([]) // advisory lock
        .mockResolvedValueOnce([]) // pre-check SELECT id (not existing)
        .mockResolvedValueOnce([
          {
            inventory_item_id: 'inv-item-1',
            warehouse_id: firstWarehouse,
            sku_id: firstSku,
            quantity_before: 10,
            quantity_after: 8,
            reserved_after: 0,
            unavailable_after: 0,
            available_after: 8,
          },
        ]) // update
        .mockResolvedValueOnce([]); // insert ledger

      await s.service.deduct(
        [{ warehouseId: firstWarehouse, skuId: firstSku, quantity: 2 }],
        s.manager as never,
        {
          orderId: '55555555-5555-4555-8555-555555555555',
          actorId: sellerId,
          note: 'COD order shipment deduction',
        },
      );

      expect(s.manager.query).toHaveBeenCalledTimes(4);
      const insertCall = s.manager.query.mock.calls[3];
      expect(insertCall[1][3]).toBe(sellerId); // actor_id is sellerId
      expect(insertCall[1][4]).toBe(-2);
    });

    it('safely skips deduction if idempotency_key was already processed (duplicate deduct)', async () => {
      const s = setup();
      s.manager.query
        .mockResolvedValueOnce([]) // advisory lock
        .mockResolvedValueOnce([{ id: 'existing-ledger-id' }]); // pre-check finds existing

      await s.service.deduct(
        [{ warehouseId: firstWarehouse, skuId: firstSku, quantity: 2 }],
        s.manager as never,
        {
          orderId: '55555555-5555-4555-8555-555555555555',
          actorId: null,
        },
      );

      // Lock and pre-check called, but UPDATE and INSERT are skipped
      expect(s.manager.query).toHaveBeenCalledTimes(2);
      expect(s.manager.query.mock.calls[0][0]).toContain(
        'pg_advisory_xact_lock',
      );
      expect(s.manager.query.mock.calls[1][0]).toContain(
        'WHERE idempotency_key = $1',
      );
    });

    it('rejects deduction when total quantity is insufficient', async () => {
      const s = setup();
      s.manager.query
        .mockResolvedValueOnce([]) // advisory lock
        .mockResolvedValueOnce([]) // pre-check
        .mockResolvedValueOnce([]); // update returns 0 rows

      await expect(
        s.service.deduct(
          [{ warehouseId: firstWarehouse, skuId: firstSku, quantity: 10 }],
          s.manager as never,
          { orderId: '55555555-5555-4555-8555-555555555555' },
        ),
      ).rejects.toMatchObject({
        status: 409,
        response: { errorCode: 'INSUFFICIENT_STOCK' },
      });
    });
  });

  describe('restoreStock', () => {
    it('restores total quantity and records ORDER_CANCELLATION_RELEASE ledger entry', async () => {
      const s = setup();
      s.manager.query
        .mockResolvedValueOnce([]) // advisory lock
        .mockResolvedValueOnce([]) // pre-check
        .mockResolvedValueOnce([
          {
            inventory_item_id: 'inv-item-1',
            warehouse_id: firstWarehouse,
            sku_id: firstSku,
            quantity_before: 8,
            quantity_after: 10,
            reserved_after: 0,
            unavailable_after: 0,
            available_after: 10,
          },
        ]) // update total_qty
        .mockResolvedValueOnce([]); // insert ledger

      await s.service.restoreStock(
        [{ warehouseId: firstWarehouse, skuId: firstSku, quantity: 2 }],
        s.manager as never,
        {
          orderId: '66666666-6666-4666-8666-666666666666',
          actorId: '77777777-7777-4777-8777-777777777777',
          note: 'Cancelled paid order',
        },
      );

      expect(s.manager.query).toHaveBeenCalledTimes(4);
      expect(s.manager.query.mock.calls[0][0]).toContain(
        'pg_advisory_xact_lock',
      );
      expect(s.manager.query.mock.calls[1][0]).toContain(
        'WHERE idempotency_key = $1',
      );

      const updateCall = s.manager.query.mock.calls[2];
      expect(updateCall[0]).toContain(
        'total_qty = inventory.total_qty + $3::int',
      );
      expect(updateCall[1]).toEqual([firstWarehouse, firstSku, 2]);

      const insertCall = s.manager.query.mock.calls[3];
      expect(insertCall[0]).toContain("'ORDER_CANCELLATION_RELEASE'");
      expect(insertCall[1][4]).toBe(2); // positive quantity delta
      expect(insertCall[1][5]).toBe(8); // before
      expect(insertCall[1][6]).toBe(10); // after
      expect(insertCall[1][12]).toBe('66666666-6666-4666-8666-666666666666');
    });

    it('skips restoreStock without changing stock if idempotency_key was already processed (duplicate/retry)', async () => {
      const s = setup();
      s.manager.query
        .mockResolvedValueOnce([]) // advisory lock
        .mockResolvedValueOnce([{ id: 'existing-restore-ledger-id' }]); // pre-check finds existing

      await s.service.restoreStock(
        [{ warehouseId: firstWarehouse, skuId: firstSku, quantity: 2 }],
        s.manager as never,
        {
          orderId: '66666666-6666-4666-8666-666666666666',
          actorId: null,
        },
      );

      // Lock and pre-check called, but UPDATE and INSERT are skipped
      expect(s.manager.query).toHaveBeenCalledTimes(2);
      expect(s.manager.query.mock.calls[0][0]).toContain(
        'pg_advisory_xact_lock',
      );
      expect(s.manager.query.mock.calls[1][0]).toContain(
        'WHERE idempotency_key = $1',
      );
    });

    it('rejects restoreStock when total quantity would overflow integer max', async () => {
      const s = setup();
      s.manager.query
        .mockResolvedValueOnce([]) // advisory lock
        .mockResolvedValueOnce([]) // pre-check
        .mockResolvedValueOnce([]); // update returns 0 rows

      await expect(
        s.service.restoreStock(
          [{ warehouseId: firstWarehouse, skuId: firstSku, quantity: 10 }],
          s.manager as never,
          { orderId: '66666666-6666-4666-8666-666666666666' },
        ),
      ).rejects.toMatchObject({
        status: 409,
        response: { errorCode: 'INVENTORY_QUANTITY_OVERFLOW' },
      });
    });

    it('propagates database error when ledger insert fails (rolling back update)', async () => {
      const s = setup();
      s.manager.query
        .mockResolvedValueOnce([]) // advisory lock
        .mockResolvedValueOnce([]) // pre-check
        .mockResolvedValueOnce([
          {
            inventory_item_id: 'inv-item-1',
            warehouse_id: firstWarehouse,
            sku_id: firstSku,
            quantity_before: 8,
            quantity_after: 10,
            reserved_after: 0,
            unavailable_after: 0,
            available_after: 10,
          },
        ]) // update
        .mockRejectedValueOnce(
          new Error(
            'Unique constraint violation: UQ_seller_inventory_adjustments_system_idempotency',
          ),
        ); // ledger insert fails

      await expect(
        s.service.restoreStock(
          [{ warehouseId: firstWarehouse, skuId: firstSku, quantity: 2 }],
          s.manager as never,
          { orderId: '66666666-6666-4666-8666-666666666666' },
        ),
      ).rejects.toThrow('Unique constraint violation');
    });

    it('aggregates duplicate items and processes in sorted (warehouseId, skuId) order', async () => {
      const s = setup();
      const skuA = '11111111-1111-4111-8111-111111111111';
      const skuB = '22222222-2222-4222-8222-222222222222';

      s.manager.query
        .mockResolvedValueOnce([]) // lock A
        .mockResolvedValueOnce([]) // precheck A
        .mockResolvedValueOnce([
          {
            inventory_item_id: 'inv-item-a',
            warehouse_id: firstWarehouse,
            sku_id: skuA,
            quantity_before: 5,
            quantity_after: 8,
            reserved_after: 0,
            unavailable_after: 0,
            available_after: 8,
          },
        ]) // update A (quantity = 2 + 1 = 3)
        .mockResolvedValueOnce([]) // insert ledger A
        .mockResolvedValueOnce([]) // lock B
        .mockResolvedValueOnce([]) // precheck B
        .mockResolvedValueOnce([
          {
            inventory_item_id: 'inv-item-b',
            warehouse_id: firstWarehouse,
            sku_id: skuB,
            quantity_before: 10,
            quantity_after: 15,
            reserved_after: 0,
            unavailable_after: 0,
            available_after: 15,
          },
        ]) // update B (quantity = 5)
        .mockResolvedValueOnce([]); // insert ledger B

      // Input has skuB first, and skuA split into two items (2 and 1)
      await s.service.restoreStock(
        [
          { warehouseId: firstWarehouse, skuId: skuB, quantity: 5 },
          { warehouseId: firstWarehouse, skuId: skuA, quantity: 2 },
          { warehouseId: firstWarehouse, skuId: skuA, quantity: 1 },
        ],
        s.manager as never,
        { orderId: '66666666-6666-4666-8666-666666666666' },
      );

      // Total 2 aggregated items processed in sorted order: skuA (qty 3), then skuB (qty 5)
      expect(s.manager.query).toHaveBeenCalledTimes(8);
      const updateA = s.manager.query.mock.calls[2];
      expect(updateA[1]).toEqual([firstWarehouse, skuA, 3]);

      const updateB = s.manager.query.mock.calls[6];
      expect(updateB[1]).toEqual([firstWarehouse, skuB, 5]);
    });
  });
});
