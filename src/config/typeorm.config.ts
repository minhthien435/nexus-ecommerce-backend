import { ConfigService } from '@nestjs/config';
import type { TypeOrmModuleOptions } from '@nestjs/typeorm';

function enabled(value: string | undefined): boolean {
  return ['1', 'true', 'yes'].includes(value?.toLowerCase() ?? '');
}

export function createTypeOrmOptions(
  config: ConfigService,
): TypeOrmModuleOptions {
  const common: TypeOrmModuleOptions = {
    type: 'postgres',
    autoLoadEntities: true,
    synchronize: false,
    ssl: enabled(config.get<string>('DB_SSL'))
      ? { rejectUnauthorized: false }
      : false,
    extra: {
      max: Number(config.get<string>('DB_POOL_MAX') || 10),
      idleTimeoutMillis: Number(
        config.get<string>('DB_POOL_IDLE_TIMEOUT') || 30000,
      ),
      connectionTimeoutMillis: Number(
        config.get<string>('DB_POOL_CONN_TIMEOUT') || 5000,
      ),
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
    },
  };
  const url = config.get<string>('DATABASE_URL');

  return url
    ? { ...common, url }
    : {
        ...common,
        host: config.get<string>('DB_HOST'),
        port: config.get<number>('DB_PORT', 5432),
        username: config.get<string>('DB_USERNAME'),
        password: config.get<string>('DB_PASSWORD'),
        database: config.get<string>('DB_DATABASE'),
      };
}
