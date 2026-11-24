import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUserId } from '../../../common/auth/current-user-id.decorator.js';
import { AccessTokenGuard } from '../../identity/auth/guards/access-token.guard.js';
import { Permissions } from '../../identity/rbac/decorators/permissions.decorator.js';
import { PermissionsGuard } from '../../identity/rbac/guards/permissions.guard.js';
import {
  CreateProductReviewDto,
  ProductReviewQueryDto,
  ReplyProductReviewDto,
} from '../dtos/product-review.dto.js';
import { ProductReviewService } from '../services/product-review.service.js';

@Controller('api/v1/catalog')
export class ProductReviewController {
  constructor(private readonly reviews: ProductReviewService) {}

  @Post('reviews')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(AccessTokenGuard, PermissionsGuard)
  @Permissions('REPUTATION.RATE')
  create(
    @CurrentUserId() buyerId: string,
    @Body() dto: CreateProductReviewDto,
  ) {
    return this.reviews.create(buyerId, dto.orderItemId, dto);
  }

  @Get('products/:slug/reviews')
  product(@Param('slug') slug: string, @Query() query: ProductReviewQueryDto) {
    return this.reviews.product(slug, query);
  }

  @Get('shops/:shop/reviews')
  shop(@Param('shop') shop: string, @Query() query: ProductReviewQueryDto) {
    return this.reviews.shop(shop, query);
  }

  @Post('seller/reviews/:id/reply')
  @UseGuards(AccessTokenGuard, PermissionsGuard)
  @Permissions('PRODUCT.UPDATE')
  reply(
    @CurrentUserId() sellerId: string,
    @Param('id') reviewId: string,
    @Body() dto: ReplyProductReviewDto,
  ) {
    return this.reviews.reply(sellerId, reviewId, dto);
  }
}
