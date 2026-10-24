import { ConfigService } from '@nestjs/config';
import type { BullRootModuleOptions } from '@nestjs/bullmq';

function integerSetting(
  config: ConfigService,
  key: string,
  fallback: number,
  minimum: number,
): number {
  const raw = config.get<string | number>(key);
  if (raw === undefined || raw === null || raw === '') return fallback;
  const parsed = typeof raw === 'number' ? raw : Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= minimum ? parsed : fallback;
}

export function createBullMqOptions(
  config: ConfigService,
): BullRootModuleOptions {
  return {
    connection: {
      host: config.get<string>('REDIS_HOST', 'localhost'),
      port: integerSetting(config, 'REDIS_PORT', 6379, 1),
      password: config.get<string>('REDIS_PASSWORD') || undefined,
      db: integerSetting(config, 'REDIS_DB', 0, 0),
      connectTimeout: integerSetting(
        config,
        'REDIS_CONNECT_TIMEOUT_MS',
        500,
        1,
      ),
      maxRetriesPerRequest: null,
    },
  };
}
