import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AiModelClientApi,
  AiToolExecutorApi,
  AiUiActionGuardApi,
  type AiAgentChatInput,
  type AiAgentChatOutput,
  type AiChatContext,
  type AiFunctionCall,
  type AiImageInput,
  type AiProductCard,
  type AiToolResult,
  type AiToolRoundMessage,
  type AiUiAction,
} from '../contracts/ai-assistant.types.js';
import { buildAiAssistantSystemPrompt } from '../prompts/system-prompt.js';
import { AiRateLimitService } from './ai-rate-limit.service.js';
import { AiSessionService } from './ai-session.service.js';

const MAX_MESSAGE_LENGTH = 1000;
const MAX_PRODUCTS_RETURNED = 5;
const MAX_SUGGESTIONS_RETURNED = 3;
const DEFAULT_MAX_TOOL_ROUNDS = 4;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_IMAGE_QUERY = 'Tìm sản phẩm tương tự trong ảnh này';
const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;
const PRODUCT_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const AI_STORAGE_KEY_PATTERN = /^ai\/[a-zA-Z0-9/_.-]+$/;

@Injectable()
export class AiAgentService {
  private readonly logger = new Logger(AiAgentService.name);
  private readonly enabled: boolean;
  private readonly maxToolRounds: number;
  private readonly timeoutMs: number;
  private readonly aiImageStoragePrefix: string;

  constructor(
    private readonly config: ConfigService,
    private readonly sessionService: AiSessionService,
    private readonly rateLimitService: AiRateLimitService,
    private readonly modelClient: AiModelClientApi,
    private readonly toolExecutor: AiToolExecutorApi,
    private readonly uiActionGuard: AiUiActionGuardApi,
  ) {
    const enabledRaw = this.config.get<string>('AI_ASSISTANT_ENABLED', 'true');
    this.enabled = String(enabledRaw).toLowerCase() !== 'false';
    this.maxToolRounds = this.clampInt(
      this.config.get<number>('AI_MAX_TOOL_ROUNDS', DEFAULT_MAX_TOOL_ROUNDS),
      1,
      6,
      DEFAULT_MAX_TOOL_ROUNDS,
    );
    this.timeoutMs = this.clampInt(
      this.config.get<number>('GEMINI_TIMEOUT_MS') ??
        this.config.get<number>('AI_TIMEOUT_MS'),
      1000,
      60_000,
      DEFAULT_TIMEOUT_MS,
    );

    const supabaseUrl = (this.config.get<string>('SUPABASE_URL') ?? '')
      .trim()
      .replace(/\/+$/, '');
    const bucket =
      (
        this.config.get<string>('SUPABASE_STORAGE_BUCKET') ?? 'nexus-media'
      ).trim() || 'nexus-media';
    this.aiImageStoragePrefix = supabaseUrl
      ? `${supabaseUrl}/storage/v1/object/public/${bucket}/`
      : '';
  }

