import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { SellerInventoryController } from '../src/modules/fulfillment/controllers/seller-inventory.controller.js';
import { SellerInventoryService } from '../src/modules/fulfillment/services/seller-inventory.service.js';
import { AccessTokenGuard } from '../src/modules/identity/auth/guards/access-token.guard.js';
import { UserEntity } from '../src/modules/identity/domain/user.entity.js';
import { RbacService } from '../src/modules/identity/rbac/rbac.service.js';

const actorId = '11111111-1111-4111-8111-111111111111';
const skuId = '22222222-2222-4222-8222-222222222222';

describe('Seller inventory API guards and actor context (e2e)', () => {
  let app: INestApplication;
  let token: string;
  const inventory = {
    list: vi.fn(),
    summary: vi.fn(),
    restock: vi.fn(),
  };
  const rbac = { hasAnyRole: vi.fn(), hasAllPermissions: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();
    rbac.hasAnyRole.mockResolvedValue(true);
    rbac.hasAllPermissions.mockResolvedValue(true);
    inventory.list.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
    });
    inventory.restock.mockResolvedValue({ skuId, totalQuantity: 5 });
    inventory.summary.mockResolvedValue({
      totalSkus: 4,
      onHand: 20,
      reserved: 3,
      lowStock: 2,
    });
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'seller-inventory-test-secret' })],
      controllers: [SellerInventoryController],
      providers: [
        AccessTokenGuard,
        { provide: SellerInventoryService, useValue: inventory },
        { provide: RbacService, useValue: rbac },
        {
          provide: getRepositoryToken(UserEntity),
          useValue: {
            findOne: vi
              .fn()
              .mockResolvedValue({ id: actorId, tokenVersion: 1 }),
          },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    token = await module
      .get(JwtService)
      .signAsync({ sub: actorId, tokenVersion: 1 });
  });

  afterEach(async () => app.close());

  it('requires authentication, SELLER/ADMIN role and list permission', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/fulfillment/seller/inventory')
      .expect(401);
    rbac.hasAnyRole.mockResolvedValueOnce(false);
    await request(app.getHttpServer())
      .get('/api/v1/fulfillment/seller/inventory')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    rbac.hasAllPermissions.mockResolvedValueOnce(false);
    await request(app.getHttpServer())
      .get('/api/v1/fulfillment/seller/inventory')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('derives actor identity for list and RESTOCK and enforces permissions', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/fulfillment/seller/inventory?page=1&limit=20')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/fulfillment/seller/inventory/adjust')
      .set('Authorization', `Bearer ${token}`)
      .send({ skuId, quantity: 5, idempotencyKey: 'stock-delivery-1' })
      .expect(201);
    expect(inventory.list).toHaveBeenCalledWith(
      actorId,
      expect.objectContaining({ page: 1, limit: 20 }),
    );
    expect(inventory.restock).toHaveBeenCalledWith(actorId, {
      skuId,
      quantity: 5,
      idempotencyKey: 'stock-delivery-1',
    });
    expect(rbac.hasAllPermissions).toHaveBeenCalledWith(actorId, [
      'PRODUCT.LIST',
    ]);
    expect(rbac.hasAllPermissions).toHaveBeenCalledWith(actorId, [
      'PRODUCT.UPDATE',
    ]);
  });

  it('protects the summary with list permission and forwards actor context', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/fulfillment/seller/inventory/summary')
      .expect(401);

    rbac.hasAllPermissions.mockResolvedValueOnce(false);
    await request(app.getHttpServer())
      .get('/api/v1/fulfillment/seller/inventory/summary')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);

    await request(app.getHttpServer())
      .get('/api/v1/fulfillment/seller/inventory/summary')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect({ totalSkus: 4, onHand: 20, reserved: 3, lowStock: 2 });

    expect(inventory.summary).toHaveBeenCalledWith(actorId);
    expect(rbac.hasAllPermissions).toHaveBeenCalledWith(actorId, [
      'PRODUCT.LIST',
    ]);
  });

  it('rejects invalid RESTOCK payload before calling the service', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/fulfillment/seller/inventory/adjust')
      .set('Authorization', `Bearer ${token}`)
      .send({ skuId, quantity: 0, idempotencyKey: '   ' })
      .expect(400);
    expect(inventory.restock).not.toHaveBeenCalled();
  });
});
