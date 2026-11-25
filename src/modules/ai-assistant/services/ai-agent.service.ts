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
  type AiAuctionCard,
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
const MAX_OBSERVED_PRODUCTS = 20;
const MAX_AUCTIONS_RETURNED = 5;
const MAX_OBSERVED_AUCTIONS = 20;
const MAX_SUGGESTIONS_RETURNED = 3;
const DEFAULT_MAX_TOOL_ROUNDS = 4;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_IMAGE_QUERY = 'Tìm sản phẩm tương tự trong ảnh này';
const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;
const PRODUCT_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const AUCTION_ID_OR_CODE_PATTERN = /^[a-zA-Z0-9_-]{2,100}$/;
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
    const configuredAiTimeout = this.config.get<number>('AI_TIMEOUT_MS');
    const configuredGeminiTimeout =
      this.config.get<number>('GEMINI_TIMEOUT_MS');
    const rawOuterTimeout =
      configuredAiTimeout !== undefined && configuredAiTimeout !== null
        ? configuredAiTimeout
        : configuredGeminiTimeout !== undefined &&
            configuredGeminiTimeout !== null
          ? Number(configuredGeminiTimeout) + 2_000
          : DEFAULT_TIMEOUT_MS + 2_000;
    this.timeoutMs = this.clampInt(
      rawOuterTimeout,
      1000,
      65_000,
      DEFAULT_TIMEOUT_MS + 2_000,
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

    if (!input.skipRateLimit) {
      await this.rateLimitService.consume({
        requesterKey: input.requesterKey,
        isAuthenticated: input.isAuthenticated,
      });
    }

    const context = this.resolveChatContext(
      input.context,
      input.isAuthenticated,
    );
    const sessionOwnerKey =
      input.isAuthenticated && context.userId
        ? `user:${context.userId}`
        : `guest:${input.requesterKey}`;

    const history = await this.sessionService.getHistory(
      sessionId,
      6,
      sessionOwnerKey,
    );
    const toolDeclarations = this.toolExecutor.getDeclarations({
      isAuthenticated: input.isAuthenticated,
    });
    const hasReadTools = toolDeclarations.some(
      (decl) => decl.name === 'get_product_detail',
    );
    const hasAuctionTools = toolDeclarations.some(
      (decl) => decl.name === 'search_auctions',
    );
    const hasFlashDealTools = toolDeclarations.some(
      (decl) => decl.name === 'get_flash_deals',
    );
    const systemPrompt = buildAiAssistantSystemPrompt({
      currentPath: context.currentPath,
      currentUrl: context.currentUrl,
      currentProductSlug: context.currentProductSlug,
      currentAuctionIdOrCode: context.currentAuctionIdOrCode,
      language: context.language,
      isAuthenticated: input.isAuthenticated,
      hasReadTools,
      hasAuctionTools,
      hasFlashDealTools,
    });

    const observedProducts: AiProductCard[] = [];
    const observedAuctions: AiAuctionCard[] = [];
    const allowedShopSlugs = new Set<string>();
    const toolRoundMessages: AiToolRoundMessage[] = [];
    let verifiedAction: AiUiAction | null = null;
    let selectedProductSlugs: string[] | null = null;
    let suppressProducts = false;
    let selectedAuctionIds: string[] | null = null;
    let suppressAuctions = false;
    let latestSuggestions: string[] = [];
    let finalReply = '';
    let finalProducts: AiProductCard[] = [];
    let finalAuctions: AiAuctionCard[] = [];

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
              const addedCount = this.mergeProducts(
                observedProducts,
                execution.products ?? [],
              );
              if (addedCount > 0) {
                selectedProductSlugs = null;
                suppressProducts = false;
              }
              const addedAuctionCount = this.mergeAuctions(
                observedAuctions,
                execution.auctions ?? [],
              );
              if (addedAuctionCount > 0) {
                selectedAuctionIds = null;
                suppressAuctions = false;
              }
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
            {
              allowedShopSlugs: [...allowedShopSlugs],
              observedAuctions,
              userMessage: effectiveMessage,
            },
          );
          if (this.isEmptyShowProductsSelection(uiCall)) {
            suppressProducts = true;
            selectedProductSlugs = [];
            if (verifiedAction?.type === 'SHOW_PRODUCTS') {
              verifiedAction = null;
            }
            resultMap.set(uiCall, {
              name: uiCall.name,
              response: { accepted: true, shownCount: 0, action: null },
            });
            continue;
          }
          if (this.isEmptyShowAuctionsSelection(uiCall)) {
            suppressAuctions = true;
            selectedAuctionIds = [];
            if (verifiedAction?.type === 'SHOW_AUCTIONS') {
              verifiedAction = null;
            }
            resultMap.set(uiCall, {
              name: uiCall.name,
              response: { accepted: true, shownCount: 0, action: null },
            });
            continue;
          }
          if (action) {
            verifiedAction = action;
            if (
              action.type === 'SHOW_PRODUCTS' &&
              Array.isArray(uiCall.args?.slugs)
            ) {
              const matchedSlugs = this.matchObservedSlugs(
                uiCall.args.slugs,
                observedProducts,
              );
              if (matchedSlugs.length > 0) {
                selectedProductSlugs = matchedSlugs;
                suppressProducts = false;
              }
            }
            if (
              action.type === 'SHOW_AUCTIONS' &&
              Array.isArray(uiCall.args?.auctionIds)
            ) {
              const matchedAuctionIds = this.matchObservedAuctionIds(
                uiCall.args.auctionIds,
                observedAuctions,
              );
              if (matchedAuctionIds.length > 0) {
                selectedAuctionIds = matchedAuctionIds;
                suppressAuctions = false;
              }
            }
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

      finalProducts = this.resolveFinalProducts(
        observedProducts,
        selectedProductSlugs,
        suppressProducts,
      );
      finalAuctions = this.resolveFinalAuctions(
        observedAuctions,
        selectedAuctionIds,
        suppressAuctions,
      );

      if (!finalReply) {
        finalReply = this.synthesizeMaxRoundReply(
          finalProducts,
          finalAuctions,
          context.language,
        );
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const isUpstreamTransient =
        !(error instanceof HttpException) ||
        error instanceof ServiceUnavailableException;

      if (
        isUpstreamTransient &&
        (observedProducts.length > 0 || observedAuctions.length > 0)
      ) {
        this.logger.warn(
          `AI agent degraded after tool retrieval (${reason}); returning grounded DB results`,
        );
        finalProducts = this.resolveFinalProducts(
          observedProducts,
          selectedProductSlugs,
          suppressProducts,
        );
        finalAuctions = this.resolveFinalAuctions(
          observedAuctions,
          selectedAuctionIds,
          suppressAuctions,
        );
        finalReply = this.synthesizeMaxRoundReply(
          finalProducts,
          finalAuctions,
          context.language,
        );
      } else {
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
    }

    if (!verifiedAction && finalProducts.length > 0) {
      verifiedAction = { type: 'SHOW_PRODUCTS' };
    } else if (!verifiedAction && finalAuctions.length > 0) {
      verifiedAction = { type: 'SHOW_AUCTIONS' };
    }

    const suggestions =
      latestSuggestions.length > 0
        ? latestSuggestions
        : this.defaultSuggestions(finalProducts, finalAuctions, context);

    const persistedModelReply =
      finalAuctions.length > 0
        ? `${finalReply}\n[Phiên đấu giá vừa hiển thị: ${finalAuctions
            .map((a) => `${a.title} (mã: ${a.id}, trạng thái: ${a.status})`)
            .join('; ')}]`
        : finalReply;

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
          text: persistedModelReply,
          timestamp: Date.now(),
        },
      ],
      sessionOwnerKey,
    );

    return {
      reply: finalReply,
      products: finalProducts,
      ...(finalAuctions.length > 0 ? { auctions: finalAuctions } : {}),
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
    auctions?: AiAuctionCard[];
    observedShopSlugs?: string[];
  }> {
    try {
      const result = await this.toolExecutor.execute(call, context);
      return {
        toolResult: result.toolResult ?? {},
        products: result.products ?? [],
        auctions: result.auctions ?? [],
        observedShopSlugs: result.observedShopSlugs ?? [],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Tool '${call.name}' execution failed: ${message}`);
      return {
        toolResult: { error: 'TOOL_EXECUTION_FAILED', message },
        products: [],
        auctions: [],
        observedShopSlugs: [],
      };
    }
  }

  private mergeProducts(
    target: AiProductCard[],
    incoming: AiProductCard[],
  ): number {
    let added = 0;
    const seen = new Set(target.map((p) => p.slug.toLowerCase()));
    for (const product of incoming) {
      if (!product?.slug) continue;
      if (target.length >= MAX_OBSERVED_PRODUCTS) break;
      const key = product.slug.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      target.push(this.sanitizeProductCard(product));
      added++;
    }
    return added;
  }

  private isEmptyShowProductsSelection(uiCall: AiFunctionCall): boolean {
    const rawType =
      typeof uiCall.args?.type === 'string'
        ? uiCall.args.type.trim().toUpperCase()
        : '';
    return (
      rawType === 'SHOW_PRODUCTS' &&
      Array.isArray(uiCall.args?.slugs) &&
      uiCall.args.slugs.length === 0
    );
  }

  private matchObservedSlugs(
    rawSlugs: unknown[],
    observedProducts: readonly AiProductCard[],
  ): string[] {
    const bySlug = new Map(
      observedProducts.map((p) => [p.slug.trim().toLowerCase(), p.slug]),
    );
    const matched: string[] = [];
    const seen = new Set<string>();
    for (const item of rawSlugs) {
      if (typeof item !== 'string') continue;
      const canonical = bySlug.get(item.trim().toLowerCase());
      if (!canonical || seen.has(canonical)) continue;
      seen.add(canonical);
      matched.push(canonical);
      if (matched.length >= MAX_PRODUCTS_RETURNED) break;
    }
    return matched;
  }

  private resolveFinalProducts(
    observedProducts: readonly AiProductCard[],
    selectedSlugs: readonly string[] | null,
    suppressProducts: boolean,
  ): AiProductCard[] {
    if (suppressProducts) return [];
    if (selectedSlugs && selectedSlugs.length > 0) {
      const bySlug = new Map(
        observedProducts.map((p) => [p.slug.toLowerCase(), p]),
      );
      return selectedSlugs
        .map((slug) => bySlug.get(slug.toLowerCase()))
        .filter((p): p is AiProductCard => Boolean(p))
        .slice(0, MAX_PRODUCTS_RETURNED);
    }
    return observedProducts.slice(0, MAX_PRODUCTS_RETURNED);
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

  private resolveChatContext(
    raw?: AiChatContext,
    isAuthenticated = false,
  ): AiChatContext {
    const rawPath = (raw?.currentPath ?? raw?.currentUrl)?.trim();
    const currentPath = rawPath ? rawPath.slice(0, 500) : undefined;

    let currentProductSlug = raw?.currentProductSlug?.trim().toLowerCase();
    if (currentProductSlug && !PRODUCT_SLUG_PATTERN.test(currentProductSlug)) {
      currentProductSlug = undefined;
    }

    let currentAuctionIdOrCode = raw?.currentAuctionIdOrCode?.trim();
    if (
      currentAuctionIdOrCode &&
      !AUCTION_ID_OR_CODE_PATTERN.test(currentAuctionIdOrCode)
    ) {
      currentAuctionIdOrCode = undefined;
    }

    if ((!currentProductSlug || !currentAuctionIdOrCode) && currentPath) {
      let pathname: string | undefined = currentPath;
      if (/^https?:\/\//i.test(currentPath)) {
        try {
          pathname = new URL(currentPath).pathname;
        } catch {
          pathname = undefined;
        }
      }
      if (!currentProductSlug) {
        const match = pathname?.match(
          /^\/products\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\/|\?|#|$)/i,
        );
        if (match) {
          currentProductSlug = match[1].toLowerCase();
        }
      }
      if (!currentAuctionIdOrCode) {
        const auctionMatch = pathname?.match(
          /^\/auctions\/([a-zA-Z0-9_-]{2,100})(?:\/|\?|#|$)/i,
        );
        if (auctionMatch) {
          currentAuctionIdOrCode = auctionMatch[1];
        }
      }
    }

    const language =
      raw?.language === 'vi' || raw?.language === 'en'
        ? raw.language
        : undefined;

    return {
      ...(currentPath ? { currentPath, currentUrl: currentPath } : {}),
      ...(currentProductSlug ? { currentProductSlug } : {}),
      ...(currentAuctionIdOrCode ? { currentAuctionIdOrCode } : {}),
      ...(language ? { language } : {}),
      ...(isAuthenticated && raw?.userId ? { userId: raw.userId } : {}),
    };
  }

  private mergeAuctions(
    target: AiAuctionCard[],
    incoming: AiAuctionCard[],
  ): number {
    let added = 0;
    const seen = new Set(target.map((a) => a.auctionId.toLowerCase()));
    for (const auction of incoming) {
      if (!auction?.auctionId) continue;
      if (target.length >= MAX_OBSERVED_AUCTIONS) break;
      const key = auction.auctionId.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      target.push(auction);
      added++;
    }
    return added;
  }

  private isEmptyShowAuctionsSelection(uiCall: AiFunctionCall): boolean {
    const rawType =
      typeof uiCall.args?.type === 'string'
        ? uiCall.args.type.trim().toUpperCase()
        : '';
    return (
      rawType === 'SHOW_AUCTIONS' &&
      Array.isArray(uiCall.args?.auctionIds) &&
      uiCall.args.auctionIds.length === 0
    );
  }

  private matchObservedAuctionIds(
    rawIds: unknown[],
    observedAuctions: readonly AiAuctionCard[],
  ): string[] {
    const byKey = new Map<string, string>();
    for (const auction of observedAuctions) {
      byKey.set(auction.id.toLowerCase(), auction.auctionId);
      byKey.set(auction.auctionId.toLowerCase(), auction.auctionId);
      if (auction.code) {
        byKey.set(auction.code.toLowerCase(), auction.auctionId);
      }
    }
    const matched: string[] = [];
    const seen = new Set<string>();
    for (const item of rawIds) {
      if (typeof item !== 'string') continue;
      const canonical = byKey.get(item.trim().toLowerCase());
      if (!canonical || seen.has(canonical)) continue;
      seen.add(canonical);
      matched.push(canonical);
      if (matched.length >= MAX_AUCTIONS_RETURNED) break;
    }
    return matched;
  }

  private resolveFinalAuctions(
    observedAuctions: readonly AiAuctionCard[],
    selectedAuctionIds: readonly string[] | null,
    suppressAuctions: boolean,
  ): AiAuctionCard[] {
    if (suppressAuctions) return [];
    if (selectedAuctionIds && selectedAuctionIds.length > 0) {
      const byId = new Map(
        observedAuctions.map((a) => [a.auctionId.toLowerCase(), a]),
      );
      return selectedAuctionIds
        .map((id) => byId.get(id.toLowerCase()))
        .filter((a): a is AiAuctionCard => Boolean(a))
        .slice(0, MAX_AUCTIONS_RETURNED);
    }
    return observedAuctions.slice(0, MAX_AUCTIONS_RETURNED);
  }

  private synthesizeMaxRoundReply(
    products: AiProductCard[],
    auctions: AiAuctionCard[],
    language?: 'vi' | 'en',
  ): string {
    if (language === 'en') {
      if (products.length > 0) {
        return `I found ${products.length} matching product(s) on Nexus. Please check the product cards below for full details!`;
      }
      if (auctions.length > 0) {
        return `I found ${auctions.length} matching auction(s) on Nexus. Please check the auction cards below for details!`;
      }
      return "I couldn't find any products matching your request yet. Could you describe it in more detail or try another keyword?";
    }
    if (products.length > 0) {
      return `Mình đã tìm thấy ${products.length} sản phẩm phù hợp trên Nexus. Bạn xem thông tin chi tiết ở các thẻ sản phẩm bên dưới nhé!`;
    }
    if (auctions.length === 1) {
      return this.formatSingleAuctionSummary(auctions[0]);
    }
    if (auctions.length > 1) {
      const topList = auctions
        .slice(0, 3)
        .map(
          (a) =>
            `${a.title} (${a.id}, ${this.formatAuctionRemainingText(a)}, giá hiện tại ${this.formatVnd(a.currentPrice)})`,
        )
        .join('; ');
      return `Mình tìm thấy ${auctions.length} phiên đấu giá: ${topList}. Bạn muốn hỏi chi tiết phiên nào không?`;
    }
    return 'Mình chưa tìm được sản phẩm nào thật sự khớp với mô tả của bạn. Bạn có thể mô tả rõ hơn hoặc thử từ khóa khác không?';
  }

  private formatSingleAuctionSummary(auction: AiAuctionCard): string {
    const timingText = this.formatAuctionRemainingText(auction);
    const currentPrice = this.formatVnd(auction.currentPrice);
    const minNextBid = this.formatVnd(auction.minNextBid);
    return `Phiên "${auction.title}" (mã ${auction.id}) ${timingText}. Giá hiện tại là ${currentPrice}, mức đặt tiếp theo tối thiểu ${minNextBid} (${auction.bidCount} lượt đặt giá).`;
  }

  private formatAuctionRemainingText(auction: AiAuctionCard): string {
    if (auction.status === 'ENDED' || auction.status === 'SETTLED') {
      return 'đã kết thúc';
    }
    if (auction.status === 'CANCELLED' || auction.status === 'FAILED') {
      return 'đã đóng';
    }
    const targetIso =
      auction.status === 'SCHEDULED' && auction.startTime
        ? auction.startTime
        : auction.endTime;
    const diffMs = new Date(targetIso).getTime() - Date.now();
    if (!Number.isFinite(diffMs) || diffMs <= 0) {
      return auction.status === 'SCHEDULED'
        ? 'sắp bắt đầu'
        : 'vừa đến hạn kết thúc';
    }
    const totalMinutes = Math.floor(diffMs / 60_000);
    const days = Math.floor(totalMinutes / (24 * 60));
    const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
    const minutes = totalMinutes % 60;
    const parts: string[] = [];
    if (days > 0) parts.push(`${days} ngày`);
    if (hours > 0) parts.push(`${hours} giờ`);
    if (minutes > 0 || parts.length === 0)
      parts.push(`${Math.max(1, minutes)} phút`);
    const prefix =
      auction.status === 'SCHEDULED'
        ? 'sắp mở sau khoảng'
        : 'đang diễn ra, còn khoảng';
    return `${prefix} ${parts.join(' ')}`;
  }

  private formatVnd(amount: number): string {
    return `${new Intl.NumberFormat('vi-VN').format(Math.round(amount))}đ`;
  }

  private defaultSuggestions(
    products: AiProductCard[],
    auctions: AiAuctionCard[],
    context?: AiChatContext,
  ): string[] {
    if (context?.language === 'en') {
      if (auctions.length > 0 || context?.currentAuctionIdOrCode) {
        return [
          'How much time is left on this auction?',
          'How do bid steps and 60s anti-sniping work?',
          'Which auctions am I currently participating in?',
        ];
      }
      if (products.length > 0) {
        return [
          'Is this product in stock or on Flash Deal?',
          'Show more trending products',
          'Compare prices of these products',
        ];
      }
      return [
        'What Flash Deals are live right now?',
        'Which auctions are live now?',
        'Show trending products',
      ];
    }
    if (auctions.length > 0 || context?.currentAuctionIdOrCode) {
      return [
        'Phiên này còn bao lâu?',
        'Bước giá và luật gia hạn 60s thế nào?',
        'Mình đang tham gia phiên nào?',
      ];
    }
    if (products.length > 0) {
      return [
        'Sản phẩm này còn hàng không?',
        'Xem thêm mẫu bán chạy khác',
        'So sánh giá các sản phẩm',
      ];
    }
    return [
      'Đang có phiên đấu giá nào live?',
      'Đang có sản phẩm nào bán chạy?',
      'Gợi ý sản phẩm giá dưới 300k',
    ];
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