  async chat(input: AiAgentChatInput): Promise<AiAgentChatOutput> {
    if (!this.enabled) {
      throw new ServiceUnavailableException({
        errorCode: 'AI_UNAVAILABLE',
        message: 'Tính năng Trợ lý AI hiện đang tạm bảo trì.',
      });
    }

    const sessionId = this.validateSessionId(input.sessionId);
    const normalizedImage = this.validateImage(
      input.image,
      input.isAuthenticated,
    );
    const effectiveMessage = this.validateMessage(
      input.message,
      Boolean(normalizedImage),
    );

    await this.rateLimitService.consume({
      requesterKey: input.requesterKey,
      isAuthenticated: input.isAuthenticated,
    });

    const context = this.resolveChatContext(input.context);
    const sessionOwnerKey =
      input.isAuthenticated && context.userId
        ? `user:${context.userId}`
        : `guest:${input.requesterKey}`;

    const history = await this.sessionService.getHistory(
      sessionId,
      6,
      sessionOwnerKey,
    );
    const systemPrompt = buildAiAssistantSystemPrompt({
      currentPath: context.currentPath,
      currentUrl: context.currentUrl,
      currentProductSlug: context.currentProductSlug,
      isAuthenticated: input.isAuthenticated,
    });
    const toolDeclarations = this.toolExecutor.getDeclarations({
      isAuthenticated: input.isAuthenticated,
    });

    const observedProducts: AiProductCard[] = [];
    const allowedShopSlugs = new Set<string>();
    const toolRoundMessages: AiToolRoundMessage[] = [];
    let verifiedAction: AiUiAction | null = null;
    let latestSuggestions: string[] = [];
    let finalReply = '';

    try {
      for (let round = 0; round < this.maxToolRounds; round++) {
        const modelResponse = await this.withTimeout(
          this.modelClient.generateTurn({
            systemPrompt,
            history,
            userMessage: effectiveMessage,
            image: normalizedImage,
            toolDeclarations,
            toolRoundMessages,
          }),
          this.timeoutMs,
        );

        if (
          Array.isArray(modelResponse.suggestions) &&
          modelResponse.suggestions.length > 0
        ) {
          latestSuggestions = modelResponse.suggestions
            .filter(
              (s): s is string => typeof s === 'string' && s.trim() !== '',
            )
            .map((s) => s.trim())
            .slice(0, MAX_SUGGESTIONS_RETURNED);
        }

        const calls = modelResponse.functionCalls ?? [];
        if (calls.length === 0) {
          finalReply = modelResponse.text.trim();
          break;
        }

        const dataCalls = calls.filter((c) => c.name !== 'ui_action');
        const uiCalls = calls.filter((c) => c.name === 'ui_action');

        const resultMap = new Map<AiFunctionCall, AiToolResult>();

        if (dataCalls.length > 0) {
          const dataResults = await Promise.all(
            dataCalls.map(async (call) => {
              const execution = await this.safeExecuteTool(call, context);
              this.mergeProducts(observedProducts, execution.products ?? []);
              for (const shopSlug of execution.observedShopSlugs ?? []) {
                const normalizedShop = shopSlug?.trim().toLowerCase();
                if (normalizedShop) allowedShopSlugs.add(normalizedShop);
              }
              return { call, result: execution.toolResult };
            }),
          );
          for (const item of dataResults) {
            resultMap.set(item.call, {
              name: item.call.name,
              response: item.result,
            });
          }
        }

        for (const uiCall of uiCalls) {
          const action = await this.uiActionGuard.verifyAndBuildAction(
            uiCall,
            observedProducts,
            { allowedShopSlugs: [...allowedShopSlugs] },
          );
          if (action) {
            verifiedAction = action;
          }
          resultMap.set(uiCall, {
            name: uiCall.name,
            response: action
              ? { accepted: true, action }
              : { accepted: false, reason: 'ACTION_OR_SLUG_NOT_VERIFIED' },
          });
        }

        const orderedResults: AiToolResult[] = calls.map(
          (call) =>
            resultMap.get(call) ?? {
              name: call.name,
              response: { error: 'MISSING_TOOL_RESULT' },
            },
        );
        toolRoundMessages.push({
          calls,
          results: orderedResults,
          ...(modelResponse.rawModelContent !== undefined
            ? { rawModelContent: modelResponse.rawModelContent }
            : {}),
        });

        // If Gemini only invoked ui_action and already returned user-facing text, return early.
        if (
          dataCalls.length === 0 &&
          uiCalls.length > 0 &&
          modelResponse.text.trim().length > 0
        ) {
          finalReply = modelResponse.text.trim();
          break;
        }
      }

      if (!finalReply) {
        finalReply = this.synthesizeMaxRoundReply(observedProducts);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`AI agent failed: ${reason}`);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new ServiceUnavailableException({
        errorCode: 'AI_UNAVAILABLE',
        message:
          'Trợ lý AI hiện đang tạm gián đoạn. Bạn vui lòng thử lại sau ít phút hoặc tìm kiếm trực tiếp trên Nexus nhé!',
      });
    }

    const finalProducts = observedProducts.slice(0, MAX_PRODUCTS_RETURNED);
    if (!verifiedAction && finalProducts.length > 0) {
      verifiedAction = { type: 'SHOW_PRODUCTS' };
    }

    const suggestions =
      latestSuggestions.length > 0
        ? latestSuggestions
        : this.defaultSuggestions(finalProducts);

    await this.safePersistTurns(
      sessionId,
      [
        {
          role: 'user',
          text: effectiveMessage,
          ...(normalizedImage?.url ? { imageUrl: normalizedImage.url } : {}),
          timestamp: Date.now(),
        },
        {
          role: 'model',
          text: finalReply,
          timestamp: Date.now(),
        },
      ],
      sessionOwnerKey,
    );

    return {
      reply: finalReply,
      products: finalProducts,
      action: verifiedAction,
      suggestions: suggestions.slice(0, MAX_SUGGESTIONS_RETURNED),
    };
  }

