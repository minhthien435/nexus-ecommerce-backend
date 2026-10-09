import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { IdentityModule } from './modules/identity/identity.module.js';

@Module({
  imports: [
    // 1. Nạp biến môi trường toàn cục (.env)
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    // 2. Cấu hình kết nối TypeORM tới Supabase PostgreSQL 17 Pooler
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('DB_HOST'),
        port: parseInt(config.get<string>('DB_PORT', '5432'), 10),
        username: config.get<string>('DB_USERNAME'),
        password: config.get<string>('DB_PASSWORD'),
        database: config.get<string>('DB_DATABASE', 'postgres'),
        ssl: {
          rejectUnauthorized: false,
        },
        autoLoadEntities: true,
        synchronize: false, // Không tự động sửa bảng vì DB Supabase đã có sẵn schema
      }),
    }),

    // 3. Nạp Bounded Context Identity Module
    IdentityModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
