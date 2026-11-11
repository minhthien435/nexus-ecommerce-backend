const redis = vi.hoisted(() => ({
  status: 'wait',
  connect: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
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
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiCacheService } from './ai-cache.service.js';

describe('AiCacheService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redis.status = 'wait';
    redis.connect.mockImplementation(async () => {
      redis.status = 'ready';
    });
  });

  it('uses versioned SHA-256 keys with normalized arguments', () => {
    const cache = new AiCacheService(new ConfigService());
    const key = cache.key('detail', { slug: ' RED-SHOE ', z: 1 });
    expect(key).toMatch(/^ai:read:v1:detail:[a-f0-9]{64}$/);
    expect(key).toBe(cache.key('detail', { z: 1, slug: 'red-shoe' }));
  });

  it('stores values for exactly 300 seconds and fails open', async () => {
    const cache = new AiCacheService(new ConfigService());
    await cache.set('key', { value: 1 });
    expect(redis.set).toHaveBeenCalledWith('key', '{"value":1}', 'EX', 300);
    redis.status = 'wait';
    redis.connect.mockRejectedValueOnce(new Error('down'));
    await expect(cache.get('key')).resolves.toBeNull();
  });

  it('reconnects after ioredis enters the ended state', async () => {
    const cache = new AiCacheService(new ConfigService());
    redis.status = 'end';
    redis.get.mockResolvedValueOnce('{"value":1}');
    await expect(cache.get('key')).resolves.toEqual({ value: 1 });
    expect(redis.connect).toHaveBeenCalledOnce();
  });
});
