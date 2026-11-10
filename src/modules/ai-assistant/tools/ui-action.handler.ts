import { BadRequestException, Injectable } from '@nestjs/common';
import type { FunctionDeclaration } from '@google/genai';
import { optionalText, strictObject } from '../dtos/ai-chat.dto.js';
import type { AiProduct } from './search-products.tool.js';

export const UI_ACTION_DECLARATION: FunctionDeclaration = {
  name: 'ui_action',
  description: 'Navigate to a product returned by search in this request.',
  parametersJsonSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      type: {
        type: 'string',
        enum: ['NAVIGATE', 'SHOW_PRODUCTS', 'OPEN_SEARCH'],
      },
      slug: { type: 'string' },
      searchQuery: { type: 'string', maxLength: 200 },
    },
    required: ['type'],
  },
};
export type UiAction =
  { type: 'NAVIGATE' | 'OPEN_SEARCH'; url: string } | { type: 'SHOW_PRODUCTS' };

@Injectable()
export class UiActionHandler {
  /** Evidence must come from this request's server-side tool results, never client/model context. */
  execute(value: unknown, requestProducts: readonly AiProduct[]): UiAction {
    const args = strictObject(value, ['type', 'slug', 'searchQuery']);
    if (
      args.type === 'SHOW_PRODUCTS' &&
      args.slug === undefined &&
      args.searchQuery === undefined &&
      requestProducts.length > 0
    )
      return { type: 'SHOW_PRODUCTS' };
    if (args.type === 'OPEN_SEARCH' && args.slug === undefined) {
      const query = optionalText(args.searchQuery, 200);
      if (query)
        return {
          type: 'OPEN_SEARCH',
          url: `/search?q=${encodeURIComponent(query)}`,
        };
    }
    if (
      args.type !== 'NAVIGATE' ||
      args.searchQuery !== undefined ||
      typeof args.slug !== 'string' ||
      args.slug.length > 200 ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(args.slug) ||
      !requestProducts.some((product) => product.slug === args.slug)
    ) {
      throw new BadRequestException(
        'Navigation requires a product from this request',
      );
    }
    return { type: 'NAVIGATE', url: `/products/${args.slug}` };
  }
}
