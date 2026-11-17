import {
  BadRequestException,
  ConflictException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PRIVILEGE_SEEDS } from '../../identity/rbac/rbac.constants.js';
import { PERMISSIONS_KEY } from '../../identity/rbac/decorators/permissions.decorator.js';
import { ROLES_KEY } from '../../identity/rbac/decorators/roles.decorator.js';
import {
  AdminAuctionController,
  AuctionController,
} from './auction.controller.js';
import type { AuctionService } from '../auction.service.js';

describe('AuctionController', () => {
  const mockAuctionDetail = {
    id: 'AUC-123456-ABCD',
    code: 'AUC-123456-ABCD',
    status: 'LIVE',
    product: {
      name: 'Rolex Submariner',
      slug: 'rolex-submariner',
      imageUrl: 'https://example.com/img.jpg',
      categoryId: 'cat-1',
    },
    seller: {
      id: 'seller-1',
      shopName: 'Luxury Watches',
      trustLevel: 'TOP_SELLER' as const,
      reputationScore: 95,
      shopSlug: 'luxury-watches',
    },
    startPrice: 1000000,
    currentPrice: 1500000,
    bidStep: 50000,
    minNextBid: 1550000,
    bidCount: 5,
    bidderCount: 3,
    highestBidderId: null,
    highestBidderMasked: null,
    isSpotlight: false,
    startTime: new Date().toISOString(),
    endTime: new Date(Date.now() + 3600000).toISOString(),
    recentBids: [],
    description: 'Chi tiết sản phẩm',
    images: ['https://example.com/img.jpg'],
    specs: [{ name: 'Thương hiệu', value: 'Rolex' }],
  };

  it('list returns wrapped envelope with data items and meta pagination', async () => {
    const mockListResult = {
      items: [mockAuctionDetail],
      total: 1,
      page: 1,
      limit: 12,
      totalPages: 1,
    };
    const mockService = {
      list: vi.fn().mockResolvedValue(mockListResult),
      findByIdOrCode: vi.fn(),
    } as unknown as AuctionService;

    const controller = new AuctionController(mockService);
    const query = { page: 1, limit: 12 };
    const response = await controller.list(query as never);

    expect(mockService.list).toHaveBeenCalledWith(query);
    expect(response).toEqual({
      success: true,
      statusCode: HttpStatus.OK,
      message: 'Lấy danh sách phiên đấu giá thành công',
      data: {
        items: [mockAuctionDetail],
        page: 1,
        limit: 12,
        total: 1,
        totalPages: 1,
      },
      meta: {
        page: 1,
        limit: 12,
        totalItems: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPrevPage: false,
      },
    });
  });

  it('findByIdOrCode returns wrapped envelope when auction exists', async () => {
    const mockService = {
      list: vi.fn(),
      findByIdOrCode: vi.fn().mockResolvedValue(mockAuctionDetail),
    } as unknown as AuctionService;

    const controller = new AuctionController(mockService);
    const response = await controller.findByIdOrCode('AUC-123456-ABCD');

    expect(mockService.findByIdOrCode).toHaveBeenCalledWith('AUC-123456-ABCD');
    expect(response).toEqual({
      success: true,
      statusCode: HttpStatus.OK,
      message: 'Lấy chi tiết phiên đấu giá thành công',
      data: mockAuctionDetail,
    });
  });

  it('findByIdOrCode throws NotFoundException when auction does not exist', async () => {
    const mockService = {
      list: vi.fn(),
      findByIdOrCode: vi.fn().mockRejectedValue(
        new NotFoundException({
          statusCode: 404,
          errorCode: 'AUCTION_NOT_FOUND',
          message: 'Không tìm thấy phiên đấu giá',
        }),
      ),
    } as unknown as AuctionService;

    const controller = new AuctionController(mockService);
    await expect(controller.findByIdOrCode('NON_EXISTENT')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('creates an auction and places a bid through the authenticated routes', async () => {
    const created = { id: 'auction-1' };
    const bidResult = { bid: { id: 'bid-1' }, minNextBid: 120 };
    const mockService = {
      create: vi.fn().mockResolvedValue(created),
      placeBid: vi.fn().mockResolvedValue(bidResult),
    } as unknown as AuctionService;
    const controller = new AuctionController(mockService);
    const createDto = { skuId: 'sku-1' };

    await expect(
      controller.create(createDto as never, 'seller-1'),
    ).resolves.toMatchObject({ statusCode: HttpStatus.CREATED, data: created });
    await expect(
      controller.placeBid('AUC-1', { amount: 110 }, 'buyer-1'),
    ).resolves.toMatchObject({
      statusCode: HttpStatus.CREATED,
      data: bidResult,
    });
    expect(mockService.create).toHaveBeenCalledWith(createDto, 'seller-1');
    expect(mockService.placeBid).toHaveBeenCalledWith(
      'AUC-1',
      'buyer-1',
      110,
      undefined,
    );
  });

  it('passes one normalized idempotency key and rejects conflicting sources', async () => {
    const mockService = {
      placeBid: vi.fn().mockResolvedValue({ bid: { id: 'bid-1' } }),
    } as unknown as AuctionService;
    const controller = new AuctionController(mockService);

    await controller.placeBid(
      'AUC-1',
      { amount: 110, idempotencyKey: 'same-key' },
      'buyer-1',
      ' same-key ',
    );
    expect(mockService.placeBid).toHaveBeenCalledWith(
      'AUC-1',
      'buyer-1',
      110,
      'same-key',
    );
    await expect(
      controller.placeBid(
        'AUC-1',
        { amount: 110, idempotencyKey: 'body-key' },
        'buyer-1',
        'header-key',
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects empty or oversized idempotency headers before calling the service', async () => {
    const mockService = { placeBid: vi.fn() } as unknown as AuctionService;
    const controller = new AuctionController(mockService);

    await expect(
      controller.placeBid('AUC-1', { amount: 110 }, 'buyer-1', '   '),
    ).rejects.toThrow(BadRequestException);
    await expect(
      controller.placeBid('AUC-1', { amount: 110 }, 'buyer-1', 'x'.repeat(201)),
    ).rejects.toThrow(BadRequestException);
    expect(mockService.placeBid).not.toHaveBeenCalled();
  });

  it('handles participations, paginated bids, endEarly, seller cancel, and admin forceCancel', async () => {
    const mockService = {
      getMyParticipations: vi.fn().mockResolvedValue({
        items: [
          {
            auction: mockAuctionDetail,
            myHighestBid: 1500000,
            isLeading: true,
          },
        ],
        total: 1,
        page: 1,
        limit: 12,
        totalPages: 1,
      }),
      listBids: vi.fn().mockResolvedValue({
        auctionId: 'uuid-1',
        items: [],
        total: 0,
        page: 1,
        limit: 20,
        totalPages: 1,
      }),
      endEarly: vi
        .fn()
        .mockResolvedValue({ ...mockAuctionDetail, status: 'ENDED' }),
      cancelAuction: vi
        .fn()
        .mockResolvedValue({ ...mockAuctionDetail, status: 'CANCELLED' }),
    } as unknown as AuctionService;

    const controller = new AuctionController(mockService);
    const adminController = new AdminAuctionController(mockService);

    const partRes = await controller.getMyParticipations('buyer-1', {
      tab: 'WON',
      page: 1,
      limit: 12,
    });
    expect(mockService.getMyParticipations).toHaveBeenCalledWith('buyer-1', {
      tab: 'WON',
      page: 1,
      limit: 12,
    });
    expect(partRes.meta.totalItems).toBe(1);

    const bidsRes = await controller.listBids('AUC-1', { page: 1, limit: 20 });
    expect(mockService.listBids).toHaveBeenCalledWith('AUC-1', 1, 20);
    expect(bidsRes.data.auctionId).toBe('uuid-1');

    await controller.endEarly('AUC-1', 'seller-1');
    expect(mockService.endEarly).toHaveBeenCalledWith('AUC-1', 'seller-1');

    await controller.cancelBySeller('AUC-1', 'seller-1', {
      reason: 'Wrong price',
    });
    expect(mockService.cancelAuction).toHaveBeenCalledWith(
      'AUC-1',
      'seller-1',
      'SELLER',
      'Wrong price',
    );

    await adminController.forceCancel('AUC-1', 'admin-1', { reason: 'Fraud' });
    expect(mockService.cancelAuction).toHaveBeenCalledWith(
      'AUC-1',
      'admin-1',
      'ADMIN',
      'Fraud',
    );
  });

  it('lists and inspects admin auctions with ADMIN role and AUCTION.ADMIN_LIST permission', async () => {
    const adminSummary = {
      liveCount: 2,
      upcomingCount: 1,
      settledCount: 3,
      paymentTimeoutCount: 1,
      endedCount: 0,
      failedCount: 0,
      cancelledCount: 0,
      totalCount: 7,
    };
    const adminItem = {
      ...mockAuctionDetail,
      reservePrice: 2000000,
      reserveMet: false,
      extensionCount: 2,
      maxExtensions: 10,
      settlementStatus: 'PENDING_PAYMENT',
      winnerId: 'winner-1',
      winnerEmail: 'winner@nexus.vn',
      winnerFullName: 'Nguyen Van A',
      orderId: 'ord-1',
      paymentDeadlineAt: '2026-11-18T00:00:00.000Z',
      finalPrice: 1500000,
      suspiciousFlags: [],
    };
    const mockService = {
      listForAdmin: vi.fn().mockResolvedValue({
        items: [adminItem],
        summary: adminSummary,
        total: 1,
        page: 1,
        limit: 12,
        totalPages: 1,
      }),
      findAdminDetailByIdOrCode: vi.fn().mockResolvedValue({
        ...adminItem,
        bids: [],
        statusHistory: [],
        extensions: [],
        settlement: {
          id: 'set-1',
          winnerId: 'winner-1',
          winnerEmail: 'winner@nexus.vn',
          winnerFullName: 'Nguyen Van A',
          winningBidId: 'bid-1',
          finalPrice: 1500000,
          currency: 'VND',
          status: 'PENDING_PAYMENT',
          orderId: 'ord-1',
          paymentDeadlineAt: '2026-11-18T00:00:00.000Z',
          settledAt: '2026-11-17T00:00:00.000Z',
        },
      }),
    } as unknown as AuctionService;

    const adminController = new AdminAuctionController(mockService);
    const listRes = await adminController.list({
      status: 'LIVE',
      search: 'Rolex',
      page: 1,
      limit: 12,
    });
    expect(mockService.listForAdmin).toHaveBeenCalledWith({
      status: 'LIVE',
      search: 'Rolex',
      page: 1,
      limit: 12,
    });
    expect(listRes.data.summary).toEqual(adminSummary);
    expect(listRes.data.items[0].reservePrice).toBe(2000000);
    expect(listRes.meta.totalItems).toBe(1);

    const detailRes = await adminController.findDetail('AUC-123456-ABCD');
    expect(mockService.findAdminDetailByIdOrCode).toHaveBeenCalledWith(
      'AUC-123456-ABCD',
    );
    expect(detailRes.data.reservePrice).toBe(2000000);
    expect(detailRes.data.settlement?.winnerEmail).toBe('winner@nexus.vn');

    for (const method of ['list', 'findDetail'] as const) {
      expect(
        Reflect.getMetadata(
          ROLES_KEY,
          AdminAuctionController.prototype[method],
        ),
      ).toEqual(['ADMIN']);
      expect(
        Reflect.getMetadata(
          PERMISSIONS_KEY,
          AdminAuctionController.prototype[method],
        ),
      ).toEqual(['AUCTION.ADMIN_LIST']);
    }

    const privilege = PRIVILEGE_SEEDS.find(
      (item) => item.code === 'AUCTION.ADMIN_LIST',
    );
    expect(privilege).toMatchObject({
      code: 'AUCTION.ADMIN_LIST',
      module: 'AUCTION',
      roles: ['ADMIN'],
    });
  });
});
