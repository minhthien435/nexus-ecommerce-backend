import type { FlashDealQuotaService } from '../src/modules/commerce/services/flash-deal-quota.service.js';
const flashDeals = {
  projectForCart: async () => new Map(),
} as unknown as FlashDealQuotaService;
import { INestApplication, ServiceUnavailableException } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor.js';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter.js';
import { AccessTokenGuard } from '../src/modules/identity/auth/guards/access-token.guard.js';
import { UserEntity } from '../src/modules/identity/domain/user.entity.js';
import { PermissionsGuard } from '../src/modules/identity/rbac/guards/permissions.guard.js';
import { RbacService } from '../src/modules/identity/rbac/rbac.service.js';
import { CartController } from '../src/modules/commerce/controllers/cart.controller.js';
import { CartService } from '../src/modules/commerce/services/cart.service.js';
import { CartWriteService } from '../src/modules/commerce/services/cart-write.service.js';

const userId = '11111111-1111-4111-8111-111111111111';
const otherUser = '22222222-2222-4222-8222-222222222222';

describe('GET commerce cart (HTTP)', () => {
  let app: INestApplication;
  let token: string;
  let otherToken: string;
  const carts = { findOne: vi.fn(), query: vi.fn() };
  const items = { find: vi.fn() };
  const catalog = { getCartSkus: vi.fn() };
  const inventory = { getDefaultWarehouseStock: vi.fn() };
  const rbac = { hasAllPermissions: vi.fn() };
  const users = { findOne: vi.fn() };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'cart-test-secret' })],
      controllers: [CartController],
      providers: [
        AccessTokenGuard,
        PermissionsGuard,
        { provide: getRepositoryToken(UserEntity), useValue: users },
        { provide: RbacService, useValue: rbac },
        { provide: CartWriteService, useValue: {} },
        {
          provide: CartService,
          useFactory: () =>
            new CartService(
              carts as never,
              items as never,
              catalog,
              inventory,
              flashDeals,
            ),
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalInterceptors(new TransformInterceptor());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    const jwt = module.get(JwtService);
    token = await jwt.signAsync({ sub: userId, tokenVersion: 0 });
    otherToken = await jwt.signAsync({ sub: otherUser, tokenVersion: 0 });
  });
  beforeEach(() => {
    vi.resetAllMocks();
    users.findOne.mockResolvedValue({ tokenVersion: 0 });
    rbac.hasAllPermissions.mockResolvedValue(true);
    carts.query.mockResolvedValue([
      { observedTime: new Date('2026-10-17T12:00:00Z') },
    ]);
    carts.findOne.mockImplementation(async ({ where }) =>
      where.userId === userId
        ? { id: 'own-cart', expiresAt: new Date('2026-10-24T12:00:00Z') }
        : null,
    );
    items.find.mockResolvedValue([]);
  });
  afterAll(async () => app.close());

  it('rejects missing and invalid JWTs without querying carts', async () => {
    await request(app.getHttpServer()).get('/api/v1/commerce/cart').expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/commerce/cart')
      .set('Authorization', 'Bearer invalid')
      .expect(401);
    expect(carts.findOne).not.toHaveBeenCalled();
  });

  it('enforces CART.VIEW', async () => {
    rbac.hasAllPermissions.mockResolvedValue(false);
    const response = await request(app.getHttpServer())
      .get('/api/v1/commerce/cart')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    expect(response.body.success).toBe(false);
    expect(rbac.hasAllPermissions).toHaveBeenCalledWith(userId, ['CART.VIEW']);
    expect(carts.findOne).not.toHaveBeenCalled();
  });

  it('returns an enveloped empty cart and cannot use query or body userId to read another account', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/commerce/cart?userId=${userId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ userId })
      .expect(200);
    expect(response.body).toMatchObject({
      success: true,
      data: { cartId: null, items: [], subtotal: '0.00' },
    });
    expect(carts.findOne).toHaveBeenCalledWith({
      where: {
        userId: otherUser,
        status: 'ACTIVE',
      },
    });
    expect(items.find).not.toHaveBeenCalled();
  });

  it('reports changed prices and stock exclusions while subtotaling only eligible items', async () => {
    items.find.mockResolvedValue(
      ['a', 'b', 'c'].map((skuId) => ({
        id: skuId,
        skuId,
        productId: 'product',
        quantity: 2,
        unitPriceSnapshot: '1.00',
      })),
    );
    catalog.getCartSkus.mockResolvedValue(
      ['a', 'b', 'c'].map((id) => ({
        id,
        productId: 'product',
        price: '1.25',
        currency: 'VND',
        isActive: true,
        productName: 'Product',
        productStatus: 'ACTIVE',
        productDeletedAt: null,
      })),
    );
    inventory.getDefaultWarehouseStock.mockResolvedValue([
      { skuId: 'a', availableQuantity: 2 },
      { skuId: 'b', availableQuantity: 1 },
      { skuId: 'c', availableQuantity: 0 },
    ]);
    const response = await request(app.getHttpServer())
      .get('/api/v1/commerce/cart')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(response.body.data).toMatchObject({
      subtotal: '2.50',
      hasExcludedItems: true,
      excludedItemCount: 2,
    });
    expect(
      response.body.data.items.map(
        (item: { exclusionReason: string }) => item.exclusionReason,
      ),
    ).toEqual([null, 'INSUFFICIENT_STOCK', 'OUT_OF_STOCK']);
    expect(response.body.data.items[0].priceChanged).toBe(true);
    expect(items.find).toHaveBeenCalledWith({
      where: { cartId: 'own-cart' },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
  });

  it('returns the actual configuration error when no default warehouse exists', async () => {
    items.find.mockResolvedValue([{ skuId: 'a' }]);
    catalog.getCartSkus.mockResolvedValue([]);
    inventory.getDefaultWarehouseStock.mockRejectedValue(
      new ServiceUnavailableException({
        errorCode: 'DEFAULT_WAREHOUSE_NOT_CONFIGURED',
        message: 'Expected exactly one active default warehouse',
      }),
    );
    const response = await request(app.getHttpServer())
      .get('/api/v1/commerce/cart')
      .set('Authorization', `Bearer ${token}`)
      .expect(503);
    expect(response.body).toMatchObject({
      success: false,
      errorCode: 'DEFAULT_WAREHOUSE_NOT_CONFIGURED',
    });
  });
});
