import { InventoryReadService } from './inventory-read.service.js';

describe('InventoryReadService', () => {
  const skuId = '11111111-1111-4111-8111-111111111111';
  function setup(rows: unknown[]) {
    const source = { query: vi.fn().mockResolvedValue(rows) };
    return { source, service: new InventoryReadService(source as never) };
  }

  it('reads only the active default warehouse and parameterizes SKU IDs', async () => {
    const s = setup([{ warehouseId: 'default', skuId, availableQuantity: 4 }]);
    await expect(
      s.service.getDefaultWarehouseStock([skuId, skuId]),
    ).resolves.toEqual([{ skuId, availableQuantity: 4 }]);
    expect(s.source.query).toHaveBeenCalledWith(
      expect.stringContaining(
        'warehouse.is_default = true AND warehouse.is_active = true',
      ),
      [[skuId]],
    );
    expect(s.source.query.mock.calls[0][0]).toContain(
      'inventory.warehouse_id = warehouse.id',
    );
    expect(s.source.query.mock.calls[0][0]).not.toMatch(
      /SUM\(|LIMIT 1|UPDATE|INSERT/i,
    );
  });

  it.each([
    [],
    [
      { warehouseId: 'one', skuId, availableQuantity: 2 },
      { warehouseId: 'two', skuId, availableQuantity: 3 },
    ],
  ])('rejects absent or ambiguous default warehouse', async (...args) => {
    const rows = args.length === 0 ? [] : args;
    const s = setup(rows);
    await expect(
      s.service.getDefaultWarehouseStock([skuId]),
    ).rejects.toMatchObject({
      status: 503,
      response: expect.objectContaining({
        errorCode: 'DEFAULT_WAREHOUSE_NOT_CONFIGURED',
      }),
    });
  });

  it('does not query warehouses for an empty request', async () => {
    const s = setup([]);
    expect(await s.service.getDefaultWarehouseStock([])).toEqual([]);
    expect(s.source.query).not.toHaveBeenCalled();
  });
  it('routes supplied context exclusively to its manager and propagates failure', async () => {
    const service = new InventoryReadService({
      query: () => {
        throw new Error('default DataSource reached');
      },
    } as never);
    const manager = {
      query: vi
        .fn()
        .mockResolvedValue([
          { warehouseId: 'default', skuId, availableQuantity: 5 },
        ]),
    };
    expect(
      await service.getDefaultWarehouseStock([skuId], manager as never),
    ).toEqual([{ skuId, availableQuantity: 5 }]);
    manager.query.mockRejectedValue(new Error('context failure'));
    await expect(
      service.getDefaultWarehouseStock([skuId], manager as never),
    ).rejects.toThrow('context failure');
  });

  it('reports negative stock as unavailable and rejects unknown stock', async () => {
    const s = setup([{ warehouseId: 'default', skuId, availableQuantity: -1 }]);
    expect(await s.service.getDefaultWarehouseStock([skuId])).toEqual([
      { skuId, availableQuantity: 0 },
    ]);
    s.source.query.mockResolvedValue([
      { warehouseId: 'default', skuId, availableQuantity: null },
    ]);
    await expect(
      s.service.getDefaultWarehouseStock([skuId]),
    ).rejects.toMatchObject({ status: 503 });
  });
});
