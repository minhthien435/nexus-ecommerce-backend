import {
  BadRequestException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  AiModelClientApi,
  AiProductCard,
  AiToolExecutorApi,
} from '../contracts/ai-assistant.types.js';
import { AiAgentService } from './ai-agent.service.js';
import { DefaultAiUiActionGuard } from './ai-fallback.adapters.js';
import type { AiRateLimitService } from './ai-rate-limit.service.js';
import type { AiSessionService } from './ai-session.service.js';

const VALID_IMAGE_URL =
  'https://project.supabase.co/storage/v1/object/public/nexus-media/ai/1794-ao-hoodie.jpg';
const VALID_IMAGE_KEY = 'ai/1794-ao-hoodie.jpg';

function createAgentContext(overrides?: Record<string, string | number>) {
  const configValues: Record<string, unknown> = {
    AI_ASSISTANT_ENABLED: 'true',
    AI_MAX_TOOL_ROUNDS: 4,
    GEMINI_TIMEOUT_MS: 5000,
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_STORAGE_BUCKET: 'nexus-media',
    ...overrides,
  };
  const config = {
    get: vi.fn((key: string, defaultVal?: unknown) =>
      key in configValues ? configValues[key] : defaultVal,
    ),
  } as unknown as ConfigService;

  const sessionService = {
    getHistory: vi.fn().mockResolvedValue([]),
    appendTurns: vi.fn().mockResolvedValue(undefined),
  } as unknown as AiSessionService;

  const rateLimitService = {
    consume: vi
      .fn()
      .mockResolvedValue({ limit: 10, remaining: 9, retryAfterSeconds: 60 }),
  } as unknown as AiRateLimitService;

  const modelClient = {
    generateTurn: vi.fn(),
  } as unknown as AiModelClientApi & {
    generateTurn: ReturnType<typeof vi.fn>;
  };

  const toolExecutor = {
    getDeclarations: vi.fn().mockReturnValue([
      {
        name: 'search_products',
        description: 'Search products',
        parameters: { type: 'object', properties: {} },
      },
    ]),
    execute: vi.fn(),
  } as unknown as AiToolExecutorApi & {
    getDeclarations: ReturnType<typeof vi.fn>;
    execute: ReturnType<typeof vi.fn>;
  };

  const uiActionGuard = new DefaultAiUiActionGuard();

  const agent = new AiAgentService(
    config,
    sessionService,
    rateLimitService,
    modelClient,
    toolExecutor,
    uiActionGuard,
  );

  return {
    agent,
    sessionService,
    rateLimitService,
    modelClient,
    toolExecutor,
  };
}

