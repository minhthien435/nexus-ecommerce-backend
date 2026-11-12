import 'reflect-metadata';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpExceptionFilter } from '../../../common/filters/http-exception.filter.js';
import { TransformInterceptor } from '../../../common/interceptors/transform.interceptor.js';
import { CatalogModule } from '../../catalog/catalog.module.js';
import { CategoryService } from '../../catalog/services/category.service.js';
import { ProductSearchService } from '../../catalog/services/product-search.service.js';
import { AccessTokenGuard } from '../../identity/auth/guards/access-token.guard.js';
import { UserEntity } from '../../identity/domain/user.entity.js';
import { IdentityModule } from '../../identity/identity.module.js';
import { AiAssistantModule } from '../ai-assistant.module.js';
import { AiImageService } from './ai-image.service.js';
import {
  GeminiClientAdapter,
  ToolExecutorAdapter,
} from './ai-orchestrator.adapters.js';
import { GeminiTransport } from './gemini-client.service.js';

const sessionId = '4f9b8c5a-1122-482a-9e58-69ebf4249a11';
const userId = '11111111-1111-4111-8111-111111111111';

const sampleProduct = {
  slug: 'ao-polo-nexus',
  name: 'Áo Polo Nexus',
  minPrice: '199000.00',
  originalPrice: '250000.00',
  unitsSold: 12,
  shop: { name: 'Nexus Fashion', slug: 'nexus-fashion' },
  imageUrl: 'https://cdn.nexus.vn/polo.jpg',
};

const dbQuery = vi.fn();
const catalogSearch = vi.fn();
const categoryGetBySlug = vi.fn();
const geminiGenerate = vi.fn();
const jwtVerifyAsync = vi.fn();
const userFindOne = vi.fn();

@Global()
@Module({
  providers: [{ provide: DataSource, useValue: { query: dbQuery } }],
  exports: [DataSource],
})
class FakeDatabaseModule {}

@Module({
  providers: [
    { provide: ProductSearchService, useValue: { search: catalogSearch } },
    { provide: CategoryService, useValue: { getBySlug: categoryGetBySlug } },
  ],
  exports: [ProductSearchService, CategoryService],
})
class FakeCatalogModule {}

@Module({
  providers: [
    AccessTokenGuard,
    { provide: JwtService, useValue: { verifyAsync: jwtVerifyAsync } },
    {
      provide: getRepositoryToken(UserEntity),
      useValue: { findOne: userFindOne },
    },
  ],
  exports: [AccessTokenGuard],
})
class FakeIdentityModule {}

