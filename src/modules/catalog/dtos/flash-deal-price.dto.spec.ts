import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import {
  AddFlashDealItemDto,
  UpdateFlashDealItemDto,
} from './admin-flash-deal.dto.js';
import {
  CreateFlashDealRegistrationDto,
  UpdateFlashDealRegistrationDto,
} from './seller-flash-deal.dto.js';

describe('Flash Deal price minimum DTO validation', () => {
  const skuId = '11111111-1111-4111-8111-111111111111';

  it.each([0, 1, 999])(
    'rejects flashPrice below 1,000 VND (%s) across admin and seller DTOs',
    async (flashPrice) => {
      for (const instance of [
        plainToInstance(AddFlashDealItemDto, {
          skuId,
          flashPrice,
          quotaQty: 5,
        }),
        plainToInstance(UpdateFlashDealItemDto, { flashPrice }),
        plainToInstance(CreateFlashDealRegistrationDto, {
          skuId,
          flashPrice,
          quotaQty: 5,
        }),
        plainToInstance(UpdateFlashDealRegistrationDto, { flashPrice }),
      ]) {
        const errors = await validate(instance);
        expect(errors.some((error) => error.property === 'flashPrice')).toBe(
          true,
        );
      }
    },
  );

  it('accepts flashPrice of 1,000 VND across admin and seller DTOs', async () => {
    for (const instance of [
      plainToInstance(AddFlashDealItemDto, {
        skuId,
        flashPrice: 1000,
        quotaQty: 5,
      }),
      plainToInstance(UpdateFlashDealItemDto, { flashPrice: 1000 }),
      plainToInstance(CreateFlashDealRegistrationDto, {
        skuId,
        flashPrice: 1000,
        quotaQty: 5,
      }),
      plainToInstance(UpdateFlashDealRegistrationDto, { flashPrice: 1000 }),
    ]) {
      await expect(validate(instance)).resolves.toHaveLength(0);
    }
  });
});
