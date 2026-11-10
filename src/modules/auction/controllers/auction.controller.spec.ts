import { HttpStatus, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AuctionController } from './auction.controller.js';
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
    expect(mockService.placeBid).toHaveBeenCalledWith('AUC-1', 'buyer-1', 110);
  });
});
