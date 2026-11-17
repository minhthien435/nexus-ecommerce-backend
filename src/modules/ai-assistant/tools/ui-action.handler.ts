import { Injectable } from '@nestjs/common';
import type { FunctionDeclaration } from '@google/genai';
import type { AiAuctionCard } from '../contracts/ai-assistant.types.js';
import { optionalText, strictObject } from '../dtos/ai-chat.dto.js';
import type { AiProduct } from './search-products.tool.js';

export const UI_ACTION_DECLARATION: FunctionDeclaration = {
  name: 'ui_action',
  description:
    'Propose a UI action grounded in current tool results. Navigation requires explicit user request.',
  parametersJsonSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      type: {
        type: 'string',
        enum: [
          'SHOW_PRODUCTS',
          'SHOW_AUCTIONS',
          'NAVIGATE',
          'OPEN_SEARCH',
          'HANDOFF_TO_SHOP',
        ],
      },
      slug: { type: 'string' },
      slugs: {
        type: 'array',
        maxItems: 5,
        items: { type: 'string', maxLength: 200 },
        description:
          'For SHOW_PRODUCTS: optional list of exact product slugs from tool results that truly match the user request or image (pass [] if none match).',
      },
      auctionIdOrCode: {
        type: 'string',
        maxLength: 100,
        description:
          'For NAVIGATE to an auction: exact auction id or code (e.g. AUC-...) from current auction tool results.',
      },
      auctionIds: {
        type: 'array',
        maxItems: 5,
        items: { type: 'string', maxLength: 100 },
        description:
          'For SHOW_AUCTIONS: optional list of exact auction id/code values from current auction tool results (pass [] if none match).',
      },
      searchQuery: { type: 'string', maxLength: 200 },
      shopSlug: { type: 'string' },
      productSlug: { type: 'string' },
    },
    required: ['type'],
  },
};
export type UiAction =
  | { type: 'NAVIGATE' | 'OPEN_SEARCH'; url: string }
  | { type: 'SHOW_PRODUCTS' | 'SHOW_AUCTIONS' }
  | { type: 'HANDOFF_TO_SHOP'; shopSlug: string; productSlug?: string };

/** Conservative consent check uses the actual current user message, never model arguments. */
export function requestsNavigation(message: string): boolean {
  const text = message.trim().toLowerCase();
  if (/(không|đừng|chưa|do not|don't|never)/i.test(text)) return false;
  return /^(?:(?:hãy|vui lòng|làm ơn|please)\s+)?(?:mở(?:\s+(?:giúp|cho))?(?:\s+mình)?|dẫn\s+mình\s+(?:tới|đến)|đưa\s+mình\s+(?:tới|đến)|open|take me to)\s+(?:sản phẩm|trang|phiên(?:\s+đấu\s+giá)?|đấu\s+giá|product|the product|this product|that product|auction|the auction|this auction|that auction|đó|nó)/i.test(
    text,
  );
}

@Injectable()
export class UiActionHandler {
  execute(
    value: unknown,
    products: readonly AiProduct[],
    userMessage = '',
    auctions: readonly AiAuctionCard[] = [],
  ): UiAction | null {
    try {
      const args = strictObject(value, [
        'type',
        'slug',
        'slugs',
        'auctionIdOrCode',
        'auctionIds',
        'searchQuery',
        'shopSlug',
        'productSlug',
      ]);
      if (args.type === 'SHOW_PRODUCTS') {
        if (args.slugs === undefined) {
          return Object.keys(args).length === 1 && products.length
            ? { type: 'SHOW_PRODUCTS' }
            : null;
        }
        if (
          !Object.keys(args).every((key) => ['type', 'slugs'].includes(key)) ||
          !Array.isArray(args.slugs) ||
          args.slugs.length > 5 ||
          !args.slugs.every(
            (slug) =>
              typeof slug === 'string' &&
              /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug),
          )
        ) {
          return null;
        }
        const validSlugs = new Set(products.map((product) => product.slug));
        return args.slugs.some((slug) => validSlugs.has(slug))
          ? { type: 'SHOW_PRODUCTS' }
          : null;
      }
      if (args.type === 'SHOW_AUCTIONS') {
        if (args.auctionIds === undefined) {
          return Object.keys(args).length === 1 && auctions.length
            ? { type: 'SHOW_AUCTIONS' }
            : null;
        }
        if (
          !Object.keys(args).every((key) =>
            ['type', 'auctionIds'].includes(key),
          ) ||
          !Array.isArray(args.auctionIds) ||
          args.auctionIds.length > 5 ||
          !args.auctionIds.every(
            (item) =>
              typeof item === 'string' && /^[a-zA-Z0-9_-]{2,100}$/.test(item),
          )
        ) {
          return null;
        }
        return args.auctionIds.some((item) =>
          Boolean(this.findObservedAuction(item, auctions)),
        )
          ? { type: 'SHOW_AUCTIONS' }
          : null;
      }
      if (
        args.type === 'OPEN_SEARCH' &&
        Object.keys(args).every((key) => ['type', 'searchQuery'].includes(key))
      ) {
        const query = optionalText(args.searchQuery, 200);
        if (query)
          return {
            type: 'OPEN_SEARCH',
            url: '/search?q=' + encodeURIComponent(query),
          };
      }
      if (
        args.type === 'NAVIGATE' &&
        Object.keys(args).every((key) => ['type', 'slug'].includes(key)) &&
        requestsNavigation(userMessage) &&
        typeof args.slug === 'string' &&
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(args.slug) &&
        products.some((product) => product.slug === args.slug)
      )
        return { type: 'NAVIGATE', url: '/products/' + args.slug };
      if (
        args.type === 'NAVIGATE' &&
        Object.keys(args).every((key) =>
          ['type', 'auctionIdOrCode'].includes(key),
        ) &&
        requestsNavigation(userMessage) &&
        typeof args.auctionIdOrCode === 'string' &&
        /^[a-zA-Z0-9_-]{2,100}$/.test(args.auctionIdOrCode)
      ) {
        const matchedAuction = this.findObservedAuction(
          args.auctionIdOrCode,
          auctions,
        );
        if (matchedAuction) {
          return {
            type: 'NAVIGATE',
            url: '/auctions/' + (matchedAuction.code || matchedAuction.id),
          };
        }
      }
      if (
        args.type === 'HANDOFF_TO_SHOP' &&
        Object.keys(args).every((key) =>
          ['type', 'shopSlug', 'productSlug', 'slug'].includes(key),
        )
      ) {
        const productSlug = args.productSlug ?? args.slug;
        if (args.productSlug !== undefined && args.slug !== undefined)
          return null;
        const product = products.find(
          (item) =>
            (args.shopSlug === undefined || item.shop.slug === args.shopSlug) &&
            (productSlug === undefined || item.slug === productSlug),
        );
        if (
          !product ||
          (args.shopSlug === undefined && productSlug === undefined)
        )
          return null;
        return {
          type: 'HANDOFF_TO_SHOP',
          shopSlug: product.shop.slug,
          ...(productSlug === undefined ? {} : { productSlug: product.slug }),
        };
      }
    } catch {
      /* Invalid model output is not an HTTP error. */
    }
    return null;
  }

  private findObservedAuction(
    rawIdentifier: string,
    auctions: readonly AiAuctionCard[],
  ): AiAuctionCard | undefined {
    const normalized = rawIdentifier.trim().toLowerCase();
    return auctions.find(
      (auction) =>
        auction.id.toLowerCase() === normalized ||
        auction.auctionId.toLowerCase() === normalized ||
        (auction.code ? auction.code.toLowerCase() === normalized : false),
    );
  }
}
