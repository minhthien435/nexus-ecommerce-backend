import {
  BadRequestException,
  ConflictException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
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
});