  private async safeExecuteTool(
    call: AiFunctionCall,
    context: AiChatContext,
  ): Promise<{
    toolResult: Record<string, unknown>;
    products?: AiProductCard[];
    observedShopSlugs?: string[];
  }> {
    try {
      const result = await this.toolExecutor.execute(call, context);
      return {
        toolResult: result.toolResult ?? {},
        products: result.products ?? [],
        observedShopSlugs: result.observedShopSlugs ?? [],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Tool '${call.name}' execution failed: ${message}`);
      return {
        toolResult: { error: 'TOOL_EXECUTION_FAILED', message },
        products: [],
        observedShopSlugs: [],
      };
    }
  }

  private mergeProducts(
    target: AiProductCard[],
    incoming: AiProductCard[],
  ): void {
    const seen = new Set(target.map((p) => p.slug.toLowerCase()));
    for (const product of incoming) {
      if (!product?.slug) continue;
      const key = product.slug.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      target.push(this.sanitizeProductCard(product));
      if (target.length >= MAX_PRODUCTS_RETURNED) break;
    }
  }

  private sanitizeProductCard(product: AiProductCard): AiProductCard {
    return {
      slug: product.slug,
      name: product.name,
      imageUrl: product.imageUrl ?? null,
      minPrice:
        product.minPrice !== null && product.minPrice !== undefined
          ? String(product.minPrice)
          : null,
      originalPrice:
        product.originalPrice !== null && product.originalPrice !== undefined
          ? String(product.originalPrice)
          : null,
      ...(typeof product.unitsSold === 'number'
        ? { unitsSold: product.unitsSold }
        : {}),
      ...(product.shop
        ? {
            shop: {
              name: product.shop.name,
              slug: product.shop.slug,
            },
          }
        : {}),
    };
  }

  private resolveChatContext(raw?: AiChatContext): AiChatContext {
    const rawPath = (raw?.currentPath ?? raw?.currentUrl)?.trim();
    const currentPath = rawPath ? rawPath.slice(0, 500) : undefined;

    let currentProductSlug = raw?.currentProductSlug?.trim().toLowerCase();
    if (currentProductSlug && !PRODUCT_SLUG_PATTERN.test(currentProductSlug)) {
      currentProductSlug = undefined;
    }

    if (!currentProductSlug && currentPath) {
      let pathname: string | undefined = currentPath;
      if (/^https?:\/\//i.test(currentPath)) {
        try {
          pathname = new URL(currentPath).pathname;
        } catch {
          pathname = undefined;
        }
      }
      const match = pathname?.match(
        /^\/products\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\/|\?|#|$)/i,
      );
      if (match) {
        currentProductSlug = match[1].toLowerCase();
      }
    }

    return {
      ...(currentPath ? { currentPath, currentUrl: currentPath } : {}),
      ...(currentProductSlug ? { currentProductSlug } : {}),
      ...(raw?.userId ? { userId: raw.userId } : {}),
    };
  }

  private synthesizeMaxRoundReply(products: AiProductCard[]): string {
    if (products.length > 0) {
      return `Mình đã tìm thấy ${products.length} sản phẩm phù hợp trên Nexus. Bạn xem thông tin chi tiết ở các thẻ sản phẩm bên dưới nhé!`;
    }
    return 'Mình chưa tìm được sản phẩm nào thật sự khớp với mô tả của bạn. Bạn có thể mô tả rõ hơn hoặc thử từ khóa khác không?';
  }

  private defaultSuggestions(products: AiProductCard[]): string[] {
    if (products.length > 0) {
      return [
        'Sản phẩm này còn hàng không?',
        'Xem thêm mẫu bán chạy khác',
        'So sánh giá các sản phẩm',
      ];
    }
    return ['Đang có sản phẩm nào bán chạy?', 'Gợi ý sản phẩm giá dưới 300k'];
  }

  private async safePersistTurns(
    sessionId: string,
    turns: Array<{
      role: 'user' | 'model';
      text: string;
      imageUrl?: string;
      timestamp: number;
    }>,
    ownerKey: string,
  ): Promise<void> {
    try {
      await this.sessionService.appendTurns(sessionId, turns, ownerKey);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.debug(`Failed to persist AI session turns: ${message}`);
    }
  }

  private validateSessionId(sessionId: string): string {
    const trimmed = typeof sessionId === 'string' ? sessionId.trim() : '';
    if (!SESSION_ID_PATTERN.test(trimmed)) {
      throw new BadRequestException({
        errorCode: 'AI_SESSION_INVALID',
        message: 'sessionId không hợp lệ cho cuộc trò chuyện với Trợ lý AI.',
      });
    }
    return trimmed;
  }

  private validateMessage(
    message: string | undefined,
    hasImage: boolean,
  ): string {
    const trimmed = typeof message === 'string' ? message.trim() : '';
    if (!trimmed) {
      if (hasImage) return DEFAULT_IMAGE_QUERY;
      throw new BadRequestException({
        errorCode: 'AI_MESSAGE_INVALID',
        message: 'Vui lòng nhập nội dung câu hỏi hoặc đính kèm hình ảnh.',
      });
    }
    if (trimmed.length > MAX_MESSAGE_LENGTH) {
      throw new BadRequestException({
        errorCode: 'AI_MESSAGE_INVALID',
        message: `Tin nhắn không được vượt quá ${MAX_MESSAGE_LENGTH} ký tự.`,
      });
    }
    return trimmed;
  }

  private validateImage(
    image: AiImageInput | undefined,
    isAuthenticated: boolean,
  ): AiImageInput | undefined {
    if (!image || typeof image !== 'object') return undefined;

    const record = image as unknown as Record<string, unknown>;
    const rawUrl = typeof record.url === 'string' ? record.url.trim() : '';
    const rawKey = typeof record.key === 'string' ? record.key.trim() : '';
    const hasLegacyBase64 =
      record.base64 !== undefined &&
      record.base64 !== null &&
      String(record.base64).trim() !== '';

    if (!rawUrl && !rawKey && !hasLegacyBase64) {
      return undefined;
    }

    if (!isAuthenticated) {
      throw new UnauthorizedException({
        errorCode: 'AI_IMAGE_LOGIN_REQUIRED',
        message: 'Vui lòng đăng nhập để tìm kiếm sản phẩm bằng hình ảnh.',
      });
    }

    if (hasLegacyBase64 || !rawUrl || !rawKey) {
      throw new BadRequestException({
        errorCode: 'AI_IMAGE_INVALID',
        message:
          'Hình ảnh phải được tải lên kho lưu trữ AI của Nexus và cung cấp đủ url và key.',
      });
    }

    if (
      rawKey.includes('..') ||
      rawKey.includes('\\') ||
      rawKey.includes('%') ||
      !AI_STORAGE_KEY_PATTERN.test(rawKey)
    ) {
      throw new BadRequestException({
        errorCode: 'AI_IMAGE_INVALID',
        message: 'Định danh ảnh (key) phải thuộc thư mục ai/ của Nexus.',
      });
    }

    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new BadRequestException({
        errorCode: 'AI_IMAGE_INVALID',
        message: 'Đường dẫn hình ảnh không hợp lệ.',
      });
    }

    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      rawUrl.includes('\\') ||
      rawUrl.includes('%')
    ) {
      throw new BadRequestException({
        errorCode: 'AI_IMAGE_INVALID',
        message: 'Đường dẫn hình ảnh không hợp lệ.',
      });
    }

    if (
      !this.aiImageStoragePrefix.startsWith('https://') ||
      !rawUrl.startsWith(this.aiImageStoragePrefix) ||
      rawUrl !== `${this.aiImageStoragePrefix}${rawKey}`
    ) {
      throw new BadRequestException({
        errorCode: 'AI_IMAGE_INVALID',
        message: 'Hình ảnh không thuộc kho lưu trữ AI hợp lệ của Nexus.',
      });
    }

    return { url: rawUrl, key: rawKey };
  }

  private async withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error(`AI_MODEL_TIMEOUT_${ms}MS`));
          }, ms);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private clampInt(
    value: unknown,
    min: number,
    max: number,
    fallback: number,
  ): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  }
}
