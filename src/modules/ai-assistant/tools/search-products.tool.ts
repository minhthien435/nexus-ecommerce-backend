import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { FunctionDeclaration } from '@google/genai';
import { CategoryService } from '../../catalog/services/category.service.js';
import { ProductSearchService } from '../../catalog/services/product-search.service.js';
import { SearchProductsQueryDto } from '../../catalog/dtos/search-products-query.dto.js';
import { optionalText, strictObject } from '../dtos/ai-chat.dto.js';

export const SEARCH_PRODUCTS_DECLARATION: FunctionDeclaration = {
  name: 'search_products',
  description:
    'Find up to five active catalog products. Only these database results are product evidence.',
  parametersJsonSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      query: { type: 'string', maxLength: 200 },
      categorySlug: { type: 'string', maxLength: 200 },
      limit: { type: 'integer', minimum: 1, maximum: 5 },
      minPrice: { type: 'number', minimum: 0 },
      maxPrice: { type: 'number', minimum: 0 },
      sort: {
        type: 'string',
        enum: ['relevance', 'newest', 'price_asc', 'price_desc'],
      },
    },
    required: ['query'],
  },
};

export type AiProduct = {
  id: string;
  slug: string;
  name: string;
  minPrice: string | null;
  currency: string | null;
  imageUrl: string | null;
};

@Injectable()
export class SearchProductsTool {
  constructor(
    @Inject(ProductSearchService)
    private readonly catalog: ProductSearchService,
    @Inject(CategoryService) private readonly categories: CategoryService,
  ) {}

  async execute(argumentsValue: unknown): Promise<AiProduct[]> {
    const args = strictObject(argumentsValue, [
      'query',
      'categorySlug',
      'limit',
      'minPrice',
      'maxPrice',
      'sort',
    ]);
    const query = new SearchProductsQueryDto();
    query.keyword = optionalText(args.query, 200);
    if (!query.keyword) throw new BadRequestException('query is required');
    if (
      args.limit !== undefined &&
      (typeof args.limit !== 'number' ||
        !Number.isInteger(args.limit) ||
        args.limit < 1 ||
        args.limit > 5)
    )
      throw new BadRequestException('Invalid limit');
    const categorySlug = optionalText(args.categorySlug, 200);
    if (categorySlug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(categorySlug))
      throw new BadRequestException('Invalid category slug');
    for (const key of ['minPrice', 'maxPrice'] as const) {
      const price = args[key];
      if (price !== undefined) {
        if (
          typeof price !== 'number' ||
          !Number.isFinite(price) ||
          price < 0 ||
          price > 1e12 ||
          Math.abs(price * 100 - Math.round(price * 100)) > 0.001
        )
          throw new BadRequestException('Invalid price');
        query[key] = price;
      }
    }
    if (
      query.minPrice !== undefined &&
      query.maxPrice !== undefined &&
      query.minPrice > query.maxPrice
    )
      throw new BadRequestException('Invalid price range');
    if (
      args.sort !== undefined &&
      !['relevance', 'newest', 'price_asc', 'price_desc'].includes(
        args.sort as string,
      )
    )
      throw new BadRequestException('Invalid sort');
    // Catalog already ranks keyword matches ahead of the selected tie-break sort.
    query.sort =
      args.sort === undefined || args.sort === 'relevance'
        ? 'newest'
        : (args.sort as SearchProductsQueryDto['sort']);
    query.page = 1;
    query.limit = args.limit === undefined ? 5 : args.limit;
    if (categorySlug) {
      const category = await this.categories.getBySlug(categorySlug);
      if (!category.isActive)
        throw new BadRequestException('Inactive category');
      query.categoryId = category.id;
    }
    const page = await this.catalog.search(query);
    return page.items.slice(0, query.limit).map((item) => ({
      id: item.id,
      slug: item.slug,
      name: item.name,
      minPrice: item.minimumPrice,
      currency: item.currency,
      imageUrl: item.primaryImageUrl,
    }));
  }
}
