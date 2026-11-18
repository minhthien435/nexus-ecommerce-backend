import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { SellerProductController } from '../src/modules/catalog/controllers/seller-product.controller.js';
import { ProductStatus } from '../src/modules/catalog/domain/entities/product.entity.js';
import { SellerProductService } from '../src/modules/catalog/services/seller-product.service.js';
import { SellerBulkImportService } from '../src/modules/catalog/services/seller-bulk-import.service.js';
import { AccessTokenGuard } from '../src/modules/identity/auth/guards/access-token.guard.js';
import { UserEntity } from '../src/modules/identity/domain/user.entity.js';
import { RbacService } from '../src/modules/identity/rbac/rbac.service.js';

const actorId = '11111111-1111-4111-8111-111111111111';
const productId = '22222222-2222-4222-8222-222222222222';

describe('Seller product API guards and ownership context (e2e)', () => {
  let app: INestApplication;
  let token: string;
  const products = {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    setStatus: vi.fn(),
    remove: vi.fn(),
  };
  const rbac = {
    hasAnyRole: vi.fn(),
    hasAllPermissions: vi.fn(),
  };
  const bulkImport = {
    template: vi.fn(),
    import: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    rbac.hasAnyRole.mockResolvedValue(true);
    rbac.hasAllPermissions.mockResolvedValue(true);
    products.list.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
    });
    products.get.mockResolvedValue({ id: productId, sellerId: actorId });
    products.setStatus.mockResolvedValue({
      id: productId,
      status: ProductStatus.ACTIVE,
    });
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'seller-product-test-secret' })],
      controllers: [SellerProductController],
      providers: [
        AccessTokenGuard,
        { provide: SellerProductService, useValue: products },
        { provide: SellerBulkImportService, useValue: bulkImport },
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

  it('requires authentication, SELLER/ADMIN role, and PRODUCT.LIST permission', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/catalog/seller/products')
      .expect(401);
    rbac.hasAnyRole.mockResolvedValueOnce(false);
    await request(app.getHttpServer())
      .get('/api/v1/catalog/seller/products')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    rbac.hasAllPermissions.mockResolvedValueOnce(false);
    await request(app.getHttpServer())
      .get('/api/v1/catalog/seller/products')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('derives the actor from the access token for list, detail, and status routes', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/catalog/seller/products?page=1&limit=20')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/catalog/seller/products/${productId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/catalog/seller/products/${productId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: ProductStatus.ACTIVE })
      .expect(200);
    expect(products.list).toHaveBeenCalledWith(
      actorId,
      expect.objectContaining({ page: 1, limit: 20 }),
    );
    expect(products.get).toHaveBeenCalledWith(productId, actorId);
    expect(products.setStatus).toHaveBeenCalledWith(
      productId,
      ProductStatus.ACTIVE,
      actorId,
    );
    expect(rbac.hasAllPermissions).toHaveBeenCalledWith(actorId, [
      'PRODUCT.LIST',
    ]);
    expect(rbac.hasAllPermissions).toHaveBeenCalledWith(actorId, [
      'PRODUCT.VIEW',
    ]);
    expect(rbac.hasAllPermissions).toHaveBeenCalledWith(actorId, [
      'PRODUCT.UPDATE',
    ]);
  });
});
