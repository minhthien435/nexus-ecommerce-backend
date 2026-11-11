import 'reflect-metadata';
import { Global, Module, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TransformInterceptor } from '../../common/interceptors/transform.interceptor.js';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { AccessTokenGuard } from '../identity/auth/guards/access-token.guard.js';
import { UserEntity } from '../identity/domain/user.entity.js';
import { CategoryService } from '../catalog/services/category.service.js';
import { ProductSearchService } from '../catalog/services/product-search.service.js';
import { AiAssistantModule } from './ai-assistant.module.js';
import { parseAiChat } from './dtos/ai-chat.dto.js';
import { AiImageService, isPublicV4 } from './services/ai-image.service.js';
import { GeminiClientService } from './services/gemini-client.service.js';
import {
  AiSampleOrchestrator,
  AI_DEMO_RESULT,
} from './services/ai-sample-orchestrator.js';
import { SearchProductsTool } from './tools/search-products.tool.js';
import { TrackMyOrderTool } from './tools/track-my-order.tool.js';
import { ToolExecutorService } from './tools/tool-executor.service.js';
import { UiActionHandler } from './tools/ui-action.handler.js';

const sessionId = '4f9b8c5a-1122-482a-9e58-69ebf4249a11';
const input = { sessionId, message: 'Tìm áo' };
const image = {
  key: 'ai/a.png',
  url: 'https://project.supabase.co/storage/v1/object/public/media/ai/a.png',
};
const config = new ConfigService({
  GEMINI_MODEL: 'test-model',
  GEMINI_API_KEY: 'fake',
  GEMINI_TIMEOUT_MS: '1234',
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_STORAGE_BUCKET: 'media',
});
const product = {
  slug: 'red-shoe',
  name: 'Red shoe',
  minPrice: '12.50',
  originalPrice: null,
  unitsSold: 2,
  shop: { name: 'Shop', slug: 'shop' },
  imageUrl: null,
};
afterEach(() => vi.useRealTimers());

describe('v2 DTO', () => {
  it.each([
    {},
    { ...input, sessionId: 'old-session' },
    { ...input, message: '' },
    { ...input, message: 'x'.repeat(1001) },
    { ...input, context: { currentUrl: '/' } },
    { ...input, context: { currentPath: '//evil.test' } },
    { ...input, context: { currentPath: '/a b' } },
    { ...input, userId: sessionId },
    { ...input, systemInstruction: 'override' },
  ])('rejects invalid request %#', (value) =>
    expect(() => parseAiChat(value)).toThrow(),
  );
  it.each([
    { ...input, imageBase64: 'AAAA' },
    { ...input, imageUrl: image.url },
    { ...input, image: { ...image, mimeType: 'image/png' } },
  ])('rejects legacy image %#', (value) => {
    try {
      parseAiChat(value);
      throw new Error('accepted');
    } catch (error) {
      expect((error as { getResponse(): unknown }).getResponse()).toMatchObject(
        { errorCode: 'AI_IMAGE_INVALID' },
      );
    }
  });
  it('accepts FE UUID, currentPath and image with empty message', () => {
    expect(
      parseAiChat({ ...input, context: { currentPath: '/products/red-shoe' } }),
    ).toMatchObject(input);
    expect(parseAiChat({ sessionId, message: '', image }).image).toEqual(image);
  });
  it.each(['chat/a.png', 'ai/../a.png', 'ai/%61.png', 'ai/b.png'])(
    'rejects mismatched key %s before download',
    async (key) => {
      await expect(
        new AiImageService(config).prepare({
          ...input,
          image: { ...image, key },
        }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ errorCode: 'AI_IMAGE_INVALID' }),
      });
    },
  );
  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '172.16.1.1',
    '192.168.0.1',
    '100.64.0.1',
    '::1',
    '::ffff:127.0.0.1',
    '224.0.0.1',
  ])('blocks private address %s', (ip) => expect(isPublicV4(ip)).toBe(false));
});

