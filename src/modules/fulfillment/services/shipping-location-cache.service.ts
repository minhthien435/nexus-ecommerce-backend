import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { readRedisBaseOptions } from '../../../config/redis.config.js';

const CACHE_TTL_SECONDS = 86400;

@Injectable()
export class ShippingLocationCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(ShippingLocationCacheService.name);
  private readonly redis: Redis;

  constructor(config: ConfigService) {
    this.redis = new Redis({
      ...readRedisBaseOptions(config),
      lazyConnect: true,
      commandTimeout: 500,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
    this.redis.on('error', () => undefined);
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      await this.ensureConnected();
      const value = await this.redis.get(key);
      return value === null ? null : (JSON.parse(value) as T);
    } catch (error) {
      this.debugFailure('read', error);
      return null;
    }
  }

  async set(key: string, value: unknown): Promise<void> {
    try {
      await this.ensureConnected();
      await this.redis.set(key, JSON.stringify(value), 'EX', CACHE_TTL_SECONDS);
    } catch (error) {
      this.debugFailure('write', error);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis.status === 'ready') await this.redis.quit();
    else this.redis.disconnect();
  }

  private async ensureConnected(): Promise<void> {
    if (this.redis.status === 'wait') await this.redis.connect();
    if (this.redis.status !== 'ready') throw new Error('Redis is unavailable');
  }

  private debugFailure(operation: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.debug(`Redis cache ${operation} skipped: ${message}`);
  }
}
