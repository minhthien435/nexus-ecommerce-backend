import { AsyncLocalStorage } from 'node:async_hooks';
import {
  HttpException,
  Inject,
  Injectable,
  Optional,
  type ExecutionContext,
} from '@nestjs/common';
import type { Content, FunctionDeclaration, Part } from '@google/genai';
import {
  AiAccessPolicy,
  AiOrchestrator,
  type AiChatResult,
} from '../ai-orchestrator.contract.js';
import {
  AiModelClientApi,
  AiToolExecutorApi,
  AiUiActionGuardApi,
  type AiChatContext,
  type AiFunctionCall,
  type AiImageInput,
  type AiModelTurnRequest,
  type AiModelTurnResponse,
  type AiProductCard,
  type AiToolDeclaration,
  type AiToolExecutionResult,
  type AiUiAction,
  type AiUiActionVerifyOptions,
} from '../contracts/ai-assistant.types.js';
import type { AiChatDto } from '../dtos/ai-chat.dto.js';
import {
  SEARCH_PRODUCTS_DECLARATION,
  type AiProduct,
} from '../tools/search-products.tool.js';
import {
  AiReadTools,
  ToolExecutorService,
  type AiToolTurn,
} from '../tools/tool-executor.service.js';
import { TRACK_MY_ORDER_DECLARATION } from '../tools/track-my-order.tool.js';
import {
  UI_ACTION_DECLARATION,
  UiActionHandler,
  type UiAction,
} from '../tools/ui-action.handler.js';
import { AiAgentService } from './ai-agent.service.js';
import type { AiHttpRequest } from './ai-http-access.guard.js';
import { AiImageService, type ValidatedImage } from './ai-image.service.js';
import { AiRateLimitService } from './ai-rate-limit.service.js';
import { GeminiClientService } from './gemini-client.service.js';

interface AiRequestScope {
  sessionId: string;
  imageCache: Map<string, Promise<ValidatedImage | undefined>>;
}

const FALLBACK_UUID = '00000000-0000-4000-8000-000000000000';

@Injectable()
export class AiRequestContextService {
  private readonly storage = new AsyncLocalStorage<AiRequestScope>();

  run<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    return this.storage.run({ sessionId, imageCache: new Map() }, fn);
  }

  getScope(): AiRequestScope | undefined {
    return this.storage.getStore();
  }
}

@Injectable()
export class MinhAiAccessPolicy extends AiAccessPolicy {
  constructor(
    @Inject(AiRateLimitService)
    private readonly rateLimitService: AiRateLimitService,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AiHttpRequest>();
    const response = context.switchToHttp().getResponse<{
      setHeader?: (name: string, value: string) => void;
    }>();
    const isAuthenticated = Boolean(request.user?.id);
    const requesterKey = request.user?.id
      ? request.user.id
      : (request.ip ?? request.socket?.remoteAddress ?? 'unknown');

    try {
      await this.rateLimitService.consume({
        requesterKey,
        isAuthenticated,
      });
      return true;
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === 429) {
        const body = error.getResponse() as {
          data?: { retryAfterSeconds?: unknown };
        };
        const retryAfter = Number(body?.data?.retryAfterSeconds);
        if (Number.isFinite(retryAfter) && retryAfter > 0) {
          response?.setHeader?.('Retry-After', String(Math.ceil(retryAfter)));
        }
      }
      throw error;
    }
  }
}

@Injectable()
export class GeminiClientAdapter extends AiModelClientApi {
  constructor(
    @Inject(GeminiClientService)
    private readonly geminiClient: GeminiClientService,
    @Inject(AiImageService) private readonly images: AiImageService,
    @Optional()
    @Inject(AiRequestContextService)
    private readonly requestContext?: AiRequestContextService,
  ) {
    super();
  }

