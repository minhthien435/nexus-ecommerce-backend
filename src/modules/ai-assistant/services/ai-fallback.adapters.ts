import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  AiModelClientApi,
  AiToolExecutorApi,
  AiUiActionGuardApi,
  type AiChatContext,
  type AiFunctionCall,
  type AiModelTurnRequest,
  type AiModelTurnResponse,
  type AiProductCard,
  type AiToolDeclaration,
  type AiToolExecutionResult,
  type AiUiAction,
  type AiUiActionVerifyOptions,
} from '../contracts/ai-assistant.types.js';

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

@Injectable()
export class PlaceholderAiModelClient extends AiModelClientApi {
  private readonly logger = new Logger(PlaceholderAiModelClient.name);

  async generateTurn(
    _request: AiModelTurnRequest,
  ): Promise<AiModelTurnResponse> {
    this.logger.warn(
      'PlaceholderAiModelClient invoked: GeminiClientService (BE-11) is not wired yet.',
    );
    throw new ServiceUnavailableException({
      errorCode: 'AI_UNAVAILABLE',
      message: 'Dịch vụ Trợ lý AI chưa được cấu hình mô hình Gemini.',
    });
  }
}

@Injectable()
export class PlaceholderAiToolExecutor extends AiToolExecutorApi {
  private readonly logger = new Logger(PlaceholderAiToolExecutor.name);

  getDeclarations(): readonly AiToolDeclaration[] {
    return [];
  }

  async execute(
    call: AiFunctionCall,
    _context: AiChatContext,
  ): Promise<AiToolExecutionResult> {
    this.logger.warn(
      `PlaceholderAiToolExecutor invoked for '${call.name}': ToolExecutorService (BE-08..BE-13) is not wired yet.`,
    );
    return {
      toolResult: {
        error: 'AI_TOOLS_NOT_CONFIGURED',
        items: [],
      },
      products: [],
    };
  }
}

@Injectable()
export class DefaultAiUiActionGuard extends AiUiActionGuardApi {
  private readonly logger = new Logger(DefaultAiUiActionGuard.name);

  async verifyAndBuildAction(
    rawActionCall: AiFunctionCall,
    observedProducts: AiProductCard[],
    options?: AiUiActionVerifyOptions,
  ): Promise<AiUiAction | null> {
    const args = rawActionCall.args ?? {};
    const actionType =
      typeof args.type === 'string' ? args.type.trim().toUpperCase() : '';

    switch (actionType) {
      case 'SHOW_PRODUCTS': {
        if (observedProducts.length === 0) return null;
        return { type: 'SHOW_PRODUCTS' };
      }

      case 'NAVIGATE': {
        const rawSlug =
          typeof args.slug === 'string' ? args.slug.trim().toLowerCase() : '';
        if (!rawSlug || !SLUG_PATTERN.test(rawSlug)) {
          this.logger.debug('Rejected NAVIGATE action without valid slug');
          return null;
        }
        const matched = observedProducts.find(
          (p) => p.slug.trim().toLowerCase() === rawSlug,
        );
        if (!matched) {
          this.logger.warn(
            `Blocked NAVIGATE action for unverified product slug '${rawSlug}'`,
          );
          return null;
        }
        return {
          type: 'NAVIGATE',
          slug: matched.slug,
          url: `/products/${encodeURIComponent(matched.slug)}`,
        };
      }

      case 'OPEN_SEARCH': {
        const rawQuery =
          typeof args.searchQuery === 'string'
            ? args.searchQuery.trim().slice(0, 200)
            : '';
        if (!rawQuery) return null;
        const params = new URLSearchParams({ q: rawQuery });
        if (
          typeof args.minPrice === 'number' &&
          Number.isFinite(args.minPrice) &&
          args.minPrice >= 0
        ) {
          params.set('minPrice', String(Math.floor(args.minPrice)));
        }
        if (
          typeof args.maxPrice === 'number' &&
          Number.isFinite(args.maxPrice) &&
          args.maxPrice > 0
        ) {
          params.set('maxPrice', String(Math.floor(args.maxPrice)));
        }
        return {
          type: 'OPEN_SEARCH',
          searchQuery: rawQuery,
          url: `/search?${params.toString()}`,
        };
      }

      case 'HANDOFF_TO_SHOP': {
        const rawProductSlug =
          typeof args.productSlug === 'string'
            ? args.productSlug.trim().toLowerCase()
            : typeof args.slug === 'string'
              ? args.slug.trim().toLowerCase()
              : '';
        if (rawProductSlug && !SLUG_PATTERN.test(rawProductSlug)) {
          return null;
        }
        const matchedProduct = rawProductSlug
          ? observedProducts.find(
              (p) => p.slug.trim().toLowerCase() === rawProductSlug,
            )
          : undefined;
        if (rawProductSlug && !matchedProduct) {
          this.logger.warn(
            `Blocked HANDOFF_TO_SHOP for unverified productSlug '${rawProductSlug}'`,
          );
          return null;
        }

        const rawShopSlug =
          typeof args.shopSlug === 'string'
            ? args.shopSlug.trim().toLowerCase()
            : '';
        const candidateShopSlug =
          rawShopSlug || matchedProduct?.shop?.slug?.trim().toLowerCase() || '';

        if (!candidateShopSlug || !SLUG_PATTERN.test(candidateShopSlug)) {
          this.logger.debug('Rejected HANDOFF_TO_SHOP without valid shopSlug');
          return null;
        }

        const allowedShopSlugs = new Set<string>(
          (options?.allowedShopSlugs ?? [])
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean),
        );
        for (const p of observedProducts) {
          const shopSlug = p.shop?.slug?.trim().toLowerCase();
          if (shopSlug) allowedShopSlugs.add(shopSlug);
        }

        if (!allowedShopSlugs.has(candidateShopSlug)) {
          this.logger.warn(
            `Blocked HANDOFF_TO_SHOP for unverified shopSlug '${candidateShopSlug}'`,
          );
          return null;
        }

        if (
          matchedProduct?.shop?.slug &&
          matchedProduct.shop.slug.trim().toLowerCase() !== candidateShopSlug
        ) {
          this.logger.warn(
            `Blocked HANDOFF_TO_SHOP because shopSlug '${candidateShopSlug}' does not match product '${matchedProduct.slug}'`,
          );
          return null;
        }

        return {
          type: 'HANDOFF_TO_SHOP',
          shopSlug: candidateShopSlug,
          ...(matchedProduct ? { productSlug: matchedProduct.slug } : {}),
        };
      }

      default:
        this.logger.debug(`Ignored unknown ui_action type '${actionType}'`);
        return null;
    }
  }
}
