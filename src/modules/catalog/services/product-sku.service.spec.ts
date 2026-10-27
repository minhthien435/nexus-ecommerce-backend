import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductSkuService } from './product-sku.service.js';

describe('ProductSkuService', () => {
  let service: ProductSkuService;
  let skuRepo: any;
  let productRepo: any;
  let identityApi: any;
  let inventory: any;
  let config: any;

  const product = {
    id: 'product-1',
    sellerId: 'seller-1',
    slug: 'dien-thoai-pro',
    deletedAt: null,
  };
  const createDto = {
    attributes: { color: ' Black ', storage: ' 256 GB ' },
    price: 1200000,
    weightGrams: 400,
    lengthCm: 20,
    widthCm: 10,
    heightCm: 5,
  };

  beforeEach(() => {
    skuRepo = {
      findOne: vi.fn(),
      find: vi.fn(),
      create: vi.fn((value) => ({ id: 'sku-1', ...value })),
      save: vi.fn(async (value) => value),
    };
    productRepo = { findOne: vi.fn().mockResolvedValue(product) };
    identityApi = {
      getUserRoles: vi.fn().mockResolvedValue(['SELLER']),
    };
    inventory = { getAvailableQuantity: vi.fn() };
    config = { get: vi.fn().mockReturnValue('false') };
    service = new ProductSkuService(
      skuRepo,
      productRepo,
      identityApi,
      inventory,
      config,
    );
  });

  it('normalizes attributes independent of request key order', () => {
    expect(
      service.normalizeAttributes({ Size: ' L ', color: ' Black ' }),
    ).toEqual({ color: 'Black', size: 'L' });
    expect(
      service.generateSkuCode('ao-so-mi', {
        material: 'Cotton',
        color: 'Trắng',
        size: 'L',
        storage: '256 GB',
      }),
    ).toBe('AO-SO-MI-256-GB-L-TRANG-COTTON');
  });

  it('creates a SKU with canonical attributes and active default', async () => {
    skuRepo.findOne.mockResolvedValue(null);

    const result = await service.create('product-1', createDto, 'seller-1');

    expect(result).toMatchObject({
      skuCode: 'DIEN-THOAI-PRO-256-GB-BLACK',
      attributes: { color: 'Black', storage: '256 GB' },
      currency: 'VND',
      isActive: true,
    });
  });

  it('uses an increasing suffix when normalized SKU text collides', async () => {
    skuRepo.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'other-1' })
      .mockResolvedValueOnce({ id: 'other-2' })
      .mockResolvedValueOnce(null);

    const result = await service.create('product-1', createDto, 'seller-1');

    expect(result.skuCode).toBe('DIEN-THOAI-PRO-256-GB-BLACK-3');
  });

  it('rejects canonical attributes already used by the product', async () => {
    skuRepo.findOne.mockResolvedValue({ id: 'existing' });

    await expect(
      service.create('product-1', createDto, 'seller-1'),
    ).rejects.toThrow(ConflictException);
    expect(skuRepo.save).not.toHaveBeenCalled();
  });

  it('maps a database unique race to conflict', async () => {
    skuRepo.findOne.mockResolvedValue(null);
    skuRepo.save.mockRejectedValue({ driverError: { code: '23505' } });

    await expect(
      service.create('product-1', createDto, 'seller-1'),
    ).rejects.toThrow(ConflictException);
  });

  it('allows an admin to manage another seller product', async () => {
    identityApi.getUserRoles.mockResolvedValue(['ADMIN']);
    skuRepo.findOne.mockResolvedValue(null);

    await expect(
      service.create('product-1', createDto, 'admin-1'),
    ).resolves.toBeDefined();
  });

  it('forbids a seller from managing another seller product', async () => {
    await expect(
      service.create('product-1', createDto, 'seller-2'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('does not change the SKU code while updating attributes', async () => {
    skuRepo.findOne
      .mockResolvedValueOnce({
        id: 'sku-1',
        productId: 'product-1',
        skuCode: 'STABLE-CODE',
        attributes: { color: 'Black' },
      })
      .mockResolvedValueOnce(null);

    const result = await service.update(
      'sku-1',
      { attributes: { color: 'White' } },
      'seller-1',
    );

    expect(result.skuCode).toBe('STABLE-CODE');
    expect(result.attributes).toEqual({ color: 'White' });
  });

  it('deactivates instead of deleting the SKU', async () => {
    skuRepo.findOne.mockResolvedValue({
      id: 'sku-1',
      productId: 'product-1',
      isActive: true,
    });

    const result = await service.deactivate('sku-1', 'seller-1');

    expect(result.isActive).toBe(false);
    expect(skuRepo.save).toHaveBeenCalled();
    expect(skuRepo.delete).toBeUndefined();
  });

  it('allows clearing original price and validates it against resulting price', async () => {
    skuRepo.findOne.mockResolvedValue({
      id: 'sku-1',
      productId: 'product-1',
      price: 100,
      originalPrice: 150,
    });
    await expect(
      service.update('sku-1', { originalPrice: null }, 'seller-1'),
    ).resolves.toMatchObject({ originalPrice: null });
    skuRepo.findOne.mockResolvedValue({
      id: 'sku-1',
      productId: 'product-1',
      price: 100,
      originalPrice: null,
    });
    await expect(
      service.update('sku-1', { originalPrice: 90 }, 'seller-1'),
    ).rejects.toThrow('Giá gốc');
  });

  it('rejects a non-positive or fractional stock quantity', async () => {
    await expect(service.checkAvailableStock('sku-1', 0)).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.checkAvailableStock('sku-1', 1.5)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('returns false for inactive or missing SKU', async () => {
    skuRepo.findOne.mockResolvedValue(null);
    await expect(service.checkAvailableStock('sku-1', 1)).resolves.toBe(false);
    expect(skuRepo.findOne).toHaveBeenCalledWith({
      where: { id: 'sku-1', isActive: true },
    });
    expect(inventory.getAvailableQuantity).not.toHaveBeenCalled();
  });

  it('compares available quantity through the inventory port', async () => {
    skuRepo.findOne.mockResolvedValue({ id: 'sku-1', isActive: true });
    inventory.getAvailableQuantity.mockResolvedValue(5);

    await expect(service.checkAvailableStock('sku-1', 5)).resolves.toBe(true);
    await expect(service.checkAvailableStock('sku-1', 6)).resolves.toBe(false);
  });

  it('fails closed when inventory is unavailable or throws', async () => {
    skuRepo.findOne.mockResolvedValue({ id: 'sku-1', isActive: true });
    inventory.getAvailableQuantity.mockResolvedValueOnce(null);
    await expect(service.checkAvailableStock('sku-1', 1)).resolves.toBe(false);

    inventory.getAvailableQuantity.mockRejectedValueOnce(new Error('offline'));
    await expect(service.checkAvailableStock('sku-1', 1)).resolves.toBe(false);
  });
});
