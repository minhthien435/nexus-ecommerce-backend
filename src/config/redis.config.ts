import type { ConfigService } from '@nestjs/config';

export interface RedisBaseConnectionOptions {
  host: string;
  port: number;
  password: string | undefined;
  db: number;
  connectTimeout: number;
}

/**
 * Đọc biến cấu hình dạng số nguyên dương/không âm từ ConfigService.
 * Ngăn lỗi ioredis/Node nhận string từ `.env` (ví dụ `'500'` thay vì `500`).
 */
export function integerSetting(
  config: ConfigService,
  key: string,
  fallback: number,
  minimum: number,
): number {
  const raw = config.get<string | number>(key);
  if (raw === undefined || raw === null) return fallback;
  const trimmed = typeof raw === 'string' ? raw.trim() : raw;
  if (trimmed === '') return fallback;
  const parsed = typeof trimmed === 'number' ? trimmed : Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed >= minimum ? parsed : fallback;
}

/**
 * Chuẩn hóa thông số kết nối Redis dùng chung cho ioredis và BullMQ.
 */
export function readRedisBaseOptions(
  config: ConfigService,
): RedisBaseConnectionOptions {
  return {
    host: config.get<string>('REDIS_HOST', 'localhost'),
    port: integerSetting(config, 'REDIS_PORT', 6379, 1),
    password: config.get<string>('REDIS_PASSWORD') || undefined,
    db: integerSetting(config, 'REDIS_DB', 0, 0),
    connectTimeout: integerSetting(config, 'REDIS_CONNECT_TIMEOUT_MS', 500, 1),
  };
}
