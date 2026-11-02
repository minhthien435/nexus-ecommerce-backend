import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  SearchProductsQueryDto,
  type ProductSort,
} from '../dtos/search-products-query.dto.js';
import { CatalogCacheService } from './catalog-cache.service.js';

type ProductListRow = {
  id: string;
  category_id: string;
  name: string;
  slug: string;
  brand: string | null;
  is_auction_eligible: boolean;
  created_at: Date | string;
  default_sku_id: string | null;
  min_price: string | null;
  currency: string | null;
  primary_image_url: string | null;
  cat_id: string | null;
  cat_name: string | null;
  cat_slug: string | null;
};

type CountRow = { total: string };
type CategoryFacetRow = {
  id: string;
  name: string;
  slug: string;
  count: string;
};

type ProductCategory = { id: string; name: string; slug: string };

export type ProductListItem = {
  id: string;
  categoryId: string;
  name: string;
  slug: string;
  brand: string | null;
  isAuctionEligible: boolean;
  defaultSkuId: string | null;
  minimumPrice: string | null;
  currency: string | null;
  primaryImageUrl: string | null;
  createdAt: Date | string;
  category: ProductCategory | null;
};

export type ProductSearchPage = {
  items: ProductListItem[];
  meta: {
    page: number;
    limit: number;
    totalItems: number;
    totalPages: number;
  };
  facets: { categories: Array<ProductCategory & { count: number }> };
};

export type ProductDetail = {
  id: string;
  sellerId: string;
  shopId: string | null;
  shopSlug: string | null;
  categoryId: string;
  name: string;
  slug: string;
  description: string | null;
  brand: string | null;
  isAuctionEligible: boolean;
  attributes: Record<string, unknown> | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  category: ProductCategory | null;
  images: Array<{
    id: string;
    url: string;
    sortOrder: number;
    isPrimary: boolean;
  }>;
  skus: Array<{
    id: string;
    skuCode: string;
    variantAttributes: Record<string, unknown> | null;
    price: string;
    originalPrice: string | null;
    currency: string;
    availableQuantity: number;
  }>;
};

const SORT_SQL: Record<ProductSort, string> = {
  newest: 'p.created_at DESC, p.id ASC',
  price_asc: 'price.min_price ASC NULLS LAST, p.id ASC',
  price_desc: 'price.min_price DESC NULLS LAST, p.id ASC',
};

@Injectable()
export class ProductSearchService {
  private unaccentSupport: Promise<boolean> | undefined;

  constructor(
    private readonly dataSource: DataSource,
    private readonly cache: CatalogCacheService,
  ) {}

  async search(query: SearchProductsQueryDto): Promise<ProductSearchPage> {
    if (
      query.minPrice !== undefined &&
      query.maxPrice !== undefined &&
      query.minPrice > query.maxPrice
    ) {
      throw new BadRequestException(
        'minPrice must be less than or equal to maxPrice',
      );
    }

    const normalized = this.normalizeQuery(query);
    const cacheKey = this.cache.searchKey(normalized);
    const cached = await this.cache.get<ProductSearchPage>(cacheKey);
    if (cached) return cached;

    const useUnaccent =
      Boolean(normalized.keyword) && (await this.hasUnaccent());
    const result = await this.runSearch(normalized, useUnaccent);
    await this.cache.set(cacheKey, result);
    return result;
  }

