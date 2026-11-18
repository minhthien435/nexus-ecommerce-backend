import { ConflictException, type INestApplication } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter.js';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor.js';
import { OrderController } from '../src/modules/commerce/controllers/order.controller.js';
import { OrderRefundService } from '../src/modules/commerce/services/order-refund.service.js';
import { OrderService } from '../src/modules/commerce/services/order.service.js';
import { AccessTokenGuard } from '../src/modules/identity/auth/guards/access-token.guard.js';
import { UserEntity } from '../src/modules/identity/domain/user.entity.js';
import { PermissionsGuard } from '../src/modules/identity/rbac/guards/permissions.guard.js';
import { RbacService } from '../src/modules/identity/rbac/rbac.service.js';

const buyerId = '11111111-1111-4111-8111-111111111111';
const orderId = '22222222-2222-4222-8222-222222222222';

describe('Buyer order detail and cancellation (HTTP)', () => {
  let app: INestApplication;
  let token: string;
  const users = { findOne: vi.fn() };
  const rbac = { hasAllPermissions: vi.fn() };
  const orders = {
    checkout: vi.fn(),
    getBuyerOrders: vi.fn(),
    getOrderById: vi.fn(),
    cancelOrder: vi.fn(),
  };
  const refunds = {
    getBuyerRefundForOrder: vi.fn(),
    updateBuyerRefundAccount: vi.fn(),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'order-test-secret' })],
      controllers: [OrderController],
      providers: [
        AccessTokenGuard,
        PermissionsGuard,
        { provide: getRepositoryToken(UserEntity), useValue: users },
        { provide: RbacService, useValue: rbac },
        { provide: OrderService, useValue: orders },
        { provide: OrderRefundService, useValue: refunds },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalInterceptors(new TransformInterceptor());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    token = await module
      .get(JwtService)
      .signAsync({ sub: buyerId, tokenVersion: 0 });
  });

  beforeEach(() => {
    vi.resetAllMocks();
    users.findOne.mockResolvedValue({ tokenVersion: 0 });
    rbac.hasAllPermissions.mockResolvedValue(true);
    orders.getOrderById.mockResolvedValue({
      id: orderId,
      buyerId,
      status: 'PENDING_PAYMENT',
      total: '12.34',
      items: [{ productNameSnapshot: 'Persisted product' }],
      history: [{ toStatus: 'PENDING_PAYMENT' }],
    });
    orders.cancelOrder.mockResolvedValue({
      id: orderId,
      status: 'CANCELLED',
    });
    refunds.getBuyerRefundForOrder.mockResolvedValue(null);
  });

  afterAll(async () => app.close());

  it('returns 401 for detail and cancel without touching orders', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/commerce/orders/${orderId}`)
      .expect(401);
    await request(app.getHttpServer())
      .patch(`/api/v1/commerce/orders/${orderId}/cancel`)
      .expect(401);
    expect(orders.getOrderById).not.toHaveBeenCalled();
    expect(orders.cancelOrder).not.toHaveBeenCalled();
  });

  it.each([
    ['get', 'ORDER.VIEW'],
    ['patch', 'ORDER.CANCEL'],
  ] as const)(
    'returns 403 when %s permission is missing',
    async (method, permission) => {
      rbac.hasAllPermissions.mockResolvedValue(false);
      const call = request(app.getHttpServer());
      if (method === 'get') {
        await call
          .get(`/api/v1/commerce/orders/${orderId}`)
          .set('Authorization', `Bearer ${token}`)
          .expect(403);
      } else {
        await call
          .patch(`/api/v1/commerce/orders/${orderId}/cancel`)
          .set('Authorization', `Bearer ${token}`)
          .expect(403);
      }
      expect(rbac.hasAllPermissions).toHaveBeenCalledWith(buyerId, [
        permission,
      ]);
    },
  );

  it('returns persisted items and status history in the standard envelope', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/commerce/orders/${orderId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(response.body).toMatchObject({
      success: true,
      data: {
        id: orderId,
        total: '12.34',
        items: [{ productNameSnapshot: 'Persisted product' }],
        history: [{ toStatus: 'PENDING_PAYMENT' }],
      },
    });
    expect(orders.getOrderById).toHaveBeenCalledWith(buyerId, orderId);
  });

  it('cancels using only the authenticated buyer identity', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/commerce/orders/${orderId}/cancel`)
      .set('Authorization', `Bearer ${token}`)
      .send({ buyerId: '33333333-3333-4333-8333-333333333333' })
      .expect(200);
    expect(orders.cancelOrder).toHaveBeenCalledWith(buyerId, orderId);
  });

  it('returns 409 when the order state no longer allows cancellation', async () => {
    orders.cancelOrder.mockRejectedValue(
      new ConflictException({
        errorCode: 'ORDER_TRANSITION_NOT_ALLOWED',
        message: 'Order cannot be cancelled',
      }),
    );
    await request(app.getHttpServer())
      .patch(`/api/v1/commerce/orders/${orderId}/cancel`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409);
  });
});