describe('grounded tools', () => {
  it('reuses catalog and enriches current active DB results without internal IDs', async () => {
    const search = vi.fn().mockResolvedValue({
      items: [{ id: sessionId, defaultSkuId: sessionId }],
    });
    const query = vi.fn().mockResolvedValue([{ ...product, unitsSold: '2' }]);
    const tool = new SearchProductsTool(
      { search } as unknown as ProductSearchService,
      {
        getBySlug: vi.fn().mockResolvedValue({ id: sessionId, isActive: true }),
      } as unknown as CategoryService,
      { query } as unknown as DataSource,
    );
    expect(
      await tool.execute({ query: 'shoe', categorySlug: 'shoes' }),
    ).toEqual([product]);
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 5,
        keyword: 'shoe',
        categoryId: sessionId,
      }),
      { activeShopOnly: true },
    );
    expect(query.mock.calls[0][0]).toContain(
      "shop.status = 'ACTIVE' AND shop.deleted_at IS NULL",
    );
    expect(query.mock.calls[0][0]).toContain(
      "p.status = 'ACTIVE' AND p.deleted_at IS NULL",
    );
    query.mockResolvedValueOnce([]); // no eligible active shop after authoritative recheck
    expect(await tool.execute({ query: 'shoe' })).toEqual([]);
    for (const args of [
      { limit: 6 },
      { userId: sessionId },
      { minPrice: 20, maxPrice: 10 },
      { sort: 'random' },
    ])
      await expect(tool.execute({ query: 'shoe', ...args })).rejects.toThrow();
  });
  it('scopes order reads by verified buyer, hides other orders and rejects AI identity', async () => {
    const query = vi
      .fn()
      .mockImplementation(async (_sql, params) =>
        params[1] === sessionId
          ? [{ status: 'SHIPPED', trackingCode: 'GHN123' }]
          : [],
      );
    const tool = new TrackMyOrderTool({ query } as unknown as DataSource);
    expect(await tool.execute({ orderNumber: 'ORD-1' }, sessionId)).toEqual({
      status: 'SHIPPED',
      trackingCode: 'GHN123',
    });
    expect(query.mock.calls[0][0]).toContain('buyer_id = $2::uuid');
    expect(await tool.execute({ orderNumber: 'ORD-1' }, 'other')).toBeNull();
    await expect(tool.execute({ orderNumber: 'ORD-1' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(
      tool.execute({ orderNumber: 'ORD-1', userId: sessionId }, 'other'),
    ).rejects.toThrow();
    expect(query).toHaveBeenCalledTimes(2);
  });
  it('returns null for invalid actions; requires user consent and current evidence', () => {
    const handler = new UiActionHandler();
    expect(
      handler.execute(
        { type: 'NAVIGATE', slug: product.slug },
        [product],
        'Mở sản phẩm đầu tiên',
      ),
    ).toEqual({ type: 'NAVIGATE', url: '/products/red-shoe' });
    for (const message of ['', 'Tìm giày đỏ', 'Đừng mở sản phẩm đó'])
      expect(
        handler.execute(
          { type: 'NAVIGATE', slug: product.slug },
          [product],
          message,
        ),
      ).toBeNull();
    expect(
      handler.execute(
        { type: 'NAVIGATE', slug: product.slug },
        [],
        'Mở sản phẩm đó',
      ),
    ).toBeNull();
    expect(
      handler.execute({ type: 'HANDOFF_TO_SHOP', shopSlug: 'unknown' }, [
        product,
      ]),
    ).toBeNull();
    expect(
      handler.execute(
        { type: 'HANDOFF_TO_SHOP', shopSlug: 'shop', productSlug: 'red-shoe' },
        [product],
      ),
    ).toEqual({
      type: 'HANDOFF_TO_SHOP',
      shopSlug: 'shop',
      productSlug: 'red-shoe',
    });
    expect(handler.execute({ type: 'SHOW_PRODUCTS' }, [product])).toEqual({
      type: 'SHOW_PRODUCTS',
    });
    expect(handler.execute({ type: 'SHOW_PRODUCTS' }, [])).toBeNull();
    expect(
      handler.execute({ type: 'OPEN_SEARCH', searchQuery: 'shoe & bag' }, []),
    ).toEqual({ type: 'OPEN_SEARCH', url: '/search?q=shoe%20%26%20bag' });
    for (const value of [
      null,
      { type: 'DELETE_ORDER' },
      { type: 'NAVIGATE', slug: 'evil', consent: true },
    ])
      expect(handler.execute(value, [product])).toBeNull();
  });
  it('dispatches only allowlisted tools and keeps turn evidence separate', async () => {
    const executor = new ToolExecutorService(
      {
        execute: vi.fn().mockResolvedValue([product]),
      } as unknown as SearchProductsTool,
      { execute: vi.fn() } as unknown as TrackMyOrderTool,
      new UiActionHandler(),
    );
    const turn = { userMessage: 'Mở sản phẩm đó', products: [] };
    await executor.execute('search_products', { query: 'shoe' }, turn);
    expect(
      await executor.execute(
        'ui_action',
        { type: 'NAVIGATE', slug: product.slug },
        turn,
      ),
    ).toMatchObject({ type: 'NAVIGATE' });
    expect(
      await executor.execute(
        'ui_action',
        { type: 'NAVIGATE', slug: product.slug },
        { userMessage: turn.userMessage, products: [] },
      ),
    ).toBeNull();
    await expect(executor.execute('delete_order', {}, turn)).rejects.toThrow();
    await expect(
      executor.execute('get_product_detail', {}, turn),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ errorCode: 'AI_UNAVAILABLE' }),
    });
  });
});