  async generateTurn(
    request: AiModelTurnRequest,
  ): Promise<AiModelTurnResponse> {
    const contents: Content[] = request.history.map((turn) => ({
      role: turn.role,
      parts: [{ text: turn.text }],
    }));

    const userParts: Part[] = [];
    if (request.userMessage) {
      userParts.push({ text: request.userMessage });
    }
    if (request.image) {
      const validatedImage = await this.prepareImageOnce(request.image);
      if (validatedImage) {
        userParts.push({ inlineData: validatedImage });
      }
    }
    contents.push({
      role: 'user',
      parts: userParts.length > 0 ? userParts : [{ text: '' }],
    });

    for (const round of request.toolRoundMessages) {
      if (round.rawModelContent) {
        contents.push(round.rawModelContent as Content);
      } else {
        contents.push({
          role: 'model',
          parts: round.calls.map((call) => ({
            functionCall: {
              ...(call.id ? { id: call.id } : {}),
              name: call.name,
              args: call.args,
            },
          })),
        });
      }

      contents.push({
        role: 'user',
        parts: round.results.map((res, index) => {
          const matchedCall = round.calls[index];
          return {
            functionResponse: {
              ...(matchedCall?.id ? { id: matchedCall.id } : {}),
              name: res.name,
              response: res.response,
            },
          };
        }),
      });
    }

    const declarations: FunctionDeclaration[] = request.toolDeclarations.map(
      (decl) => ({
        name: decl.name,
        description: decl.description,
        parametersJsonSchema: decl.parameters,
      }),
    );

    const response = await this.geminiClient.generate(
      contents,
      declarations,
      request.systemPrompt,
    );

    const candidateContent = response.candidates?.[0]?.content;
    const parts = Array.isArray(candidateContent?.parts)
      ? candidateContent.parts
      : [];

    const text = parts
      .filter(
        (part): part is Part & { text: string } =>
          typeof part?.text === 'string' &&
          !(part as { thought?: boolean }).thought,
      )
      .map((part) => part.text)
      .join('');

    const callsFromParts: AiFunctionCall[] = parts
      .filter((part) => Boolean(part?.functionCall?.name))
      .map((part) => ({
        ...(part.functionCall!.id ? { id: part.functionCall!.id } : {}),
        name: part.functionCall!.name!,
        args:
          part.functionCall!.args &&
          typeof part.functionCall!.args === 'object' &&
          !Array.isArray(part.functionCall!.args)
            ? (part.functionCall!.args as Record<string, unknown>)
            : {},
      }));

    const fallbackCalls: AiFunctionCall[] = Array.isArray(
      response.functionCalls,
    )
      ? response.functionCalls
          .filter((fc) => Boolean(fc?.name))
          .map((fc) => ({
            ...(fc.id ? { id: fc.id } : {}),
            name: fc.name!,
            args:
              fc.args && typeof fc.args === 'object' && !Array.isArray(fc.args)
                ? (fc.args as Record<string, unknown>)
                : {},
          }))
      : [];

    return {
      text,
      functionCalls: callsFromParts.length > 0 ? callsFromParts : fallbackCalls,
      ...(candidateContent ? { rawModelContent: candidateContent } : {}),
    };
  }

  private async prepareImageOnce(
    image: AiImageInput,
  ): Promise<ValidatedImage | undefined> {
    const scope = this.requestContext?.getScope();
    const cacheKey = `${image.url}|${image.key}`;
    if (scope) {
      const existing = scope.imageCache.get(cacheKey);
      if (existing) {
        return existing;
      }
      const promise = this.images.prepare({
        sessionId: scope.sessionId,
        message: '',
        image: { url: image.url, key: image.key },
      });
      scope.imageCache.set(cacheKey, promise);
      return promise;
    }
    return this.images.prepare({
      sessionId: FALLBACK_UUID,
      message: '',
      image: { url: image.url, key: image.key },
    });
  }
}

@Injectable()
export class ToolExecutorAdapter extends AiToolExecutorApi {
  constructor(
    @Inject(ToolExecutorService)
    private readonly toolExecutor: ToolExecutorService,
    @Optional()
    @Inject(AiReadTools)
    private readonly readTools?: AiReadTools,
  ) {
    super();
  }

  getDeclarations(options: {
    isAuthenticated: boolean;
  }): readonly AiToolDeclaration[] {
    const declarations: FunctionDeclaration[] = [
      SEARCH_PRODUCTS_DECLARATION,
      UI_ACTION_DECLARATION,
    ];
    if (options.isAuthenticated) {
      declarations.push(TRACK_MY_ORDER_DECLARATION);
    }
    return declarations
      .filter((decl) => Boolean(decl.name))
      .map((decl) => ({
        name: decl.name!,
        description: decl.description ?? '',
        parameters: (decl.parametersJsonSchema ?? {}) as Record<
          string,
          unknown
        >,
      }));
  }

