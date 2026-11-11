const redis = vi.hoisted(() => ({
  status: 'wait',
  connect: vi.fn(),
  incr: vi.fn(),
  expire: vi.fn(),
  ttl: vi.fn(),
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

import { HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiRateLimitService } from './ai-rate-limit.service.js';

describe('AiRateLimitService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redis.status = 'wait';
    redis.connect.mockImplementation(async () => {
      redis.status = 'ready';
    });
    redis.expire.mockResolvedValue(1);
    redis.ttl.mockResolvedValue(45);
  });

  it('enforces guest limit via Redis and returns AI_RATE_LIMITED with retryAfterSeconds', async () => {
    redis.incr.mockResolvedValueOnce(1);
    const service = new AiRateLimitService(new ConfigService());

    const first = await service.consume({
      requesterKey: '127.0.0.1',
      isAuthenticated: false,
    });
    expect(redis.expire).toHaveBeenCalledWith(
      'ai:rate-limit:v1:guest:127.0.0.1',
      60,
    );
    expect(first).toEqual({
      limit: 10,
      remaining: 9,
      retryAfterSeconds: 45,
    });

    redis.incr.mockResolvedValueOnce(11);
    await expect(
      service.consume({
        requesterKey: '127.0.0.1',
        isAuthenticated: false,
      }),
    ).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
      response: expect.objectContaining({
        errorCode: 'AI_RATE_LIMITED',
        data: expect.objectContaining({ retryAfterSeconds: 45 }),
      }),
    });
  });

  it('supports v2 env names AI_RATE_LIMIT_GUEST / AI_RATE_LIMIT_USER and memory fallback', async () => {
    redis.connect.mockRejectedValue(new Error('Redis offline'));
    const service = new AiRateLimitService(
      new ConfigService({
        AI_RATE_LIMIT_GUEST: 2,
        AI_RATE_LIMIT_USER: 3,
      }),
    );

    for (let i = 1; i <= 3; i++) {
      const res = await service.consume({
        requesterKey: 'user-123',
        isAuthenticated: true,
      });
      expect(res.limit).toBe(3);
      expect(res.remaining).toBe(3 - i);
    }

    await expect(
      service.consume({
        requesterKey: 'user-123',
        isAuthenticated: true,
      }),
    ).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
      response: expect.objectContaining({
        errorCode: 'AI_RATE_LIMITED',
      }),
    });
  });
});
