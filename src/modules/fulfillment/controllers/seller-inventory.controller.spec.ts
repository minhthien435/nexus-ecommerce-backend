import { describe, expect, it, vi } from 'vitest';
import { SellerInventoryController } from './seller-inventory.controller.js';
import type { SellerInventoryService } from '../services/seller-inventory.service.js';
import { InventoryLedgerType } from '../domain/entities/inventory-ledger.entity.js';

describe('SellerInventoryController', () => {
  const actorId = '11111111-1111-4111-8111-111111111111';
  const skuId = '22222222-2222-4222-8222-222222222222';

  const inventoryService = {
    list: vi.fn(),
    summary: vi.fn(),
    restock: vi.fn(),
    decrease: vi.fn(),
    history: vi.fn(),
  };

  const controller = new SellerInventoryController(
    inventoryService as unknown as SellerInventoryService,
  );

  it('delegates list to inventory service', async () => {
    inventoryService.list.mockResolvedValueOnce({ items: [], total: 0 });
    const query = { page: 1, limit: 20, search: 'test' };
    await expect(controller.list(query, actorId)).resolves.toEqual({
      items: [],
      total: 0,
    });
    expect(inventoryService.list).toHaveBeenCalledWith(actorId, query);
  });

  it('delegates summary to inventory service', async () => {
    inventoryService.summary.mockResolvedValueOnce({ totalSkus: 5 });
    await expect(controller.summary(actorId)).resolves.toEqual({
      totalSkus: 5,
    });
    expect(inventoryService.summary).toHaveBeenCalledWith(actorId);
  });

  it('delegates restock to inventory service', async () => {
    const dto = { skuId, quantity: 5, idempotencyKey: 'k-1', note: 'Restock' };
    inventoryService.restock.mockResolvedValueOnce({ skuId, quantityDelta: 5 });
    await expect(controller.restock(dto, actorId)).resolves.toEqual({
      skuId,
      quantityDelta: 5,
    });
    expect(inventoryService.restock).toHaveBeenCalledWith(actorId, dto);
  });

  it('delegates decrease to inventory service', async () => {
    const dto = {
      skuId,
      quantity: 2,
      idempotencyKey: 'k-2',
      note: 'Damaged item',
    };
    inventoryService.decrease.mockResolvedValueOnce({
      skuId,
      quantityDelta: -2,
    });
    await expect(controller.decrease(dto, actorId)).resolves.toEqual({
      skuId,
      quantityDelta: -2,
    });
    expect(inventoryService.decrease).toHaveBeenCalledWith(actorId, dto);
  });

  it('delegates history to inventory service', async () => {
    const query = {
      skuId,
      type: InventoryLedgerType.MANUAL_DECREASE,
      page: 1,
      limit: 10,
    };
    inventoryService.history.mockResolvedValueOnce({ items: [], total: 0 });
    await expect(controller.history(query, actorId)).resolves.toEqual({
      items: [],
      total: 0,
    });
    expect(inventoryService.history).toHaveBeenCalledWith(actorId, query);
  });
});
