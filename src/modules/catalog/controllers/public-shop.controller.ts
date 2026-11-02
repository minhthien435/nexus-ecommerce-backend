import { Controller, Get, Param, Query } from '@nestjs/common';
import { ShopProductQueryDto } from '../dtos/shop-product-query.dto.js';
import { PublicShopService } from '../services/public-shop.service.js';

@Controller('api/v1/catalog/shops')
export class PublicShopController {
  constructor(private readonly shops: PublicShopService) {}
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
