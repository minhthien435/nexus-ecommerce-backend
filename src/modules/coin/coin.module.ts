import { TypeOrmModule } from '@nestjs/typeorm';
import { CoinWalletEntity } from './coin-wallet.entity.js';
import { CoinTransactionEntity } from './coin-transaction.entity.js';
import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module.js';
import { CoinController } from './coin.controller.js';
import { CoinService } from './coin.service.js';

@Module({
  imports: [
    IdentityModule,
    TypeOrmModule.forFeature([CoinWalletEntity, CoinTransactionEntity]),
  ],
  controllers: [CoinController],
  providers: [CoinService],
})
export class CoinModule {}
