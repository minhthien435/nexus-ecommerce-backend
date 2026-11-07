import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ShippingLocationsService } from './shipping-locations.service.js';
import { ShippingLocationCacheService } from './shipping-location-cache.service.js';

const redis = vi.hoisted(() => ({
  status: 'ready',
  connect: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
  on: vi.fn(),
  quit: vi.fn(),
  disconnect: vi.fn(),
}));
vi.mock('ioredis', () => ({
  Redis: class {
    constructor() {
      return redis;
    }
  },
}));
beforeEach(() => {
  vi.resetAllMocks();
  redis.status = 'ready';
});
describe('Shipping locations cache', () => {
  it('normalizes GHN locations and reuses Redis results for 24 hours', async () => {
    const ghn = {
      request: vi
        .fn()
        .mockResolvedValue([{ ProvinceID: 202, ProvinceName: 'HCM' }]),
    };
    const cache = new ShippingLocationCacheService(new ConfigService());
    const service = new ShippingLocationsService(ghn as never, cache);
    redis.get
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('[{"code":"202","name":"HCM"}]');
    const first = await service.provinces();
    expect(await service.provinces()).toEqual(first);
    expect(ghn.request).toHaveBeenCalledOnce();
    expect(redis.set).toHaveBeenCalledWith(
      'shipping:locations:v1:province:all',
      JSON.stringify(first),
      'EX',
      86400,
    );
  });
  it('still retrieves GHN data when Redis read and write fail', async () => {
    redis.get.mockRejectedValue(new Error('disconnected'));
    redis.set.mockRejectedValue(new Error('disconnected'));
    const ghn = {
      request: vi
        .fn()
        .mockResolvedValue([{ WardCode: '21007', WardName: 'Ward' }]),
    };
    const service = new ShippingLocationsService(
      ghn as never,
      new ShippingLocationCacheService(new ConfigService()),
    );
    await expect(service.wards(1452)).resolves.toEqual([
      { code: '21007', name: 'Ward' },
    ]);
    expect(ghn.request).toHaveBeenCalledWith(
      'master-data/ward?district_id=1452',
    );
  });
  it('does not cache an upstream failure or invalid location response', async () => {
    redis.get.mockResolvedValue(null);
    const ghn = {
      request: vi
        .fn()
        .mockRejectedValueOnce(new Error('upstream'))
        .mockResolvedValueOnce({ wrong: [] }),
    };
    const service = new ShippingLocationsService(
      ghn as never,
      new ShippingLocationCacheService(new ConfigService()),
    );
    await expect(service.provinces()).rejects.toThrow('upstream');
    await expect(service.provinces()).rejects.toMatchObject({ status: 503 });
    expect(redis.set).not.toHaveBeenCalled();
  });
  it('rejects invalid parent IDs without an outbound call', async () => {
    const ghn = { request: vi.fn() };
    const service = new ShippingLocationsService(
      ghn as never,
      new ShippingLocationCacheService(new ConfigService()),
    );
    await expect(service.districts(-1)).rejects.toMatchObject({ status: 400 });
    await expect(service.wards(NaN)).rejects.toMatchObject({ status: 400 });
    expect(ghn.request).not.toHaveBeenCalled();
  });
});
