import { Controller, Get, Param, Query } from '@nestjs/common';
import { ShopProductQueryDto } from '../dtos/shop-product-query.dto.js';
import { PublicShopService } from '../services/public-shop.service.js';
import { TrustedShopQueryDto } from '../dtos/flash-deal-query.dto.js';

@Controller('api/v1/catalog/shops')
export class PublicShopController {
  constructor(private readonly shops: PublicShopService) {}
  @Get('trusted') trusted(@Query() query: TrustedShopQueryDto) {
    return this.shops.trusted(query);
  }
  @Get(':shop') profile(@Param('shop') shop: string) {
    return this.shops.profile(shop);
  }
  @Get(':shop/products') products(
    @Param('shop') shop: string,
    @Query() query: ShopProductQueryDto,
  ) {
    return this.shops.products(shop, query);
  }
  @Get(':shop/auctions') auctions(@Param('shop') shop: string) {
    return this.shops.auctions(shop);
  }
}
