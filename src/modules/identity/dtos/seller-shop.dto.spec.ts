import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import {
  RegisterSellerShopDto,
  UpdateSellerShopDto,
} from './seller-shop.dto.js';

describe('seller shop DTOs', () => {
  it('normalizes and accepts a valid registration', async () => {
    const input = plainToInstance(RegisterSellerShopDto, {
      name: '  Nexus Shop  ',
      phone: '0912345678',
      warehouseAddress: '  Ho Chi Minh City  ',
      identityNumber: ' 012345678901 ',
    });
    await expect(validate(input)).resolves.toEqual([]);
    expect(input.name).toBe('Nexus Shop');
    expect(input.warehouseAddress).toBe('Ho Chi Minh City');
  });

  it('rejects null for non-nullable patch fields', async () => {
    const input = plainToInstance(UpdateSellerShopDto, {
      phone: null,
      warehouseAddress: null,
    });
    const errors = await validate(input);
    expect(errors.map(({ property }) => property).sort()).toEqual([
      'phone',
      'warehouseAddress',
    ]);
  });

  it('allows null only for explicitly nullable presentation fields', async () => {
    const input = plainToInstance(UpdateSellerShopDto, {
      headline: null,
      description: null,
      logoUrl: null,
      bannerUrl: null,
      email: null,
    });
    await expect(validate(input)).resolves.toEqual([]);
  });
});
