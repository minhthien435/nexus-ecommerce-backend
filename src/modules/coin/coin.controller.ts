import {
  Controller,
  DefaultValuePipe,
  Get,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUserId } from '../../common/auth/current-user-id.decorator.js';
import { AccessTokenGuard } from '../identity/auth/guards/access-token.guard.js';
import { CoinService } from './coin.service.js';

@Controller('api/v1/coins')
@UseGuards(AccessTokenGuard)
export class CoinController {
  constructor(private readonly coinService: CoinService) {}

  @Get('me')
  getWallet(@CurrentUserId() userId: string) {
    return this.coinService.getWallet(userId);
  }

  @Get('me/transactions')
  getTransactions(
    @CurrentUserId() userId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.coinService.getTransactions(
      userId,
      Math.min(2_147_483_647, Math.max(1, page)),
      Math.min(100, Math.max(1, limit)),
    );
  }
}
