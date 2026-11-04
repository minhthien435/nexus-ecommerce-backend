import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessTokenGuard } from '../../identity/auth/guards/access-token.guard.js';
import { PermissionsGuard } from '../../identity/rbac/guards/permissions.guard.js';
import { RolesGuard } from '../../identity/rbac/guards/roles.guard.js';
import { RbacService } from '../../identity/rbac/rbac.service.js';
import { UserEntity } from '../../identity/domain/user.entity.js';
import { OrderService } from '../services/order.service.js';
import { SellerOrderController } from './seller-order.controller.js';

describe('SellerOrderController - Security & RBAC (NEX-FAST-04)', () => {
  let app: INestApplication;
  let jwtService: { verifyAsync: ReturnType<typeof vi.fn> };
  let userRepo: { findOne: ReturnType<typeof vi.fn> };
  let rbacService: {
    hasAnyRole: ReturnType<typeof vi.fn>;
    hasAllPermissions: ReturnType<typeof vi.fn>;
  };
  let orderService: {
    getSellerOrders: ReturnType<typeof vi.fn>;
    getSellerOrderById: ReturnType<typeof vi.fn>;
    confirmSellerOrder: ReturnType<typeof vi.fn>;
    shipSellerOrder: ReturnType<typeof vi.fn>;
  };

  const sellerAId = '11111111-1111-4111-8111-111111111111';
  const buyerId = '22222222-2222-4222-8222-222222222222';
  const orderId = '33333333-3333-4333-8333-333333333333';
  const forgedSellerId = '99999999-9999-4999-8999-999999999999';

  beforeEach(async () => {
    jwtService = {
      verifyAsync: vi.fn(),
    };
    userRepo = {
      findOne: vi.fn(),
    };
    rbacService = {
      hasAnyRole: vi.fn(),
      hasAllPermissions: vi.fn(),
    };
    orderService = {
      getSellerOrders: vi.fn().mockResolvedValue({
        data: [],
        meta: { page: 1, limit: 10, total: 0, totalItems: 0, totalPages: 1 },
      }),
      getSellerOrderById: vi.fn().mockResolvedValue({
        id: orderId,
        sellerId: sellerAId,
        status: 'PAID',
      }),
      confirmSellerOrder: vi.fn().mockResolvedValue({
        orderId,
        status: 'PROCESSING',
        updatedAt: new Date(),
      }),
      shipSellerOrder: vi.fn().mockResolvedValue({
        orderId,
        status: 'SHIPPED',
        trackingCode: 'TRACK123',
        carrierName: 'VNPost',
        updatedAt: new Date(),
      }),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [SellerOrderController],
      providers: [
        Reflector,
        AccessTokenGuard,
        RolesGuard,
        PermissionsGuard,
        { provide: JwtService, useValue: jwtService },
        { provide: getRepositoryToken(UserEntity), useValue: userRepo },
        { provide: RbacService, useValue: rbacService },
        { provide: OrderService, useValue: orderService },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
    vi.clearAllMocks();
  });

  function authenticateAs(userId: string, tokenVersion = 1) {
    jwtService.verifyAsync.mockResolvedValue({
      sub: userId,
      tokenVersion,
    });
    userRepo.findOne.mockResolvedValue({
      id: userId,
      tokenVersion,
      status: 'ACTIVE',
    });
  }

  describe('A. Missing authentication', () => {
    it('returns 401 Unauthorized on GET / when Authorization header is missing', async () => {
      const res = await request(app.getHttpServer()).get(
        '/api/v1/commerce/seller/orders',
      );

      expect(res.status).toBe(401);
      expect(orderService.getSellerOrders).not.toHaveBeenCalled();
    });

    it('returns 401 Unauthorized on GET /:id when token is invalid or expired', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('jwt expired'));

      const res = await request(app.getHttpServer())
        .get(`/api/v1/commerce/seller/orders/${orderId}`)
        .set('Authorization', 'Bearer invalid-or-expired-token');

      expect(res.status).toBe(401);
      expect(orderService.getSellerOrderById).not.toHaveBeenCalled();
    });

    it('returns 401 Unauthorized on PATCH /:id/confirm when no token provided', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/commerce/seller/orders/${orderId}/confirm`)
        .send({ note: 'Confirm without auth' });

      expect(res.status).toBe(401);
      expect(orderService.confirmSellerOrder).not.toHaveBeenCalled();
    });

    it('returns 401 Unauthorized on PATCH /:id/ship when no token provided', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/commerce/seller/orders/${orderId}/ship`)
        .send({ trackingCode: 'VN123', carrierName: 'VNPost' });

      expect(res.status).toBe(401);
      expect(orderService.shipSellerOrder).not.toHaveBeenCalled();
    });
  });

  describe('B. Invalid role', () => {
    it('returns 403 Forbidden when an authenticated BUYER attempts to list seller orders', async () => {
      authenticateAs(buyerId);
      rbacService.hasAnyRole.mockResolvedValue(false);

      const res = await request(app.getHttpServer())
        .get('/api/v1/commerce/seller/orders')
        .set('Authorization', 'Bearer valid-buyer-token');

      expect(res.status).toBe(403);
      expect(rbacService.hasAnyRole).toHaveBeenCalledWith(buyerId, [
        'ADMIN',
        'SELLER',
      ]);
      expect(orderService.getSellerOrders).not.toHaveBeenCalled();
    });

    it('returns 403 Forbidden when an authenticated BUYER attempts to view seller order details', async () => {
      authenticateAs(buyerId);
      rbacService.hasAnyRole.mockResolvedValue(false);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/commerce/seller/orders/${orderId}`)
        .set('Authorization', 'Bearer valid-buyer-token');

      expect(res.status).toBe(403);
      expect(orderService.getSellerOrderById).not.toHaveBeenCalled();
    });

    it('returns 403 Forbidden when an authenticated BUYER attempts to confirm a seller order', async () => {
      authenticateAs(buyerId);
      rbacService.hasAnyRole.mockResolvedValue(false);

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/commerce/seller/orders/${orderId}/confirm`)
        .set('Authorization', 'Bearer valid-buyer-token')
        .send({ note: 'Buyer attempt' });

      expect(res.status).toBe(403);
      expect(orderService.confirmSellerOrder).not.toHaveBeenCalled();
    });

    it('returns 403 Forbidden when an authenticated BUYER attempts to ship a seller order', async () => {
      authenticateAs(buyerId);
      rbacService.hasAnyRole.mockResolvedValue(false);

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/commerce/seller/orders/${orderId}/ship`)
        .set('Authorization', 'Bearer valid-buyer-token')
        .send({ trackingCode: 'CODE123', carrierName: 'FastShip' });

      expect(res.status).toBe(403);
      expect(orderService.shipSellerOrder).not.toHaveBeenCalled();
    });
  });

  describe('C. Missing permission', () => {
    it('returns 403 Forbidden when SELLER lacks ORDER.LIST permission on GET /', async () => {
      authenticateAs(sellerAId);
      rbacService.hasAnyRole.mockResolvedValue(true);
      rbacService.hasAllPermissions.mockResolvedValue(false);

      const res = await request(app.getHttpServer())
        .get('/api/v1/commerce/seller/orders')
        .set('Authorization', 'Bearer valid-seller-token');

      expect(res.status).toBe(403);
      expect(rbacService.hasAllPermissions).toHaveBeenCalledWith(sellerAId, [
        'ORDER.LIST',
      ]);
      expect(orderService.getSellerOrders).not.toHaveBeenCalled();
    });

    it('returns 403 Forbidden when SELLER lacks ORDER.VIEW permission on GET /:id', async () => {
      authenticateAs(sellerAId);
      rbacService.hasAnyRole.mockResolvedValue(true);
      rbacService.hasAllPermissions.mockResolvedValue(false);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/commerce/seller/orders/${orderId}`)
        .set('Authorization', 'Bearer valid-seller-token');

      expect(res.status).toBe(403);
      expect(rbacService.hasAllPermissions).toHaveBeenCalledWith(sellerAId, [
        'ORDER.VIEW',
      ]);
      expect(orderService.getSellerOrderById).not.toHaveBeenCalled();
    });

    it('returns 403 Forbidden when SELLER lacks ORDER.VIEW permission on PATCH /:id/confirm', async () => {
      authenticateAs(sellerAId);
      rbacService.hasAnyRole.mockResolvedValue(true);
      rbacService.hasAllPermissions.mockResolvedValue(false);

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/commerce/seller/orders/${orderId}/confirm`)
        .set('Authorization', 'Bearer valid-seller-token')
        .send({ note: 'Valid note' });

      expect(res.status).toBe(403);
      expect(rbacService.hasAllPermissions).toHaveBeenCalledWith(sellerAId, [
        'ORDER.VIEW',
      ]);
      expect(orderService.confirmSellerOrder).not.toHaveBeenCalled();
    });

    it('returns 403 Forbidden when SELLER lacks ORDER.VIEW permission on PATCH /:id/ship', async () => {
      authenticateAs(sellerAId);
      rbacService.hasAnyRole.mockResolvedValue(true);
      rbacService.hasAllPermissions.mockResolvedValue(false);

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/commerce/seller/orders/${orderId}/ship`)
        .set('Authorization', 'Bearer valid-seller-token')
        .send({ trackingCode: 'SHIP123', carrierName: 'VNPost' });

      expect(res.status).toBe(403);
      expect(rbacService.hasAllPermissions).toHaveBeenCalledWith(sellerAId, [
        'ORDER.VIEW',
      ]);
      expect(orderService.shipSellerOrder).not.toHaveBeenCalled();
    });
  });

  describe('D. Seller identity cannot be forged', () => {
    beforeEach(() => {
      authenticateAs(sellerAId);
      rbacService.hasAnyRole.mockResolvedValue(true);
      rbacService.hasAllPermissions.mockResolvedValue(true);
    });

    it('binds sellerId strictly to authenticated user on GET / even if sellerId query param is forged', async () => {
      const res = await request(app.getHttpServer())
        .get(
          `/api/v1/commerce/seller/orders?sellerId=${forgedSellerId}&page=1&limit=10`,
        )
        .set('Authorization', 'Bearer valid-seller-token');

      expect(res.status).toBe(200);
      expect(orderService.getSellerOrders).toHaveBeenCalledWith(
        sellerAId,
        expect.objectContaining({ page: 1, limit: 10 }),
      );
      expect(orderService.getSellerOrders).not.toHaveBeenCalledWith(
        forgedSellerId,
        expect.anything(),
      );
    });

    it('binds sellerId strictly to authenticated user on GET /:id ignoring any injected parameters', async () => {
      const res = await request(app.getHttpServer())
        .get(
          `/api/v1/commerce/seller/orders/${orderId}?sellerId=${forgedSellerId}`,
        )
        .set('Authorization', 'Bearer valid-seller-token');

      expect(res.status).toBe(200);
      expect(orderService.getSellerOrderById).toHaveBeenCalledWith(
        sellerAId,
        orderId,
      );
      expect(orderService.getSellerOrderById).not.toHaveBeenCalledWith(
        forgedSellerId,
        expect.anything(),
      );
    });

    it('binds sellerId strictly to authenticated user on PATCH /:id/confirm even if body attempts to forge sellerId', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/commerce/seller/orders/${orderId}/confirm`)
        .set('Authorization', 'Bearer valid-seller-token')
        .send({
          sellerId: forgedSellerId,
          note: 'Trying to forge seller identity',
        });

      expect(res.status).toBe(200);
      expect(orderService.confirmSellerOrder).toHaveBeenCalledWith(
        sellerAId,
        orderId,
        expect.objectContaining({ note: 'Trying to forge seller identity' }),
      );
      expect(orderService.confirmSellerOrder).not.toHaveBeenCalledWith(
        forgedSellerId,
        expect.anything(),
        expect.anything(),
      );
    });

    it('binds sellerId strictly to authenticated user on PATCH /:id/ship even if body attempts to forge sellerId', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/commerce/seller/orders/${orderId}/ship`)
        .set('Authorization', 'Bearer valid-seller-token')
        .send({
          sellerId: forgedSellerId,
          trackingCode: 'LEGAL-TRACK-999',
          carrierName: 'GiaoHangNhanh',
        });

      expect(res.status).toBe(200);
      expect(orderService.shipSellerOrder).toHaveBeenCalledWith(
        sellerAId,
        orderId,
        expect.objectContaining({
          trackingCode: 'LEGAL-TRACK-999',
          carrierName: 'GiaoHangNhanh',
        }),
      );
      expect(orderService.shipSellerOrder).not.toHaveBeenCalledWith(
        forgedSellerId,
        expect.anything(),
        expect.anything(),
      );
    });
  });
});
