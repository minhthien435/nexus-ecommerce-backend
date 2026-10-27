import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductStatus } from '../domain/entities/product.entity.js';
import { SellerProductController } from './seller-product.controller.js';

describe('SellerProductController', () => {
  let controller: SellerProductController;
  let service: any;

  beforeEach(() => {
    service = {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      setStatus: vi.fn(),
      remove: vi.fn(),
    };
    controller = new SellerProductController(service);
  });

  it('always passes the token-derived actor to seller operations', async () => {
    const query = { page: 1, limit: 20 };
    await controller.list(query, 'seller-1');
    await controller.get('product-1', 'seller-1');
    await controller.setStatus(
      'product-1',
      { status: ProductStatus.ACTIVE },
      'seller-1',
    );
    expect(service.list).toHaveBeenCalledWith('seller-1', query);
    expect(service.get).toHaveBeenCalledWith('product-1', 'seller-1');
    expect(service.setStatus).toHaveBeenCalledWith(
      'product-1',
      ProductStatus.ACTIVE,
      'seller-1',
    );
  });

  it('uses soft-delete service flow', async () => {
    await controller.remove('product-1', 'seller-1');
    expect(service.remove).toHaveBeenCalledWith('product-1', 'seller-1');
  });
});
