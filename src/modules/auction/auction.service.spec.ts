import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AuctionService } from './auction.service.js';
import type { AuctionEntity } from './entities/auction.entity.js';

describe('AuctionService', () => {
  it('calculates demo prices using the approved ratios', () => {
    const service = new AuctionService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    expect(service.calculateDemoPrices(1000)).toEqual({
      startPrice: '600.00',
      reservePrice: '800.00',
      bidIncrement: '20.00',
    });
    expect(() => service.calculateDemoPrices(-1)).toThrow(BadRequestException);
  });

  it('skips a SKU that already has an open auction', async () => {
    const auctions = { findOne: vi.fn().mockResolvedValue({ id: 'existing' }) };
    const products = {
      findOne: vi.fn().mockResolvedValue({
        id: 'p',
        sellerId: 's',
        isAuctionEligible: true,
        deletedAt: null,
      }),
    };
    const skus = {
      findOne: vi.fn().mockResolvedValue({
        id: 'sku',
        productId: 'p',
        price: 100,
        currency: 'INR',
      }),
    };
    const shops = { findOne: vi.fn() };
    const service = new AuctionService(
      auctions as never,
      products as never,
      skus as never,
      shops as never,
    );
    await expect(
      service.createDemoForSku('sku', { startsAt: new Date() }),
    ).resolves.toBeNull();
  });

  it('rejects invalid scheduling before reading or writing repositories', async () => {
    const auctions = { save: vi.fn() };
    const products = { findOne: vi.fn() };
    const skus = { findOne: vi.fn() };
    const shops = { findOne: vi.fn() };
    const service = new AuctionService(
      auctions as never,
      products as never,
      skus as never,
      shops as never,
    );
    await expect(
      service.createDemoForSku('sku', { startsAt: new Date('bad') }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.createDemoForSku('sku', {
        startsAt: new Date(),
        durationDays: 0,
      }),
    ).rejects.toThrow(BadRequestException);
    expect(skus.findOne).not.toHaveBeenCalled();
    expect(auctions.save).not.toHaveBeenCalled();
  });

  describe('findByIdOrCode', () => {
    const mockAuction: Partial<AuctionEntity> = {
      id: 'a0000000-0000-0000-0000-000000000001',
      code: 'AUC-202311-0001',
      sellerId: 's0000000-0000-0000-0000-000000000001',
      productId: 'p0000000-0000-0000-0000-000000000001',
      skuId: 'k0000000-0000-0000-0000-000000000001',
      titleSnapshot: 'Snapshot Product Title',
      startPrice: '1000000.00',
      reservePrice: '1200000.00',
      bidIncrement: '50000.00',
      currentPrice: '1500000.00',
      currency: 'VND',
      startsAt: new Date(Date.now() - 3600000),
      endsAt: new Date(Date.now() + 3600000),
      originalEndsAt: new Date(Date.now() + 3600000),
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mockProduct = {
      id: 'p0000000-0000-0000-0000-000000000001',
      name: 'Rolex Submariner',
      slug: 'rolex-submariner',
      description: 'Mô tả chi tiết đồng hồ',
      brand: 'Rolex',
      categoryId: 'cat-1',
      attributes: { Color: 'Black', Movement: 'Automatic' },
      images: [
        { url: 'https://example.com/img1.jpg', isPrimary: true, sortOrder: 0 },
        { url: 'https://example.com/img2.jpg', isPrimary: false, sortOrder: 1 },
      ],
    };

    const mockShop = {
      id: 'shop-1',
      sellerId: 's0000000-0000-0000-0000-000000000001',
      name: 'Luxury Watches Store',
      slug: 'luxury-watches',
      reputationScore: 85,
    };

    it('looks up auction by AUC-... code case-insensitively', async () => {
      const qb = {
        where: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue(mockAuction),
      };
      const auctions = {
        createQueryBuilder: vi.fn().mockReturnValue(qb),
      };
      const products = {
        findOne: vi.fn().mockResolvedValue(mockProduct),
      };
      const shops = {
        findOne: vi.fn().mockResolvedValue(mockShop),
      };

      const service = new AuctionService(
        auctions as never,
        products as never,
        {} as never,
        shops as never,
      );

      const result = await service.findByIdOrCode('auc-202311-0001');

      expect(auctions.createQueryBuilder).toHaveBeenCalledWith('auction');
      expect(qb.where).toHaveBeenCalledWith(
        'LOWER(auction.code) = LOWER(:code)',
        { code: 'auc-202311-0001' },
      );
      expect(result.id).toBe('AUC-202311-0001');
      expect(result.code).toBe('AUC-202311-0001');
      expect(result.status).toBe('LIVE');
      expect(result.product.name).toBe('Rolex Submariner');
      expect(result.product.imageUrl).toBe('https://example.com/img1.jpg');
      expect(result.seller.shopName).toBe('Luxury Watches Store');
      expect(result.seller.trustLevel).toBe('TRUSTED');
      expect(result.startPrice).toBe(1000000);
      expect(result.currentPrice).toBe(1500000);
      expect(result.bidStep).toBe(50000);
      expect(result.minNextBid).toBe(1550000);
      expect(result.images).toEqual([
        'https://example.com/img1.jpg',
        'https://example.com/img2.jpg',
      ]);
      expect(result.specs).toEqual([
        { name: 'Thương hiệu', value: 'Rolex' },
        { name: 'Color', value: 'Black' },
        { name: 'Movement', value: 'Automatic' },
      ]);
    });

    it('looks up auction by UUID', async () => {
      const uuid = 'a0000000-0000-0000-0000-000000000001';
      const qb = {
        where: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue(mockAuction),
      };
      const auctions = {
        createQueryBuilder: vi.fn().mockReturnValue(qb),
      };
      const products = {
        findOne: vi.fn().mockResolvedValue(mockProduct),
      };
      const shops = {
        findOne: vi.fn().mockResolvedValue(mockShop),
      };

      const service = new AuctionService(
        auctions as never,
        products as never,
        {} as never,
        shops as never,
      );

      const result = await service.findByIdOrCode(uuid);

      expect(qb.where).toHaveBeenCalledWith(
        'auction.id = :id OR LOWER(auction.code) = LOWER(:code)',
        { id: uuid, code: uuid },
      );
      expect(result.id).toBe('AUC-202311-0001');
    });

    it('throws NotFoundException AUCTION_NOT_FOUND if not found', async () => {
      const qb = {
        where: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue(null),
      };
      const auctions = {
        createQueryBuilder: vi.fn().mockReturnValue(qb),
      };

      const service = new AuctionService(
        auctions as never,
        {} as never,
        {} as never,
        {} as never,
      );

      await expect(service.findByIdOrCode('AUC-NOTFOUND')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('list', () => {
    it('queries auctions with status, pagination, and loads relations in batch', async () => {
      const mockAuction = {
        id: 'auc-uuid-1',
        code: 'AUC-1',
        sellerId: 'seller-1',
        productId: 'prod-1',
        startPrice: '500.00',
        currentPrice: '600.00',
        bidIncrement: '25.00',
        startsAt: new Date(Date.now() - 100000),
        endsAt: new Date(Date.now() + 100000),
        status: 'ACTIVE',
      };

      const qb = {
        innerJoin: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        take: vi.fn().mockReturnThis(),
        getManyAndCount: vi.fn().mockResolvedValue([[mockAuction], 1]),
      };
      const auctions = {
        createQueryBuilder: vi.fn().mockReturnValue(qb),
      };
      const products = {
        find: vi.fn().mockResolvedValue([
          {
            id: 'prod-1',
            name: 'P1',
            slug: 'p1',
            categoryId: 'cat-1',
            images: [{ url: 'https://img.com/p1.jpg', isPrimary: true }],
          },
        ]),
      };
      const shops = {
        find: vi.fn().mockResolvedValue([
          {
            sellerId: 'seller-1',
            name: 'S1 Shop',
            slug: 's1-shop',
            reputationScore: 92,
          },
        ]),
      };

      const service = new AuctionService(
        auctions as never,
        products as never,
        {} as never,
        shops as never,
      );

      const result = await service.list({
        status: 'LIVE',
        page: 1,
        limit: 10,
        sort: 'price_asc',
      });

      expect(qb.skip).toHaveBeenCalledWith(0);
      expect(qb.take).toHaveBeenCalledWith(10);
      expect(qb.orderBy).toHaveBeenCalledWith('auction.currentPrice', 'ASC');
      expect(result.total).toBe(1);
      expect(result.totalPages).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.id).toBe('AUC-1');
      expect(result.items[0]?.seller.trustLevel).toBe('TOP_SELLER');
    });
  });
});
