import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AuctionReadToolsService } from './auction-read-tools.service.js';

describe('AuctionReadToolsService', () => {
  const auctionUuid = 'c9c7ba7e-5c86-4363-8dd6-5f0cdf3811b4';
  const buyerUuid = 'ea4f6120-1e4f-4a9e-9913-8699b8144269';

  const makeRow = (overrides: Record<string, unknown> = {}) => ({
    id: auctionUuid,
    code: 'AUC-088618-PPBI',
    seller_id: 'seller-uuid-1',
    product_id: 'prod-uuid-1',
    title_snapshot: 'PHILIPS Drip Coffee Maker HD7432/20',
    product_name: 'PHILIPS Drip Coffee Maker HD7432/20',
    product_slug: 'philips-drip-coffee-maker',
    product_description: 'Great drip coffee maker',
    product_brand: 'Philips',
    image_url: 'https://cdn.nexus.vn/coffee.jpg',
    model_3d_url: 'https://modelviewer.dev/shared-assets/models/coffeemat.glb',
    shop_name: 'Nexus Official',
    shop_slug: 'nexus-official',
    starting_price: '50000.00',
    current_price: '120000.00',
    bid_increment: '10000.00',
    bid_count: 3,
    highest_bidder_id: buyerUuid,
    winner_id: null,
    start_at: new Date(Date.now() - 60_000),
    end_at: new Date(Date.now() + 3_600_000),
    status: 'SCHEDULED',
    extension_count: 1,
    max_extensions: 10,
    retail_min_price: '200000.00',
    retail_max_price: '250000.00',
    ...overrides,
  });

  it('searches LIVE/SCHEDULED auctions with filters and maps due SCHEDULED as LIVE', async () => {
    const query = vi.fn().mockResolvedValue([makeRow()]);
    const service = new AuctionReadToolsService({ query } as never);

    const out = await service.execute('search_auctions', {
      query: 'coffee',
      status: 'LIVE',
      maxPrice: 500000,
      sort: 'popular',
      limit: 3,
    });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('FROM auction.auctions a'),
      ['%coffee%', 500000, 3],
    );
    expect(query.mock.calls[0][0]).not.toContain('reserve_price');
    expect(out.auctions).toHaveLength(1);
    expect(out.result).toMatchObject({
      count: 1,
      items: [
        expect.objectContaining({
          code: 'AUC-088618-PPBI',
          remainingSeconds: expect.any(Number),
          secondsUntilStart: 0,
        }),
      ],
    });
    expect(out.auctions[0]).toMatchObject({
      id: 'AUC-088618-PPBI',
      auctionId: auctionUuid,
      code: 'AUC-088618-PPBI',
      status: 'LIVE',
      currentPrice: 120000,
      bidStep: 10000,
      minNextBid: 130000,
      bidCount: 3,
      has3dModel: true,
    });
    expect(out.observedShopSlugs).toEqual(['nexus-official']);
  });

  it('returns public auction detail with retail reference and never exposes reservePrice', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([makeRow({ status: 'ACTIVE' })])
      .mockResolvedValueOnce([
        {
          amount: '120000.00',
          bidder_id: buyerUuid,
          placed_at: new Date('2026-11-16T06:00:00.000Z'),
        },
      ]);
    const service = new AuctionReadToolsService({ query } as never);

    const out = await service.execute(
      'get_auction_detail',
      { idOrCode: 'AUC-088618-PPBI' },
      buyerUuid,
    );

    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][0]).not.toContain('reserve_price');
    expect(out.result).toMatchObject({
      found: true,
      auction: {
        code: 'AUC-088618-PPBI',
        status: 'LIVE',
        currentPrice: 120000,
        minNextBid: 130000,
        highestBidderMasked: '***4269',
        isCurrentUserLeading: true,
        isCurrentUserSeller: false,
        extensionCount: 1,
        maxExtensions: 10,
        has3dModel: true,
        retailReference: {
          minPrice: 200000,
          maxPrice: 250000,
          estimatedSavingsPercent: 40,
        },
      },
    });
    const detailJson = JSON.stringify(out.result);
    expect(detailJson).not.toContain('reservePrice');
    expect(detailJson).not.toContain(buyerUuid);
  });

  it('requires authentication for get_my_auction_participations and scopes query to verified user', async () => {
    const query = vi.fn().mockResolvedValue([
      makeRow({
        status: 'SETTLED',
        winner_id: buyerUuid,
        my_highest_bid: '120000.00',
        settlement_winner_id: buyerUuid,
        settlement_status: 'PENDING_PAYMENT',
        settlement_order_id: 'ord-uuid-1',
        payment_deadline_at: new Date('2026-11-17T06:00:00.000Z'),
        final_price: '120000.00',
      }),
    ]);
    const service = new AuctionReadToolsService({ query } as never);

    const guestOut = await service.execute('get_my_auction_participations', {
      tab: 'WON',
    });
    expect(guestOut.result).toMatchObject({ requiresAuth: true, items: [] });
    expect(query).not.toHaveBeenCalled();

    const authOut = await service.execute(
      'get_my_auction_participations',
      { tab: 'WON', limit: 2 },
      buyerUuid,
    );
    expect(query).toHaveBeenCalledWith(expect.any(String), [buyerUuid, 2]);
    expect(authOut.result).toMatchObject({
      tab: 'WON',
      count: 1,
      items: [
        expect.objectContaining({
          myHighestBid: 120000,
          isLeading: true,
          isWinner: true,
          settlementStatus: 'PENDING_PAYMENT',
          orderId: 'ord-uuid-1',
          finalPrice: 120000,
        }),
      ],
    });
    expect(authOut.auctions).toHaveLength(1);
  });

  it('rejects invalid arguments cleanly', async () => {
    const service = new AuctionReadToolsService({ query: vi.fn() } as never);

    await expect(
      service.execute('search_auctions', { limit: 10 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.execute('get_auction_detail', { idOrCode: 'bad code!' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.execute(
        'get_my_auction_participations',
        { tab: 'INVALID' },
        buyerUuid,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