  async getBySlug(slug: string): Promise<ProductDetail> {
    const normalizedSlug = slug.trim().toLowerCase();
    const cacheKey = this.cache.detailKey(normalizedSlug);
    const cached = await this.cache.get<ProductDetail>(cacheKey);
    if (cached) return cached;

    const products = await this.dataSource.query<
      Array<{
        id: string;
        seller_id: string;
        shop_id: string | null;
        shop_slug: string | null;
        category_id: string;
        name: string;
        slug: string;
        description: string | null;
        brand: string | null;
        is_auction_eligible: boolean;
        attributes: Record<string, unknown> | null;
        created_at: Date | string;
        updated_at: Date | string;
        cat_id: string | null;
        cat_name: string | null;
        cat_slug: string | null;
      }>
    >(
      `SELECT p.id, p.seller_id, shop.id AS shop_id, shop.slug AS shop_slug,
              p.category_id, p.name, p.slug,
              p.description, p.brand, p.is_auction_eligible, p.attributes,
              p.created_at, p.updated_at,
              c.id AS cat_id, c.name AS cat_name, c.slug AS cat_slug
         FROM catalog.products p
         LEFT JOIN catalog.categories c
           ON c.id = p.category_id AND c.is_active = true AND c.deleted_at IS NULL
         LEFT JOIN identity.shops shop
           ON shop.id = p.shop_id AND shop.status = 'ACTIVE' AND shop.deleted_at IS NULL
        WHERE p.slug = $1
          AND p.status = 'ACTIVE'
          AND p.deleted_at IS NULL
        LIMIT 1`,
      [normalizedSlug],
    );
    const product = products[0];
    if (!product) throw new NotFoundException('Product not found');

    const [images, skus] = await Promise.all([
      this.dataSource.query<
        Array<{
          id: string;
          url: string;
          sort_order: number;
          is_primary: boolean;
        }>
      >(
        `SELECT id, url, sort_order, is_primary
           FROM catalog.product_images
          WHERE product_id = $1
          ORDER BY is_primary DESC, sort_order ASC, id ASC`,
        [product.id],
      ),
      this.dataSource.query<
        Array<{
          id: string;
          sku_code: string;
          variant_attributes: Record<string, unknown> | null;
          price: string;
          original_price: string | null;
          currency: string;
          available_quantity: string;
        }>
      >(
        `SELECT s.id, s.sku_code, s.variant_attributes, s.price::text,
                s.original_price::text,
                trim(s.currency) AS currency,
                SUM(i.available_qty)::text AS available_quantity
           FROM catalog.product_skus s
           JOIN fulfillment.inventory_items i ON i.sku_id = s.id
          WHERE s.product_id = $1
            AND s.is_active = true
          GROUP BY s.id
         HAVING SUM(i.available_qty) > 0
          ORDER BY s.price ASC, s.id ASC`,
        [product.id],
      ),
    ]);

    const detail: ProductDetail = {
      id: product.id,
      sellerId: product.seller_id,
      shopId: product.shop_id,
      shopSlug: product.shop_slug,
      categoryId: product.category_id,
      name: product.name,
      slug: product.slug,
      description: product.description,
      brand: product.brand,
      isAuctionEligible: product.is_auction_eligible,
      attributes: product.attributes,
      createdAt: product.created_at,
      updatedAt: product.updated_at,
      category: this.toCategory(product),
      images: images.map((image) => ({
        id: image.id,
        url: image.url,
        sortOrder: image.sort_order,
        isPrimary: image.is_primary,
      })),
      skus: skus.map((sku) => ({
        id: sku.id,
        skuCode: sku.sku_code,
        variantAttributes: sku.variant_attributes,
        price: sku.price,
        originalPrice: sku.original_price,
        currency: sku.currency,
        availableQuantity: Number(sku.available_quantity),
      })),
    };
    await this.cache.set(cacheKey, detail);
    return detail;
  }

