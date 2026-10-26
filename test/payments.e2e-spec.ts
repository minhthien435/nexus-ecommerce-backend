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
    createPaymentIntent: vi.fn(),
  };
  const paymentWebhookService = {
    handleWebhook: vi.fn(),
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
      }),
    );
    app.useGlobalInterceptors(new TransformInterceptor());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    const jwt = module.get(JwtService);
    token = await jwt.signAsync({ sub: userId, tokenVersion: 0 });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    users.findOne.mockResolvedValue({ id: userId, tokenVersion: 0 });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/v1/commerce/payments/stripe/create-intent', () => {
    it('rejects unauthenticated request with 401', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/commerce/payments/stripe/create-intent')
        .send({ orderId: validOrderId });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('rejects invalid or missing orderId format with 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/commerce/payments/stripe/create-intent')
        .set('Authorization', `Bearer ${token}`)
        .send({ orderId: 'not-a-uuid' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.errorCode).toBe('VALIDATION_ERROR');
    });

    it('rejects unexpected client fields when forbidNonWhitelisted is active', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/commerce/payments/stripe/create-intent')
        .set('Authorization', `Bearer ${token}`)
        .send({
          orderId: validOrderId,
          amount: 1, // Malicious override attempt
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 404 when order does not exist', async () => {
      paymentsService.createPaymentIntent.mockRejectedValue(
        new NotFoundException('Order not found'),
      );

      const res = await request(app.getHttpServer())
        .post('/api/v1/commerce/payments/stripe/create-intent')
        .set('Authorization', `Bearer ${token}`)
        .send({ orderId: validOrderId });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.errorCode).toBe('RESOURCE_NOT_FOUND');
    });

    it('returns 403 when user is not the buyer', async () => {
      paymentsService.createPaymentIntent.mockRejectedValue(
        new ForbiddenException('You do not have permission'),
      );

      const res = await request(app.getHttpServer())
        .post('/api/v1/commerce/payments/stripe/create-intent')
        .set('Authorization', `Bearer ${token}`)
        .send({ orderId: validOrderId });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.errorCode).toBe('FORBIDDEN');
    });

    it('returns 409 when order is already PAID', async () => {
      paymentsService.createPaymentIntent.mockRejectedValue(
        new ConflictException('Order has already been paid'),
      );

      const res = await request(app.getHttpServer())
        .post('/api/v1/commerce/payments/stripe/create-intent')
        .set('Authorization', `Bearer ${token}`)
        .send({ orderId: validOrderId });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.errorCode).toBe('RESOURCE_ALREADY_EXISTS');
    });

    it('returns 400 when order is CANCELLED', async () => {
      paymentsService.createPaymentIntent.mockRejectedValue(
        new BadRequestException('Order cannot be paid in current status'),
      );

      const res = await request(app.getHttpServer())
        .post('/api/v1/commerce/payments/stripe/create-intent')
        .set('Authorization', `Bearer ${token}`)
        .send({ orderId: validOrderId });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.errorCode).toBe('VALIDATION_ERROR');
    });

    it('creates PaymentIntent successfully and returns wrapped response envelope', async () => {
      paymentsService.createPaymentIntent.mockResolvedValue({
        paymentId: 'pay-uuid-1',
        orderId: validOrderId,
        paymentIntentId: 'pi_test_123',
        clientSecret: 'pi_test_123_secret_abc',
        amount: '550000.00',
        currency: 'VND',
        status: 'INITIATED',
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/commerce/payments/stripe/create-intent')
        .set('Authorization', `Bearer ${token}`)
        .send({ orderId: validOrderId });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({
        paymentId: 'pay-uuid-1',
        orderId: validOrderId,
        paymentIntentId: 'pi_test_123',
        clientSecret: 'pi_test_123_secret_abc',
        amount: '550000.00',
        currency: 'VND',
        status: 'INITIATED',
      });
    });
  });

  describe('POST /api/v1/commerce/payments/stripe/webhook', () => {
    it('does not require JWT authentication', async () => {
      paymentWebhookService.handleWebhook.mockResolvedValue({ received: true });

      const res = await request(app.getHttpServer())
        .post('/api/v1/commerce/payments/stripe/webhook')
        .set('stripe-signature', 't=123,v1=valid')
        .send({ id: 'evt_123', type: 'payment_intent.succeeded' });

      // Must NOT be 401 Unauthorized
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({ received: true });
    });

    it('rejects with 400 when PaymentWebhookService throws BadRequestException (invalid signature/payload)', async () => {
      paymentWebhookService.handleWebhook.mockRejectedValue(
        new BadRequestException('Invalid Stripe webhook signature'),
      );

      const res = await request(app.getHttpServer())
        .post('/api/v1/commerce/payments/stripe/webhook')
        .set('stripe-signature', 'invalid-signature')
        .send({ id: 'evt_bad' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.errorCode).toBe('VALIDATION_ERROR');
    });

    it('acknowledges duplicate events safely with 200 and { received: true, duplicate: true }', async () => {
      paymentWebhookService.handleWebhook.mockResolvedValue({
        received: true,
        duplicate: true,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/commerce/payments/stripe/webhook')
        .set('stripe-signature', 't=123,v1=valid')
        .send({ id: 'evt_dup' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({ received: true, duplicate: true });
    });
  });
});
