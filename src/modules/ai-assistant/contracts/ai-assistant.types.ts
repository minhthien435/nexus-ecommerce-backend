export type AiChatLanguage = 'vi' | 'en';

export interface AiImageInput {
  url: string;
  key: string;
}

export interface AiChatContext {
  currentPath?: string;
  currentUrl?: string;
  currentProductSlug?: string;
  currentAuctionIdOrCode?: string;
  language?: AiChatLanguage;
  userId?: string;
}

export interface AiConversationTurn {
  role: 'user' | 'model';
  text: string;
  imageUrl?: string;
  timestamp: number;
}

export interface AiFunctionCall {
  id?: string;
  name: string;
  args: Record<string, unknown>;
}

export interface AiToolResult {
  name: string;
  response: Record<string, unknown>;
}

export interface AiToolRoundMessage {
  calls: AiFunctionCall[];
  results: AiToolResult[];
  /** Preserves raw provider Content (e.g., Gemini thoughtSignature) across rounds */
  rawModelContent?: unknown;
}

export interface AiToolDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface AiProductShopSummary {
  name: string;
  slug: string;
}

export interface AiProductCard {
  slug: string;
  name: string;
  imageUrl?: string | null;
  minPrice: string | null;
  originalPrice?: string | null;
  unitsSold?: number;
  shop?: AiProductShopSummary | null;
}

export interface AiAuctionCard {
  id: string;
  auctionId: string;
  code: string | null;
  title: string;
  imageUrl?: string | null;
  status: string;
  currentPrice: number;
  bidStep: number;
  minNextBid: number;
  bidCount: number;
  startTime: string | null;
  endTime: string;
  has3dModel: boolean;
}

export type AiUiActionType =
  | 'SHOW_PRODUCTS'
  | 'SHOW_AUCTIONS'
  | 'NAVIGATE'
  | 'OPEN_SEARCH'
  | 'HANDOFF_TO_SHOP';

export interface AiUiAction {
  type: AiUiActionType;
  url?: string;
  slug?: string;
  auctionIdOrCode?: string;
  searchQuery?: string;
  shopSlug?: string;
  productSlug?: string;
}

export interface AiUiActionVerifyOptions {
  allowedShopSlugs?: readonly string[];
  observedAuctions?: readonly AiAuctionCard[];
  userMessage?: string;
}

export interface AiAgentChatInput {
  sessionId: string;
  message?: string;
  image?: AiImageInput;
  context?: AiChatContext;
  requesterKey: string;
  isAuthenticated: boolean;
  /** Internal flag set when an HTTP guard has already consumed the rate-limit quota */
  skipRateLimit?: boolean;
}

export interface AiAgentChatOutput {
  reply: string;
  products: AiProductCard[];
  auctions?: AiAuctionCard[];
  action: AiUiAction | null;
  suggestions: string[];
}

export interface AiModelTurnRequest {
  systemPrompt: string;
  history: AiConversationTurn[];
  userMessage: string;
  image?: AiImageInput;
  toolDeclarations: readonly AiToolDeclaration[];
  toolRoundMessages: AiToolRoundMessage[];
}

export interface AiModelTurnResponse {
  text: string;
  functionCalls: AiFunctionCall[];
  suggestions?: string[];
  rawModelContent?: unknown;
}

export interface AiToolExecutionResult {
  toolResult: Record<string, unknown>;
  products?: AiProductCard[];
  auctions?: AiAuctionCard[];
  observedShopSlugs?: string[];
}

/**
 * Contract for the Gemini (or LLM) client wrapper.
 * Implemented by BE-11 (Hoang: GeminiClientService).
 */
export abstract class AiModelClientApi {
  abstract generateTurn(
    request: AiModelTurnRequest,
  ): Promise<AiModelTurnResponse>;
}

/**
 * Contract for executing AI tools against Nexus services / database.
 * Implemented by BE-08..BE-10 & BE-13 (Khoa & Hoang: ToolExecutorService).
 */
export abstract class AiToolExecutorApi {
  abstract getDeclarations(options: {
    isAuthenticated: boolean;
  }): readonly AiToolDeclaration[];

  abstract execute(
    call: AiFunctionCall,
    context: AiChatContext,
  ): Promise<AiToolExecutionResult>;
}

/**
 * Contract for verifying UI actions emitted by the model (e.g., NAVIGATE, HANDOFF_TO_SHOP).
 * Ensures the AI never fabricates external URLs, non-existent slugs, or unverified shopSlugs.
 */
export abstract class AiUiActionGuardApi {
  abstract verifyAndBuildAction(
    rawActionCall: AiFunctionCall,
    observedProducts: AiProductCard[],
    options?: AiUiActionVerifyOptions,
  ): Promise<AiUiAction | null>;
}
