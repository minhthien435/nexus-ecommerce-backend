import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  INestApplication,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter.js';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor.js';
import { PaymentsController } from '../src/modules/commerce/controllers/payments.controller.js';
import { PaymentsService } from '../src/modules/commerce/services/payments.service.js';
import { PaymentWebhookService } from '../src/modules/commerce/services/payment-webhook.service.js';
import { AccessTokenGuard } from '../src/modules/identity/auth/guards/access-token.guard.js';
import { UserEntity } from '../src/modules/identity/domain/user.entity.js';

const userId = '11111111-1111-4111-8111-111111111111';
const validOrderId = '33333333-3333-4333-8333-333333333333';

describe('Payments Endpoints (E2E)', () => {
  let app: INestApplication;
  let token: string;
  const users = { findOne: vi.fn() };
  const paymentsService = {
    createPayosPaymentLink: vi.fn(),
  };
  const paymentWebhookService = {
    handlePayosWebhook: vi.fn(),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'payments-test-secret' })],
      controllers: [PaymentsController],
      providers: [
        AccessTokenGuard,
        { provide: getRepositoryToken(UserEntity), useValue: users },
        { provide: PaymentsService, useValue: paymentsService },
        { provide: PaymentWebhookService, useValue: paymentWebhookService },
      ],
    }).compile();

    app = module.createNestApplication({ rawBody: true });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
        exceptionFactory: (errors) => {
          return new BadRequestException({
            errorCode: 'VALIDATION_ERROR',
            message: 'Validation failed',
            errors: errors.map((e) => ({
              field: e.property,
              rule: Object.keys(e.constraints ?? {})[0] ?? 'custom',
              message: Object.values(e.constraints ?? {})[0] ?? 'Invalid',
            })),
          });
        },
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new TransformInterceptor());
    await app.init();

    const jwt = module.get(JwtService);
    token = jwt.sign({
      sub: userId,
      email: 'buyer@test.com',
      tokenVersion: 1,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    users.findOne.mockResolvedValue({ id: userId, tokenVersion: 1 });
  });

  describe('POST /api/v1/commerce/payments/payos/create-link', () => {
    it('rejects unauthenticated request with 401', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/commerce/payments/payos/create-link')
        .send({ orderId: validOrderId });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('rejects invalid orderId with 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/commerce/payments/payos/create-link')
        .set('Authorization', `Bearer ${token}`)
        .send({ orderId: 'invalid-uuid-format' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.errorCode).toBe('VALIDATION_ERROR');
    });

    it('returns 201 with checkoutUrl, qrCode, and orderCode upon success', async () => {
      paymentsService.createPayosPaymentLink.mockResolvedValue({
        paymentId: 'pay-uuid-payos-1',
        orderId: validOrderId,
        orderCode: 1793584893952001,
        paymentLinkId: 'link_payos_123',
        checkoutUrl: 'https://pay.payos.vn/web/123456',
        qrCode: 'vietqr://pay?amount=550000',
        amount: 550000,
        currency: 'VND',
        status: 'PENDING',
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/commerce/payments/payos/create-link')
        .set('Authorization', `Bearer ${token}`)
        .send({ orderId: validOrderId, idempotencyKey: 'payos_idem_1' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({
        paymentId: 'pay-uuid-payos-1',
        orderId: validOrderId,
        orderCode: 1793584893952001,
        paymentLinkId: 'link_payos_123',
        checkoutUrl: 'https://pay.payos.vn/web/123456',
        qrCode: 'vietqr://pay?amount=550000',
        amount: 550000,
        currency: 'VND',
        status: 'PENDING',
      });
    });

    it('propagates 403 ForbiddenException when caller does not own the order', async () => {
      paymentsService.createPayosPaymentLink.mockRejectedValue(
        new ForbiddenException(
          'You do not have permission to pay for this order',
        ),
      );

      const res = await request(app.getHttpServer())
        .post('/api/v1/commerce/payments/payos/create-link')
        .set('Authorization', `Bearer ${token}`)
        .send({ orderId: validOrderId });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('propagates 404 NotFoundException when order does not exist', async () => {
      paymentsService.createPayosPaymentLink.mockRejectedValue(
        new NotFoundException(`Order with id '${validOrderId}' not found`),
      );

      const res = await request(app.getHttpServer())
        .post('/api/v1/commerce/payments/payos/create-link')
        .set('Authorization', `Bearer ${token}`)
        .send({ orderId: validOrderId });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('propagates 409 ConflictException when order is already paid', async () => {
      paymentsService.createPayosPaymentLink.mockRejectedValue(
        new ConflictException('Order has already been paid'),
      );

      const res = await request(app.getHttpServer())
        .post('/api/v1/commerce/payments/payos/create-link')
        .set('Authorization', `Bearer ${token}`)
        .send({ orderId: validOrderId });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /api/v1/commerce/payments/payos/webhook', () => {
    const validWebhookPayload = {
      code: '00',
      desc: 'success',
      success: true,
      data: {
        orderCode: 1793584893952001,
        amount: 550000,
        description: 'Don hang test',
        accountNumber: '123456789',
        reference: 'TF_PAYOS_998877',
        transactionDateTime: '2026-11-02 08:30:00',
        currency: 'VND',
        paymentLinkId: 'link_payos_123',
        code: '00',
        desc: 'success',
      },
      signature: 'valid_signature',
    };

    it('does not require JWT authentication and returns 200 { received: true }', async () => {
      paymentWebhookService.handlePayosWebhook.mockResolvedValue({
        received: true,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/commerce/payments/payos/webhook')
        .send(validWebhookPayload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({ received: true });
    });

    it('propagates 400 when PayOS webhook signature verification fails', async () => {
      paymentWebhookService.handlePayosWebhook.mockRejectedValue(
        new BadRequestException(
          'Invalid PayOS webhook signature: Data not integrity',
        ),
      );

      const res = await request(app.getHttpServer())
        .post('/api/v1/commerce/payments/payos/webhook')
        .send({ ...validWebhookPayload, signature: 'bad_signature' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 200 { received: true, duplicate: true } on duplicate webhook deliveries', async () => {
      paymentWebhookService.handlePayosWebhook.mockResolvedValue({
        received: true,
        duplicate: true,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/commerce/payments/payos/webhook')
        .send(validWebhookPayload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({ received: true, duplicate: true });
    });
  });
});
