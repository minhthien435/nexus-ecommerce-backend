import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductSkuController } from './product-sku.controller.js';

describe('ProductSkuController', () => {
  let controller: ProductSkuController;
  let service: any;

  beforeEach(() => {
    service = {
      create: vi.fn(),
      listByProduct: vi.fn(),
      getById: vi.fn(),
      update: vi.fn(),
      deactivate: vi.fn(),
    };
    controller = new ProductSkuController(service);
  });

  it('passes the product, payload and actor when creating', async () => {
    const dto = {
      attributes: { color: 'Black' },
      price: 1,
      weightGrams: 1,
      lengthCm: 1,
      widthCm: 1,
      heightCm: 1,
    };
    service.create.mockResolvedValue({ id: 'sku-1' });

    await controller.create('product-1', dto, 'seller-1');

    expect(service.create).toHaveBeenCalledWith('product-1', dto, 'seller-1');
  });

  it('uses the service deactivation flow for DELETE', async () => {
    service.deactivate.mockResolvedValue({ id: 'sku-1', isActive: false });

    const result = await controller.deactivate('sku-1', 'seller-1');

    expect(result.isActive).toBe(false);
    expect(service.deactivate).toHaveBeenCalledWith('sku-1', 'seller-1');
  });
});
