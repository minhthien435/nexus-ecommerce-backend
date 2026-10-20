import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { Redis } from 'ioredis';

const SEARCH_PREFIX = 'catalog:search:v2:';
const DETAIL_PREFIX = 'catalog:detail:v2:';
const CACHE_TTL_SECONDS = 300;

@Injectable()
export class CatalogCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(CatalogCacheService.name);
  private readonly redis: Redis;

  constructor(config: ConfigService) {
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

  searchKey(input: object): string {
    const digest = createHash('sha256')
      .update(JSON.stringify(input))
      .digest('hex');
    return `${SEARCH_PREFIX}${digest}`;
  }

  detailKey(slug: string): string {
    return `${DETAIL_PREFIX}${slug.toLowerCase()}`;
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

  async invalidateProduct(slug?: string): Promise<void> {
    try {
      await this.ensureConnected();
      await this.deleteByPrefix(SEARCH_PREFIX);
      if (slug) await this.redis.del(this.detailKey(slug));
    } catch (error) {
      this.debugFailure('invalidate', error);
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

  private async deleteByPrefix(prefix: string): Promise<void> {
    let cursor = '0';
    do {
      const [next, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        `${prefix}*`,
        'COUNT',
        100,
      );
      cursor = next;
      if (keys.length > 0) await this.redis.del(...keys);
    } while (cursor !== '0');
  }

  private debugFailure(operation: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.debug(`Redis cache ${operation} skipped: ${message}`);
  }
}
