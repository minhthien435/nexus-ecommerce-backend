import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { FunctionDeclaration } from '@google/genai';
import { strictObject } from '../dtos/ai-chat.dto.js';
import {
  TrendingProductsQuery,
  type AiActiveFlashDealInfo,
  type AiProductProjection,
} from '../queries/trending-products.query.js';
import { AiCacheService } from '../services/ai-cache.service.js';
import { AiReadTools, type KHOA_TOOLS } from './tool-executor.service.js';
import type { AiProduct } from './search-products.tool.js';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const slugSchema = {
  type: 'string',
  maxLength: 200,
  pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
};
const base = { type: 'object', additionalProperties: false } as const;

export const AI_READ_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'get_product_detail',
    description: 'Get current public details for one product slug.',
    parametersJsonSchema: {
      ...base,
      properties: { slug: slugSchema },
      required: ['slug'],
    },
  },
  {
    name: 'get_trending_products',
    description:
      'Get up to five products ranked by paid or fulfilled units in the last 30 days.',
    parametersJsonSchema: {
      ...base,
      properties: {
        categorySlug: slugSchema,
        limit: { type: 'integer', minimum: 1, maximum: 5 },
      },
    },
  },
  {
    name: 'compare_products',
    description:
      'Compare two to five current public products in the requested order.',
    parametersJsonSchema: {
      ...base,
      properties: {
        slugs: {
          type: 'array',
          minItems: 2,
          maxItems: 5,
          uniqueItems: true,
          items: slugSchema,
        },
      },
      required: ['slugs'],
    },
  },
  {
    name: 'get_price_insight',
    description:
      'Report only current active variant prices and current original-price discount facts.',
    parametersJsonSchema: {
      ...base,
      properties: { slug: slugSchema },
      required: ['slug'],
    },
  },
];

type ToolName = (typeof KHOA_TOOLS)[number];
type Cached = {
  result: unknown;
  products: AiProduct[];
  slugs: string[];
  hasFlashDeal?: boolean;
};

@Injectable()
export class AiReadToolsService extends AiReadTools {
  constructor(
    @Inject(TrendingProductsQuery)
    private readonly productsQuery: TrendingProductsQuery,
    @Inject(AiCacheService) private readonly cache: AiCacheService,
  ) {
    super();
  }

  async execute(
    name: ToolName,
    value: unknown,
  ): Promise<{ result: unknown; products: AiProduct[] }> {
    const args = validate(name, value);
    const key = this.cache.key(name, args);
    let cached: Cached | null = null;
    try {
      cached = await this.cache.get<Cached>(key);
    } catch {
      // Availability never depends on Redis or an alternate cache provider.
    }
    if (isCached(cached) && !cached.hasFlashDeal) {
      const visible = new Set(
        await this.productsQuery.visibleSlugs(cached.slugs),
      );
      if (cached.slugs.every((slug) => visible.has(slug)))
        return { result: cached.result, products: cached.products };
    }
    const { hasFlashDeal, ...response } = await this.run(name, args);
    if (!hasFlashDeal) {
      try {
        await this.cache.set(key, {
          ...response,
          slugs: response.products.map((product) => product.slug),
        });
      } catch {
        // Fail open.
      }
    }
    return response;
  }

