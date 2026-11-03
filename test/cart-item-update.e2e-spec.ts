import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor.js';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter.js';
import { CartController } from '../src/modules/commerce/controllers/cart.controller.js';
import { CartEntity } from '../src/modules/commerce/domain/entities/cart.entity.js';
import { CartItemEntity } from '../src/modules/commerce/domain/entities/cart-item.entity.js';
import { CartService } from '../src/modules/commerce/services/cart.service.js';
import { CartWriteService } from '../src/modules/commerce/services/cart-write.service.js';
import { AccessTokenGuard } from '../src/modules/identity/auth/guards/access-token.guard.js';
import { UserEntity } from '../src/modules/identity/domain/user.entity.js';
import { PermissionsGuard } from '../src/modules/identity/rbac/guards/permissions.guard.js';
import { RbacService } from '../src/modules/identity/rbac/rbac.service.js';

const userId = '11111111-1111-4111-8111-111111111111';
const otherUser = '22222222-2222-4222-8222-222222222222';
const skuId = 'BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB';
const remainingSku = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const base = '/api/v1/commerce/cart';
const path = `${base}/items`;
const expiresAt = new Date('2026-10-24T12:00:00Z');

describe('PATCH commerce cart items (HTTP with transactional mock persistence)', () => {
  let app: INestApplication;
  let token: string;
  let otherToken: string;
  let rows: any[];
  let cart: any;
  const rbac = { hasAllPermissions: vi.fn() };
  const users = { findOne: vi.fn() };
  const catalog = { getCartSkus: vi.fn() };
  const inventory = { getDefaultWarehouseStock: vi.fn() };
  const carts = {
    findOne: vi.fn(async ({ where }) =>
      where.userId === cart?.userId && where.status === cart?.status
        ? cart
        : null,
    ),
    query: vi.fn(async () => [
      { observedTime: new Date('2026-10-17T12:00:00Z') },
    ]),
  };
  const items = {
    findOne: vi.fn(
      async ({ where }) =>
        rows.find(
          (row) => row.cartId === where.cartId && row.skuId === where.skuId,
        ) ?? null,
    ),
    find: vi.fn(async ({ where }) =>
      rows.filter((row) => row.cartId === where.cartId),
    ),
    update: vi.fn(async (id, changes) =>
      Object.assign(
        rows.find((row) => row.id === id),
        changes,
      ),
    ),
    create: vi.fn((data: any) => ({ id: 'new-line', ...data })),
    save: vi.fn(async (entity: any) => {
      rows.push(entity);
      return entity;
    }),
    delete: vi.fn(async (id) => {
      rows = rows.filter((row) => row.id !== id);
    }),
  };
  const manager = {
    getRepository: (entity: unknown) => {
      if (entity === CartEntity) return carts;
      if (entity === CartItemEntity) return items;
      throw new Error('Unexpected entity');
    },
    query: vi.fn(async (sql: string) => {
      if (sql.includes('pg_advisory_xact_lock')) return [];
      if (sql.includes('clock_timestamp'))
        return [{ observedTime: new Date('2026-10-17T12:00:00Z') }];
      if (sql.includes('commerce.service_configs')) return [{ value: 7 }];
      throw new Error('Unexpected SQL');
    }),
  };
  const source = {
    transaction: vi.fn(async (_isolation, work) => {
      const before = structuredClone({ cart, rows });
      try {
        return await work(manager);
      } catch (error) {
        cart = before.cart;
        rows = before.rows;
        throw error;
      }
    }),
  };

  const addRemainingLine = () => {
    rows.push({
      ...rows[0],
      id: 'remaining-line',
      skuId: remainingSku,
      quantity: 3,
      productNameSnapshot: 'Remaining snapshot',
      unitPriceSnapshot: '90000.00',
    });
    catalog.getCartSkus.mockResolvedValue([
      {
        id: remainingSku,
        productId: 'product',
        productName: 'Remaining current name',
        price: '120000.00',
        currency: 'VND',
        isActive: true,
        productStatus: 'ACTIVE',
        productDeletedAt: null,
      },
    ]);
    inventory.getDefaultWarehouseStock.mockResolvedValue([
      { skuId: remainingSku, availableQuantity: 10 },
    ]);
  };

  beforeAll(async () => {
    const reader = new CartService(
      carts as never,
      items as never,
      catalog,
      inventory,
    );
    const writer = new CartWriteService(
      source as never,
      reader,
      catalog,
      inventory,
    );
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'cart-patch-test-secret' })],
      controllers: [CartController],
      providers: [
        AccessTokenGuard,
        PermissionsGuard,
        { provide: getRepositoryToken(UserEntity), useValue: users },
        { provide: RbacService, useValue: rbac },
        { provide: CartService, useValue: reader },
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
    otherToken = await module
      .get(JwtService)
      .signAsync({ sub: otherUser, tokenVersion: 0 });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    users.findOne.mockResolvedValue({ tokenVersion: 0 });
    rbac.hasAllPermissions.mockResolvedValue(true);
    cart = { id: 'own-cart', userId, status: 'ACTIVE', expiresAt };
    rows = [
      {
        id: 'line',
        cartId: cart.id,
        skuId: skuId.toLowerCase(),
        productId: 'product',
        quantity: 2,
        unitPriceSnapshot: '100000.00',
        productNameSnapshot: 'Original',
      },
    ];
    catalog.getCartSkus.mockResolvedValue([
      {
        id: skuId.toLowerCase(),
        productId: 'product',
        productName: 'Current',
        price: '120000.00',
        currency: 'VND',
        isActive: true,
        productStatus: 'ACTIVE',
        productDeletedAt: null,
      },
    ]);
    inventory.getDefaultWarehouseStock.mockResolvedValue([
      { skuId: skuId.toLowerCase(), availableQuantity: 2147483647 },
    ]);
  });

  afterAll(async () => app.close());

  describe('Route and obsolete endpoints checks', () => {
    it('returns 404 for obsolete PATCH /api/v1/commerce/cart/items/:skuId', async () => {
      await request(app.getHttpServer())
        .patch(`${base}/items/${skuId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ quantity: 1 })
        .expect(404);
      expect(source.transaction).not.toHaveBeenCalled();
    });

    it('returns 404 for obsolete DELETE /api/v1/commerce/cart/items/:skuId', async () => {
      await request(app.getHttpServer())
        .delete(`${base}/items/${skuId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
      expect(source.transaction).not.toHaveBeenCalled();
    });
  });

  describe('Authentication & Authorization', () => {
    it('rejects missing and invalid JWTs before any transaction', async () => {
      await request(app.getHttpServer())
        .patch(path)
        .send({ skuId, quantity: 1 })
        .expect(401);
      await request(app.getHttpServer())
        .patch(path)
        .set('Authorization', 'Bearer invalid')
        .send({ skuId, quantity: 1 })
        .expect(401);
      expect(source.transaction).not.toHaveBeenCalled();
    });

    it('requires CART.UPDATE before any transaction', async () => {
      rbac.hasAllPermissions.mockResolvedValue(false);
      await request(app.getHttpServer())
        .patch(path)
        .set('Authorization', `Bearer ${token}`)
        .send({ skuId, quantity: 1 })
        .expect(403);
      expect(rbac.hasAllPermissions).toHaveBeenCalledWith(userId, [
        'CART.UPDATE',
      ]);
      expect(source.transaction).not.toHaveBeenCalled();
    });
  });

  describe('DTO and Validation', () => {
    it.each([
      {},
      { skuId },
      { quantity: 1 },
      { skuId: 'not-a-uuid', quantity: 1 },
      ...[-1, 1.5, 2147483648, '1', null, true].map((quantity) => ({
        skuId,
        quantity,
      })),
      ...[
        'userId',
        'productId',
        'sellerId',
        'price',
        'unitPriceSnapshot',
        'expiresAt',
      ].map((key) => ({ skuId, quantity: 1, [key]: userId })),
    ])(
      'rejects invalid and extra payload %j before any transaction',
      async (body) => {
        await request(app.getHttpServer())
          .patch(path)
          .set('Authorization', `Bearer ${token}`)
          .send(body)
          .expect(400);
        expect(source.transaction).not.toHaveBeenCalled();
      },
    );
  });

  describe('Update Quantity (quantity > 0)', () => {
    it.each([1, 2147483647])(
      'accepts boundary positive quantity %s, canonicalizes SKU and returns 200 with the cart envelope',
      async (quantity) => {
        const response = await request(app.getHttpServer())
          .patch(`${path}?userId=${otherUser}`)
          .set('Authorization', `Bearer ${token}`)
          .send({ skuId, quantity })
          .expect(200);
        expect(response.body).toMatchObject({
          success: true,
          data: {
            cartId: 'own-cart',
            expiresAt: expiresAt.toISOString(),
            subtotal: quantity === 1 ? '120000.00' : '257698037640000.00',
          },
        });
        expect(carts.findOne).toHaveBeenCalledWith({
          where: { userId, status: 'ACTIVE' },
          lock: { mode: 'pessimistic_write' },
        });
        expect(items.findOne).toHaveBeenCalledWith({
          where: { cartId: 'own-cart', skuId: skuId.toLowerCase() },
          lock: { mode: 'pessimistic_write' },
        });
      },
    );

    it('PATCHes 2 to 3 at the current price and GET observes 3 with the original snapshot and expiry', async () => {
      const patch = await request(app.getHttpServer())
        .patch(path)
        .set('Authorization', `Bearer ${token}`)
        .send({ skuId, quantity: 3 })
        .expect(200);
      const get = await request(app.getHttpServer())
        .get(base)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(get.body.data).toEqual(patch.body.data);
      expect(get.body.data).toMatchObject({
        cartId: 'own-cart',
        expiresAt: expiresAt.toISOString(),
        subtotal: '360000.00',
        items: [
          expect.objectContaining({
            quantity: 3,
            unitPriceSnapshot: '100000.00',
            unitPrice: '120000.00',
            lineTotal: '360000.00',
          }),
        ],
      });
    });

    it('returns 409 without partial mutation when absolute requested stock is insufficient', async () => {
      inventory.getDefaultWarehouseStock.mockResolvedValue([
        { skuId: skuId.toLowerCase(), availableQuantity: 2 },
      ]);
      const response = await request(app.getHttpServer())
        .patch(path)
        .set('Authorization', `Bearer ${token}`)
        .send({ skuId, quantity: 3 })
        .expect(409);
      expect(response.body).toMatchObject({
        success: false,
        errorCode: 'INSUFFICIENT_STOCK',
      });
      expect(rows[0].quantity).toBe(2);
    });

    it('cannot target another account through query parameters or ownership', async () => {
      await request(app.getHttpServer())
        .patch(`${path}?userId=${userId}`)
        .set('Authorization', `Bearer ${otherToken}`)
        .send({ skuId, quantity: 1 })
        .expect(404);
      expect(rows[0].quantity).toBe(2);
      expect(catalog.getCartSkus).not.toHaveBeenCalled();
      expect(items.delete).not.toHaveBeenCalled();
      expect(carts.findOne).toHaveBeenCalledWith({
        where: { userId: otherUser, status: 'ACTIVE' },
        lock: { mode: 'pessimistic_write' },
      });
    });
  });

  describe('Remove Item (quantity === 0)', () => {
    it('accepts quantity 0 and returns 200 with empty cart', async () => {
      const response = await request(app.getHttpServer())
        .patch(path)
        .set('Authorization', `Bearer ${token}`)
        .send({ skuId, quantity: 0 })
        .expect(200);
      expect(response.body).toMatchObject({
        success: true,
        data: {
          cartId: 'own-cart',
          expiresAt: expiresAt.toISOString(),
          subtotal: '0.00',
          items: [],
        },
      });
      expect(items.delete).toHaveBeenCalledWith('line');
      expect(rows).toEqual([]);
    });

    it('deletes a missing Catalog SKU when quantity is 0 and GET retains the same empty cart', async () => {
      catalog.getCartSkus.mockResolvedValue([]);
      const patch = await request(app.getHttpServer())
        .patch(path)
        .set('Authorization', `Bearer ${token}`)
        .send({ skuId, quantity: 0 })
        .expect(200);
      const get = await request(app.getHttpServer())
        .get(base)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(get.body.data).toEqual(patch.body.data);
      expect(get.body.data).toMatchObject({
        cartId: 'own-cart',
        expiresAt: expiresAt.toISOString(),
        items: [],
        subtotal: '0.00',
      });
      expect(catalog.getCartSkus).not.toHaveBeenCalled();
      expect(inventory.getDefaultWarehouseStock).not.toHaveBeenCalled();
    });

    it.each(['missing', 'discontinued'])(
      'removes a %s Catalog SKU with quantity 0 and GET retains the same empty cart',
      async (state) => {
        if (state === 'missing') catalog.getCartSkus.mockResolvedValue([]);
        else {
          catalog.getCartSkus.mockResolvedValue([
            { id: skuId.toLowerCase(), isActive: false },
          ]);
        }
        const before = structuredClone(cart);
        const deletion = await request(app.getHttpServer())
          .patch(path)
          .set('Authorization', `Bearer ${token}`)
          .send({ skuId, quantity: 0 })
          .expect(200);
        const get = await request(app.getHttpServer())
          .get(base)
          .set('Authorization', `Bearer ${token}`)
          .expect(200);
        expect(deletion.body).toMatchObject({
          success: true,
          data: {
            cartId: 'own-cart',
            expiresAt: expiresAt.toISOString(),
            items: [],
            subtotal: '0.00',
          },
        });
        expect(get.body.data).toEqual(deletion.body.data);
        expect(cart).toEqual(before);
        expect(rows).toEqual([]);
        expect(catalog.getCartSkus).not.toHaveBeenCalled();
        expect(inventory.getDefaultWarehouseStock).not.toHaveBeenCalled();
        expect(items.update).not.toHaveBeenCalled();
      },
    );

    it('removes only the requested line when quantity is 0 and preserves other snapshots and expiry', async () => {
      addRemainingLine();
      const before = structuredClone({ cart, remaining: rows[1] });
      const response = await request(app.getHttpServer())
        .patch(path)
        .set('Authorization', `Bearer ${token}`)
        .send({ skuId, quantity: 0 })
        .expect(200);
      expect(response.body.data).toMatchObject({
        cartId: 'own-cart',
        expiresAt: expiresAt.toISOString(),
        subtotal: '360000.00',
        items: [
          {
            skuId: remainingSku,
            quantity: 3,
            unitPriceSnapshot: '90000.00',
            unitPrice: '120000.00',
          },
        ],
      });
      expect(rows).toEqual([before.remaining]);
      expect(cart).toEqual(before.cart);
      expect(catalog.getCartSkus).toHaveBeenCalledExactlyOnceWith(
        [remainingSku],
        manager,
      );
      expect(
        inventory.getDefaultWarehouseStock,
      ).toHaveBeenCalledExactlyOnceWith([remainingSku], manager);
      expect(items.update).not.toHaveBeenCalled();
    });

    it.each([
      'missing cart',
      'non-ACTIVE',
      'expired',
      'equal expiry',
      'missing line',
    ])('returns 404 without mutation for %s', async (state) => {
      if (state === 'missing cart') cart = null;
      if (state === 'non-ACTIVE') cart.status = 'CHECKED_OUT';
      if (state === 'expired')
        cart.expiresAt = new Date('2026-10-17T11:59:59Z');
      if (state === 'equal expiry')
        cart.expiresAt = new Date('2026-10-17T12:00:00Z');
      if (state === 'missing line') rows[0].skuId = remainingSku;
      const before = structuredClone({ cart, rows });
      const response = await request(app.getHttpServer())
        .patch(path)
        .set('Authorization', `Bearer ${token}`)
        .send({ skuId, quantity: 0 })
        .expect(404);
      expect(response.body.errorCode).toBe(
        state === 'missing line' ? 'CART_ITEM_NOT_FOUND' : 'CART_NOT_FOUND',
      );
      expect({ cart, rows }).toEqual(before);
      expect(items.delete).not.toHaveBeenCalled();
      expect(items.update).not.toHaveBeenCalled();
      expect(catalog.getCartSkus).not.toHaveBeenCalled();
      expect(inventory.getDefaultWarehouseStock).not.toHaveBeenCalled();
    });

    it('cannot use a supplied userId in query to modify another user cart', async () => {
      const before = structuredClone({ cart, rows });
      await request(app.getHttpServer())
        .patch(`${path}?userId=${userId}`)
        .set('Authorization', `Bearer ${otherToken}`)
        .send({ skuId, quantity: 0 })
        .expect(404);
      expect(carts.findOne).toHaveBeenCalledExactlyOnceWith({
        where: { userId: otherUser, status: 'ACTIVE' },
        lock: { mode: 'pessimistic_write' },
      });
      expect({ cart, rows }).toEqual(before);
      expect(items.delete).not.toHaveBeenCalled();
    });

    it('propagates a deletion failure and restores mock transaction state', async () => {
      const before = structuredClone({ cart, rows });
      items.delete.mockImplementationOnce(async (id) => {
        rows = rows.filter((row) => row.id !== id);
        throw new Error('Deletion failed');
      });
      await request(app.getHttpServer())
        .patch(path)
        .set('Authorization', `Bearer ${token}`)
        .send({ skuId, quantity: 0 })
        .expect(500);
      expect(items.delete).toHaveBeenCalledExactlyOnceWith('line');
      expect({ cart, rows }).toEqual(before);
    });

    it.each(['catalog', 'inventory'])(
      'restores the deleted line when remaining-line %s projection fails',
      async (dependency) => {
        addRemainingLine();
        const before = structuredClone({ cart, rows });
        if (dependency === 'catalog') {
          catalog.getCartSkus.mockRejectedValueOnce(
            new Error('Catalog failed'),
          );
        } else {
          inventory.getDefaultWarehouseStock.mockResolvedValueOnce([]);
        }
        const response = await request(app.getHttpServer())
          .patch(path)
          .set('Authorization', `Bearer ${token}`)
          .send({ skuId, quantity: 0 })
          .expect(dependency === 'catalog' ? 500 : 503);
        if (dependency === 'inventory') {
          expect(response.body.errorCode).toBe('INVENTORY_UNAVAILABLE');
        }
        expect(items.delete).toHaveBeenCalledExactlyOnceWith('line');
        expect({ cart, rows }).toEqual(before);
      },
    );
  });

  describe('POST and PATCH response parity', () => {
    it('returns consistent complete cart envelope for POST and PATCH', async () => {
      const postRes = await request(app.getHttpServer())
        .post(path)
        .set('Authorization', `Bearer ${token}`)
        .send({ skuId, quantity: 1 })
        .expect(201);

      const patchRes = await request(app.getHttpServer())
        .patch(path)
        .set('Authorization', `Bearer ${token}`)
        .send({ skuId, quantity: 4 })
        .expect(200);

      // Verify identical top-level and data fields
      expect(Object.keys(postRes.body)).toEqual(Object.keys(patchRes.body));
      expect(Object.keys(postRes.body.data).sort()).toEqual(
        Object.keys(patchRes.body.data).sort(),
      );

      // Verify complete cart structure on PATCH
      expect(patchRes.body).toMatchObject({
        success: true,
        data: {
          cartId: 'own-cart',
          expiresAt: expiresAt.toISOString(),
          currency: 'VND',
          subtotal: '480000.00',
          hasExcludedItems: false,
          excludedItemCount: 0,
          items: [
            expect.objectContaining({
              skuId: skuId.toLowerCase(),
              quantity: 4,
              unitPrice: '120000.00',
              lineTotal: '480000.00',
              includedInSubtotal: true,
            }),
          ],
        },
      });

      // Verify PATCH with 0 returns complete refreshed cart with items = []
      const removeRes = await request(app.getHttpServer())
        .patch(path)
        .set('Authorization', `Bearer ${token}`)
        .send({ skuId, quantity: 0 })
        .expect(200);

      expect(Object.keys(removeRes.body.data).sort()).toEqual(
        Object.keys(postRes.body.data).sort(),
      );
      expect(removeRes.body).toMatchObject({
        success: true,
        data: {
          cartId: 'own-cart',
          expiresAt: expiresAt.toISOString(),
          subtotal: '0.00',
          items: [],
          hasExcludedItems: false,
          excludedItemCount: 0,
        },
      });
    });
  });
});
