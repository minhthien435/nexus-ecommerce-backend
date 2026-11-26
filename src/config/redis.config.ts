import type { ConfigService } from '@nestjs/config';

export interface RedisBaseConnectionOptions {
  host: string;
  port: number;
  username?: string;
  password: string | undefined;
  db: number;
  connectTimeout: number;
  family: number;
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
  const connectTimeout = integerSetting(
    config,
    'REDIS_CONNECT_TIMEOUT_MS',
    500,
    1,
  );
  const rawUrl = config.get<string>('REDIS_URL')?.trim();
  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      const dbPath = parsed.pathname.replace(/^\//, '');
      const parsedDb = dbPath ? Number(dbPath) : 0;
      const username = parsed.username
        ? decodeURIComponent(parsed.username)
        : undefined;
      return {
        host: parsed.hostname || 'localhost',
        port: parsed.port ? Number(parsed.port) : 6379,
        ...(username ? { username } : {}),
        password: parsed.password
          ? decodeURIComponent(parsed.password)
          : undefined,
        db:
          Number.isSafeInteger(parsedDb) && parsedDb >= 0
            ? parsedDb
            : integerSetting(config, 'REDIS_DB', 0, 0),
        connectTimeout,
        family: 0,
      };
    } catch {
      // Fall back to discrete REDIS_* variables if REDIS_URL is malformed.
    }
  }
  const username = config.get<string>('REDIS_USERNAME')?.trim() || undefined;
  return {
    host: config.get<string>('REDIS_HOST', 'localhost'),
    port: integerSetting(config, 'REDIS_PORT', 6379, 1),
    ...(username ? { username } : {}),
    password: config.get<string>('REDIS_PASSWORD') || undefined,
    db: integerSetting(config, 'REDIS_DB', 0, 0),
    connectTimeout,
    family: 0,
  };
}
