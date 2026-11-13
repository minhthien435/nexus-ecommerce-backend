import type { ConfigService } from '@nestjs/config';
import type { BullRootModuleOptions } from '@nestjs/bullmq';
import { readRedisBaseOptions } from './redis.config.js';

export function createBullMqOptions(
  config: ConfigService,
): BullRootModuleOptions {
  return {
    connection: {
      ...readRedisBaseOptions(config),
      maxRetriesPerRequest: null,
    },
  };
}