  private async run(
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<{
    result: unknown;
    products: AiProduct[];
    hasFlashDeal: boolean;
  }> {
    if (name === 'get_trending_products') {
      const rows = await this.productsQuery.trending(
        args.categorySlug as string | undefined,
        (args.limit as number | undefined) ?? 5,
      );
      return {
        result: { windowDays: 30, products: rows.map(publicFacts) },
        products: rows.map(evidence),
        hasFlashDeal: rows.some((row) => Boolean(row.activeFlashDeal)),
      };
    }
    const slugs =
      name === 'compare_products'
        ? (args.slugs as string[])
        : [args.slug as string];
    const rows = await this.productsQuery.bySlugs(slugs);
    const hasFlashDeal = rows.some((row) => Boolean(row.activeFlashDeal));
    const found = new Map(rows.map((row) => [row.slug, row]));
    if (name === 'compare_products') {
      const items = slugs.map((slug) =>
        found.has(slug)
          ? { status: 'available', ...publicFacts(found.get(slug)!) }
          : { slug, status: 'not_found' },
      );
      return {
        result: { products: items },
        products: rows.map(evidence),
        hasFlashDeal,
      };
    }
    const row = rows[0];
    if (!row)
      return {
        result: { slug: slugs[0], status: 'not_found' },
        products: [],
        hasFlashDeal: false,
      };
    if (name === 'get_price_insight') {
      const flashDeal = formatFlashDeal(row.activeFlashDeal);
      if (flashDeal) {
        return {
          result: {
            slug: row.slug,
            basis: 'active_flash_deal',
            currency: row.currency,
            minPrice: row.minPrice,
            maxPrice: row.maxPrice,
            effectiveMinPrice: flashDeal.flashPrice,
            activeVariantCount: row.activeVariantCount,
            originalPrice: flashDeal.regularPrice,
            discountPercent: flashDeal.discountPercent,
            flashDeal,
          },
          products: [evidence(row)],
          hasFlashDeal: true,
        };
      }
      const discounted =
        row.originalPrice !== null &&
        Number(row.originalPrice) > Number(row.minPrice);
      return {
        result: {
          slug: row.slug,
          basis: 'current_active_variants',
          currency: row.currency,
          minPrice: row.minPrice,
          maxPrice: row.maxPrice,
          activeVariantCount: row.activeVariantCount,
          originalPrice: discounted ? row.originalPrice : null,
          discountPercent: discounted
            ? Math.round(
                (1 - Number(row.minPrice) / Number(row.originalPrice)) * 100,
              )
            : null,
        },
        products: [evidence(row)],
        hasFlashDeal: false,
      };
    }
    return {
      result: { status: 'available', ...publicFacts(row) },
      products: [evidence(row)],
      hasFlashDeal,
    };
  }
}

function validate(name: ToolName, value: unknown): Record<string, unknown> {
  const keys =
    name === 'get_trending_products'
      ? ['categorySlug', 'limit']
      : name === 'compare_products'
        ? ['slugs']
        : ['slug'];
  const args = strictObject(value, keys);
  if (name === 'get_trending_products') {
    if (args.categorySlug !== undefined) requireSlug(args.categorySlug);
    if (
      args.limit !== undefined &&
      (typeof args.limit !== 'number' ||
        !Number.isInteger(args.limit) ||
        args.limit < 1 ||
        args.limit > 5)
    )
      throw new BadRequestException('Invalid limit');
  } else if (name === 'compare_products') {
    if (
      !Array.isArray(args.slugs) ||
      args.slugs.length < 2 ||
      args.slugs.length > 5
    )
      throw new BadRequestException('Invalid slugs');
    args.slugs.forEach(requireSlug);
    if (new Set(args.slugs).size !== args.slugs.length)
      throw new BadRequestException('Duplicate slugs');
  } else requireSlug(args.slug);
  return args;
}

function requireSlug(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length > 200 || !SLUG.test(value))
    throw new BadRequestException('Invalid product slug');
}

function formatFlashDeal(deal: AiActiveFlashDealInfo | null | undefined) {
  if (!deal) return null;
  const endMs = new Date(deal.endsAt).getTime();
  const remainingSeconds = Number.isFinite(endMs)
    ? Math.max(0, Math.floor((endMs - Date.now()) / 1000))
    : 0;
  return {
    campaignTitle: deal.campaignTitle,
    flashPrice: deal.flashPrice,
    regularPrice: deal.regularPrice,
    discountPercent: Number(deal.discountPercent ?? 0),
    remainingQty: Number(deal.remainingQty ?? 0),
    maxPerBuyer: Number(deal.maxPerBuyer ?? 1),
    endsAt: Number.isFinite(endMs)
      ? new Date(endMs).toISOString()
      : String(deal.endsAt),
    remainingSeconds,
  };
}

function publicFacts(row: AiProductProjection) {
  const flashDeal = formatFlashDeal(row.activeFlashDeal);
  return {
    slug: row.slug,
    name: row.name,
    brand: row.brand,
    category: row.category,
    shop: row.shop,
    imageUrl: row.imageUrl,
    minPrice: row.minPrice,
    maxPrice: row.maxPrice,
    currency: row.currency,
    activeVariantCount: row.activeVariantCount,
    unitsSold: row.unitsSold,
    ...(flashDeal ? { flashDeal } : {}),
  };
}

function evidence(row: AiProductProjection): AiProduct {
  const flashDeal = formatFlashDeal(row.activeFlashDeal);
  if (flashDeal) {
    return {
      slug: row.slug,
      name: row.name,
      minPrice: flashDeal.flashPrice,
      originalPrice:
        Number(flashDeal.regularPrice) > Number(flashDeal.flashPrice)
          ? flashDeal.regularPrice
          : row.originalPrice,
      unitsSold: row.unitsSold,
      shop: row.shop,
      imageUrl: row.imageUrl,
    };
  }
  return {
    slug: row.slug,
    name: row.name,
    minPrice: row.minPrice,
    originalPrice: row.originalPrice,
    unitsSold: row.unitsSold,
    shop: row.shop,
    imageUrl: row.imageUrl,
  };
}

function isCached(value: unknown): value is Cached {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<Cached>;
  return (
    Array.isArray(candidate.slugs) &&
    candidate.slugs.length <= 5 &&
    candidate.slugs.every(
      (slug) => typeof slug === 'string' && SLUG.test(slug),
    ) &&
    Array.isArray(candidate.products) &&
    candidate.products.length <= 5 &&
    candidate.products.every(isAiProduct)
  );
}

function isAiProduct(value: unknown): value is AiProduct {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const product = value as Partial<AiProduct>;
  return (
    typeof product.slug === 'string' &&
    SLUG.test(product.slug) &&
    typeof product.name === 'string' &&
    typeof product.minPrice === 'string' &&
    (product.originalPrice === null ||
      typeof product.originalPrice === 'string') &&
    typeof product.unitsSold === 'number' &&
    (product.imageUrl === null || typeof product.imageUrl === 'string') &&
    !!product.shop &&
    typeof product.shop.name === 'string' &&
    typeof product.shop.slug === 'string'
  );
}
