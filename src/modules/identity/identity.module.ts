// src/modules/identity/identity.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { UserEntity } from './domain/user.entity.js';
import { RefreshTokenEntity } from './domain/refresh-token.entity.js';
import { PasswordResetTokenEntity } from './domain/password-reset-token.entity.js';

import { AuthService } from './auth/services/auth.service.js';
import { TokenService } from './auth/services/token.service.js';
import { AuthController } from './auth/controllers/auth.controller.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserEntity,
      RefreshTokenEntity,
      PasswordResetTokenEntity,
    ]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_ACCESS_SECRET', 'super-secret-key-15m'),
        signOptions: { expiresIn: '15m' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, TokenService],
  exports: [AuthService, TokenService],
})
export class IdentityModule {}