describe('AI Assistant Live Integration (Minh + Hoang)', () => {
  let settings: Record<string, string>;

  beforeEach(() => {
    vi.clearAllMocks();
    settings = {
      NODE_ENV: 'test',
      GEMINI_MODEL: 'gemini-2.5-flash',
      GEMINI_API_KEY: 'test-key',
      GEMINI_TIMEOUT_MS: '10000',
      AI_ASSISTANT_ENABLED: 'true',
      AI_MAX_TOOL_ROUNDS: '4',
      AI_RATE_LIMIT_GUEST: '10',
      AI_RATE_LIMIT_USER: '20',
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_STORAGE_BUCKET: 'nexus-media',
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function createTestApp(overrideImages?: Partial<AiImageService>) {
    const builder = Test.createTestingModule({
      imports: [FakeDatabaseModule, AiAssistantModule.registerAgent()],
    })
      .overrideModule(CatalogModule)
      .useModule(FakeCatalogModule)
      .overrideModule(IdentityModule)
      .useModule(FakeIdentityModule)
      .overrideProvider(ConfigService)
      .useValue(
        new Proxy(
          {},
          {
            get: (_t, prop) =>
              prop === 'get'
                ? (key: string, fallback?: unknown) =>
                    key in settings ? settings[key] : fallback
                : undefined,
          },
        ),
      )
      .overrideProvider(GeminiTransport)
      .useValue({ generate: geminiGenerate });

    if (overrideImages) {
      builder.overrideProvider(AiImageService).useValue(overrideImages);
    }

    const moduleRef = await builder.compile();
    const app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new TransformInterceptor());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    return app;
  }

  it('runs multi-turn Gemini + search_products + conservative NAVIGATE guard and enforces guest rate limit once per request', async () => {
    catalogSearch.mockResolvedValue({
      items: [{ id: 'prod-1', defaultSkuId: 'sku-1' }],
    });
    dbQuery.mockResolvedValue([{ ...sampleProduct, unitsSold: '12' }]);

    const round1Content = {
      role: 'model',
      parts: [
        {
          functionCall: {
            id: 'fc-1',
            name: 'search_products',
            args: { query: 'áo polo' },
          },
          thoughtSignature: 'sig-abc',
        },
      ],
    };

    geminiGenerate
      .mockResolvedValueOnce({ candidates: [{ content: round1Content }] })
      .mockResolvedValueOnce({
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                {
                  functionCall: {
                    id: 'fc-2',
                    name: 'ui_action',
                    args: { type: 'NAVIGATE', slug: 'ao-polo-nexus' },
                  },
                },
                {
                  text: 'Mình tìm thấy Áo Polo Nexus giá 199.000đ rất hợp với bạn.',
                },
              ],
            },
          },
        ],
      });

    const app = await createTestApp();
    try {
      const api = () => request(app.getHttpServer()).post('/api/v1/ai/chat');

      // 1) User only searched ("Tìm áo polo"), did NOT request navigation -> must downgrade NAVIGATE to SHOW_PRODUCTS
      const searchRes = await api()
        .send({ sessionId, message: 'Tìm áo polo' })
        .expect(200);

      expect(searchRes.body).toEqual({
        success: true,
        statusCode: 200,
        message: 'OK',
        data: {
          reply: 'Mình tìm thấy Áo Polo Nexus giá 199.000đ rất hợp với bạn.',
          products: [sampleProduct],
          action: { type: 'SHOW_PRODUCTS' },
          suggestions: [
            'Sản phẩm này còn hàng không?',
            'Xem thêm mẫu bán chạy khác',
            'So sánh giá các sản phẩm',
          ],
        },
      });
      expect(geminiGenerate).toHaveBeenCalledTimes(2);
      // Verify thoughtSignature raw content was preserved in round 2
      expect(geminiGenerate.mock.calls[1][0].contents).toEqual(
        expect.arrayContaining([round1Content]),
      );
      // Guest declarations omit track_my_order but include the registered read tools.
      const declaredNames =
        geminiGenerate.mock.calls[0][0].config.tools[0].functionDeclarations.map(
          (d: { name: string }) => d.name,
        );
      expect(declaredNames).toEqual([
        'search_products',
        'ui_action',
        'get_product_detail',
        'get_trending_products',
        'compare_products',
        'get_price_insight',
      ]);

      // 2) User explicitly asks to open product -> NAVIGATE allowed
      geminiGenerate
        .mockResolvedValueOnce({ candidates: [{ content: round1Content }] })
        .mockResolvedValueOnce({
          candidates: [
            {
              content: {
                role: 'model',
                parts: [
                  {
                    functionCall: {
                      name: 'ui_action',
                      args: { type: 'NAVIGATE', slug: 'ao-polo-nexus' },
                    },
                  },
                  { text: 'Mình mở trang Áo Polo Nexus ngay cho bạn.' },
                ],
              },
            },
          ],
        });

      const navRes = await api()
        .send({ sessionId, message: 'Mở sản phẩm đó giúp mình' })
        .expect(200);
      expect(navRes.body.data.action).toEqual({
        type: 'NAVIGATE',
        url: '/products/ao-polo-nexus',
      });

      // 3) Remaining 8 guest requests (total 10) must pass, then 11th returns 429 with Retry-After
      for (let i = 0; i < 8; i++) {
        geminiGenerate.mockResolvedValueOnce({
          candidates: [{ content: { role: 'model', parts: [{ text: 'Ok' }] } }],
        });
        await api().send({ sessionId, message: 'Hi' }).expect(200);
      }

      const limited = await api()
        .send({ sessionId, message: 'Hi' })
        .expect(429);
      expect(limited.body.errorCode).toBe('AI_RATE_LIMITED');
      expect(limited.headers['retry-after']).toBeDefined();
    } finally {
      await app.close();
    }
  });

  it('allows authenticated track_my_order scoped to verified JWT user and returns 503 when Gemini credentials are missing', async () => {
    jwtVerifyAsync.mockResolvedValue({ sub: userId, tokenVersion: 1 });
    userFindOne.mockResolvedValue({ id: userId, tokenVersion: 1 });
    dbQuery.mockResolvedValueOnce([
      { status: 'SHIPPED', trackingCode: 'GHN999' },
    ]);

    geminiGenerate
      .mockResolvedValueOnce({
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                {
                  functionCall: {
                    name: 'track_my_order',
                    args: { orderNumber: 'NEX-123' },
                  },
                },
              ],
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ text: 'Đơn NEX-123 đang giao với mã vận đơn GHN999.' }],
            },
          },
        ],
      });

    const app = await createTestApp();
    try {
      const api = () =>
        request(app.getHttpServer())
          .post('/api/v1/ai/chat')
          .set('Authorization', 'Bearer good-token');

      const orderRes = await api()
        .send({ sessionId, message: 'Kiểm tra đơn NEX-123' })
        .expect(200);

      expect(orderRes.body.data.reply).toContain('GHN999');
      expect(dbQuery).toHaveBeenCalledWith(
        expect.stringContaining('buyer_id'),
        ['NEX-123', userId],
      );
      const declaredNames =
        geminiGenerate.mock.calls[0][0].config.tools[0].functionDeclarations.map(
          (d: { name: string }) => d.name,
        );
      expect(declaredNames).toEqual([
        'search_products',
        'ui_action',
        'track_my_order',
        'get_product_detail',
        'get_trending_products',
        'compare_products',
        'get_price_insight',
      ]);

      // Missing API key degrades cleanly to 503 AI_UNAVAILABLE
      settings.GEMINI_API_KEY = '';
      const downRes = await api()
        .send({ sessionId, message: 'Xin chào' })
        .expect(503);
      expect(downRes.body.errorCode).toBe('AI_UNAVAILABLE');
    } finally {
      await app.close();
    }
  });

  it('memoizes image download within one request across multiple Gemini rounds and wraps ToolExecutor results as plain objects', async () => {
    const prepare = vi
      .fn()
      .mockResolvedValue({ mimeType: 'image/jpeg', data: 'BASE64DATA' });
    catalogSearch.mockResolvedValue({
      items: [{ id: 'prod-1', defaultSkuId: 'sku-1' }],
    });
    dbQuery.mockResolvedValue([{ ...sampleProduct, unitsSold: '12' }]);
    jwtVerifyAsync.mockResolvedValue({ sub: userId, tokenVersion: 1 });
    userFindOne.mockResolvedValue({ id: userId, tokenVersion: 1 });

    geminiGenerate
      .mockResolvedValueOnce({
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                {
                  functionCall: {
                    name: 'search_products',
                    args: { query: 'áo polo' },
                  },
                },
              ],
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ text: 'Đây là áo polo giống ảnh của bạn.' }],
            },
          },
        ],
      });

    const app = await createTestApp({ prepare });
    try {
      const res = await request(app.getHttpServer())
        .post('/api/v1/ai/chat')
        .set('Authorization', 'Bearer good-token')
        .send({
          sessionId,
          message: '',
          image: {
            url: 'https://project.supabase.co/storage/v1/object/public/nexus-media/ai/1794-ao.jpg',
            key: 'ai/1794-ao.jpg',
          },
        })
        .expect(200);

      expect(res.body.data.products).toEqual([sampleProduct]);
      // Once in controller + once in GeminiClientAdapter cached across both rounds = 2 total (NOT 3)
      expect(prepare).toHaveBeenCalledTimes(2);
    } finally {
      await app.close();
    }
  });

  it('wraps search_products array & track_my_order null safely in ToolExecutorAdapter', async () => {
    const toolExecutor = {
      execute: vi
        .fn()
        .mockResolvedValueOnce([sampleProduct])
        .mockResolvedValueOnce(null),
    };
    const adapter = new ToolExecutorAdapter(toolExecutor as never);

    expect(adapter.getDeclarations({ isAuthenticated: false })).toEqual([
      expect.objectContaining({ name: 'search_products' }),
      expect.objectContaining({ name: 'ui_action' }),
    ]);

    const searchOut = await adapter.execute(
      { name: 'search_products', args: { query: 'polo' } },
      {},
    );
    expect(searchOut.toolResult).toEqual({
      items: [sampleProduct],
      count: 1,
    });
    expect(searchOut.observedShopSlugs).toEqual(['nexus-fashion']);

    const orderOut = await adapter.execute(
      { name: 'track_my_order', args: { orderNumber: 'MISSING' } },
      { userId },
    );
    expect(orderOut.toolResult).toEqual({ found: false, order: null });
  });

  it('safely passes history turns in GeminiClientAdapter', async () => {
    const generate = vi.fn().mockResolvedValue({
      candidates: [
        { content: { role: 'model', parts: [{ text: 'Chào bạn' }] } },
      ],
    });
    const adapter = new GeminiClientAdapter(
      { generate } as never,
      { prepare: vi.fn() } as never,
    );
    const out = await adapter.generateTurn({
      systemPrompt: 'sys',
      history: [{ role: 'user', text: 'Xin chào', timestamp: 1 }],
      userMessage: 'Tìm áo',
      toolDeclarations: [],
      toolRoundMessages: [],
    });
    expect(out.text).toBe('Chào bạn');
    expect(generate).toHaveBeenCalledWith(
      [
        { role: 'user', parts: [{ text: 'Xin chào' }] },
        { role: 'user', parts: [{ text: 'Tìm áo' }] },
      ],
      [],
      'sys',
    );
  });

  it('switches to GEMINI_FALLBACK_MODELS seamlessly during live multi-round tool calls', async () => {
    const fallbackUserId = '22222222-2222-4222-8222-222222222222';
    settings.GEMINI_MODEL = 'gemini-3.5-flash-lite';
    settings.GEMINI_FALLBACK_MODELS = 'gemini-3.1-flash-lite,gemini-3.8-flash';
    settings.GEMINI_FALLBACK_COOLDOWN_MS = '30000';

    jwtVerifyAsync.mockResolvedValue({ sub: fallbackUserId, tokenVersion: 1 });
    userFindOne.mockResolvedValue({ id: fallbackUserId, tokenVersion: 1 });
    catalogSearch.mockResolvedValue({
      items: [{ id: 'prod-1', defaultSkuId: 'sku-1' }],
    });
    dbQuery.mockResolvedValue([{ ...sampleProduct, unitsSold: '12' }]);

    const round1Content = {
      role: 'model',
      parts: [
        {
          functionCall: {
            id: 'fc-fb-1',
            name: 'search_products',
            args: { query: 'áo polo' },
          },
          thoughtSignature: 'sig-fb-1',
        },
      ],
    };

    geminiGenerate
      // Round 1: primary fails 503, immediately switches to fallback #1
      .mockRejectedValueOnce({ status: 503, message: 'model overloaded' })
      .mockResolvedValueOnce({ candidates: [{ content: round1Content }] })
      // Round 2: stays on healthy fallback #1 directly (primary in cooldown)
      .mockResolvedValueOnce({
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                {
                  text: 'Mình tìm thấy Áo Polo Nexus giá 199.000đ cho bạn nhé!',
                },
              ],
            },
          },
        ],
      });

    const app = await createTestApp();
    try {
      const res = await request(app.getHttpServer())
        .post('/api/v1/ai/chat')
        .set('Authorization', 'Bearer fallback-user-token')
        .send({ sessionId, message: 'Tìm áo polo giúp mình' })
        .expect(200);

      expect(res.body.data.products).toEqual([sampleProduct]);
      expect(res.body.data.reply).toContain('Áo Polo Nexus');
      expect(geminiGenerate.mock.calls.map((c) => c[0].model)).toEqual([
        'gemini-3.5-flash-lite',
        'gemini-3.1-flash-lite',
        'gemini-3.1-flash-lite',
      ]);
    } finally {
      await app.close();
    }
  });
});
