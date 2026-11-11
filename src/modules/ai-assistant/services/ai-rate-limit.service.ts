import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

const RATE_LIMIT_KEY_PREFIX = 'ai:rate-limit:v1:';
const WINDOW_SECONDS = 60;
const DEFAULT_GUEST_LIMIT = 10;
const DEFAULT_AUTH_LIMIT = 20;
const MAX_MEMORY_KEYS = 10000;

interface MemoryWindowEntry {
  count: number;
  expiresAt: number;
}

export interface AiRateLimitConsumeInput {
  requesterKey: string;
  isAuthenticated: boolean;
}

export interface AiRateLimitResult {
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

@Injectable()
export class AiRateLimitService implements OnModuleDestroy {
  private readonly logger = new Logger(AiRateLimitService.name);
  private readonly redis: Redis;
  private readonly memoryWindows = new Map<string, MemoryWindowEntry>();
  private readonly guestLimit: number;
  private readonly authLimit: number;

  constructor(config: ConfigService) {
    this.guestLimit = this.positiveInt(
      config.get<number>('AI_RATE_LIMIT_GUEST') ??
        config.get<number>('AI_RATE_LIMIT_GUEST_PER_MIN'),
      DEFAULT_GUEST_LIMIT,
    );
    this.authLimit = this.positiveInt(
      config.get<number>('AI_RATE_LIMIT_USER') ??
        config.get<number>('AI_RATE_LIMIT_AUTH_PER_MIN'),
      DEFAULT_AUTH_LIMIT,
    );

    this.redis = new Redis({
      host: config.get<string>('REDIS_HOST', 'localhost'),
      port: config.get<number>('REDIS_PORT', 6379),
      password: config.get<string>('REDIS_PASSWORD') || undefined,
      db: config.get<number>('REDIS_DB', 0),
      connectTimeout: config.get<number>('REDIS_CONNECT_TIMEOUT_MS', 500),
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
    this.redis.on('error', () => undefined);
  }

  async consume(input: AiRateLimitConsumeInput): Promise<AiRateLimitResult> {
    const limit = input.isAuthenticated ? this.authLimit : this.guestLimit;
    const scope = input.isAuthenticated ? 'auth' : 'guest';
    const normalizedRequester =
      input.requesterKey.trim().slice(0, 128) || 'anonymous';
    const bucketKey = `${scope}:${normalizedRequester}`;

    const counter =
      (await this.incrementRedis(bucketKey)) ?? this.incrementMemory(bucketKey);

    if (counter.count > limit) {
      throw new HttpException(
        {
          errorCode: 'AI_RATE_LIMITED',
          message: `Bạn đã gửi quá ${limit} yêu cầu mỗi phút cho Trợ lý AI. Vui lòng thử lại sau ${counter.retryAfterSeconds} giây.`,
          error: 'Too Many Requests',
          data: {
            limit,
            remaining: 0,
            retryAfterSeconds: counter.retryAfterSeconds,
          },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return {
      limit,
      remaining: Math.max(0, limit - counter.count),
      retryAfterSeconds: counter.retryAfterSeconds,
    };
  }

  async onModuleDestroy(): Promise<void> {
    this.memoryWindows.clear();
    if (this.redis.status === 'ready') {
      await this.redis.quit();
    } else {
      this.redis.disconnect();
    }
  }

  private async incrementRedis(
    bucketKey: string,
  ): Promise<{ count: number; retryAfterSeconds: number } | null> {
    try {
      await this.ensureConnected();
      const redisKey = `${RATE_LIMIT_KEY_PREFIX}${bucketKey}`;
      const count = await this.redis.incr(redisKey);
      if (count === 1) {
        await this.redis.expire(redisKey, WINDOW_SECONDS);
      }
      const ttl = await this.redis.ttl(redisKey);
      const retryAfterSeconds = ttl > 0 ? ttl : WINDOW_SECONDS;
      return { count, retryAfterSeconds };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.debug(
        `AI rate limit Redis skipped (using memory fallback): ${message}`,
      );
      return null;
    }
  }

  private incrementMemory(bucketKey: string): {
    count: number;
    retryAfterSeconds: number;
  } {
    const now = Date.now();
    this.evictExpiredEntries(now);

    const existing = this.memoryWindows.get(bucketKey);
    if (!existing || existing.expiresAt <= now) {
      if (
        !this.memoryWindows.has(bucketKey) &&
        this.memoryWindows.size >= MAX_MEMORY_KEYS
      ) {
        const oldestKey = this.memoryWindows.keys().next().value;
        if (oldestKey) this.memoryWindows.delete(oldestKey);
      }
      const expiresAt = now + WINDOW_SECONDS * 1000;
      this.memoryWindows.set(bucketKey, { count: 1, expiresAt });
      return { count: 1, retryAfterSeconds: WINDOW_SECONDS };
    }

    existing.count += 1;
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((existing.expiresAt - now) / 1000),
    );
    return { count: existing.count, retryAfterSeconds };
  }

  private evictExpiredEntries(now: number): void {
    for (const [key, entry] of this.memoryWindows.entries()) {
      if (entry.expiresAt <= now) {
        this.memoryWindows.delete(key);
      }
    }
  }

  private positiveInt(value: unknown, fallback: number): number {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }

  private async ensureConnected(): Promise<void> {
    if (this.redis.status === 'wait') await this.redis.connect();
    if (this.redis.status !== 'ready') throw new Error('Redis is unavailable');
  }
}
