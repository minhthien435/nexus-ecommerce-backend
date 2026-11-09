import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ProductEntity,
  ProductStatus,
} from '../domain/entities/product.entity.js';
import { SellerProductService } from './seller-product.service.js';

describe('SellerProductService', () => {
  let service: SellerProductService;
  let manager: any;
  let dataSource: any;
  let identity: any;
  let cache: any;

  beforeEach(() => {
    manager = {
      findOne: vi.fn(),
      exists: vi.fn().mockResolvedValue(false),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn((_entity, value) => ({ ...value })),
      save: vi.fn(async (value) => {
        if (Array.isArray(value)) return value;
        return { id: value.id ?? 'product-1', ...value };
      }),
      delete: vi.fn(),
      update: vi.fn(),
      softRemove: vi.fn(),
      getRepository: vi.fn().mockReturnValue({
        findOne: vi.fn().mockResolvedValue(null),
      }),
    };
    dataSource = {
      manager,
      transaction: vi.fn(async (callback) => callback(manager)),
      getRepository: vi.fn(),
    };
    identity = { getUserRoles: vi.fn().mockResolvedValue(['SELLER']) };
    cache = { invalidateProduct: vi.fn() };
    const skuService = {
      normalizeAttributes: vi.fn((attributes) => attributes),
      generateSkuCode: vi.fn(() => 'PRODUCT-BLACK'),
    };
    service = new SellerProductService(
      dataSource,
      skuService as any,
      identity,
      cache,
    );
  });

  it('returns not found when another seller addresses a product', async () => {
    manager.findOne.mockResolvedValue({
      id: 'product-1',
      sellerId: 'seller-2',
    });
    await expect(service.get('product-1', 'seller-1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('finds owned product by uuid or slug', async () => {
    const mockProduct = {
      id: '11111111-2222-3333-4444-555555555555',
      slug: 'ao-thun-nam-cotton',
      sellerId: 'seller-1',
    };
    manager.findOne.mockResolvedValue(mockProduct);

    // 1. By UUID
    const resByUuid = await service.get(
      '11111111-2222-3333-4444-555555555555',
      'seller-1',
    );
    expect(manager.findOne).toHaveBeenCalledWith(
      ProductEntity,
      expect.objectContaining({
        where: {
          id: '11111111-2222-3333-4444-555555555555',
          deletedAt: expect.anything(),
        },
      }),
    );
    expect(resByUuid).toBe(mockProduct);

    // 2. By slug
    const resBySlug = await service.get('ao-thun-nam-cotton', 'seller-1');
    expect(manager.findOne).toHaveBeenCalledWith(
      ProductEntity,
      expect.objectContaining({
        where: { slug: 'ao-thun-nam-cotton', deletedAt: expect.anything() },
      }),
    );
    expect(resBySlug).toBe(mockProduct);
  });

  it('creates the complete aggregate in one transaction as draft', async () => {
    manager.findOne
      .mockResolvedValueOnce({ id: 'category-1', level: 3, isActive: true })
      .mockResolvedValueOnce({
        id: 'product-1',
        sellerId: 'seller-1',
        slug: 'product',
        status: ProductStatus.DRAFT,
        images: [],
        skus: [],
      });
    const dto: any = {
      categoryId: 'category-1',
      name: 'Product',
      images: [
        { url: 'https://example.com/a.jpg', sortOrder: 0, isPrimary: true },
      ],
      skus: [
        {
          attributes: { color: 'Black' },
          price: 10,
          weightGrams: 1,
          lengthCm: 1,
          widthCm: 1,
          heightCm: 1,
        },
      ],
    };
    const result = await service.create(dto, 'seller-1');
    expect(dataSource.transaction).toHaveBeenCalledOnce();
    expect(manager.save).toHaveBeenCalledTimes(3);
    expect(result.status).toBe(ProductStatus.DRAFT);
  });

  it('links newly created products to the seller shop when one exists', async () => {
    manager.getRepository.mockReturnValue({
      findOne: vi.fn().mockResolvedValue({ id: 'shop-1' }),
    });
    manager.findOne
      .mockResolvedValueOnce({ id: 'category-1', level: 3, isActive: true })
      .mockResolvedValueOnce({
        id: 'product-1',
        sellerId: 'seller-1',
        shopId: 'shop-1',
        slug: 'product',
        status: ProductStatus.DRAFT,
        images: [],
        skus: [],
      });
    await service.create(
      {
        categoryId: 'category-1',
        name: 'Product',
        images: [
          { url: 'https://example.com/a.jpg', sortOrder: 0, isPrimary: true },
        ],
        skus: [
          {
            attributes: { color: 'Black' },
            price: 10,
            weightGrams: 1,
            lengthCm: 1,
            widthCm: 1,
            heightCm: 1,
          },
        ],
      } as any,
      'seller-1',
    );
    expect(manager.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sellerId: 'seller-1', shopId: 'shop-1' }),
    );
    expect(manager.getRepository().findOne).toHaveBeenCalledWith({
      where: expect.objectContaining({
        sellerId: 'seller-1',
        status: 'ACTIVE',
      }),
      select: { id: true },
    });
  });

  it('includes soft-deleted products when allocating a unique slug', async () => {
    manager.exists
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false);
    manager.findOne
      .mockResolvedValueOnce({ id: 'category-1', isActive: true })
      .mockResolvedValueOnce({
        id: 'product-1',
        sellerId: 'seller-1',
        slug: 'product-2',
        status: ProductStatus.DRAFT,
      });
    const dto: any = {
      categoryId: 'category-1',
      name: 'Product',
      images: [
        { url: 'https://example.com/a.jpg', sortOrder: 0, isPrimary: true },
      ],
      skus: [
        {
          attributes: { color: 'Black' },
          price: 10,
          weightGrams: 1,
          lengthCm: 1,
          widthCm: 1,
          heightCm: 1,
        },
      ],
    };

    await service.create(dto, 'seller-1');

    expect(manager.exists).toHaveBeenNthCalledWith(1, expect.anything(), {
      where: { slug: 'product' },
      withDeleted: true,
    });
    expect(manager.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ slug: 'product-2' }),
    );
  });

  it('retries a concurrent product slug unique conflict', async () => {
    dataSource.transaction
      .mockRejectedValueOnce({
        driverError: {
          code: '23505',
          constraint: 'UQ_products_slug',
          detail: 'Key (slug)=(product) already exists.',
        },
      })
      .mockImplementationOnce(async (callback: any) => callback(manager));
    manager.exists
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false);
    manager.findOne
      .mockResolvedValueOnce({ id: 'category-1', isActive: true })
      .mockResolvedValueOnce({
        id: 'product-1',
        sellerId: 'seller-1',
        slug: 'product-2',
        status: ProductStatus.DRAFT,
      });
    const dto: any = {
      categoryId: 'category-1',
      name: 'Product',
      images: [
        { url: 'https://example.com/a.jpg', sortOrder: 0, isPrimary: true },
      ],
      skus: [
        {
          attributes: { color: 'Black' },
          price: 10,
          weightGrams: 1,
          lengthCm: 1,
          widthCm: 1,
          heightCm: 1,
        },
      ],
    };

    await expect(service.create(dto, 'seller-1')).resolves.toMatchObject({
      slug: 'product-2',
    });
    expect(dataSource.transaction).toHaveBeenCalledTimes(2);
  });

  it('propagates persistence failure and does not invalidate cache', async () => {
    manager.findOne.mockResolvedValue({
      id: 'category-1',
      level: 3,
      isActive: true,
    });
    manager.save.mockRejectedValue(new Error('db failure'));
    const dto: any = {
      categoryId: 'category-1',
      name: 'Product',
      images: [
        { url: 'https://example.com/a.jpg', sortOrder: 0, isPrimary: true },
      ],
      skus: [
        {
          attributes: { color: 'Black' },
          price: 10,
          weightGrams: 1,
          lengthCm: 1,
          widthCm: 1,
          heightCm: 1,
        },
      ],
    };
    await expect(service.create(dto, 'seller-1')).rejects.toThrow('db failure');
    expect(cache.invalidateProduct).not.toHaveBeenCalled();
  });

  it('rejects activation unless the aggregate is publishable', async () => {
    manager.findOne.mockResolvedValue({
      id: 'product-1',
      sellerId: 'seller-1',
      categoryId: 'category-1',
      slug: 'product',
      images: [],
      skus: [],
      status: ProductStatus.DRAFT,
    });
    await expect(
      service.setStatus('product-1', ProductStatus.ACTIVE, 'seller-1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('publishes a ready product and allows hiding it again', async () => {
    const product = {
      id: 'product-1',
      sellerId: 'seller-1',
      categoryId: 'category-1',
      slug: 'product',
      images: [{ isPrimary: true }],
      skus: [{ isActive: true }],
      status: ProductStatus.DRAFT,
    };
    manager.findOne.mockImplementation(async (entity: any) =>
      entity.name === 'CategoryEntity'
        ? { id: 'category-1', isActive: true }
        : product,
    );
    await expect(
      service.setStatus('product-1', ProductStatus.ACTIVE, 'seller-1'),
    ).resolves.toMatchObject({ status: ProductStatus.ACTIVE });
    await expect(
      service.setStatus('product-1', ProductStatus.HIDDEN, 'seller-1'),
    ).resolves.toMatchObject({ status: ProductStatus.HIDDEN });
  });

  it('rejects an active category that has a non-deleted child', async () => {
    manager.findOne.mockImplementation(async (entity: any) =>
      entity.name === 'CategoryEntity'
        ? { id: 'category-1', isActive: true }
        : {
            id: 'product-1',
            sellerId: 'seller-1',
            categoryId: 'category-1',
            slug: 'product',
            images: [{ isPrimary: true }],
            skus: [{ isActive: true }],
          },
    );
    manager.count.mockResolvedValue(1);
    await expect(
      service.setStatus('product-1', ProductStatus.ACTIVE, 'seller-1'),
    ).rejects.toThrow('danh mục lá');
  });

  it('rejects empty updates and invalid replacement image primary state', async () => {
    await expect(service.update('product-1', {}, 'seller-1')).rejects.toThrow(
      'không được để trống',
    );
    await expect(
      service.update(
        'product-1',
        {
          images: [
            { url: 'https://example.com/1.jpg', sortOrder: 0, isPrimary: true },
            { url: 'https://example.com/2.jpg', sortOrder: 1, isPrimary: true },
          ],
        },
        'seller-1',
      ),
    ).rejects.toThrow('đúng một ảnh chính');
  });

  it('replaces image metadata transactionally on update', async () => {
    manager.findOne
      .mockResolvedValueOnce({
        id: 'product-1',
        sellerId: 'seller-1',
        slug: 'stable-slug',
      })
      .mockResolvedValueOnce({
        id: 'product-1',
        sellerId: 'seller-1',
        slug: 'stable-slug',
      });
    await service.update(
      'product-1',
      {
        images: [
          { url: 'https://example.com/new.jpg', sortOrder: 0, isPrimary: true },
        ],
      },
      'seller-1',
    );
    expect(manager.delete).toHaveBeenCalledWith(expect.anything(), {
      productId: 'product-1',
    });
    expect(dataSource.transaction).toHaveBeenCalledOnce();
  });

  it('deactivates SKUs and soft-deletes the product atomically', async () => {
    manager.findOne.mockResolvedValue({
      id: 'product-1',
      sellerId: 'seller-1',
      slug: 'product',
    });
    await service.remove('product-1', 'seller-1');
    expect(manager.update).toHaveBeenCalledWith(
      expect.anything(),
      { productId: 'product-1', isActive: true },
      { isActive: false },
    );
    expect(manager.softRemove).toHaveBeenCalled();
    expect(dataSource.transaction).toHaveBeenCalledOnce();
  });

  it('applies ownership scope and pagination to listing', async () => {
    const qb: any = {};
    for (const method of [
      'leftJoinAndSelect',
      'where',
      'andWhere',
      'orderBy',
      'skip',
      'take',
    ])
      qb[method] = vi.fn(() => qb);
    qb.getManyAndCount = vi.fn().mockResolvedValue([[{ id: 'product-1' }], 1]);
    dataSource.getRepository.mockReturnValue({ createQueryBuilder: () => qb });
    const result = await service.list('seller-1', { page: 2, limit: 10 });
    expect(qb.andWhere).toHaveBeenCalledWith('product.seller_id = :actorId', {
      actorId: 'seller-1',
    });
    expect(qb.skip).toHaveBeenCalledWith(10);
    expect(result).toMatchObject({ total: 1, page: 2, limit: 10 });
  });
});
