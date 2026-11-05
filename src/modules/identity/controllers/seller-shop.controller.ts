import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentUserId } from '../../../common/auth/current-user-id.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import {
  RegisterSellerShopDto,
  UpdateSellerShopDto,
} from '../dtos/seller-shop.dto.js';
import { Roles } from '../rbac/decorators/roles.decorator.js';
import { RolesGuard } from '../rbac/guards/roles.guard.js';
import { SellerShopService } from '../services/seller-shop.service.js';

@Controller('api/v1/identity/seller')
export class SellerShopController {
  constructor(private readonly shops: SellerShopService) {}

  @UseGuards(AccessTokenGuard)
  @Post('register')
  register(
    @CurrentUserId() userId: string,
    @Body() dto: RegisterSellerShopDto,
  ) {
    return this.shops.registerShop(userId, dto);
  }

  @Roles('SELLER')
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Get('shop/me')
  getMine(@CurrentUserId() userId: string) {
    return this.shops.getMyShop(userId);
  }

  @Roles('SELLER')
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Patch('shop/me')
  updateMine(
    @CurrentUserId() userId: string,
    @Body() dto: UpdateSellerShopDto,
  ) {
    return this.shops.updateMyShop(userId, dto);
  }

  @Roles('SELLER')
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Post('shop/me/close')
  closeMine(@CurrentUserId() userId: string) {
    return this.shops.closeMyShop(userId);
  }
}