describe('Gemini', () => {
  it('uses configured model, timeout and trusted prompt with read-only declarations', async () => {
    const generate = vi.fn().mockResolvedValue({});
    const client = new GeminiClientService(
      config,
      { generate },
      new AiImageService(config),
    );
    const content = await client.prepareUserContent(input);
    await client.generate([content], undefined, 'trusted prompt');
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'test-model',
        config: expect.objectContaining({
          systemInstruction: 'trusted prompt',
          httpOptions: { timeout: 1234, retryOptions: { attempts: 1 } },
        }),
      }),
    );
  });
  it('aborts a stalled transport at configured deadline and sanitizes errors', async () => {
    vi.useFakeTimers();
    const generate = vi.fn().mockImplementation(() => new Promise(() => {}));
    const pending = new GeminiClientService(
      config,
      { generate },
      new AiImageService(config),
    ).generate([]);
    const assertion = expect(pending).rejects.toMatchObject({
      response: expect.objectContaining({ errorCode: 'AI_UNAVAILABLE' }),
    });
    await vi.advanceTimersByTimeAsync(1234);
    await assertion;
    expect(generate.mock.calls[0][0].config.abortSignal.aborted).toBe(true);
  });
  it('constructs without credentials and fails unavailable without transport calls', async () => {
    const generate = vi.fn();
    const client = new GeminiClientService(
      new ConfigService({}),
      { generate },
      new AiImageService(config),
    );
    await expect(client.generate([])).rejects.toMatchObject({
      response: expect.objectContaining({ errorCode: 'AI_UNAVAILABLE' }),
    });
    expect(generate).not.toHaveBeenCalled();
  });
  it('retries transient errors at most twice without exposing provider messages', async () => {
    vi.useFakeTimers();
    const generate = vi
      .fn()
      .mockRejectedValue({ status: 503, message: 'SECRET' });
    const pending = new GeminiClientService(
      config,
      { generate },
      new AiImageService(config),
    ).generate([]);
    const assertion = expect(pending).rejects.toThrow('Xin lỗi');
    await vi.runAllTimersAsync();
    await assertion;
    expect(generate).toHaveBeenCalledTimes(3);
  });
});

const verifyAsync = vi.fn();
const findOne = vi.fn();
@Global()
@Module({
  providers: [{ provide: DataSource, useValue: { query: vi.fn() } }],
  exports: [DataSource],
})
class FakeDatabaseModule {}
@Module({
  providers: [
    { provide: ProductSearchService, useValue: {} },
    { provide: CategoryService, useValue: {} },
  ],
  exports: [ProductSearchService, CategoryService],
})
class FakeCatalogModule {}
@Module({
  providers: [
    AccessTokenGuard,
    { provide: JwtService, useValue: { verifyAsync } },
    { provide: getRepositoryToken(UserEntity), useValue: { findOne } },
  ],
  exports: [AccessTokenGuard],
})
class FakeIdentityModule {}

