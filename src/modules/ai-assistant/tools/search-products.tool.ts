import { DataSource } from 'typeorm';
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
  slug: string;
  name: string;
  minPrice: string;
  originalPrice: string | null;
  unitsSold: number;
  shop: { name: string; slug: string };
  imageUrl: string | null;
};

@Injectable()
export class SearchProductsTool {
  private unaccentSupport: Promise<boolean> | undefined;

  constructor(
    @Inject(ProductSearchService)
    private readonly catalog: ProductSearchService,
    @Inject(CategoryService) private readonly categories: CategoryService,
    @Inject(DataSource) private readonly dataSource: DataSource,
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
    const page = await this.catalog.search(query, { activeShopOnly: true });
    const candidates = page.items.slice(0, query.limit);
    if (!candidates.length) {
      const tokens = this.tokenizeKeyword(query.keyword);
      if (tokens.length < 2) return [];
      return this.searchByTokens(query, tokens);
    }
    // Recheck cached catalog results against current DB state; never expose internal IDs.
    const rows = await this.dataSource.query<
      Array<AiProduct & { unitsSold: string | number }>
    >(
      `SELECT p.slug, p.name, image.url AS "imageUrl", sku.price::text AS "minPrice",
              sku.original_price::text AS "originalPrice",
              COALESCE(sold.units_sold, 0)::text AS "unitsSold",
              json_build_object('name', shop.name, 'slug', shop.slug) AS shop
         FROM catalog.products p
         JOIN identity.shops shop
           ON (shop.id = p.shop_id OR (p.shop_id IS NULL AND shop.seller_id = p.seller_id))
          AND shop.status = 'ACTIVE' AND shop.deleted_at IS NULL
         JOIN catalog.product_skus sku ON sku.id = ANY($2::uuid[]) AND sku.product_id = p.id AND sku.is_active = true
         LEFT JOIN LATERAL (
           SELECT i.url FROM catalog.product_images i WHERE i.product_id = p.id
           ORDER BY i.is_primary DESC, i.sort_order ASC, i.id ASC LIMIT 1
         ) image ON true
         LEFT JOIN LATERAL (
           SELECT SUM(oi.quantity) AS units_sold FROM commerce.order_items oi
           JOIN commerce.orders o ON o.id = oi.order_id
           WHERE oi.product_id = p.id AND o.status IN ('PAID','PROCESSING','SHIPPED','DELIVERED','COMPLETED')
         ) sold ON true
        WHERE p.id = ANY($1::uuid[]) AND p.status = 'ACTIVE' AND p.deleted_at IS NULL
          AND ($4::numeric IS NULL OR sku.price >= $4) AND ($5::numeric IS NULL OR sku.price <= $5)
        ORDER BY array_position($1::uuid[], p.id) LIMIT $3`,
      [
        candidates.map((item) => item.id),
        candidates.map((item) => item.defaultSkuId).filter(Boolean),
        query.limit,
        query.minPrice ?? null,
        query.maxPrice ?? null,
      ],
    );
    return this.mapProductRows(rows);
  }

