import { Controller, Get, HttpStatus, Param, Query } from '@nestjs/common';
import { SearchProductsQueryDto } from '../dtos/search-products-query.dto.js';
import { ProductSearchService } from '../services/product-search.service.js';

@Controller('api/v1/catalog/products')
export class ProductController {
  constructor(private readonly products: ProductSearchService) {}

  @Get()
  async search(@Query() query: SearchProductsQueryDto) {
    const result = await this.products.search(query);
    return {
      success: true as const,
      statusCode: HttpStatus.OK,
      message: 'Lấy danh sách sản phẩm thành công',
      data: result.items,
      meta: result.meta,
    };
  }

  @Get(':slug')
  async getBySlug(@Param('slug') slug: string) {
    const result = await this.products.getBySlug(slug);
    return {
      success: true as const,
      statusCode: HttpStatus.OK,
      message: 'Lấy chi tiết sản phẩm thành công',
      data: result,
    };
  }
}
