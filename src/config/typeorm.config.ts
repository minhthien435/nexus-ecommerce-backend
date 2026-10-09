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
