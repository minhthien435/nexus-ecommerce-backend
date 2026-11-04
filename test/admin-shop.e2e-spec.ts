import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AdminShopController } from '../src/modules/identity/admin/admin-shop.controller.js';
import { AdminShopService } from '../src/modules/identity/admin/admin-shop.service.js';
import { AccessTokenGuard } from '../src/modules/identity/auth/guards/access-token.guard.js';
import { UserEntity } from '../src/modules/identity/domain/user.entity.js';
import { PermissionsGuard } from '../src/modules/identity/rbac/guards/permissions.guard.js';
import { RolesGuard } from '../src/modules/identity/rbac/guards/roles.guard.js';
import { RbacService } from '../src/modules/identity/rbac/rbac.service.js';

const secret = 'admin-shop-test-secret';
const actorId = '11111111-1111-4111-8111-111111111111';
const shopId = '22222222-2222-4222-8222-222222222222';
const base = '/api/v1/admin/shops';

describe('Admin Shop API (e2e)', () => {
  let app: INestApplication;
  let token: string;
  const rbac = {
    hasAnyRole: vi.fn().mockResolvedValue(true),
    hasAllPermissions: vi.fn().mockResolvedValue(true),
  };
  const shops = {
    list: vi.fn().mockResolvedValue({
      items: [],
      page: 1,
      limit: 20,
      total: 0,
      totalPages: 0,
    }),
    getById: vi.fn().mockResolvedValue({ id: shopId, status: 'ACTIVE' }),
    updateStatus: vi
      .fn()
      .mockResolvedValue({ id: shopId, status: 'SUSPENDED' }),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ secret })],
      controllers: [AdminShopController],
      providers: [
        AccessTokenGuard,
        RolesGuard,
        PermissionsGuard,
        { provide: RbacService, useValue: rbac },
        { provide: AdminShopService, useValue: shops },
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

  beforeEach(() => {
    vi.clearAllMocks();
    rbac.hasAnyRole.mockResolvedValue(true);
    rbac.hasAllPermissions.mockResolvedValue(true);
  });

  afterAll(async () => app.close());

  it('rejects unauthenticated and non-admin list requests before service', async () => {
    await request(app.getHttpServer()).get(base).expect(401);
    rbac.hasAnyRole.mockResolvedValueOnce(false);
    await request(app.getHttpServer())
      .get(base)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    expect(shops.list).not.toHaveBeenCalled();
  });

  it('rejects an admin missing the required route privilege', async () => {
    rbac.hasAllPermissions.mockResolvedValueOnce(false);
    await request(app.getHttpServer())
      .get(`${base}/${shopId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    expect(rbac.hasAllPermissions).toHaveBeenCalledWith(actorId, ['SHOP.VIEW']);
    expect(shops.getById).not.toHaveBeenCalled();
  });

  it('transforms list filters and delegates status updates for an authorized admin', async () => {
    await request(app.getHttpServer())
      .get(base)
      .query({ search: ' Shop ', status: 'ACTIVE', page: 2, limit: 10 })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(shops.list).toHaveBeenCalledWith(
      expect.objectContaining({
        search: 'Shop',
        status: 'ACTIVE',
        page: 2,
        limit: 10,
      }),
    );

    await request(app.getHttpServer())
      .patch(`${base}/${shopId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'SUSPENDED', reason: ' Policy breach ' })
      .expect(200);
    expect(shops.updateStatus).toHaveBeenCalledWith(
      actorId,
      shopId,
      'SUSPENDED',
      'Policy breach',
    );
  });

  it('rejects malformed UUIDs and invalid queries or bodies before service', async () => {
    await request(app.getHttpServer())
      .get(`${base}/not-a-uuid`)
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
    await request(app.getHttpServer())
      .get(base)
      .query({ status: 'UNKNOWN', page: 0, limit: 101 })
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
    await request(app.getHttpServer())
      .patch(`${base}/${shopId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'SUSPENDED', reason: '   ' })
      .expect(400);
    expect(shops.getById).not.toHaveBeenCalled();
    expect(shops.list).not.toHaveBeenCalled();
    expect(shops.updateStatus).not.toHaveBeenCalled();
  });
});
