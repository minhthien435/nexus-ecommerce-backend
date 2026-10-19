import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AuctionService } from './auction.service.js';

describe('AuctionService', () => {
  it('calculates demo prices using the approved ratios', () => {
    const service = new AuctionService({} as never, {} as never, {} as never);
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
      findOne: vi
        .fn()
        .mockResolvedValue({
          id: 'p',
          sellerId: 's',
          isAuctionEligible: true,
          deletedAt: null,
        }),
    };
    const skus = {
      findOne: vi
        .fn()
        .mockResolvedValue({
          id: 'sku',
          productId: 'p',
          price: 100,
          currency: 'INR',
        }),
    };
    const service = new AuctionService(
      auctions as never,
      products as never,
      skus as never,
    );
    await expect(
      service.createDemoForSku('sku', { startsAt: new Date() }),
    ).resolves.toBeNull();
  });
  it('rejects invalid scheduling before reading or writing repositories', async () => {
    const auctions = { save: vi.fn() };
    const products = { findOne: vi.fn() };
    const skus = { findOne: vi.fn() };
    const service = new AuctionService(
      auctions as never,
      products as never,
      skus as never,
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
});
