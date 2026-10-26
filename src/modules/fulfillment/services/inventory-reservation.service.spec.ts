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
    expect(s.manager.getRepository).not.toHaveBeenCalled();
    expect(s.manager.query).not.toHaveBeenCalled();
  });
});
