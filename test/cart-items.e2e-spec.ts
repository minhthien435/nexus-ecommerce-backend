import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { CartController } from '../src/modules/commerce/controllers/cart.controller.js';
import { CartService } from '../src/modules/commerce/services/cart.service.js';
import { CartWriteService } from '../src/modules/commerce/services/cart-write.service.js';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor.js';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter.js';
import { AccessTokenGuard } from '../src/modules/identity/auth/guards/access-token.guard.js';
import { UserEntity } from '../src/modules/identity/domain/user.entity.js';
import { PermissionsGuard } from '../src/modules/identity/rbac/guards/permissions.guard.js';
import { RbacService } from '../src/modules/identity/rbac/rbac.service.js';

const userId = '11111111-1111-4111-8111-111111111111';
const skuId = 'BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB';
const path = '/api/v1/commerce/cart/items';

describe('POST commerce cart items (HTTP guards and strict DTO)', () => {
  let app: INestApplication;
  let token: string;
  const writer = { addItem: vi.fn() };
  const rbac = { hasAllPermissions: vi.fn() };
  const users = { findOne: vi.fn() };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'cart-post-test-secret' })],
      controllers: [CartController],
      providers: [
        AccessTokenGuard,
        PermissionsGuard,
        { provide: getRepositoryToken(UserEntity), useValue: users },
        { provide: RbacService, useValue: rbac },
        { provide: CartService, useValue: {} },
        { provide: CartWriteService, useValue: writer },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.useGlobalInterceptors(new TransformInterceptor());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    token = await module
      .get(JwtService)
      .signAsync({ sub: userId, tokenVersion: 0 });
  });
  beforeEach(() => {
    vi.resetAllMocks();
    users.findOne.mockResolvedValue({ tokenVersion: 0 });
    rbac.hasAllPermissions.mockResolvedValue(true);
    writer.addItem.mockResolvedValue({
      cartId: 'cart',
      expiresAt: new Date('2026-10-24T12:00:00Z'),
      items: [],
      subtotal: '0.00',
    });
  });
  afterAll(async () => app.close());
  it('rejects missing/invalid JWTs before writes', async () => {
    await request(app.getHttpServer())
      .post(path)
      .send({ skuId, quantity: 1 })
      .expect(401);
    await request(app.getHttpServer())
      .post(path)
      .set('Authorization', 'Bearer invalid')
      .send({ skuId, quantity: 1 })
      .expect(401);
    expect(writer.addItem).not.toHaveBeenCalled();
  });
  it('requires CART.CREATE before writes', async () => {
    rbac.hasAllPermissions.mockResolvedValue(false);
    await request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${token}`)
      .send({ skuId, quantity: 1 })
      .expect(403);
    expect(rbac.hasAllPermissions).toHaveBeenCalledWith(userId, [
      'CART.CREATE',
    ]);
    expect(writer.addItem).not.toHaveBeenCalled();
  });
  it.each([
    {},
    { skuId },
    { quantity: 1 },
    { skuId: 'bad', quantity: 1 },
    ...[0, -1, 1.5, 2147483648, '1', null, true].map((quantity) => ({
      skuId,
      quantity,
    })),
    ...['userId', 'productId', 'sellerId', 'price', 'unitPriceSnapshot'].map(
      (key) => ({ skuId, quantity: 1, [key]: userId }),
    ),
  ])('rejects invalid or extra payload %j before writes', async (payload) => {
    await request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${token}`)
      .send(payload)
      .expect(400);
    expect(writer.addItem).not.toHaveBeenCalled();
  });
  it.each([1, 2147483647])(
    'accepts quantity boundary %s and takes account only from JWT',
    async (quantity) => {
      const response = await request(app.getHttpServer())
        .post(`${path}?userId=untrusted`)
        .set('Authorization', `Bearer ${token}`)
        .send({ skuId, quantity })
        .expect(201);
      expect(writer.addItem).toHaveBeenCalledWith(userId, { skuId, quantity });
      expect(response.body).toMatchObject({
        success: true,
        data: { expiresAt: '2026-10-24T12:00:00.000Z', subtotal: '0.00' },
      });
    },
  );
});
