import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessTokenGuard } from '../../auth/guards/access-token.guard.js';
import { UserEntity } from '../../domain/user.entity.js';
import { UserAddressEntity } from '../entities/user-address.entity.js';
import { AddressController } from './address.controller.js';
import { AddressService } from './address.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserAddressEntity, UserEntity]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_ACCESS_SECRET', 'super-secret-key-15m'),
        signOptions: { expiresIn: '8h' },
      }),
    }),
  ],
  controllers: [AddressController],
  providers: [AddressService, AccessTokenGuard],
  exports: [AddressService],
})
export class AddressModule {}
