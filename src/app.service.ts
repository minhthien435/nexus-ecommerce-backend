import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { DataSource } from 'typeorm';
import { readRedisBaseOptions } from './config/redis.config.js';

@Injectable()
export class AppService {
  constructor(
    private readonly database: DataSource,
    private readonly config: ConfigService,
  ) {}

  getHello(): string {
    return 'Hello World!';
  }

  async health() {
    const [database, redis] = await Promise.allSettled([
      this.database.query('SELECT 1'),
      this.pingRedis(),
    ]);
    const databaseUp = database.status === 'fulfilled';
    const redisUp = redis.status === 'fulfilled' && redis.value === 'PONG';
    return {
      status: databaseUp ? (redisUp ? 'ok' : 'degraded') : 'down',
      database: databaseUp ? 'up' : 'down',
      redis: redisUp ? 'up' : 'down',
      timestamp: new Date().toISOString(),
    };
  }

  private async pingRedis() {
    const options = readRedisBaseOptions(this.config);
    const client = new Redis({
      ...options,
      lazyConnect: true,
      commandTimeout: options.connectTimeout,
      retryStrategy: () => null,
    });
    client.on('error', () => undefined);
    try {
      await client.connect();
      return await client.ping();
    } finally {
      client.disconnect();
    }
  }
}
