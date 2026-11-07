import { describe, expect, it, vi } from 'vitest';
import { ValidationPipe } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import {
  CalculateShippingFeeDto,
  DistrictsQueryDto,
  WardsQueryDto,
} from '../dtos/calculate-shipping-fee.dto.js';
import { ShippingController } from './shipping.controller.js';

describe('ShippingController', () => {
  it('exposes the assigned fulfillment shipping routes', () => {
    expect(Reflect.getMetadata(PATH_METADATA, ShippingController)).toBe(
      'api/v1/fulfillment/shipping',
    );
    for (const method of ['provinces', 'districts', 'wards'] as const) {
      expect(
        Reflect.getMetadata(
          PATH_METADATA,
          ShippingController.prototype[method],
        ),
      ).toBe(`locations/${method}`);
    }
    expect(
      Reflect.getMetadata(PATH_METADATA, ShippingController.prototype.quote),
    ).toBe('calculate-fee');
  });
  it('delegates public contract inputs to locations and quotes', async () => {
    const locations = {
      provinces: vi.fn().mockResolvedValue([]),
      districts: vi.fn().mockResolvedValue([]),
      wards: vi.fn().mockResolvedValue([]),
    };
    const quotes = { quote: vi.fn().mockResolvedValue({ fee: 30000 }) };
    const controller = new ShippingController(
      locations as never,
      quotes as never,
    );
    await controller.provinces();
    await controller.districts({ provinceId: 202 });
    await controller.wards({ districtId: 1452 });
    const input = {
      toDistrictId: 1452,
      toWardCode: '21007',
      weightInGrams: 300,
    };
    expect(await controller.quote(input)).toEqual({ fee: 30000 });
    expect(locations.districts).toHaveBeenCalledWith(202);
    expect(locations.wards).toHaveBeenCalledWith(1452);
    expect(quotes.quote).toHaveBeenCalledWith({
      districtId: 1452,
      wardCode: '21007',
      weightGrams: 300,
    });
  });
  it('rejects invalid HTTP payloads and transforms valid query IDs', async () => {
    const pipe = new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    await expect(
      pipe.transform(
        { provinceId: '202' },
        { type: 'query', metatype: DistrictsQueryDto },
      ),
    ).resolves.toEqual({ provinceId: 202 });
    await expect(
      pipe.transform(
        { districtId: 'NaN' },
        { type: 'query', metatype: WardsQueryDto },
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      pipe.transform(
        { toDistrictId: 1452, toWardCode: '', weightInGrams: -2, fee: 0 },
        { type: 'body', metatype: CalculateShippingFeeDto },
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      pipe.transform(
        { toDistrictId: 1452, toWardCode: '21007', weightInGrams: 300 },
        { type: 'body', metatype: CalculateShippingFeeDto },
      ),
    ).resolves.toEqual({
      toDistrictId: 1452,
      toWardCode: '21007',
      weightInGrams: 300,
    });
    await expect(
      pipe.transform(
        { districtId: 1452, wardCode: '21007', weightGrams: 300 },
        { type: 'body', metatype: CalculateShippingFeeDto },
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});