  private async searchByTokens(
    query: SearchProductsQueryDto,
    tokens: string[],
  ): Promise<AiProduct[]> {
    const useUnaccent = await this.hasUnaccent();
    const searchableExpr = useUnaccent
      ? `unaccent(lower(p.name || ' ' || COALESCE(p.brand, '') || ' ' || COALESCE(p.description, '')))`
      : `lower(p.name || ' ' || COALESCE(p.brand, '') || ' ' || COALESCE(p.description, ''))`;
    const nameExpr = useUnaccent ? `unaccent(lower(p.name))` : `lower(p.name)`;
    const paramOffset = 5;
    const tokenConditions = tokens
      .map((_, i) => {
        const param = `$${paramOffset + i}`;
        const patternExpr = useUnaccent
          ? `unaccent(lower(${param}))`
          : `lower(${param})`;
        return `${searchableExpr} LIKE ${patternExpr} ESCAPE '\\'`;
      })
      .join(' AND ');
    const nameMatchScore = tokens
      .map((_, i) => {
        const param = `$${paramOffset + i}`;
        const patternExpr = useUnaccent
          ? `unaccent(lower(${param}))`
          : `lower(${param})`;
        return `CASE WHEN ${nameExpr} LIKE ${patternExpr} ESCAPE '\\' THEN 1 ELSE 0 END`;
      })
      .join(' + ');
    const tieBreakSort =
      query.sort === 'price_asc'
        ? 'sku.price ASC, p.id ASC'
        : query.sort === 'price_desc'
          ? 'sku.price DESC, p.id ASC'
          : 'p.created_at DESC, p.id ASC';

    const rows = await this.dataSource.query<
      Array<AiProduct & { unitsSold: string | number }>
    >(
      `WITH RECURSIVE category_tree AS (
        SELECT id FROM catalog.categories
         WHERE id = $1::uuid AND is_active = true AND deleted_at IS NULL
        UNION ALL
        SELECT child.id FROM catalog.categories child
        JOIN category_tree parent ON child.parent_id = parent.id
         WHERE child.is_active = true AND child.deleted_at IS NULL
      )
      SELECT p.slug, p.name, image.url AS "imageUrl", sku.price::text AS "minPrice",
             sku.original_price::text AS "originalPrice",
             COALESCE(sold.units_sold, 0)::text AS "unitsSold",
             json_build_object('name', shop.name, 'slug', shop.slug) AS shop
        FROM catalog.products p
        JOIN identity.shops shop
          ON (shop.id = p.shop_id OR (p.shop_id IS NULL AND shop.seller_id = p.seller_id))
         AND shop.status = 'ACTIVE' AND shop.deleted_at IS NULL
        JOIN LATERAL (
          SELECT s.id, s.price, s.original_price
            FROM catalog.product_skus s
            JOIN fulfillment.inventory_items i ON i.sku_id = s.id
            JOIN fulfillment.warehouses w
              ON w.id = i.warehouse_id
             AND w.is_default = true
             AND w.is_active = true
             AND NOT EXISTS (
               SELECT 1
                 FROM fulfillment.warehouses other
                WHERE other.is_default = true
                  AND other.is_active = true
                  AND other.id <> w.id
             )
           WHERE s.product_id = p.id
             AND s.is_active = true
           GROUP BY s.id
          HAVING SUM(i.available_qty) > 0
           ORDER BY s.price ASC, s.id ASC
           LIMIT 1
        ) sku ON true
        LEFT JOIN LATERAL (
          SELECT i.url FROM catalog.product_images i WHERE i.product_id = p.id
          ORDER BY i.is_primary DESC, i.sort_order ASC, i.id ASC LIMIT 1
        ) image ON true
        LEFT JOIN LATERAL (
          SELECT SUM(oi.quantity) AS units_sold FROM commerce.order_items oi
          JOIN commerce.orders o ON o.id = oi.order_id
          WHERE oi.product_id = p.id AND o.status IN ('PAID','PROCESSING','SHIPPED','DELIVERED','COMPLETED')
        ) sold ON true
       WHERE p.status = 'ACTIVE' AND p.deleted_at IS NULL
         AND ($1::uuid IS NULL OR p.category_id IN (SELECT id FROM category_tree))
         AND ($2::numeric IS NULL OR sku.price >= $2)
         AND ($3::numeric IS NULL OR sku.price <= $3)
         AND ${tokenConditions}
       ORDER BY (${nameMatchScore}) DESC, ${tieBreakSort}
       LIMIT $4`,
      [
        query.categoryId ?? null,
        query.minPrice ?? null,
        query.maxPrice ?? null,
        query.limit,
        ...tokens.map((token) => `%${this.escapeLike(token)}%`),
      ],
    );
    return this.mapProductRows(rows);
  }

  private mapProductRows(
    rows: Array<AiProduct & { unitsSold: string | number }> | undefined,
  ): AiProduct[] {
    if (!Array.isArray(rows)) return [];
    return rows.map((row) => ({
      slug: row.slug,
      name: row.name,
      imageUrl: row.imageUrl,
      minPrice: row.minPrice,
      originalPrice: row.originalPrice,
      unitsSold: Number(row.unitsSold),
      shop: row.shop,
    }));
  }

  private tokenizeKeyword(keyword: string): string[] {
    const rawTokens = keyword
      .trim()
      .split(/[\s,.;:/\\|+-]+/)
      .map((part) => part.trim())
      .filter((part) => /[\p{L}\p{N}]/u.test(part));
    const unique: string[] = [];
    const seen = new Set<string>();
    for (const token of rawTokens) {
      const normalized = token.toLowerCase();
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      unique.push(token);
      if (unique.length >= 6) break;
    }
    return unique;
  }

  private escapeLike(value: string): string {
    return value
      .replaceAll('\\', '\\\\')
      .replaceAll('%', '\\%')
      .replaceAll('_', '\\_');
  }

  private async hasUnaccent(): Promise<boolean> {
    this.unaccentSupport ??= this.dataSource
      .query<Array<{ available: boolean }>>(
        `SELECT to_regprocedure('unaccent(text)') IS NOT NULL AS available`,
      )
      .then((rows) => Array.isArray(rows) && rows[0]?.available === true)
      .catch(() => false);
    return this.unaccentSupport;
  }
}
