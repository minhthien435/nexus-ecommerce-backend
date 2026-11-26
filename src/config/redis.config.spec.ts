import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import { integerSetting, readRedisBaseOptions } from './redis.config.js';

describe('redis.config', () => {
  it('parses string Redis environment variables into safe integers', () => {
    const config = new ConfigService({
      REDIS_HOST: 'redis.local',
      REDIS_PORT: '6380',
      REDIS_PASSWORD: 'pw',
      REDIS_DB: '3',
      REDIS_CONNECT_TIMEOUT_MS: '750',
    });

    expect(readRedisBaseOptions(config)).toEqual({
      host: 'redis.local',
      port: 6380,
      password: 'pw',
      db: 3,
      connectTimeout: 750,
      family: 0,
    });
  });

  it('falls back to safe numeric defaults when env values are blank or invalid', () => {
    const config = new ConfigService({
      REDIS_PORT: 'abc',
      REDIS_DB: '',
      REDIS_CONNECT_TIMEOUT_MS: '-5',
    });

    expect(integerSetting(config, 'REDIS_DB', 0, 0)).toBe(0);
    expect(readRedisBaseOptions(config)).toEqual({
      host: 'localhost',
      port: 6379,
      password: undefined,
      db: 0,
      connectTimeout: 500,
      family: 0,
    });
  });

  it('parses REDIS_URL when configured for managed Redis providers', () => {
    const config = new ConfigService({
      REDIS_URL: 'redis://default:s3cr%40t@redis.railway.internal:6379/1',
      REDIS_CONNECT_TIMEOUT_MS: '5000',
    });

    expect(readRedisBaseOptions(config)).toEqual({
      host: 'redis.railway.internal',
      port: 6379,
      username: 'default',
      password: 's3cr@t',
      db: 1,
      connectTimeout: 5000,
      family: 0,
    });
  });
});
