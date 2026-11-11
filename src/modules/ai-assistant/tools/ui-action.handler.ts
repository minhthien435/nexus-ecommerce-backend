import { Injectable } from '@nestjs/common';
import type { FunctionDeclaration } from '@google/genai';
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
        enum: ['SHOW_PRODUCTS', 'NAVIGATE', 'OPEN_SEARCH', 'HANDOFF_TO_SHOP'],
      },
      slug: { type: 'string' },
      searchQuery: { type: 'string', maxLength: 200 },
      shopSlug: { type: 'string' },
      productSlug: { type: 'string' },
    },
    required: ['type'],
  },
};
export type UiAction =
  | { type: 'NAVIGATE' | 'OPEN_SEARCH'; url: string }
  | { type: 'SHOW_PRODUCTS' }
  | { type: 'HANDOFF_TO_SHOP'; shopSlug: string; productSlug?: string };

/** Conservative consent check uses the actual current user message, never model arguments. */
export function requestsNavigation(message: string): boolean {
  const text = message.trim().toLowerCase();
  if (/(không|đừng|chưa|do not|don't|never)/i.test(text)) return false;
  return /^(?:(?:hãy|vui lòng|làm ơn|please)\s+)?(?:mở(?:\s+(?:giúp|cho))?(?:\s+mình)?|dẫn\s+mình\s+(?:tới|đến)|đưa\s+mình\s+(?:tới|đến)|open|take me to)\s+(?:sản phẩm|trang|product|the product|this product|that product|đó|nó)/i.test(
    text,
  );
}

@Injectable()
export class UiActionHandler {
  execute(
    value: unknown,
    products: readonly AiProduct[],
    userMessage = '',
  ): UiAction | null {
    try {
      const args = strictObject(value, [
        'type',
        'slug',
        'searchQuery',
        'shopSlug',
        'productSlug',
      ]);
      if (
        args.type === 'SHOW_PRODUCTS' &&
        Object.keys(args).length === 1 &&
        products.length
      )
        return { type: 'SHOW_PRODUCTS' };
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
}
