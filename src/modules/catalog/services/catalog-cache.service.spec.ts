const redis = vi.hoisted(() => ({
  status: 'wait',
  connect: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
  scan: vi.fn(),
  del: vi.fn(),
  quit: vi.fn(),
  disconnect: vi.fn(),
  on: vi.fn(),
}));

vi.mock('ioredis', () => ({
  Redis: class RedisMock {
    constructor() {
      return redis;
    }
  },
}));

import { ConfigService } from '@nestjs/config';
import { CatalogCacheService } from './catalog-cache.service.js';

describe('CatalogCacheService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redis.status = 'wait';
    redis.connect.mockImplementation(async () => {
      redis.status = 'ready';
    });
  });

  it('stores JSON for exactly five minutes', async () => {
    const cache = new CatalogCacheService(new ConfigService());
    await cache.set('key', { value: 1 });
    expect(redis.set).toHaveBeenCalledWith('key', '{"value":1}', 'EX', 300);
  });

  it('returns null instead of failing when Redis is unavailable', async () => {
    redis.connect.mockRejectedValue(new Error('connection refused'));
    const cache = new CatalogCacheService(new ConfigService());
    await expect(cache.get('key')).resolves.toBeNull();
  });

  it('uses normalized, deterministic search and detail keys', () => {
    const cache = new CatalogCacheService(new ConfigService());
    expect(cache.searchKey({ page: 1 })).toBe(cache.searchKey({ page: 1 }));
    expect(cache.detailKey('IPHONE')).toBe('catalog:detail:v3:iphone');
  });
});
