import { ConfigService } from '@nestjs/config';
import { createTypeOrmOptions } from './typeorm.config.js';

describe('createTypeOrmOptions', () => {
  it('configures safe PostgreSQL runtime options without exposing secrets', () => {
    const config = new ConfigService({
      DB_HOST: 'db.example',
      DB_PORT: 5433,
      DB_USERNAME: 'nexus',
      DB_PASSWORD: 'secret',
      DB_DATABASE: 'postgres',
      DB_SSL: 'true',
    });

    expect(createTypeOrmOptions(config)).toMatchObject({
      type: 'postgres',
      host: 'db.example',
      port: 5433,
      username: 'nexus',
      password: 'secret',
      database: 'postgres',
      ssl: { rejectUnauthorized: false },
      autoLoadEntities: true,
      synchronize: false,
    });
  });
});
