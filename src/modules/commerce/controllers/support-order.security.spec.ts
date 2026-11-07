import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AccessTokenGuard } from '../../identity/auth/guards/access-token.guard.js';
import { UserEntity } from '../../identity/domain/user.entity.js';
import { PermissionsGuard } from '../../identity/rbac/guards/permissions.guard.js';
import { RolesGuard } from '../../identity/rbac/guards/roles.guard.js';
import { RbacService } from '../../identity/rbac/rbac.service.js';
import { SupportOrderService } from '../services/support-order.service.js';
import { SupportOrderController } from './support-order.controller.js';

describe('SupportOrderController security', () => {
  let app: INestApplication;
  const staffId = '11111111-1111-4111-8111-111111111111';
  const buyerId = '22222222-2222-4222-8222-222222222222';
  const sellerId = '44444444-4444-4444-8444-444444444444';
  const orderId = '33333333-3333-4333-8333-333333333333';
  const jwt = { verifyAsync: vi.fn() };
  const users = { findOne: vi.fn() };
  const rbac = {
    hasAnyRole: vi.fn(),
    hasAllPermissions: vi.fn(),
  };
  const service = {
    list: vi.fn(),
    detail: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    service.list.mockResolvedValue({
      data: [],
      meta: { page: 1, limit: 20, totalItems: 0, totalPages: 1 },
    });
    service.detail.mockResolvedValue({ id: orderId });
    const moduleRef = await Test.createTestingModule({
      controllers: [SupportOrderController],
      providers: [
        Reflector,
        AccessTokenGuard,
        RolesGuard,
        PermissionsGuard,
        { provide: JwtService, useValue: jwt },
        { provide: getRepositoryToken(UserEntity), useValue: users },
        { provide: RbacService, useValue: rbac },
        { provide: SupportOrderService, useValue: service },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });

  afterEach(async () => app.close());

  function authenticate(userId: string) {
    jwt.verifyAsync.mockResolvedValue({ sub: userId, tokenVersion: 1 });
    users.findOne.mockResolvedValue({
      id: userId,
      tokenVersion: 1,
      status: 'ACTIVE',
    });
  }

  it('allows STAFF with ORDER.LIST to query all orders', async () => {
    authenticate(staffId);
    rbac.hasAnyRole.mockResolvedValue(true);
    rbac.hasAllPermissions.mockResolvedValue(true);

    const response = await request(app.getHttpServer())
      .get('/api/v1/commerce/support/orders?page=1&limit=20')
      .set('Authorization', 'Bearer staff-token');

    expect(response.status).toBe(200);
    expect(rbac.hasAnyRole).toHaveBeenCalledWith(staffId, ['ADMIN', 'STAFF']);
    expect(rbac.hasAllPermissions).toHaveBeenCalledWith(staffId, [
      'ORDER.LIST',
    ]);
    expect(service.list).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, limit: 20 }),
    );
  });

  it('allows STAFF with ORDER.VIEW to read order details', async () => {
    authenticate(staffId);
    rbac.hasAnyRole.mockResolvedValue(true);
    rbac.hasAllPermissions.mockResolvedValue(true);

    const response = await request(app.getHttpServer())
      .get(`/api/v1/commerce/support/orders/${orderId}`)
      .set('Authorization', 'Bearer staff-token');

    expect(response.status).toBe(200);
    expect(rbac.hasAllPermissions).toHaveBeenCalledWith(staffId, [
      'ORDER.VIEW',
    ]);
    expect(service.detail).toHaveBeenCalledWith(orderId);
  });

  it.each([
    ['BUYER', buyerId],
    ['SELLER', sellerId],
  ])(
    'rejects %s before the service reads all-orders data',
    async (_, userId) => {
      authenticate(userId);
      rbac.hasAnyRole.mockResolvedValue(false);

      const response = await request(app.getHttpServer())
        .get('/api/v1/commerce/support/orders')
        .set('Authorization', 'Bearer buyer-token');

      expect(response.status).toBe(403);
      expect(service.list).not.toHaveBeenCalled();
    },
  );

  it('rejects unauthenticated requests before reading all-orders data', async () => {
    const response = await request(app.getHttpServer()).get(
      '/api/v1/commerce/support/orders',
    );

    expect(response.status).toBe(401);
    expect(service.list).not.toHaveBeenCalled();
  });

  it('rejects malformed order ids before calling the service', async () => {
    authenticate(staffId);
    rbac.hasAnyRole.mockResolvedValue(true);
    rbac.hasAllPermissions.mockResolvedValue(true);

    const response = await request(app.getHttpServer())
      .get('/api/v1/commerce/support/orders/not-a-uuid')
      .set('Authorization', 'Bearer staff-token');

    expect(response.status).toBe(400);
    expect(service.detail).not.toHaveBeenCalled();
  });
});
