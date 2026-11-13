import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { Redis } from 'ioredis';
import { readRedisBaseOptions } from '../../../config/redis.config.js';

const PREFIX = 'ai:read:v1:';
const TTL_SECONDS = 300;

@Injectable()
export class AiCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(AiCacheService.name);
  private readonly redis: Redis;

  constructor(config: ConfigService) {
    this.redis = new Redis({
      ...readRedisBaseOptions(config),
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
    this.redis.on('error', () => undefined);
  }

  key(tool: string, args: object): string {
    const normalized = normalize(args);
    const digest = createHash('sha256')
      .update(JSON.stringify(normalized))
      .digest('hex');
    return `${PREFIX}${tool}:${digest}`;
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      await this.connect();
      const value = await this.redis.get(key);
      return value === null ? null : (JSON.parse(value) as T);
    } catch (error) {
      this.debug('read', error);
      return null;
    }
  }

  async set(key: string, value: unknown): Promise<void> {
    try {
      await this.connect();
      await this.redis.set(key, JSON.stringify(value), 'EX', TTL_SECONDS);
    } catch (error) {
      this.debug('write', error);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis.status === 'ready') await this.redis.quit();
    else this.redis.disconnect();
  }

  private async connect(): Promise<void> {
    if (this.redis.status === 'wait' || this.redis.status === 'end')
      await this.redis.connect();
    if (this.redis.status !== 'ready') throw new Error('Redis is unavailable');
  }

  private debug(operation: string, error: unknown): void {
    this.logger.debug(
      `AI cache ${operation} skipped: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [
          key,
          normalize((value as Record<string, unknown>)[key]),
        ]),
    );
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}
