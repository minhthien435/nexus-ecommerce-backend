import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { CreateAuctionDto } from './create-auction.dto.js';
import { UpdateAuctionDto } from './update-auction.dto.js';

describe('Auction price minimum DTO validation', () => {
  const validCreate = {
    skuId: '11111111-1111-4111-8111-111111111111',
    startPrice: 50_000,
    reservePrice: 50_000,
    bidIncrement: 10_000,
    startsAt: '2026-12-01T10:00:00.000Z',
    endsAt: '2026-12-02T10:00:00.000Z',
  };

  it('accepts minimum valid auction prices (50,000 VND start/reserve, 10,000 VND increment)', async () => {
    await expect(
      validate(plainToInstance(CreateAuctionDto, validCreate)),
    ).resolves.toHaveLength(0);
    await expect(
      validate(
        plainToInstance(UpdateAuctionDto, {
          startPrice: 50_000,
          reservePrice: 50_000,
          bidIncrement: 10_000,
        }),
      ),
    ).resolves.toHaveLength(0);
  });

  it.each([
    ['startPrice', 49_999],
    ['reservePrice', 49_999],
    ['bidIncrement', 9_999],
  ])(
    'rejects %s below minimum (%s) on CreateAuctionDto and UpdateAuctionDto',
    async (field, value) => {
      const createErrors = await validate(
        plainToInstance(CreateAuctionDto, { ...validCreate, [field]: value }),
      );
      expect(createErrors.some((error) => error.property === field)).toBe(true);

      const updateErrors = await validate(
        plainToInstance(UpdateAuctionDto, { [field]: value }),
      );
      expect(updateErrors.some((error) => error.property === field)).toBe(true);
    },
  );
});