  async execute(
    call: AiFunctionCall,
    context: AiChatContext,
  ): Promise<AiToolExecutionResult> {
    const turn: AiToolTurn = {
      verifiedUserId: context.userId,
      userMessage: '',
      products: [],
    };
    const rawResult = await this.toolExecutor.execute(
      call.name,
      call.args ?? {},
      turn,
    );

    if (call.name === 'search_products') {
      const items = Array.isArray(rawResult) ? (rawResult as AiProduct[]) : [];
      const products = this.mapProducts(items);
      return {
        toolResult: { items: products, count: products.length },
        products,
        observedShopSlugs: this.extractShopSlugs(products),
      };
    }

    if (call.name === 'track_my_order') {
      const toolResult =
        rawResult && typeof rawResult === 'object' && !Array.isArray(rawResult)
          ? { found: true, ...(rawResult as Record<string, unknown>) }
          : { found: false, order: null };
      return {
        toolResult,
        products: [],
      };
    }

    const products = this.mapProducts(turn.products);
    const toolResult =
      rawResult && typeof rawResult === 'object' && !Array.isArray(rawResult)
        ? (rawResult as Record<string, unknown>)
        : { result: rawResult ?? null };
    return {
      toolResult,
      products,
      observedShopSlugs: this.extractShopSlugs(products),
    };
  }

  hasReadTools(): boolean {
    return Boolean(this.readTools);
  }

  private mapProducts(items: readonly AiProduct[]): AiProductCard[] {
    return items.map((p) => ({
      slug: p.slug,
      name: p.name,
      imageUrl: p.imageUrl ?? null,
      minPrice: p.minPrice,
      originalPrice: p.originalPrice ?? null,
      unitsSold: p.unitsSold,
      shop: { name: p.shop.name, slug: p.shop.slug },
    }));
  }

  private extractShopSlugs(products: readonly AiProductCard[]): string[] {
    return products
      .map((p) => p.shop?.slug)
      .filter((s): s is string => typeof s === 'string' && s.trim() !== '');
  }
}

@Injectable()
export class UiActionGuardAdapter extends AiUiActionGuardApi {
  constructor(
    @Inject(UiActionHandler)
    private readonly uiActionHandler: UiActionHandler,
  ) {
    super();
  }

  async verifyAndBuildAction(
    rawActionCall: AiFunctionCall,
    observedProducts: AiProductCard[],
    options?: AiUiActionVerifyOptions,
  ): Promise<AiUiAction | null> {
    const mappedProducts: AiProduct[] = observedProducts.map((p) => ({
      slug: p.slug,
      name: p.name,
      minPrice: p.minPrice ?? '0.00',
      originalPrice: p.originalPrice ?? null,
      unitsSold: p.unitsSold ?? 0,
      shop: {
        name: p.shop?.name ?? '',
        slug: p.shop?.slug ?? '',
      },
      imageUrl: p.imageUrl ?? null,
    }));

    const result = this.uiActionHandler.execute(
      rawActionCall.args ?? {},
      mappedProducts,
      options?.userMessage ?? '',
    );
    return result as AiUiAction | null;
  }
}

@Injectable()
export class MinhAiOrchestrator extends AiOrchestrator {
  constructor(
    @Inject(AiAgentService) private readonly agentService: AiAgentService,
    @Optional()
    @Inject(AiRequestContextService)
    private readonly requestContext?: AiRequestContextService,
  ) {
    super();
  }

  async chat(input: AiChatDto, request: unknown): Promise<AiChatResult> {
    const req = request as AiHttpRequest | undefined;
    const isAuthenticated = Boolean(req?.user?.id);
    const requesterKey = req?.user?.id
      ? req.user.id
      : (req?.ip ?? req?.socket?.remoteAddress ?? 'unknown');

    const context: AiChatContext = {
      ...(input.context?.currentPath
        ? { currentPath: input.context.currentPath }
        : {}),
      ...(isAuthenticated && req?.user?.id ? { userId: req.user.id } : {}),
    };

    const runAgent = () =>
      this.agentService.chat({
        sessionId: input.sessionId,
        message: input.message,
        image: input.image,
        context,
        requesterKey,
        isAuthenticated,
        skipRateLimit: true,
      });

    const output = this.requestContext
      ? await this.requestContext.run(input.sessionId, runAgent)
      : await runAgent();

    const products: AiProduct[] = output.products.map((p) => ({
      slug: p.slug,
      name: p.name,
      minPrice: p.minPrice ?? '0.00',
      originalPrice: p.originalPrice ?? null,
      unitsSold: p.unitsSold ?? 0,
      shop: {
        name: p.shop?.name ?? '',
        slug: p.shop?.slug ?? '',
      },
      imageUrl: p.imageUrl ?? null,
    }));

    return {
      reply: output.reply,
      products,
      action: output.action as UiAction | null,
      suggestions: output.suggestions,
    };
  }
}