describe('registered endpoint', () => {
  it('boots without key; validates DTO/auth, exact demo envelope, rate limit and production fail-closed', async () => {
    const settings = { NODE_ENV: 'development', AI_MOCK_ENABLED: 'true' };
    const module = await Test.createTestingModule({
      imports: [FakeDatabaseModule, AiAssistantModule.register()],
    })
      .overrideModule(CatalogModule)
      .useModule(FakeCatalogModule)
      .overrideModule(IdentityModule)
      .useModule(FakeIdentityModule)
      .overrideProvider(ConfigService)
      .useValue(new ConfigService(settings))
      .compile();
    const app = module.createNestApplication();
    app.useGlobalInterceptors(new TransformInterceptor());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    try {
      const api = () => request(app.getHttpServer()).post('/api/v1/ai/chat');
      expect((await api().send(input).expect(200)).body).toEqual({
        success: true,
        statusCode: 200,
        message: 'OK',
        data: AI_DEMO_RESULT,
      });
      expect(
        (
          await api()
            .send({ ...input, message: '' })
            .expect(400)
        ).body.errorCode,
      ).toBe('AI_MESSAGE_INVALID');
      expect(
        (
          await api()
            .send({ ...input, image })
            .expect(401)
        ).body.errorCode,
      ).toBe('AI_IMAGE_LOGIN_REQUIRED');
      verifyAsync.mockRejectedValueOnce(new Error('bad token'));
      await api()
        .set('Authorization', 'Bearer invalid')
        .send(input)
        .expect(401);
      verifyAsync.mockResolvedValue({ sub: sessionId, tokenVersion: 1 });
      findOne.mockResolvedValue({ id: sessionId, tokenVersion: 1 });
      expect(
        (
          await api()
            .set('Authorization', 'Bearer good')
            .send({ ...input, image: { ...image, key: 'chat/a.png' } })
            .expect(400)
        ).body.errorCode,
      ).toBe('AI_IMAGE_INVALID');
      settings.AI_MOCK_ENABLED = 'false';
      expect((await api().send(input).expect(503)).body.errorCode).toBe(
        'AI_UNAVAILABLE',
      );
      settings.AI_MOCK_ENABLED = 'true';
      settings.NODE_ENV = 'production';
      expect((await api().send(input).expect(503)).body.errorCode).toBe(
        'AI_UNAVAILABLE',
      );
      settings.NODE_ENV = 'development';
      for (let i = 0; i < 5; i++) await api().send(input).expect(200);
      const limited = await api().send(input).expect(429);
      expect(limited.body.errorCode).toBe('AI_RATE_LIMITED');
      expect(limited.body.data.retryAfterSeconds).toBeGreaterThan(0);
      expect(limited.headers['retry-after']).toBeDefined();
    } finally {
      await app.close();
    }
  });
  it.each(['production', '', 'staging'])(
    'disallows sample outside explicit development/test: %s',
    async (NODE_ENV) => {
      await expect(
        new AiSampleOrchestrator(
          new ConfigService({ NODE_ENV, AI_MOCK_ENABLED: 'true' }),
        ).chat(),
      ).rejects.toThrow();
    },
  );
});
it('accepts encoded internal search paths and rejects unsafe encodings', () => {
  expect(
    parseAiChat({
      ...input,
      context: { currentPath: '/search?q=shoe%20%26%20bag' },
    }).context?.currentPath,
  ).toBe('/search?q=shoe%20%26%20bag');
  for (const currentPath of [
    '/search?q=%ZZ',
    '/search?q=%',
    '/%2fevil.test',
    '/search?q=%00',
    '/search?q=%0a',
    '/search?q=%5c',
  ])
    expect(() => parseAiChat({ ...input, context: { currentPath } })).toThrow();
});
