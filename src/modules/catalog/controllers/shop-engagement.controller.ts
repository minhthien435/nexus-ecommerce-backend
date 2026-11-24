import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUserId } from '../../../common/auth/current-user-id.decorator.js';
import { AccessTokenGuard } from '../../identity/auth/guards/access-token.guard.js';
import { WishlistQueryDto } from '../dtos/wishlist-query.dto.js';
import { ShopEngagementService } from '../services/shop-engagement.service.js';

@Controller('api/v1/catalog')
@UseGuards(AccessTokenGuard)
export class ShopEngagementController {
  constructor(private readonly engagement: ShopEngagementService) {}

  @Get('shops/:shop/follow')
  followStatus(@CurrentUserId() userId: string, @Param('shop') shop: string) {
    return this.engagement.getFollow(userId, shop);
  }

  @Post('shops/:shop/follow')
  @HttpCode(HttpStatus.OK)
  follow(@CurrentUserId() userId: string, @Param('shop') shop: string) {
    return this.engagement.setFollow(userId, shop, true);
  }

  @Delete('shops/:shop/follow')
  unfollow(@CurrentUserId() userId: string, @Param('shop') shop: string) {
    return this.engagement.setFollow(userId, shop, false);
  }

  @Get('wishlist')
  wishlist(@CurrentUserId() userId: string, @Query() query: WishlistQueryDto) {
    return this.engagement.wishlist(userId, query);
  }

  @Post('wishlist/:productId')
  @HttpCode(HttpStatus.OK)
  addToWishlist(
    @CurrentUserId() userId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
  ) {
    return this.engagement.setWishlist(userId, productId, true);
  }

  @Delete('wishlist/:productId')
  removeFromWishlist(
    @CurrentUserId() userId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
  ) {
    return this.engagement.setWishlist(userId, productId, false);
  }
}
