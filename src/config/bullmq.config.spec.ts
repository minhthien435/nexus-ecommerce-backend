import { ConfigService } from '@nestjs/config';
import { createBullMqOptions } from './bullmq.config.js';

describe('createBullMqOptions', () => {
  it('creates a worker-compatible Redis connection', () => {
    const config = new ConfigService({
      REDIS_HOST: 'redis.example',
      REDIS_PORT: '6380',
      REDIS_PASSWORD: 'secret',
      REDIS_DB: '2',
      REDIS_CONNECT_TIMEOUT_MS: '1250',
    });

    expect(createBullMqOptions(config)).toEqual({
      connection: {
        host: 'redis.example',
        port: 6380,
        password: 'secret',
        db: 2,
        connectTimeout: 1250,
        family: 0,
        maxRetriesPerRequest: null,
      },
    });
  });

  it('uses safe defaults for absent or invalid numeric settings', () => {
    const config = new ConfigService({
      REDIS_PORT: 'not-a-port',
      REDIS_DB: '-1',
      REDIS_CONNECT_TIMEOUT_MS: '1.5',
    });

    expect(createBullMqOptions(config)).toEqual({
      connection: {
        host: 'localhost',
        port: 6379,
        password: undefined,
        db: 0,
        connectTimeout: 500,
        family: 0,
        maxRetriesPerRequest: null,
      },
    });
  });
});
