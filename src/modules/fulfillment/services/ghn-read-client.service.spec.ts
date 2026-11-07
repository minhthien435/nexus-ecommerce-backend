import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { GhnClientService } from './ghn-client.service.js';

afterEach(() => vi.unstubAllGlobals());
const config = { GHN_API_TOKEN: 'test-token', GHN_SHOP_ID: '123' };
describe('GHN read-only client', () => {
  it.each([
    'https://example.test/shiip/public-api',
    'https://example.test/shiip/public-api/v2/',
  ])('normalizes base %s without v2 on locations', async (GHN_API_URL) => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 200, data: [] }),
    });
    vi.stubGlobal('fetch', fetcher);
    const service = new GhnClientService(
      new ConfigService({ ...config, GHN_API_URL }),
    );
    await service.request('master-data/province');
    expect(fetcher).toHaveBeenCalledWith(
      'https://example.test/shiip/public-api/master-data/province',
      expect.objectContaining({
        method: 'GET',
        signal: expect.any(AbortSignal),
      }),
    );
  });
  it('never mocks missing credentials even when shipment fallback is enabled', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(
      new GhnClientService(
        new ConfigService({ GHN_MOCK_FALLBACK: 'true' }),
      ).request('master-data/province'),
    ).rejects.toMatchObject({ status: 503 });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(['network', 'timeout', 'http', 'json', 'shape'])(
    'surfaces %s failures',
    async (failure) => {
      const fetcher = vi.fn().mockImplementation(async () => {
        if (['network', 'timeout'].includes(failure)) throw new Error(failure);
        return {
          ok: failure !== 'http',
          json: async () => {
            if (failure === 'json') throw new Error('json');
            return { code: failure === 'shape' ? 400 : 200 };
          },
        };
      });
      vi.stubGlobal('fetch', fetcher);
      await expect(
        new GhnClientService(new ConfigService(config)).request(
          'master-data/province',
        ),
      ).rejects.toMatchObject({ status: 503 });
    },
  );
  it('finds configured shop on a later cursor page', async () => {
    const service = new GhnClientService(new ConfigService(config));
    const request = vi
      .spyOn(service, 'request')
      .mockResolvedValueOnce({ shops: [{ _id: 1 }], last_offset: 100 })
      .mockResolvedValueOnce({
        shops: [{ _id: 123, district_id: 1452, ward_code: '21007' }],
        last_offset: 123,
      });
    await expect(service.getShopOrigin()).resolves.toEqual({
      shopId: 123,
      districtId: 1452,
      wardCode: '21007',
    });
    expect(request).toHaveBeenNthCalledWith(
      2,
      'v2/shop/all?offset=100&limit=100',
    );
  });
  it('rejects missing shop origin', async () => {
    const service = new GhnClientService(new ConfigService(config));
    vi.spyOn(service, 'request').mockResolvedValue({
      shops: [],
      last_offset: 0,
    });
    await expect(service.getShopOrigin()).rejects.toMatchObject({
      status: 503,
    });
  });
});