  private async runSearch(
    query: ReturnType<ProductSearchService['normalizeQuery']>,
    useUnaccent: boolean,
  ): Promise<ProductSearchPage> {
    const categoryCte = `WITH RECURSIVE category_tree AS (
      SELECT id FROM catalog.categories
       WHERE id = $1::uuid AND is_active = true AND deleted_at IS NULL
      UNION ALL
      SELECT child.id FROM catalog.categories child
      JOIN category_tree parent ON child.parent_id = parent.id
       WHERE child.is_active = true AND child.deleted_at IS NULL
    )`;
    const textExpression = useUnaccent
      ? `unaccent(lower(p.name || ' ' || COALESCE(p.brand, '') || ' ' || COALESCE(p.description, ''))) LIKE unaccent(lower($2)) ESCAPE '\\'`
      : `lower(p.name || ' ' || COALESCE(p.brand, '') || ' ' || COALESCE(p.description, '')) LIKE lower($2) ESCAPE '\\'`;
    const where = `p.status = 'ACTIVE'
      AND p.deleted_at IS NULL
      AND ($1::uuid IS NULL OR p.category_id IN (SELECT id FROM category_tree))
      AND ($2::text IS NULL OR ${textExpression})
      AND ($3::text IS NULL OR lower(p.brand) = lower($3))
      AND ($4::numeric IS NULL OR price.min_price >= $4)
      AND ($5::numeric IS NULL OR price.min_price <= $5)`;
    const priceJoin = `LEFT JOIN LATERAL (
      SELECT s.id AS default_sku_id,
             s.price AS min_price,
             trim(s.currency) AS currency
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
    ) price ON true`;
    const baseParameters = [
      query.categoryId,
      query.keyword ? `%${this.escapeLike(query.keyword)}%` : null,
      query.brand,
      query.minPrice,
      query.maxPrice,
    ];
    const rankNameExpression = useUnaccent
      ? `unaccent(lower(regexp_replace(p.name, '[^[:alnum:]]+', ' ', 'g')))`
      : `lower(regexp_replace(p.name, '[^[:alnum:]]+', ' ', 'g'))`;
    const rankKeywordExpression = useUnaccent
      ? `unaccent(lower($8))`
      : `lower($8)`;
    const nameContainsExpression = useUnaccent
      ? `unaccent(lower(p.name)) LIKE unaccent(lower($2)) ESCAPE '\\'`
      : `lower(p.name) LIKE lower($2) ESCAPE '\\'`;
    const brandContainsExpression = useUnaccent
      ? `unaccent(lower(COALESCE(p.brand, ''))) LIKE unaccent(lower($2)) ESCAPE '\\'`
      : `lower(COALESCE(p.brand, '')) LIKE lower($2) ESCAPE '\\'`;
    const relevanceOrder = query.keyword
      ? `CASE
           WHEN ${rankNameExpression} = ${rankKeywordExpression}
             OR (' ' || ${rankNameExpression} || ' ') LIKE ('% ' || ${rankKeywordExpression} || ' %') THEN 0
           WHEN ${nameContainsExpression} THEN 1
           WHEN ${brandContainsExpression} THEN 2
           ELSE 3
         END ASC, `
      : '';
    const rowParameters = [
      ...baseParameters,
      query.limit,
      (query.page - 1) * query.limit,
      ...(query.keyword ? [query.keyword] : []),
    ];
    const rows = await this.dataSource.query<ProductListRow[]>(
      `${categoryCte}
       SELECT p.id, p.category_id, p.name, p.slug, p.brand,
               p.is_auction_eligible, p.created_at, price.default_sku_id,
               price.min_price::text, price.currency, image.url AS primary_image_url,
               c.id AS cat_id, c.name AS cat_name, c.slug AS cat_slug
         FROM catalog.products p
         LEFT JOIN catalog.categories c
           ON c.id = p.category_id AND c.is_active = true AND c.deleted_at IS NULL
         ${priceJoin}
         LEFT JOIN LATERAL (
           SELECT pi.url FROM catalog.product_images pi
            WHERE pi.product_id = p.id
            ORDER BY pi.is_primary DESC, pi.sort_order ASC, pi.id ASC
            LIMIT 1
         ) image ON true
        WHERE ${where}
        ORDER BY ${relevanceOrder}${SORT_SQL[query.sort]}
        LIMIT $6 OFFSET $7`,
      rowParameters,
    );
    const facets = await this.dataSource.query<CategoryFacetRow[]>(
      `${categoryCte}
       SELECT c.id, c.name, c.slug, COUNT(p.id)::text AS count
         FROM catalog.products p
         ${priceJoin}
         JOIN catalog.categories c
           ON c.id = p.category_id AND c.is_active = true AND c.deleted_at IS NULL
        WHERE ${where}
        GROUP BY c.id, c.name, c.slug
        ORDER BY COUNT(p.id) DESC, c.name ASC, c.id ASC`,
      baseParameters,
    );
    const counts = await this.dataSource.query<CountRow[]>(
      `${categoryCte}
       SELECT COUNT(*)::text AS total
         FROM catalog.products p
         ${priceJoin}
        WHERE ${where}`,
      baseParameters,
    );
    const totalItems = Number(counts[0]?.total ?? 0);
    return {
      items: rows.map((row) => ({
        id: row.id,
        categoryId: row.category_id,
        name: row.name,
        slug: row.slug,
        brand: row.brand,
        isAuctionEligible: row.is_auction_eligible,
        defaultSkuId: row.default_sku_id,
        minimumPrice: row.min_price,
        currency: row.currency,
        primaryImageUrl: row.primary_image_url,
        createdAt: row.created_at,
        category: this.toCategory(row),
      })),
      meta: {
        page: query.page,
        limit: query.limit,
        totalItems,
        totalPages: Math.ceil(totalItems / query.limit),
      },
      facets: {
        categories: facets.map((facet) => ({
          id: facet.id,
          name: facet.name,
          slug: facet.slug,
          count: Number(facet.count),
        })),
      },
    };
  }

  private normalizeQuery(query: SearchProductsQueryDto) {
    return {
      keyword: query.keyword || null,
      categoryId: query.categoryId || null,
      minPrice: query.minPrice ?? null,
      maxPrice: query.maxPrice ?? null,
      brand: query.brand || null,
      sort: query.sort,
      page: query.page,
      limit: query.limit,
    };
  }

  private async hasUnaccent(): Promise<boolean> {
    this.unaccentSupport ??= this.dataSource
      .query<Array<{ available: boolean }>>(
        `SELECT to_regprocedure('unaccent(text)') IS NOT NULL AS available`,
      )
      .then((rows) => rows[0]?.available === true)
      .catch(() => false);
    return this.unaccentSupport;
  }

  private escapeLike(value: string): string {
    return value
      .replaceAll('\\', '\\\\')
      .replaceAll('%', '\\%')
      .replaceAll('_', '\\_');
  }

  private toCategory(row: {
    cat_id: string | null;
    cat_name: string | null;
    cat_slug: string | null;
  }): ProductCategory | null {
    return row.cat_id && row.cat_name && row.cat_slug
      ? { id: row.cat_id, name: row.cat_name, slug: row.cat_slug }
      : null;
  }
}