describe('AiAgentService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws 503 AI_UNAVAILABLE when AI_ASSISTANT_ENABLED is false', async () => {
    const { agent } = createAgentContext({ AI_ASSISTANT_ENABLED: 'false' });

    await expect(
      agent.chat({
        sessionId: 'sess-1',
        message: 'Tìm áo thun',
        requesterKey: '127.0.0.1',
        isAuthenticated: false,
      }),
    ).rejects.toMatchObject({
      status: 503,
      response: expect.objectContaining({ errorCode: 'AI_UNAVAILABLE' }),
    });
  });

  it('validates sessionId, message length (max 1000), guest image auth, and AI storage prefix', async () => {
    const { agent } = createAgentContext();

    await expect(
      agent.chat({
        sessionId: '../bad',
        message: 'hi',
        requesterKey: '127.0.0.1',
        isAuthenticated: false,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      agent.chat({
        sessionId: 'sess-1',
        message: '   ',
        requesterKey: '127.0.0.1',
        isAuthenticated: false,
      }),
    ).rejects.toMatchObject({
      status: 400,
      response: expect.objectContaining({ errorCode: 'AI_MESSAGE_INVALID' }),
    });

    await expect(
      agent.chat({
        sessionId: 'sess-1',
        message: 'a'.repeat(1001),
        requesterKey: '127.0.0.1',
        isAuthenticated: false,
      }),
    ).rejects.toMatchObject({
      status: 400,
      response: expect.objectContaining({ errorCode: 'AI_MESSAGE_INVALID' }),
    });

    const guestImageCall = agent.chat({
      sessionId: 'sess-1',
      message: 'Tìm áo giống ảnh',
      image: { url: VALID_IMAGE_URL, key: VALID_IMAGE_KEY },
      requesterKey: '127.0.0.1',
      isAuthenticated: false,
    });
    await expect(guestImageCall).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(guestImageCall).rejects.toMatchObject({
      status: 401,
      response: expect.objectContaining({
        errorCode: 'AI_IMAGE_LOGIN_REQUIRED',
      }),
    });

    await expect(
      agent.chat({
        sessionId: 'sess-1',
        message: 'Tìm áo giống ảnh',
        image: {
          url: VALID_IMAGE_URL,
          key: VALID_IMAGE_KEY,
          base64: 'AAAA',
        } as never,
        requesterKey: 'user-1',
        isAuthenticated: true,
      }),
    ).rejects.toMatchObject({
      status: 400,
      response: expect.objectContaining({ errorCode: 'AI_IMAGE_INVALID' }),
    });

    await expect(
      agent.chat({
        sessionId: 'sess-1',
        message: 'Tìm áo giống ảnh',
        image: {
          url: 'https://project.supabase.co/storage/v1/object/public/nexus-media/chat/other.jpg',
          key: 'chat/other.jpg',
        },
        requesterKey: 'user-1',
        isAuthenticated: true,
      }),
    ).rejects.toMatchObject({
      status: 400,
      response: expect.objectContaining({ errorCode: 'AI_IMAGE_INVALID' }),
    });

    await expect(
      agent.chat({
        sessionId: 'sess-1',
        message: 'Tìm áo giống ảnh',
        image: { url: 'https://evil.test/hack.jpg', key: VALID_IMAGE_KEY },
        requesterKey: 'user-1',
        isAuthenticated: true,
      }),
    ).rejects.toMatchObject({
      status: 400,
      response: expect.objectContaining({ errorCode: 'AI_IMAGE_INVALID' }),
    });
  });

  it('completes a multi-round Function Calling loop, strips internal id, preserves rawModelContent, and scopes session', async () => {
    const { agent, modelClient, toolExecutor, sessionService } =
      createAgentContext();

    const rawProductFromTool = {
      id: 'internal-db-uuid-must-be-stripped',
      slug: 'ao-hoodie-ni-xam-oversize',
      name: 'Áo Hoodie Nỉ Xám Oversize',
      minPrice: '280000.00',
      originalPrice: '350000.00',
      imageUrl: 'https://cdn.nexus.vn/hoodie.jpg',
      unitsSold: 94,
      shop: { name: 'Nexus Fashion', slug: 'nexus-fashion' },
    } as AiProductCard & { id: string };

    const rawContentRound1 = {
      role: 'model',
      parts: [
        {
          functionCall: { name: 'search_products' },
          thoughtSignature: 'sig-1',
        },
      ],
    };

    modelClient.generateTurn.mockResolvedValueOnce({
      text: '',
      rawModelContent: rawContentRound1,
      functionCalls: [
        {
          name: 'search_products',
          args: { query: 'áo hoodie nỉ xám oversize' },
        },
      ],
    });
    toolExecutor.execute.mockResolvedValueOnce({
      toolResult: { items: [rawProductFromTool] },
      products: [rawProductFromTool],
    });

    modelClient.generateTurn.mockResolvedValueOnce({
      text: 'Mình tìm thấy mẫu Áo Hoodie Nỉ Xám Oversize rất giống ảnh bạn gửi (280.000đ). Đang chuyển bạn tới trang sản phẩm nhé!',
      functionCalls: [
        {
          name: 'ui_action',
          args: { type: 'NAVIGATE', slug: 'ao-hoodie-ni-xam-oversize' },
        },
      ],
      suggestions: [
        'Còn size L không?',
        'Xem màu khác',
        'So sánh giá',
        'Dư thừa thứ 4',
      ],
    });

    const result = await agent.chat({
      sessionId: 'sess-visual',
      image: { url: VALID_IMAGE_URL, key: VALID_IMAGE_KEY },
      context: {
        currentPath: '/products/ao-so-mi-trang-oxford',
        userId: 'buyer-9',
      },
      requesterKey: 'user:buyer-9',
      isAuthenticated: true,
    });

    expect(modelClient.generateTurn).toHaveBeenCalledTimes(2);
    expect(modelClient.generateTurn.mock.calls[0][0].userMessage).toBe(
      'Tìm sản phẩm tương tự trong ảnh này',
    );
    expect(modelClient.generateTurn.mock.calls[0][0].systemPrompt).toContain(
      'ao-so-mi-trang-oxford',
    );
    expect(
      modelClient.generateTurn.mock.calls[1][0].toolRoundMessages[0]
        .rawModelContent,
    ).toEqual(rawContentRound1);

    expect(result).toEqual({
      reply:
        'Mình tìm thấy mẫu Áo Hoodie Nỉ Xám Oversize rất giống ảnh bạn gửi (280.000đ). Đang chuyển bạn tới trang sản phẩm nhé!',
      products: [
        {
          slug: 'ao-hoodie-ni-xam-oversize',
          name: 'Áo Hoodie Nỉ Xám Oversize',
          minPrice: '280000.00',
          originalPrice: '350000.00',
          imageUrl: 'https://cdn.nexus.vn/hoodie.jpg',
          unitsSold: 94,
          shop: { name: 'Nexus Fashion', slug: 'nexus-fashion' },
        },
      ],
      action: {
        type: 'NAVIGATE',
        slug: 'ao-hoodie-ni-xam-oversize',
        url: '/products/ao-hoodie-ni-xam-oversize',
      },
      suggestions: ['Còn size L không?', 'Xem màu khác', 'So sánh giá'],
    });
    expect('id' in result.products[0]).toBe(false);

    expect(sessionService.getHistory).toHaveBeenCalledWith(
      'sess-visual',
      6,
      'user:buyer-9',
    );
    expect(sessionService.appendTurns).toHaveBeenCalledWith(
      'sess-visual',
      expect.arrayContaining([
        expect.objectContaining({
          role: 'user',
          text: 'Tìm sản phẩm tương tự trong ảnh này',
          imageUrl: VALID_IMAGE_URL,
        }),
        expect.objectContaining({
          role: 'model',
          text: result.reply,
        }),
      ]),
      'user:buyer-9',
    );
  });

  it('blocks hallucinated NAVIGATE / HANDOFF_TO_SHOP and downgrades action safely to SHOW_PRODUCTS', async () => {
    const { agent, modelClient, toolExecutor } = createAgentContext();
    const realProduct: AiProductCard = {
      slug: 'ao-thun-cotton-compact',
      name: 'Áo Thun Cotton Compact',
      minPrice: '189000.00',
      originalPrice: null,
      imageUrl: null,
      shop: { name: 'Nexus Official', slug: 'nexus-official' },
    };

    modelClient.generateTurn
      .mockResolvedValueOnce({
        text: '',
        functionCalls: [
          { name: 'search_products', args: { query: 'áo thun' } },
        ],
      })
      .mockResolvedValueOnce({
        text: 'Đây là sản phẩm gợi ý cho bạn.',
        functionCalls: [
          {
            name: 'ui_action',
            args: { type: 'NAVIGATE', slug: 'slug-ao-ai-tu-bia-ra' },
          },
        ],
      });
    toolExecutor.execute.mockResolvedValueOnce({
      toolResult: { items: [realProduct] },
      products: [realProduct],
    });

    const result = await agent.chat({
      sessionId: 'sess-guard',
      message: 'Mở áo thun cho tôi',
      requesterKey: '127.0.0.1',
      isAuthenticated: false,
    });

    expect(result.action).toEqual({ type: 'SHOW_PRODUCTS' });
    expect(result.products).toEqual([realProduct]);
  });

  it('caps tool execution at AI_MAX_TOOL_ROUNDS and returns deterministic summary', async () => {
    const { agent, modelClient, toolExecutor } = createAgentContext({
      AI_MAX_TOOL_ROUNDS: 2,
    });

    modelClient.generateTurn.mockResolvedValue({
      text: '',
      functionCalls: [{ name: 'search_products', args: { query: 'giày' } }],
    });
    toolExecutor.execute.mockResolvedValue({
      toolResult: { items: [] },
      products: [],
    });

    const result = await agent.chat({
      sessionId: 'sess-cap',
      message: 'Tìm giày chạy bộ',
      requesterKey: '127.0.0.1',
      isAuthenticated: false,
    });

    expect(modelClient.generateTurn).toHaveBeenCalledTimes(2);
    expect(result.reply).toContain('chưa tìm được sản phẩm');
  });

  it('throws 503 AI_UNAVAILABLE when Gemini fails or times out per v2 spec', async () => {
    const { agent, modelClient } = createAgentContext();

    modelClient.generateTurn.mockRejectedValue(
      new Error('Gemini rate limit upstream'),
    );

    await expect(
      agent.chat({
        sessionId: 'sess-down',
        message: 'tai nghe bluetooth',
        requesterKey: '127.0.0.1',
        isAuthenticated: false,
      }),
    ).rejects.toMatchObject({
      status: 503,
      response: expect.objectContaining({ errorCode: 'AI_UNAVAILABLE' }),
    });

    await expect(
      agent.chat({
        sessionId: 'sess-down',
        message: 'tai nghe bluetooth',
        requesterKey: '127.0.0.1',
        isAuthenticated: false,
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('filters returned product cards using SHOW_PRODUCTS slugs and supports empty selection', async () => {
    const diceProduct: AiProductCard = {
      slug: 'bo-xuc-xac-pokemon',
      name: 'Bộ xúc xắc Pokémon',
      minPrice: '320000.00',
      originalPrice: null,
      imageUrl: null,
      shop: { name: 'Shop Pokemon', slug: 'shop-pokemon' },
    };
    const playmatProduct: AiProductCard = {
      slug: 'tham-dau-pokemon',
      name: 'Thảm đấu Pokémon',
      minPrice: '490000.00',
      originalPrice: null,
      imageUrl: null,
      shop: { name: 'Shop Pokemon', slug: 'shop-pokemon' },
    };

    const { agent, modelClient, toolExecutor } = createAgentContext();
    modelClient.generateTurn
      .mockResolvedValueOnce({
        text: '',
        functionCalls: [
          { name: 'search_products', args: { query: 'pokemon' } },
        ],
      })
      .mockResolvedValueOnce({
        text: 'Mình tìm thấy đúng bộ xúc xắc Pokémon khớp với ảnh của bạn.',
        functionCalls: [
          {
            name: 'ui_action',
            args: {
              type: 'SHOW_PRODUCTS',
              slugs: ['bo-xuc-xac-pokemon', 'hallucinated-slug'],
            },
          },
        ],
      });
    toolExecutor.execute.mockResolvedValueOnce({
      toolResult: { items: [diceProduct, playmatProduct] },
      products: [diceProduct, playmatProduct],
    });

    const filteredResult = await agent.chat({
      sessionId: 'sess-filter',
      message: 'Tìm sản phẩm giống ảnh',
      requesterKey: '127.0.0.1',
      isAuthenticated: false,
    });

    expect(filteredResult.products).toEqual([diceProduct]);
    expect(filteredResult.action).toEqual({ type: 'SHOW_PRODUCTS' });

    modelClient.generateTurn
      .mockResolvedValueOnce({
        text: '',
        functionCalls: [
          { name: 'search_products', args: { query: 'pokemon' } },
        ],
      })
      .mockResolvedValueOnce({
        text: 'Xin lỗi, Nexus chưa có gấu bông Pokémon như trong ảnh.',
        functionCalls: [
          {
            name: 'ui_action',
            args: { type: 'SHOW_PRODUCTS', slugs: [] },
          },
        ],
      });
    toolExecutor.execute.mockResolvedValueOnce({
      toolResult: { items: [diceProduct, playmatProduct] },
      products: [diceProduct, playmatProduct],
    });

    const emptySelectionResult = await agent.chat({
      sessionId: 'sess-empty-filter',
      message: 'Tìm gấu bông giống ảnh',
      requesterKey: '127.0.0.1',
      isAuthenticated: false,
    });

    expect(emptySelectionResult.products).toEqual([]);
    expect(emptySelectionResult.action).toBeNull();
  });
});
