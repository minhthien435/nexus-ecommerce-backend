import { DataSource, In } from 'typeorm';
import { InventoryItemEntity } from '../domain/entities/inventory-item.entity.js';
import { WarehouseEntity } from '../domain/entities/warehouse.entity.js';
import { InventoryReadService } from './inventory-read.service.js';

describe('InventoryReadService', () => {
  const skuId = '11111111-1111-4111-8111-111111111111';
  const otherSkuId = '22222222-2222-4222-8222-222222222222';
  const alphabeticSkuId = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
  function setup() {
    const warehouses = { find: vi.fn().mockResolvedValue([{ id: 'default' }]) };
    const inventory = {
      find: vi.fn().mockResolvedValue([{ skuId, availableQuantity: 4 }]),
    };
    return {
      warehouses,
      inventory,
      service: new InventoryReadService(
        warehouses as never,
        inventory as never,
      ),
    };
  }

  it('batches unique SKU IDs and restricts reads to the active default warehouse', async () => {
    const s = setup();
    await expect(
      s.service.getDefaultWarehouseStock([skuId, otherSkuId, skuId]),
    ).resolves.toEqual([
      { skuId, availableQuantity: 4 },
      { skuId: otherSkuId, availableQuantity: 0 },
    ]);
    expect(s.warehouses.find).toHaveBeenCalledExactlyOnceWith({
      select: { id: true },
      where: { isDefault: true, isActive: true },
    });
    expect(s.inventory.find).toHaveBeenCalledExactlyOnceWith({
      select: { skuId: true, availableQuantity: true },
      where: { warehouseId: 'default', skuId: In([skuId, otherSkuId]) },
    });
  });

  it.each([{ candidates: [] }, { candidates: [{ id: 'one' }, { id: 'two' }] }])(
    'rejects absent or ambiguous default warehouses before reading inventory: %j',
    async ({ candidates }) => {
      const s = setup();
      s.warehouses.find.mockResolvedValue(candidates);
      await expect(
        s.service.getDefaultWarehouseStock([skuId]),
      ).rejects.toMatchObject({
        status: 503,
        response: {
          errorCode: 'DEFAULT_WAREHOUSE_NOT_CONFIGURED',
          message: 'Expected exactly one active default warehouse',
        },
      });
      expect(s.inventory.find).not.toHaveBeenCalled();
    },
  );

  it.each([
    { ids: [alphabeticSkuId.toUpperCase()] },
    { ids: [alphabeticSkuId.toUpperCase(), alphabeticSkuId] },
  ])(
    'normalizes uppercase UUIDs before deduplication and lookup: %j',
    async ({ ids }) => {
      const s = setup();
      s.inventory.find.mockResolvedValue([
        { skuId: alphabeticSkuId, availableQuantity: 4 },
      ]);
      await expect(s.service.getDefaultWarehouseStock(ids)).resolves.toEqual([
        { skuId: alphabeticSkuId, availableQuantity: 4 },
      ]);
      expect(s.inventory.find).toHaveBeenCalledExactlyOnceWith({
        select: { skuId: true, availableQuantity: true },
        where: { warehouseId: 'default', skuId: In([alphabeticSkuId]) },
      });
    },
  );

  it('rejects null stock for an uppercase UUID request', async () => {
    const s = setup();
    s.inventory.find.mockResolvedValue([
      { skuId: alphabeticSkuId, availableQuantity: null },
    ] as never);
    await expect(
      s.service.getDefaultWarehouseStock([alphabeticSkuId.toUpperCase()]),
    ).rejects.toMatchObject({
      status: 503,
      response: {
        errorCode: 'INVALID_INVENTORY_DATA',
        message: 'Available stock cannot be determined',
      },
    });
  });

  it('returns empty stock without repository or manager calls', async () => {
    const s = setup();
    const manager = { getRepository: vi.fn() };
    expect(
      await s.service.getDefaultWarehouseStock([], manager as never),
    ).toEqual([]);
    expect(await s.service.getDefaultWarehouseStock([])).toEqual([]);
    expect(manager.getRepository).not.toHaveBeenCalled();
    expect(s.warehouses.find).not.toHaveBeenCalled();
    expect(s.inventory.find).not.toHaveBeenCalled();
  });

  it('uses both manager repositories exclusively and propagates each failure', async () => {
    const ordinary = setup();
    const contextual = setup();
    const manager = {
      getRepository: vi.fn((entity: unknown) => {
        if (entity === WarehouseEntity) return contextual.warehouses;
        if (entity === InventoryItemEntity) return contextual.inventory;
        throw new Error('Unexpected entity');
      }),
    };
    await expect(
      ordinary.service.getDefaultWarehouseStock([skuId], manager as never),
    ).resolves.toEqual([{ skuId, availableQuantity: 4 }]);
    expect(manager.getRepository.mock.calls).toEqual([
      [WarehouseEntity],
      [InventoryItemEntity],
    ]);
    contextual.warehouses.find.mockRejectedValueOnce(
      new Error('warehouse failure'),
    );
    await expect(
      ordinary.service.getDefaultWarehouseStock([skuId], manager as never),
    ).rejects.toThrow('warehouse failure');
    contextual.inventory.find.mockRejectedValueOnce(
      new Error('inventory failure'),
    );
    await expect(
      ordinary.service.getDefaultWarehouseStock([skuId], manager as never),
    ).rejects.toThrow('inventory failure');
    expect(ordinary.warehouses.find).not.toHaveBeenCalled();
    expect(ordinary.inventory.find).not.toHaveBeenCalled();
  });

  it('clamps negative quantities to zero', async () => {
    const s = setup();
    s.inventory.find.mockResolvedValue([{ skuId, availableQuantity: -1 }]);
    expect(await s.service.getDefaultWarehouseStock([skuId])).toEqual([
      { skuId, availableQuantity: 0 },
    ]);
  });

  it.each([null, 1.5, '4', undefined])(
    'rejects invalid quantity %j on an existing row',
    async (quantity) => {
      const s = setup();
      s.inventory.find.mockResolvedValue([
        { skuId, availableQuantity: quantity },
      ] as never);
      await expect(
        s.service.getDefaultWarehouseStock([skuId]),
      ).rejects.toMatchObject({
        status: 503,
        response: {
          errorCode: 'INVALID_INVENTORY_DATA',
          message: 'Available stock cannot be determined',
        },
      });
    },
  );

  it('maps read entities and protects the nullable calculated column from writes', async () => {
    const source = new DataSource({
      type: 'postgres',
      entities: [WarehouseEntity, InventoryItemEntity],
      synchronize: false,
    });
    // Initialize actual TypeORM metadata without connecting or changing the database.
    await (
      source as unknown as { buildMetadatas(): Promise<void> }
    ).buildMetadatas();
    expect(source.getMetadata(WarehouseEntity).tablePath).toBe(
      'fulfillment.warehouses',
    );
    const metadata = source.getMetadata(InventoryItemEntity);
    expect(metadata.tablePath).toBe('fulfillment.inventory_items');
    expect(
      metadata.findColumnWithPropertyName('availableQuantity'),
    ).toMatchObject({
      databaseName: 'available_qty',
      type: 'int',
      isNullable: true,
      isInsert: false,
      isUpdate: false,
    });
  });
});
