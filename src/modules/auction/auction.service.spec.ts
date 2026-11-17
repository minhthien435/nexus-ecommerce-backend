import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { In } from 'typeorm';
import { AuctionService } from './auction.service.js';
import { AuctionEntity } from './entities/auction.entity.js';
import { ShopEntity } from '../identity/domain/shop.entity.js';

describe('AuctionService', () => {
  const bidReadRepository = (rows: unknown[] = [], bids: unknown[] = []) => ({
    createQueryBuilder: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      addSelect: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      groupBy: vi.fn().mockReturnThis(),
      getRawMany: vi.fn().mockResolvedValue(rows),
    }),
    find: vi.fn().mockResolvedValue(bids),
  });
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

  it('keeps zero/empty bid projections for an auction without bids', () => {
    const service = new AuctionService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const auction = {
      id: 'auction-1',
      sellerId: 'seller-1',
      titleSnapshot: 'Product',
      startPrice: '100.00',
      currentPrice: '100.00',
      bidIncrement: '10.00',
      bidCount: 0,
      highestBidderId: null,
      startsAt: new Date(Date.now() - 1000),
      endsAt: new Date(Date.now() + 60000),
      status: 'ACTIVE',
    } as AuctionEntity;

    expect(service.toView(auction)).toMatchObject({
      bidCount: 0,
      bidderCount: 0,
      highestBidderMasked: null,
    });
    expect(service.toDetailView(auction).recentBids).toEqual([]);
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

  describe('demo seller eligibility', () => {
    function fixture(shop: { status: string; reputationScore: number } | null) {
      const persistedShop = shop ? Object.freeze({ ...shop }) : null;
      const shopRepo = {
        findOne: vi.fn().mockResolvedValue(persistedShop),
        save: vi.fn(),
        update: vi.fn(),
      };
      const auctionRepo = {
        create: vi.fn((value) => value),
        save: vi.fn(async (value) => ({ id: 'demo-auction', ...value })),
      };
      const manager = {
        getRepository: vi.fn((entity) => {
          if (entity === ShopEntity) return shopRepo;
          if (entity === AuctionEntity) return auctionRepo;
          throw new Error(
            'Unexpected repository: reputation must remain read-only',
          );
        }),
      };
      let committed = false;
      const transaction = vi.fn(async (work) => {
        const result = await work(manager);
        committed = true;
        return result;
      });
      const schedule = vi.fn(() => expect(committed).toBe(true));
      const auctions = {
        findOne: vi.fn().mockResolvedValue(null),
        save: vi.fn(),
        manager: { transaction },
      };
      const service = new AuctionService(
        auctions as never,
        {
          findOne: vi.fn().mockResolvedValue({
            id: 'product',
            sellerId: 'seller',
            name: 'Product',
            isAuctionEligible: true,
          }),
        } as never,
        {
          findOne: vi.fn().mockResolvedValue({
            id: 'sku',
            productId: 'product',
            price: 1000,
            currency: 'VND',
          }),
        } as never,
        {} as never,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { schedule } as never,
      );
      return {
        service,
        shopRepo,
        auctionRepo,
        manager,
        transaction,
        schedule,
        auctions,
        persistedShop,
      };
    }

    it.each([
      ...[49, 50, 59, 60, 69].map((reputationScore) => ({
        status: 'ACTIVE',
        reputationScore,
      })),
      ...['PENDING', 'SUSPENDED', 'CLOSED'].map((status) => ({
        status,
        reputationScore: 100,
      })),
      null,
    ])('skips an ineligible demo seller: %j', async (shop) => {
      const f = fixture(shop);
      await expect(
        f.service.createDemoForSku('sku', { startsAt: new Date() }),
      ).resolves.toBeNull();
      expect(f.auctionRepo.save).not.toHaveBeenCalled();
      expect(f.auctions.save).not.toHaveBeenCalled();
      expect(f.schedule).not.toHaveBeenCalled();
      expect(f.shopRepo.save).not.toHaveBeenCalled();
      expect(f.shopRepo.update).not.toHaveBeenCalled();
    });

    it.each([70, 71])(
      'creates and schedules after committing the locked shop lookup at %s',
      async (reputationScore) => {
        const f = fixture({ status: 'ACTIVE', reputationScore });
        const startsAt = new Date(Date.now() + 60_000);
        await expect(
          f.service.createDemoForSku('sku', { startsAt }),
        ).resolves.toMatchObject({
          id: 'demo-auction',
          sellerId: 'seller',
          startPrice: '600.00',
          reservePrice: '800.00',
          bidIncrement: '20.00',
          status: 'SCHEDULED',
          startsAt,
        });
        expect(f.transaction).toHaveBeenCalledTimes(1);
        expect(f.shopRepo.findOne).toHaveBeenCalledWith({
          where: { sellerId: 'seller' },
          lock: { mode: 'pessimistic_read' },
        });
        expect(f.manager.getRepository).toHaveBeenCalledWith(AuctionEntity);
        expect(f.auctionRepo.save).toHaveBeenCalledTimes(1);
        expect(f.auctions.save).not.toHaveBeenCalled();
        expect(f.schedule).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({ id: 'demo-auction' }),
        );
        expect(f.shopRepo.save).not.toHaveBeenCalled();
        expect(f.shopRepo.update).not.toHaveBeenCalled();
        expect(f.persistedShop).toEqual({ status: 'ACTIVE', reputationScore });
      },
    );

    it('does not schedule a transaction that fails to commit', async () => {
      const f = fixture({ status: 'ACTIVE', reputationScore: 70 });
      const failure = new Error('commit failed');
      f.transaction.mockImplementationOnce(async (work) => {
        await work(f.manager);
        throw failure;
      });
      await expect(
        f.service.createDemoForSku('sku', { startsAt: new Date() }),
      ).rejects.toBe(failure);
      expect(f.schedule).not.toHaveBeenCalled();
    });
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
      highestBidderId: '00000000-0000-0000-0000-000000001234',
      bidCount: 3,
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
      const bidRepository = bidReadRepository(
        [
          {
            auctionId: mockAuction.id,
            bidCount: '3',
            bidderCount: '2',
          },
        ],
        [
          {
            id: 'bid-3',
            bidderId: '00000000-0000-0000-0000-000000001234',
            amount: '1500000.00',
            placedAt: new Date('2026-11-10T00:00:00Z'),
          },
        ],
      );
      const auctions = {
        createQueryBuilder: vi.fn().mockReturnValue(qb),
        manager: {
          getRepository: vi.fn().mockReturnValue(bidRepository),
        },
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
      expect(result.bidCount).toBe(3);
      expect(result.bidderCount).toBe(2);
      expect(result.highestBidderMasked).toBe('***1234');
      const summaryQb = bidRepository.createQueryBuilder.mock.results[0]?.value;
      expect(summaryQb.andWhere).toHaveBeenCalledWith(
        'bid.status IN (:...acceptedStatuses)',
        { acceptedStatuses: ['WINNING', 'OUTBID'] },
      );
      expect(bidRepository.find).toHaveBeenCalledWith({
        where: {
          auctionId: mockAuction.id,
          status: In(['WINNING', 'OUTBID']),
        },
        order: { placedAt: 'DESC' },
        take: 10,
      });
      expect(result.recentBids).toEqual([
        {
          id: 'bid-3',
          bidderMaskedName: '***1234',
          amount: 1500000,
          bidTime: '2026-11-10T00:00:00.000Z',
        },
      ]);
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
        manager: {
          getRepository: vi.fn().mockReturnValue(bidReadRepository()),
        },
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
        manager: {
          getRepository: vi
            .fn()
            .mockReturnValue(
              bidReadRepository([
                { auctionId: 'auc-uuid-1', bidCount: '3', bidderCount: '2' },
              ]),
            ),
        },
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
      expect(result.items[0]?.bidCount).toBe(3);
      expect(result.items[0]?.bidderCount).toBe(2);
    });

    it('sorts by bidCount DESC then endsAt ASC when sort=popular', async () => {
      const qb = {
        innerJoin: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        addOrderBy: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        take: vi.fn().mockReturnThis(),
        getManyAndCount: vi.fn().mockResolvedValue([[], 0]),
      };
      const service = new AuctionService(
        {
          createQueryBuilder: vi.fn().mockReturnValue(qb),
          manager: { getRepository: vi.fn() },
        } as never,
        {} as never,
        {} as never,
        {} as never,
      );

      await service.list({
        status: 'LIVE',
        page: 1,
        limit: 15,
        sort: 'popular',
      });

      expect(qb.orderBy).toHaveBeenCalledWith('auction.bidCount', 'DESC');
      expect(qb.addOrderBy).toHaveBeenCalledWith('auction.endsAt', 'ASC');
    });
  });

  describe('create', () => {
    const createService = (
      auctions: Record<string, any>,
      products: Record<string, any>,
      skus: Record<string, any>,
      reservation = {
        reserve: vi
          .fn()
          .mockResolvedValue([
            { skuId: 'sku-1', warehouseId: 'warehouse-1', quantity: 1 },
          ]),
      },
    ) => {
      const shopRepo = {
        save: vi.fn(),
        update: vi.fn(),
        findOne: vi
          .fn()
          .mockResolvedValue({ status: 'ACTIVE', reputationScore: 70 }),
      };
      const manager = {
        getRepository: vi
          .fn()
          .mockReturnValueOnce(skus)
          .mockReturnValueOnce(products)
          .mockReturnValueOnce(auctions)
          .mockReturnValue(shopRepo),
        query: vi.fn().mockResolvedValue([]),
      };
      auctions.count ??= vi.fn().mockResolvedValue(0);
      auctions.manager = {
        transaction: vi.fn(async (callback) => callback(manager)),
      };
      return {
        service: new AuctionService(
          auctions as never,
          products as never,
          skus as never,
          {} as never,
          undefined,
          undefined,
          reservation as never,
        ),
        reservation,
        manager,
        shopRepo,
      };
    };

    it.each([
      { shopScore: 49, personalScore: 100, allowed: false },
      { shopScore: 50, personalScore: 100, allowed: false },
      { shopScore: 59, personalScore: 100, allowed: false },
      { shopScore: 60, personalScore: 100, allowed: false },
      { shopScore: 69, personalScore: 100, allowed: false },
      { shopScore: 70, personalScore: 60, allowed: true },
      { shopScore: 71, personalScore: 60, allowed: true },
      { shopScore: 85, personalScore: 20, allowed: true },
    ])(
      'uses shop reputation at the seller boundary: %j',
      async ({ shopScore, personalScore, allowed }) => {
        const auctions = {
          findOne: vi.fn().mockResolvedValue(null),
          create: vi.fn((value) => value),
          save: vi.fn(async (value) => ({ id: 'auction-1', ...value })),
        };
        const { service, shopRepo, manager, reservation } = createService(
          auctions,
          {
            findOne: vi.fn().mockResolvedValue({
              id: 'product-1',
              sellerId: 'seller-1',
              name: 'Product',
              status: 'ACTIVE',
              isAuctionEligible: true,
              deletedAt: null,
            }),
          },
          {
            findOne: vi.fn().mockResolvedValue({
              id: 'sku-1',
              productId: 'product-1',
              currency: 'VND',
            }),
          },
        );
        const persistedShop = Object.freeze({
          status: 'ACTIVE',
          reputationScore: shopScore,
        });
        shopRepo.findOne.mockResolvedValue(persistedShop);
        manager.query.mockImplementation(async (sql: string) =>
          sql.includes('identity.reputation_scores')
            ? [{ score: personalScore }]
            : [],
        );
        const dto = {
          reputationScore: 100,
          sellerId: 'spoofed-seller',
          skuId: 'sku-1',
          startPrice: 100,
          reservePrice: 120,
          bidIncrement: 10,
          startsAt: new Date(Date.now() + 60_000).toISOString(),
          endsAt: new Date(Date.now() + 3_660_000).toISOString(),
        };
        const result = service.create(dto, 'seller-1');
        if (allowed)
          await expect(result).resolves.toMatchObject({ id: 'auction-1' });
        else {
          await expect(result).rejects.toMatchObject({
            response: {
              errorCode: 'SELLER_AUCTION_INELIGIBLE',
              message:
                'Cửa hàng phải đang hoạt động và có điểm uy tín tối thiểu 70',
            },
          });
          expect(reservation.reserve).not.toHaveBeenCalled();
          expect(auctions.save).not.toHaveBeenCalled();
          await expect(result).rejects.toMatchObject({ status: 403 });
        }
        expect(persistedShop).toEqual({
          status: 'ACTIVE',
          reputationScore: shopScore,
        });
        expect(shopRepo.save).not.toHaveBeenCalled();
        expect(shopRepo.update).not.toHaveBeenCalled();
        expect(
          manager.query.mock.calls.some(([sql]) =>
            /(?:UPDATE|INSERT INTO) identity\.(?:shops|users|reputation_scores)/i.test(
              sql,
            ),
          ),
        ).toBe(false);
        expect(manager.getRepository).toHaveBeenCalledWith(ShopEntity);
        expect(shopRepo.findOne).toHaveBeenCalledWith({
          where: { sellerId: 'seller-1' },
          lock: { mode: 'pessimistic_read' },
        });
        expect(
          manager.query.mock.calls.some(([sql]) =>
            sql.includes('identity.reputation_scores'),
          ),
        ).toBe(false);
      },
    );

    it.each([
      {
        status: 'SUSPENDED',
        reputationScore: 100,
        openCount: 0,
        errorCode: 'SELLER_AUCTION_INELIGIBLE',
      },
      ...['PENDING', 'CLOSED', null].map((status) => ({
        status,
        reputationScore: 100,
        openCount: 0,
        errorCode: 'SELLER_AUCTION_INELIGIBLE',
      })),
      {
        status: 'ACTIVE',
        reputationScore: 49,
        openCount: 0,
        errorCode: 'SELLER_AUCTION_INELIGIBLE',
      },
      {
        status: 'ACTIVE',
        reputationScore: 70,
        openCount: 5,
        errorCode: 'SELLER_AUCTION_LIMIT_REACHED',
      },
    ])(
      'rejects invalid seller state before reserving inventory',
      async ({ status, reputationScore, openCount, errorCode }) => {
        const auctionRepo = {
          count: vi.fn().mockResolvedValue(openCount),
          save: vi.fn(),
        };
        const productRepo = {
          findOne: vi.fn().mockResolvedValue({ status: 'ACTIVE' }),
        };
        const skuRepo = {
          findOne: vi
            .fn()
            .mockResolvedValue({ id: 'sku-1', productId: 'product-1' }),
        };
        const { service, shopRepo, reservation } = createService(
          auctionRepo,
          productRepo,
          skuRepo,
        );
        shopRepo.findOne.mockResolvedValue(
          status ? { status, reputationScore } : null,
        );
        const now = Date.now();
        await expect(
          service.create(
            {
              skuId: 'sku-1',
              startPrice: 100,
              reservePrice: 120,
              bidIncrement: 10,
              startsAt: new Date(now + 60_000).toISOString(),
              endsAt: new Date(now + 3_660_000).toISOString(),
            },
            'seller-1',
          ),
        ).rejects.toMatchObject({ response: { errorCode } });
        expect(auctionRepo.save).not.toHaveBeenCalled();
        expect(reservation.reserve).not.toHaveBeenCalled();
      },
    );

    it('creates an auction for an owned active eligible SKU', async () => {
      const auctions = {
        findOne: vi.fn().mockResolvedValue(null),
        create: vi.fn((value) => value),
        save: vi.fn(async (value) => ({ id: 'auction-1', ...value })),
      };
      const products = {
        findOne: vi.fn().mockResolvedValue({
          id: 'product-1',
          sellerId: 'seller-1',
          name: 'Product',
          status: 'ACTIVE',
          isAuctionEligible: true,
          deletedAt: null,
        }),
      };
      const skus = {
        findOne: vi.fn().mockResolvedValue({
          id: 'sku-1',
          productId: 'product-1',
          currency: 'VND',
        }),
      };
      const { service, reservation, manager } = createService(
        auctions,
        products,
        skus,
      );
      const result = await service.create(
        {
          skuId: 'sku-1',
          startPrice: 100,
          reservePrice: 120,
          bidIncrement: 10,
          startsAt: new Date(Date.now() + 1000).toISOString(),
          endsAt: new Date(Date.now() + 3605000).toISOString(),
        },
        'seller-1',
      );
      expect(result).toMatchObject({
        id: 'auction-1',
        sellerId: 'seller-1',
        currentPrice: '100.00',
        bidCount: 0,
        reservationReceipt: [
          { skuId: 'sku-1', warehouseId: 'warehouse-1', quantity: 1 },
        ],
      });
      expect(reservation.reserve).toHaveBeenCalledWith(
        [{ skuId: 'sku-1', quantity: 1 }],
        manager,
      );
    });

    it('rejects an unowned SKU without creating an auction', async () => {
      const auctions = { findOne: vi.fn(), save: vi.fn() };
      const products = { findOne: vi.fn().mockResolvedValue(null) };
      const skus = {
        findOne: vi
          .fn()
          .mockResolvedValue({ id: 'sku-1', productId: 'product-1' }),
      };
      const { service } = createService(auctions, products, skus);

      await expect(
        service.create(
          {
            skuId: 'sku-1',
            startPrice: 100,
            reservePrice: 120,
            bidIncrement: 10,
            startsAt: new Date(Date.now() + 1000).toISOString(),
            endsAt: new Date(Date.now() + 3605000).toISOString(),
          },
          'other-seller',
        ),
      ).rejects.toMatchObject({
        status: 403,
        response: { errorCode: 'AUCTION_SKU_NOT_OWNED_OR_INELIGIBLE' },
      });
      expect(auctions.save).not.toHaveBeenCalled();
    });

    it('rejects a duplicate open auction for the SKU', async () => {
      const auctions = {
        findOne: vi.fn().mockResolvedValue({ id: 'existing' }),
        save: vi.fn(),
      };
      const products = {
        findOne: vi.fn().mockResolvedValue({
          id: 'product-1',
          sellerId: 'seller-1',
          name: 'Product',
          status: 'ACTIVE',
          isAuctionEligible: true,
          deletedAt: null,
        }),
      };
      const skus = {
        findOne: vi.fn().mockResolvedValue({
          id: 'sku-1',
          productId: 'product-1',
        }),
      };
      const { service } = createService(auctions, products, skus);

      await expect(
        service.create(
          {
            skuId: 'sku-1',
            startPrice: 100,
            reservePrice: 120,
            bidIncrement: 10,
            startsAt: new Date(Date.now() + 1000).toISOString(),
            endsAt: new Date(Date.now() + 3605000).toISOString(),
          },
          'seller-1',
        ),
      ).rejects.toMatchObject({
        status: 409,
        response: { errorCode: 'AUCTION_ALREADY_OPEN' },
      });
      expect(auctions.save).not.toHaveBeenCalled();
    });

    it('does not save when inventory reservation fails', async () => {
      const auctions = {
        findOne: vi.fn().mockResolvedValue(null),
        create: vi.fn((value) => value),
        save: vi.fn(),
      };
      const products = {
        findOne: vi.fn().mockResolvedValue({
          id: 'product-1',
          sellerId: 'seller-1',
          name: 'Product',
          status: 'ACTIVE',
          isAuctionEligible: true,
          deletedAt: null,
        }),
      };
      const skus = {
        findOne: vi.fn().mockResolvedValue({
          id: 'sku-1',
          productId: 'product-1',
          currency: 'VND',
        }),
      };
      const reservationError = new ConflictException({
        errorCode: 'INSUFFICIENT_STOCK',
      });
      const { service } = createService(auctions, products, skus, {
        reserve: vi.fn().mockRejectedValue(reservationError),
      });

      await expect(
        service.create(
          {
            skuId: 'sku-1',
            startPrice: 100,
            reservePrice: 120,
            bidIncrement: 10,
            startsAt: new Date(Date.now() + 1000).toISOString(),
            endsAt: new Date(Date.now() + 3605000).toISOString(),
          },
          'seller-1',
        ),
      ).rejects.toBe(reservationError);
      expect(auctions.save).not.toHaveBeenCalled();
    });
  });

  describe('placeBid', () => {
    const activeAuction = () => ({
      id: 'auction-1',
      code: 'AUC-1',
      sellerId: 'seller-1',
      currentPrice: '100.00',
      bidIncrement: '10.00',
      bidCount: 1,
      highestBidId: 'old-bid',
      highestBidderId: null as string | null,
      startsAt: new Date(Date.now() - 1000),
      endsAt: new Date(Date.now() + 60000),
      status: 'ACTIVE',
    });

    function biddingService(auction = activeAuction()) {
      const auctionQb = {
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue(auction),
      };
      const auctionRepo = {
        createQueryBuilder: vi.fn().mockReturnValue(auctionQb),
        save: vi.fn().mockResolvedValue(auction),
      };
      const bidRepo = {
        findOne: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockResolvedValue({ affected: 1 }),
        create: vi.fn((value) => value),
        save: vi.fn(async (value) => ({
          id: 'new-bid',
          placedAt: new Date(),
          ...value,
        })),
      };
      const eligibilityRepo = { findOne: vi.fn().mockResolvedValue(null) };
      const manager = {
        getRepository: vi
          .fn()
          .mockReturnValueOnce(auctionRepo)
          .mockReturnValueOnce(bidRepo)
          .mockReturnValueOnce(eligibilityRepo)
          .mockReturnValue({
            findOne: vi
              .fn()
              .mockResolvedValue({ status: 'ACTIVE', reputationScore: 70 }),
          }),
        query: vi.fn().mockResolvedValue([]),
      };
      const auctions = {
        manager: {
          transaction: vi.fn(async (callback) => callback(manager)),
        },
      };
      return {
        service: new AuctionService(
          auctions as never,
          {} as never,
          {} as never,
          {} as never,
        ),
        auctionRepo,
        bidRepo,
        eligibilityRepo,
        manager,
      };
    }

    it.each([50, 69])(
      'blocks scheduled activation through bid for shop %s despite personal score 100',
      async (shopScore) => {
        const auction = activeAuction();
        auction.status = 'SCHEDULED';
        const test = biddingService(auction);
        test.eligibilityRepo.findOne.mockResolvedValue({
          reputationScore: 100,
          isRestricted: false,
        });
        test.manager.getRepository.mockReturnValue({
          findOne: vi.fn().mockResolvedValue({
            status: 'ACTIVE',
            reputationScore: shopScore,
          }),
        });
        await expect(
          test.service.placeBid('AUC-1', 'buyer-1', 110),
        ).rejects.toMatchObject({
          response: { errorCode: 'SELLER_AUCTION_INELIGIBLE' },
        });
        expect(test.bidRepo.save).not.toHaveBeenCalled();
        expect(test.auctionRepo.save).not.toHaveBeenCalled();
      },
    );

    it('atomically outbids the previous winner and updates counters', async () => {
      const { service, auctionRepo, bidRepo } = biddingService();
      await expect(
        service.placeBid('AUC-1', 'buyer-1', 110),
      ).resolves.toMatchObject({
        bid: { id: 'new-bid', amount: '110.00', status: 'WINNING' },
        minNextBid: 120,
      });
      expect(bidRepo.update).toHaveBeenCalledWith(
        { id: 'old-bid', status: 'WINNING' },
        { status: 'OUTBID' },
      );
      expect(auctionRepo.createQueryBuilder().setLock).toHaveBeenCalledWith(
        'pessimistic_write',
      );
      expect(auctionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          currentPrice: '110.00',
          highestBidId: 'new-bid',
          highestBidderId: 'buyer-1',
          bidCount: 2,
        }),
      );
    });

    it('rejects self-bidding without writes', async () => {
      const { service, auctionRepo, bidRepo } = biddingService();
      await expect(
        service.placeBid('AUC-1', 'seller-1', 110),
      ).rejects.toMatchObject({
        status: 403,
        response: { errorCode: 'CANNOT_BID_OWN_AUCTION' },
      });
      expect(bidRepo.save).not.toHaveBeenCalled();
      expect(auctionRepo.save).not.toHaveBeenCalled();
    });

    it('rejects a bid below minNextBid without writes', async () => {
      const { service, auctionRepo, bidRepo } = biddingService();
      await expect(
        service.placeBid('AUC-1', 'buyer-1', 109),
      ).rejects.toMatchObject({
        status: 409,
        response: { errorCode: 'BID_TOO_LOW', minNextBid: 110 },
      });
      expect(bidRepo.save).not.toHaveBeenCalled();
      expect(auctionRepo.save).not.toHaveBeenCalled();
    });

    it('rejects bids outside the active time window without writes', async () => {
      const auction = activeAuction();
      auction.endsAt = new Date(Date.now() - 1);
      const { service, auctionRepo, bidRepo } = biddingService(auction);
      await expect(service.placeBid('AUC-1', 'buyer-1', 110)).rejects.toThrow(
        ConflictException,
      );
      expect(bidRepo.save).not.toHaveBeenCalled();
      expect(auctionRepo.save).not.toHaveBeenCalled();
    });

    it('activates a scheduled auction once its persisted window opens', async () => {
      const auction = activeAuction();
      auction.status = 'SCHEDULED';
      const { service, auctionRepo } = biddingService(auction);
      await service.placeBid('AUC-1', 'buyer-1', 110);
      expect(auctionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'ACTIVE' }),
      );
    });

    it('uses cent-safe arithmetic for bid thresholds and responses', async () => {
      const auction = {
        ...activeAuction(),
        currentPrice: '0.10',
        bidIncrement: '0.20',
      };
      const { service, auctionRepo } = biddingService(auction);
      await expect(
        service.placeBid('AUC-1', 'buyer-1', 0.3),
      ).resolves.toMatchObject({
        bid: { amount: '0.30' },
        minNextBid: 0.5,
      });
      expect(auctionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ currentPrice: '0.30' }),
      );
    });

    it('returns an idempotent retry before applying the leader prohibition', async () => {
      const auction = {
        ...activeAuction(),
        highestBidderId: 'buyer-1',
        currentPrice: '110.00',
      };
      const { service, bidRepo, auctionRepo } = biddingService(auction);
      bidRepo.findOne.mockResolvedValue({
        id: 'original-bid',
        auctionId: auction.id,
        bidderId: 'buyer-1',
        amount: '110.00',
        idempotencyKey: 'retry-key',
      });

      await expect(
        service.placeBid('AUC-1', 'buyer-1', 110, ' retry-key '),
      ).resolves.toMatchObject({
        bid: { id: 'original-bid' },
        minNextBid: 120,
      });
      expect(bidRepo.save).not.toHaveBeenCalled();
      expect(auctionRepo.save).not.toHaveBeenCalled();
    });

    it('rejects current leaders and restricted bidders before writes', async () => {
      const leader = biddingService({
        ...activeAuction(),
        highestBidderId: 'buyer-1',
      });
      await expect(
        leader.service.placeBid('AUC-1', 'buyer-1', 110),
      ).rejects.toMatchObject({
        response: { errorCode: 'ALREADY_HIGHEST_BIDDER' },
      });

      const restricted = biddingService();
      restricted.eligibilityRepo.findOne.mockResolvedValue({
        reputationScore: 90,
        trustLevel: 'STANDARD',
        isRestricted: true,
      });
      await expect(
        restricted.service.placeBid('AUC-1', 'buyer-1', 110),
      ).rejects.toMatchObject({
        response: { errorCode: 'REPUTATION_TOO_LOW' },
      });
      expect(restricted.bidRepo.save).not.toHaveBeenCalled();
    });

    it.each([
      { reputationScore: 49, trustLevel: 'STANDARD', isRestricted: false },
      { reputationScore: 90, trustLevel: 'RESTRICTED', isRestricted: false },
    ])(
      'rejects ineligible per-user eligibility rows before writes',
      async (eligibility) => {
        const fixture = biddingService();
        fixture.eligibilityRepo.findOne.mockResolvedValue(eligibility);

        await expect(
          fixture.service.placeBid('AUC-1', 'buyer-1', 110),
        ).rejects.toMatchObject({
          status: 403,
          response: { errorCode: 'REPUTATION_TOO_LOW' },
        });
        expect(fixture.eligibilityRepo.findOne).toHaveBeenCalledWith({
          where: { userId: 'buyer-1' },
        });
        expect(fixture.bidRepo.save).not.toHaveBeenCalled();
        expect(fixture.auctionRepo.save).not.toHaveBeenCalled();
      },
    );

    it('emits bid:placed post-commit using canonical UUID sessionId', async () => {
      const auction = activeAuction();
      auction.endsAt = new Date(Date.now() + 30_000);
      const originalEnd = auction.endsAt;
      const emitBidPlaced = vi.fn();
      const emitAuctionSniped = vi.fn();
      const schedule = vi.fn();
      const notifyMany = vi.fn().mockResolvedValue(undefined);
      const { auctionRepo, bidRepo } = biddingService(auction);
      const mockManager = {
        getRepository: vi
          .fn()
          .mockReturnValueOnce(auctionRepo)
          .mockReturnValueOnce(bidRepo)
          .mockReturnValueOnce({ findOne: vi.fn().mockResolvedValue(null) }),
        query: vi.fn(async (sql: string) => {
          if (sql.includes('ANTI_SNIPING_ENABLED'))
            return [{ config_value: true }];
          if (sql.includes('SELECT DISTINCT bidder_id'))
            return [{ bidder_id: 'buyer-2' }, { bidder_id: 'buyer-3' }];
          return [];
        }),
      };
      let committed = false;
      const service = new AuctionService(
        {
          manager: {
            transaction: async (fn: (m: any) => Promise<any>) => {
              const result = await fn(mockManager);
              committed = true;
              return result;
            },
          },
        } as never,
        {} as never,
        {} as never,
        {} as never,
        { emitBidPlaced, emitAuctionSniped } as never,
        { notifyMany } as never,
        undefined,
        undefined,
        undefined,
        { schedule } as never,
      );

      emitAuctionSniped.mockImplementation(() => expect(committed).toBe(true));
      schedule.mockImplementation(() => expect(committed).toBe(true));
      await service.placeBid('AUC-1', 'buyer-1', 110);

      expect(emitBidPlaced).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: auction.id,
          auctionCode: 'AUC-1',
          newPrice: 110,
          highestBidderId: 'buyer-1',
        }),
      );
      const expectedEnd = new Date(originalEnd.getTime() + 60_000);
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO auction.auction_extensions'),
        [auction.id, 'new-bid', originalEnd, expectedEnd, 60],
      );
      expect(emitAuctionSniped).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: auction.id,
          newEndTime: expectedEnd.toISOString(),
          remainingExtensions: 9,
        }),
      );
      expect(schedule).toHaveBeenCalledWith(
        expect.objectContaining({ endsAt: expectedEnd }),
      );
      expect(notifyMany).toHaveBeenCalledWith([
        expect.objectContaining({
          userId: 'buyer-2',
          type: 'AUCTION_SNIPED',
          sourceEventId: 'new-bid',
        }),
        expect.objectContaining({
          userId: 'buyer-3',
          actionUrl: '/auctions/auction-1',
        }),
      ]);
    });

    it('does not fail a committed extended bid when anti-sniping notification dispatch fails', async () => {
      const auction = activeAuction();
      auction.endsAt = new Date(Date.now() + 30_000);
      const fixture = biddingService(auction);
      fixture.manager.query.mockImplementation(async (sql: string) => {
        if (sql.includes('ANTI_SNIPING_ENABLED'))
          return [{ config_value: true }];
        if (sql.includes('SELECT DISTINCT bidder_id'))
          return [{ bidder_id: 'buyer-2' }];
        return [];
      });
      const service = new AuctionService(
        {
          manager: {
            transaction: vi.fn(async (callback) => callback(fixture.manager)),
          },
        } as never,
        {} as never,
        {} as never,
        {} as never,
        undefined,
        {
          notifyMany: vi.fn().mockRejectedValue(new Error('push down')),
        } as never,
      );

      await expect(
        service.placeBid('AUC-1', 'buyer-1', 110),
      ).resolves.toMatchObject({ bid: { id: 'new-bid' } });
    });

    it.each([
      { extensionCount: 10, enabled: true },
      { extensionCount: 0, enabled: false },
    ])(
      'keeps the deadline when anti-sniping is disabled or exhausted',
      async ({ extensionCount, enabled }) => {
        const auction = {
          ...activeAuction(),
          extensionCount,
          maxExtensions: 10,
        };
        auction.endsAt = new Date(Date.now() + 30_000);
        const originalEnd = auction.endsAt;
        const fixture = biddingService(auction);
        fixture.eligibilityRepo.findOne.mockResolvedValue({
          reputationScore: 50,
        });
        fixture.manager.query.mockResolvedValue([{ config_value: enabled }]);
        await fixture.service.placeBid('AUC-1', 'buyer-1', 110);
        expect(auction.endsAt).toBe(originalEnd);
        expect(fixture.manager.query).not.toHaveBeenCalledWith(
          expect.stringContaining('INSERT INTO auction.auction_extensions'),
          expect.any(Array),
        );
      },
    );
  });

  describe('auction lifecycle', () => {
    function fixture(status: AuctionEntity['status'], remainingMs: number) {
      const auction = {
        id: 'auction-1',
        sellerId: 'seller-1',
        status,
        startsAt: new Date(Date.now() - 120_000),
        endsAt: new Date(Date.now() + remainingMs),
      } as AuctionEntity;
      const repo = {
        findOne: vi.fn().mockResolvedValue(auction),
        save: vi.fn(async (value) => value),
      };
      const shopRepo = {
        save: vi.fn(),
        update: vi.fn(),
        findOne: vi
          .fn()
          .mockResolvedValue({ status: 'ACTIVE', reputationScore: 70 }),
      };
      const manager = {
        getRepository: vi.fn((entity) =>
          entity === AuctionEntity ? repo : shopRepo,
        ),
        query: vi.fn().mockResolvedValue([]),
      };
      let committed = false;
      const settleAuction = vi.fn(async () => {
        expect(committed).toBe(true);
        auction.status = 'SETTLED';
      });
      const service = new AuctionService(
        {
          manager: {
            transaction: async (
              work: (value: typeof manager) => Promise<unknown>,
            ) => {
              committed = false;
              const result = await work(manager);
              committed = true;
              return result;
            },
          },
        } as never,
        {} as never,
        {} as never,
        {} as never,
        undefined,
        undefined,
        undefined,
        undefined,
        { settleAuction } as never,
      );
      return { service, auction, repo, shopRepo, manager, settleAuction };
    }

    it('activates a due auction and records the transition', async () => {
      const { service, auction, repo, manager, settleAuction } = fixture(
        'SCHEDULED',
        60_000,
      );
      await service.advanceLifecycle(auction.id);
      expect(repo.findOne).toHaveBeenCalledWith({
        where: { id: auction.id },
        lock: { mode: 'pessimistic_write' },
      });
      expect(auction.status).toBe('ACTIVE');
      expect(manager.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO auction.auction_status_history'),
        [auction.id, 'SCHEDULED', 'ACTIVE', null, 'SYSTEM', expect.any(String)],
      );
      expect(settleAuction).not.toHaveBeenCalled();
    });

    it.each([49, 50, 59, 60, 69])(
      'cancels an ineligible scheduled auction before activation at shop score %s',
      async (shopScore) => {
        const { service, auction, shopRepo, settleAuction } = fixture(
          'SCHEDULED',
          60_000,
        );
        shopRepo.findOne.mockResolvedValue({
          status: 'ACTIVE',
          reputationScore: shopScore,
        });
        await service.advanceLifecycle(auction.id);
        expect(auction.status).toBe('CANCELLED');
        expect(settleAuction).not.toHaveBeenCalled();
      },
    );

    it('ignores a stale close job and settles once the current deadline passes', async () => {
      const { service, auction, repo, manager, settleAuction } = fixture(
        'ACTIVE',
        60_000,
      );
      await service.advanceLifecycle(auction.id);
      expect(repo.save).not.toHaveBeenCalled();
      expect(settleAuction).not.toHaveBeenCalled();

      auction.endsAt = new Date(Date.now() - 1);
      await service.advanceLifecycle(auction.id);
      await service.advanceLifecycle(auction.id);
      expect(manager.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO auction.auction_status_history'),
        [auction.id, 'ACTIVE', 'ENDED', null, 'SYSTEM', expect.any(String)],
      );
      expect(settleAuction).toHaveBeenCalledExactlyOnceWith(auction.id);
    });
  });

  describe('Dev 1 (Minh) views, filters, history, participations, endEarly & cancel', () => {
    it('returns canonical auctionId, actual highestBidderId, and media360 in views', () => {
      const service = new AuctionService(
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      );
      const auction = {
        id: 'uuid-auction-1',
        code: 'AUC-001',
        sellerId: 'seller-1',
        titleSnapshot: '3D Watch',
        startPrice: '100.00',
        currentPrice: '150.00',
        bidIncrement: '10.00',
        bidCount: 2,
        highestBidderId: 'buyer-9999',
        startsAt: new Date(Date.now() - 60_000),
        endsAt: new Date(Date.now() + 60_000),
        status: 'ACTIVE',
      } as AuctionEntity;

      const product = {
        id: 'prod-1',
        name: '3D Watch',
        slug: '3d-watch',
        categoryId: 'cat-1',
        images: [],
        attributes: {
          model3dUrl: 'https://cdn.example.com/watch.glb',
          spinImages: [
            'https://cdn.example.com/1.jpg',
            'https://cdn.example.com/2.jpg',
          ],
          Material: 'Titanium',
        },
      } as any;

      const detail = service.toDetailView(auction, product);
      expect(detail.id).toBe('AUC-001');
      expect(detail.auctionId).toBe('uuid-auction-1');
      expect(detail.highestBidderId).toBe('buyer-9999');
      expect(detail.media360).toEqual({
        model3dUrl: 'https://cdn.example.com/watch.glb',
        spinImages: [
          'https://cdn.example.com/1.jpg',
          'https://cdn.example.com/2.jpg',
        ],
      });
      expect(detail.specs).toEqual([{ name: 'Material', value: 'Titanium' }]);
    });

    it('filters list() by sellerId when supplied', async () => {
      const qb = {
        innerJoin: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        take: vi.fn().mockReturnThis(),
        getManyAndCount: vi.fn().mockResolvedValue([[], 0]),
      };
      const service = new AuctionService(
        { createQueryBuilder: vi.fn().mockReturnValue(qb) } as never,
        { find: vi.fn().mockResolvedValue([]) } as never,
        {} as never,
        { find: vi.fn().mockResolvedValue([]) } as never,
      );

      await service.list({ sellerId: 'seller-abc', page: 1, limit: 10 });

      expect(qb.andWhere).toHaveBeenCalledWith('auction.sellerId = :sellerId', {
        sellerId: 'seller-abc',
      });
    });

    it('paginates full bid history via listBids()', async () => {
      const auction = { id: 'uuid-1', code: 'AUC-1' };
      const qb = {
        where: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue(auction),
      };
      const bidRepo = {
        findAndCount: vi.fn().mockResolvedValue([
          [
            {
              id: 'bid-2',
              auctionId: 'uuid-1',
              bidderId: '00000000-0000-0000-0000-000000009999',
              amount: '250.00',
              status: 'WINNING',
              placedAt: new Date('2026-11-13T08:00:00Z'),
            },
          ],
          15,
        ]),
      };
      const service = new AuctionService(
        {
          createQueryBuilder: vi.fn().mockReturnValue(qb),
          manager: { getRepository: vi.fn().mockReturnValue(bidRepo) },
        } as never,
        {} as never,
        {} as never,
        {} as never,
      );

      const res = await service.listBids('AUC-1', 2, 10);
      expect(res).toEqual({
        auctionId: 'uuid-1',
        items: [
          {
            id: 'bid-2',
            bidderMaskedName: '***9999',
            amount: 250,
            status: 'WINNING',
            bidTime: '2026-11-13T08:00:00.000Z',
          },
        ],
        total: 15,
        page: 2,
        limit: 10,
        totalPages: 2,
      });
    });

    it('ends an active auction early for owner and emits auction:ended', async () => {
      const liveAuction = {
        id: 'uuid-1',
        code: 'AUC-1',
        sellerId: 'seller-1',
        productId: 'prod-1',
        titleSnapshot: 'Watch',
        startPrice: '100.00',
        currentPrice: '200.00',
        bidIncrement: '10.00',
        highestBidderId: 'buyer-1',
        bidCount: 3,
        startsAt: new Date(Date.now() - 60_000),
        endsAt: new Date(Date.now() + 60_000),
        status: 'ACTIVE',
      } as AuctionEntity;

      const qb = {
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue(liveAuction),
      };
      const auctionRepo = {
        createQueryBuilder: vi.fn().mockReturnValue(qb),
        save: vi.fn().mockImplementation(async (x) => x),
      };
      const bidRepo = {
        createQueryBuilder: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          addSelect: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          andWhere: vi.fn().mockReturnThis(),
          groupBy: vi.fn().mockReturnThis(),
          getRawMany: vi.fn().mockResolvedValue([]),
        }),
      };
      const emitAuctionEnded = vi.fn();
      const mockManager = {
        getRepository: vi.fn().mockReturnValue(auctionRepo),
        query: vi.fn().mockResolvedValue([]),
      };
      const service = new AuctionService(
        {
          manager: {
            transaction: (fn: (m: any) => Promise<any>) => fn(mockManager),
            getRepository: vi.fn().mockReturnValue(bidRepo),
          },
        } as never,
        { find: vi.fn().mockResolvedValue([]) } as never,
        {} as never,
        { find: vi.fn().mockResolvedValue([]) } as never,
        { emitAuctionEnded } as never,
      );

      const view = await service.endEarly('AUC-1', 'seller-1');
      expect(view.status).toBe('ENDED');
      expect(emitAuctionEnded).toHaveBeenCalledWith({
        sessionId: 'uuid-1',
        auctionCode: 'AUC-1',
        winnerId: 'buyer-1',
        finalPrice: 200,
        status: 'ENDED',
      });
    });

    it('forbids seller from cancelling auction owned by another seller or with existing bids', async () => {
      const auction = {
        id: 'uuid-1',
        sellerId: 'seller-owner',
        bidCount: 1,
        highestBidId: 'bid-1',
        status: 'ACTIVE',
      } as AuctionEntity;
      const qb = {
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue(auction),
      };
      const mockManager = {
        getRepository: vi.fn().mockReturnValue({
          createQueryBuilder: vi.fn().mockReturnValue(qb),
          save: vi.fn(),
        }),
      };
      const service = new AuctionService(
        {
          manager: {
            transaction: (fn: (m: any) => Promise<any>) => fn(mockManager),
          },
        } as never,
        {} as never,
        {} as never,
        {} as never,
      );

      await expect(
        service.cancelAuction('uuid-1', 'other-seller', 'SELLER'),
      ).rejects.toThrow(ForbiddenException);

      await expect(
        service.cancelAuction('uuid-1', 'seller-owner', 'SELLER'),
      ).rejects.toMatchObject({
        status: 409,
        response: { errorCode: 'AUCTION_CANCEL_HAS_BIDS' },
      });
    });

    it('allows admin to force-cancel an active auction with bids', async () => {
      const auction = {
        id: 'uuid-1',
        code: 'AUC-1',
        sellerId: 'seller-owner',
        productId: 'prod-1',
        titleSnapshot: 'Watch',
        startPrice: '100.00',
        currentPrice: '200.00',
        bidIncrement: '10.00',
        bidCount: 2,
        highestBidId: 'bid-2',
        startsAt: new Date(Date.now() - 60_000),
        endsAt: new Date(Date.now() + 60_000),
        status: 'ACTIVE',
      } as AuctionEntity;
      const qb = {
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue(auction),
      };
      const emitAuctionEnded = vi.fn();
      const mockManager = {
        getRepository: vi.fn().mockReturnValue({
          createQueryBuilder: vi.fn().mockReturnValue(qb),
          save: vi.fn().mockImplementation(async (x) => x),
        }),
        query: vi.fn().mockResolvedValue([]),
      };
      const bidRepo = {
        createQueryBuilder: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          addSelect: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          andWhere: vi.fn().mockReturnThis(),
          groupBy: vi.fn().mockReturnThis(),
          getRawMany: vi.fn().mockResolvedValue([]),
        }),
      };
      const service = new AuctionService(
        {
          manager: {
            transaction: (fn: (m: any) => Promise<any>) => fn(mockManager),
            getRepository: vi.fn().mockReturnValue(bidRepo),
          },
        } as never,
        { find: vi.fn().mockResolvedValue([]) } as never,
        {} as never,
        { find: vi.fn().mockResolvedValue([]) } as never,
        { emitAuctionEnded } as never,
      );

      const res = await service.cancelAuction(
        'AUC-1',
        'admin-1',
        'ADMIN',
        'Vi phạm chính sách',
      );
      expect(res.status).toBe('CANCELLED');
      expect(emitAuctionEnded).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'uuid-1',
          winnerId: null,
          status: 'CANCELLED',
        }),
      );
    });

    it('releases a persisted reservation and clears its receipt in the cancel transaction', async () => {
      const receipt = [
        { skuId: 'sku-1', warehouseId: 'warehouse-1', quantity: 1 },
      ];
      const auction = {
        id: 'uuid-1',
        code: 'AUC-1',
        sellerId: 'seller-owner',
        productId: 'prod-1',
        titleSnapshot: 'Watch',
        startPrice: '100.00',
        currentPrice: '100.00',
        bidIncrement: '10.00',
        bidCount: 0,
        highestBidId: null,
        startsAt: new Date(Date.now() + 60_000),
        endsAt: new Date(Date.now() + 120_000),
        status: 'SCHEDULED',
        reservationReceipt: receipt,
      } as AuctionEntity;
      const qb = {
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue(auction),
      };
      const auctionRepo = {
        createQueryBuilder: vi.fn().mockReturnValue(qb),
        save: vi.fn().mockImplementation(async (value) => value),
      };
      const manager = {
        getRepository: vi.fn().mockReturnValue(auctionRepo),
        query: vi.fn().mockResolvedValue([]),
      };
      const release = vi.fn().mockResolvedValue(undefined);
      const transaction = vi.fn(async (work) => work(manager));
      const service = new AuctionService(
        {
          manager: {
            getRepository: vi.fn().mockReturnValue(bidReadRepository()),
          },
        } as never,
        { find: vi.fn().mockResolvedValue([]) } as never,
        {} as never,
        { find: vi.fn().mockResolvedValue([]) } as never,
        undefined,
        undefined,
        { reserve: vi.fn(), release } as never,
        { transaction } as never,
      );

      await service.cancelAuction('AUC-1', 'seller-owner', 'SELLER');

      expect(release).toHaveBeenCalledWith(receipt, manager);
      expect(auctionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'CANCELLED',
          reservationReceipt: null,
        }),
      );
      expect(transaction).toHaveBeenCalledTimes(1);
    });

    it('does not release inventory when a cancelled auction has no receipt', async () => {
      const auction = {
        id: 'uuid-1',
        code: 'AUC-1',
        sellerId: 'seller-owner',
        productId: 'prod-1',
        titleSnapshot: 'Legacy auction',
        startPrice: '100.00',
        currentPrice: '100.00',
        bidIncrement: '10.00',
        bidCount: 0,
        highestBidId: null,
        startsAt: new Date(Date.now() + 60_000),
        endsAt: new Date(Date.now() + 120_000),
        status: 'SCHEDULED',
        reservationReceipt: null,
      } as AuctionEntity;
      const auctionRepo = {
        createQueryBuilder: vi.fn().mockReturnValue({
          setLock: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          getOne: vi.fn().mockResolvedValue(auction),
        }),
        save: vi.fn().mockImplementation(async (value) => value),
      };
      const manager = {
        getRepository: vi.fn().mockReturnValue(auctionRepo),
        query: vi.fn().mockResolvedValue([]),
      };
      const release = vi.fn();
      const service = new AuctionService(
        {
          manager: {
            transaction: (work: (value: any) => Promise<any>) => work(manager),
            getRepository: vi.fn().mockReturnValue(bidReadRepository()),
          },
        } as never,
        { find: vi.fn().mockResolvedValue([]) } as never,
        {} as never,
        { find: vi.fn().mockResolvedValue([]) } as never,
        undefined,
        undefined,
        { reserve: vi.fn(), release } as never,
      );

      await service.cancelAuction('AUC-1', 'seller-owner', 'SELLER');

      expect(release).not.toHaveBeenCalled();
      expect(auctionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'CANCELLED' }),
      );
    });

    it('does not save cancellation when reservation release fails', async () => {
      const auction = {
        id: 'uuid-1',
        sellerId: 'seller-owner',
        bidCount: 0,
        highestBidId: null,
        status: 'SCHEDULED',
        reservationReceipt: [
          { skuId: 'sku-1', warehouseId: 'warehouse-1', quantity: 1 },
        ],
      } as AuctionEntity;
      const auctionRepo = {
        createQueryBuilder: vi.fn().mockReturnValue({
          setLock: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          getOne: vi.fn().mockResolvedValue(auction),
        }),
        save: vi.fn(),
      };
      const manager = {
        getRepository: vi.fn().mockReturnValue(auctionRepo),
        query: vi.fn().mockResolvedValue([]),
      };
      const releaseError = new Error('release failed');
      const service = new AuctionService(
        {
          manager: {
            transaction: (work: (value: any) => Promise<any>) => work(manager),
          },
        } as never,
        {} as never,
        {} as never,
        {} as never,
        undefined,
        undefined,
        {
          reserve: vi.fn(),
          release: vi.fn().mockRejectedValue(releaseError),
        } as never,
      );

      await expect(
        service.cancelAuction('AUC-1', 'seller-owner', 'SELLER'),
      ).rejects.toBe(releaseError);
      expect(auctionRepo.save).not.toHaveBeenCalled();
    });

    it('returns buyer participations with highest bid, settlement orderId, and paymentDeadlineAt', async () => {
      const wonAuction = {
        id: 'uuid-won-1',
        code: 'AUC-WON',
        sellerId: 'seller-1',
        productId: 'prod-1',
        titleSnapshot: 'Rolex Daytona',
        startPrice: '1000.00',
        currentPrice: '1500.00',
        bidIncrement: '50.00',
        highestBidderId: 'buyer-1',
        winnerId: 'buyer-1',
        finalPrice: '1500.00',
        bidCount: 4,
        startsAt: new Date(Date.now() - 120_000),
        endsAt: new Date(Date.now() - 10_000),
        status: 'SETTLED',
      } as AuctionEntity;

      const bidQb = {
        select: vi.fn().mockReturnThis(),
        addSelect: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        groupBy: vi.fn().mockReturnThis(),
        getRawMany: vi
          .fn()
          .mockResolvedValueOnce([
            {
              auctionId: 'uuid-won-1',
              myHighestBid: '1500.00',
              lastBidAt: '2026-11-13T10:00:00.000Z',
            },
          ])
          .mockResolvedValueOnce([]),
      };
      const auctionQb = {
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        take: vi.fn().mockReturnThis(),
        getManyAndCount: vi.fn().mockResolvedValue([[wonAuction], 1]),
      };

      const deadline = new Date('2026-11-14T10:00:00.000Z');
      const service = new AuctionService(
        {
          createQueryBuilder: vi.fn().mockReturnValue(auctionQb),
          manager: {
            getRepository: vi.fn().mockReturnValue({
              createQueryBuilder: vi.fn().mockReturnValue(bidQb),
            }),
            query: vi.fn().mockResolvedValue([
              {
                auction_id: 'uuid-won-1',
                winner_id: 'buyer-1',
                status: 'PENDING_PAYMENT',
                order_id: 'order-uuid-1',
                payment_deadline_at: deadline,
                final_price: '1500.00',
              },
            ]),
          },
        } as never,
        { find: vi.fn().mockResolvedValue([]) } as never,
        {} as never,
        { find: vi.fn().mockResolvedValue([]) } as never,
      );

      const res = await service.getMyParticipations('buyer-1', {
        tab: 'WON',
        page: 1,
        limit: 12,
      });

      expect(res.total).toBe(1);
      expect(res.items[0]).toMatchObject({
        myHighestBid: 1500,
        isLeading: true,
        isWinner: true,
        settlementStatus: 'PENDING_PAYMENT',
        orderId: 'order-uuid-1',
        paymentDeadlineAt: deadline.toISOString(),
        finalPrice: 1500,
      });
      expect(res.items[0].auction.auctionId).toBe('uuid-won-1');
    });

    it('maps SCHEDULED auctions to LIVE once startsAt <= now < endsAt and keeps future ones SCHEDULED', () => {
      const service = new AuctionService(
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      );
      const now = Date.now();

      expect(
        service.mapStatus({
          status: 'SCHEDULED',
          startsAt: new Date(now - 60_000),
          endsAt: new Date(now + 3_600_000),
        } as AuctionEntity),
      ).toBe('LIVE');

      expect(
        service.mapStatus({
          status: 'SCHEDULED',
          startsAt: new Date(now + 60_000),
          endsAt: new Date(now + 3_600_000),
        } as AuctionEntity),
      ).toBe('SCHEDULED');

      expect(
        service.mapStatus({
          status: 'SCHEDULED',
          startsAt: new Date(now - 120_000),
          endsAt: new Date(now - 1_000),
        } as AuctionEntity),
      ).toBe('ENDED');
    });

    it('emits auction:updated when update() modifies a scheduled auction', async () => {
      const now = Date.now();
      const scheduled = {
        id: 'uuid-sched-1',
        code: 'AUC-SCHED',
        sellerId: 'seller-1',
        productId: 'prod-1',
        titleSnapshot: 'Coffee Maker',
        startPrice: '100000.00',
        reservePrice: '150000.00',
        currentPrice: '100000.00',
        bidIncrement: '10000.00',
        bidCount: 0,
        startsAt: new Date(now + 600_000),
        endsAt: new Date(now + 7_200_000),
        originalEndsAt: new Date(now + 7_200_000),
        status: 'SCHEDULED',
      } as AuctionEntity;
      const newStartsAt = new Date(now + 900_000);
      const newEndsAt = new Date(now + 5_400_000);

      const qb = {
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue(scheduled),
      };
      const auctionRepo = {
        createQueryBuilder: vi.fn().mockReturnValue(qb),
        save: vi.fn().mockImplementation(async (value) => value),
      };
      const manager = {
        getRepository: vi.fn().mockReturnValue(auctionRepo),
      };
      const emitAuctionUpdated = vi.fn();
      const schedule = vi.fn();

      const service = new AuctionService(
        {
          manager: {
            getRepository: vi.fn().mockReturnValue(bidReadRepository()),
            transaction: (work: (m: any) => Promise<any>) => work(manager),
          },
        } as never,
        { find: vi.fn().mockResolvedValue([]) } as never,
        {} as never,
        { find: vi.fn().mockResolvedValue([]) } as never,
        { emitAuctionUpdated } as never,
        undefined,
        undefined,
        undefined,
        undefined,
        { schedule } as never,
      );

      await service.update('AUC-SCHED', 'seller-1', {
        startsAt: newStartsAt.toISOString(),
        endsAt: newEndsAt.toISOString(),
      });

      expect(schedule).toHaveBeenCalledTimes(1);
      expect(emitAuctionUpdated).toHaveBeenCalledWith({
        sessionId: 'uuid-sched-1',
        auctionCode: 'AUC-SCHED',
        status: 'SCHEDULED',
        startPrice: 100_000,
        bidStep: 10_000,
        minNextBid: 110_000,
        startsAt: newStartsAt.toISOString(),
        endsAt: newEndsAt.toISOString(),
      });
    });
  });
});
