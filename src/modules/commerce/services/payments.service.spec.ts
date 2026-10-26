import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import { Repository } from 'typeorm';
import { OrderEntity } from '../domain/entities/order.entity.js';
import { PaymentEntity } from '../domain/entities/payment.entity.js';
import { CreatePaymentIntentDto } from '../dtos/create-payment-intent.dto.js';
import { PaymentsService } from './payments.service.js';
import { StripeClientService } from './stripe-client.service.js';

describe('PaymentsService', () => {
  let service: PaymentsService;
  let orderRepository: Repository<OrderEntity>;
  let paymentRepository: Repository<PaymentEntity>;
  let stripeClientService: StripeClientService;
  let mockStripe: {
    paymentIntents: {
      create: ReturnType<typeof vi.fn>;
      retrieve: ReturnType<typeof vi.fn>;
    };
  };

  const buyerId = '11111111-1111-4111-8111-111111111111';
  const otherBuyerId = '22222222-2222-4222-8222-222222222222';
  const orderId = '33333333-3333-4333-8333-333333333333';

  const mockOrder: OrderEntity = {
    id: orderId,
    orderNumber: 'NEXUS-20261024-001',
    checkoutSessionId: '44444444-4444-4444-8444-444444444444',
    buyerId,
    sellerId: '55555555-5555-4555-8555-555555555555',
    source: 'CART',
    auctionId: null,
    status: 'PENDING_PAYMENT',
    subtotal: '500000.00',
    discountAmount: '0.00',
    shippingFee: '50000.00',
    tax: '0.00',
    total: '550000.00',
    currency: 'VND',
    shippingAddressSnapshot: { city: 'HCM' },
    holdExpiresAt: new Date(),
    idempotencyKey: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    orderRepository = {
      findOne: vi.fn(),
    } as unknown as Repository<OrderEntity>;

    paymentRepository = {
      findOne: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      save: vi.fn(),
    } as unknown as Repository<PaymentEntity>;

    mockStripe = {
      paymentIntents: {
        create: vi.fn(),
        retrieve: vi.fn(),
      },
    };

    stripeClientService = {
      getClient: vi.fn().mockReturnValue(mockStripe as unknown as Stripe),
    } as unknown as StripeClientService;

    service = new PaymentsService(
      orderRepository,
      paymentRepository,
      stripeClientService,
    );
  });

  it('throws NotFoundException when order does not exist', async () => {
    vi.mocked(orderRepository.findOne).mockResolvedValue(null);

    const dto: CreatePaymentIntentDto = { orderId };

    await expect(service.createPaymentIntent(buyerId, dto)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('throws ForbiddenException when order belongs to another user', async () => {
    vi.mocked(orderRepository.findOne).mockResolvedValue({
      ...mockOrder,
      buyerId: otherBuyerId,
    });

    const dto: CreatePaymentIntentDto = { orderId };

    await expect(service.createPaymentIntent(buyerId, dto)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('throws ConflictException when order is already PAID', async () => {
    vi.mocked(orderRepository.findOne).mockResolvedValue({
      ...mockOrder,
      status: 'PAID',
    });

    const dto: CreatePaymentIntentDto = { orderId };

    await expect(service.createPaymentIntent(buyerId, dto)).rejects.toThrow(
      ConflictException,
    );
  });

  it('throws BadRequestException when order is CANCELLED', async () => {
    vi.mocked(orderRepository.findOne).mockResolvedValue({
      ...mockOrder,
      status: 'CANCELLED',
    });

    const dto: CreatePaymentIntentDto = { orderId };

    await expect(service.createPaymentIntent(buyerId, dto)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('throws BadRequestException when order amount or currency is invalid', async () => {
    vi.mocked(orderRepository.findOne).mockResolvedValue({
      ...mockOrder,
      currency: 'INVALID_CURRENCY',
    });

    const dto: CreatePaymentIntentDto = { orderId };

    await expect(service.createPaymentIntent(buyerId, dto)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('propagates ServiceUnavailableException when Stripe configuration is missing', async () => {
    vi.mocked(orderRepository.findOne).mockResolvedValue(mockOrder);
    vi.mocked(paymentRepository.findOne).mockResolvedValue(null);
    vi.mocked(paymentRepository.count).mockResolvedValue(0);
    vi.mocked(stripeClientService.getClient).mockImplementation(() => {
      throw new ServiceUnavailableException('Stripe is not configured');
    });

    const dto: CreatePaymentIntentDto = { orderId };

    await expect(service.createPaymentIntent(buyerId, dto)).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('creates Stripe PaymentIntent with authoritative backend values, ignoring client tampering', async () => {
    vi.mocked(orderRepository.findOne).mockResolvedValue(mockOrder);
    vi.mocked(paymentRepository.findOne).mockResolvedValue(null);
    vi.mocked(paymentRepository.count).mockResolvedValue(0);

    const mockPaymentIntent = {
      id: 'pi_test_123',
      client_secret: 'pi_test_123_secret_abc',
    };
    mockStripe.paymentIntents.create.mockResolvedValue(mockPaymentIntent);

    const createdPayment = {
      id: 'pay_uuid_1',
      orderId,
      status: 'INITIATED',
    };
    vi.mocked(paymentRepository.create).mockReturnValue(
      createdPayment as PaymentEntity,
    );
    vi.mocked(paymentRepository.save).mockResolvedValue(
      createdPayment as PaymentEntity,
    );

    const dto: CreatePaymentIntentDto = { orderId };

    const result = await service.createPaymentIntent(buyerId, dto);

    expect(mockStripe.paymentIntents.create).toHaveBeenCalledWith(
      {
        amount: 550000,
        currency: 'vnd',
        metadata: {
          orderId,
          orderNumber: 'NEXUS-20261024-001',
          buyerId,
        },
      },
      {
        idempotencyKey: `nexus_order_${orderId}_attempt_1`,
      },
    );

    expect(paymentRepository.create).toHaveBeenCalledWith({
      orderId,
      checkoutSessionId: mockOrder.checkoutSessionId,
      provider: 'STRIPE',
      providerPaymentId: 'pi_test_123',
      amount: '550000.00',
      currency: 'VND',
      status: 'INITIATED',
      attemptNo: 1,
      idempotencyKey: null,
    });

    expect(result).toEqual({
      paymentId: 'pay_uuid_1',
      orderId,
      paymentIntentId: 'pi_test_123',
      clientSecret: 'pi_test_123_secret_abc',
      amount: '550000.00',
      currency: 'VND',
      status: 'INITIATED',
    });
  });

  it('reuses existing active PaymentIntent if already present on the order', async () => {
    vi.mocked(orderRepository.findOne).mockResolvedValue(mockOrder);

    const existingActivePayment: Partial<PaymentEntity> = {
      id: 'existing_pay_1',
      orderId,
      amount: '550000.00',
      currency: 'VND',
      providerPaymentId: 'pi_existing_123',
      status: 'INITIATED',
    };
    vi.mocked(paymentRepository.findOne).mockResolvedValue(
      existingActivePayment as PaymentEntity,
    );

    mockStripe.paymentIntents.retrieve.mockResolvedValue({
      id: 'pi_existing_123',
      client_secret: 'pi_existing_secret_xyz',
      status: 'requires_payment_method',
    });

    const dto: CreatePaymentIntentDto = { orderId };
    const result = await service.createPaymentIntent(buyerId, dto);

    expect(mockStripe.paymentIntents.retrieve).toHaveBeenCalledWith(
      'pi_existing_123',
    );
    expect(mockStripe.paymentIntents.create).not.toHaveBeenCalled();
    expect(result.clientSecret).toBe('pi_existing_secret_xyz');
    expect(result.paymentIntentId).toBe('pi_existing_123');
  });

  it('reuses previous payment when idempotencyKey matches on the same order', async () => {
    vi.mocked(orderRepository.findOne).mockResolvedValue(mockOrder);

    const existingByIdempotency: Partial<PaymentEntity> = {
      id: 'existing_idem_pay',
      orderId,
      idempotencyKey: 'idem-key-1',
      providerPaymentId: 'pi_idem_123',
      status: 'INITIATED',
    };
    vi.mocked(paymentRepository.findOne).mockResolvedValue(
      existingByIdempotency as PaymentEntity,
    );

    mockStripe.paymentIntents.retrieve.mockResolvedValue({
      id: 'pi_idem_123',
      client_secret: 'pi_idem_secret',
      status: 'requires_payment_method',
    });

    const dto: CreatePaymentIntentDto = {
      orderId,
      idempotencyKey: 'idem-key-1',
    };
    const result = await service.createPaymentIntent(buyerId, dto);

    expect(result.paymentIntentId).toBe('pi_idem_123');
    expect(mockStripe.paymentIntents.create).not.toHaveBeenCalled();
  });

  it('rejects when idempotencyKey was previously used on another order', async () => {
    vi.mocked(orderRepository.findOne).mockResolvedValue(mockOrder);

    const conflictingPayment: Partial<PaymentEntity> = {
      id: 'conflicting_pay',
      orderId: 'other-order-uuid',
      idempotencyKey: 'reused-key',
    };
    vi.mocked(paymentRepository.findOne).mockResolvedValue(
      conflictingPayment as PaymentEntity,
    );

    const dto: CreatePaymentIntentDto = {
      orderId,
      idempotencyKey: 'reused-key',
    };

    await expect(service.createPaymentIntent(buyerId, dto)).rejects.toThrow(
      ConflictException,
    );
  });

  it('rejects when idempotencyKey was previously used on a FAILED or CANCELLED payment', async () => {
    vi.mocked(orderRepository.findOne).mockResolvedValue(mockOrder);

    const failedPayment: Partial<PaymentEntity> = {
      id: 'failed_pay_id',
      orderId,
      idempotencyKey: 'terminal-key',
      status: 'FAILED',
    };
    vi.mocked(paymentRepository.findOne).mockResolvedValue(
      failedPayment as PaymentEntity,
    );

    const dto: CreatePaymentIntentDto = {
      orderId,
      idempotencyKey: 'terminal-key',
    };

    await expect(service.createPaymentIntent(buyerId, dto)).rejects.toThrow(
      ConflictException,
    );
    await expect(service.createPaymentIntent(buyerId, dto)).rejects.toThrow(
      /already failed/,
    );
  });

  it('handles Stripe SDK creation failure safely', async () => {
    vi.mocked(orderRepository.findOne).mockResolvedValue(mockOrder);
    vi.mocked(paymentRepository.findOne).mockResolvedValue(null);
    vi.mocked(paymentRepository.count).mockResolvedValue(0);

    mockStripe.paymentIntents.create.mockRejectedValue(
      new Error('Stripe API network timeout'),
    );

    const dto: CreatePaymentIntentDto = { orderId };

    await expect(service.createPaymentIntent(buyerId, dto)).rejects.toThrow(
      'Stripe API network timeout',
    );
    expect(paymentRepository.save).not.toHaveBeenCalled();
  });

  it('recovers gracefully from unique constraint violation (23505) under concurrent create-intent requests', async () => {
    vi.mocked(orderRepository.findOne).mockResolvedValue(mockOrder);
    // 1st call: active payment lookup (returns null)
    // 2nd call: 23505 recovery lookup (returns the record saved by concurrent request)
    vi.mocked(paymentRepository.findOne)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'concurrent-recovered-pay-id',
        orderId,
        providerPaymentId: 'pi_concurrent_123',
        status: 'INITIATED',
      } as PaymentEntity);

    vi.mocked(paymentRepository.count).mockResolvedValue(0);

    mockStripe.paymentIntents.create.mockResolvedValue({
      id: 'pi_concurrent_123',
      client_secret: 'pi_concurrent_secret',
    });

    vi.mocked(paymentRepository.create).mockReturnValue({
      orderId,
    } as PaymentEntity);

    const uniqueViolationError = Object.assign(
      new Error(
        'duplicate key value violates unique constraint "payments_provider_payment_id_key"',
      ),
      { code: '23505' },
    );
    vi.mocked(paymentRepository.save).mockRejectedValue(uniqueViolationError);

    const dto: CreatePaymentIntentDto = { orderId };

    const result = await service.createPaymentIntent(buyerId, dto);

    expect(result).toEqual({
      paymentId: 'concurrent-recovered-pay-id',
      orderId,
      paymentIntentId: 'pi_concurrent_123',
      clientSecret: 'pi_concurrent_secret',
      amount: '550000.00',
      currency: 'VND',
      status: 'INITIATED',
    });
  });

  it('rejects with ConflictException when unique constraint violation (23505) belongs to a different order', async () => {
    vi.mocked(orderRepository.findOne).mockResolvedValue(mockOrder);
    vi.mocked(paymentRepository.findOne)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'cross-order-pay-id',
        orderId: 'other-order-id',
        providerPaymentId: 'pi_race_123',
        status: 'INITIATED',
      } as PaymentEntity);

    vi.mocked(paymentRepository.count).mockResolvedValue(0);

    mockStripe.paymentIntents.create.mockResolvedValue({
      id: 'pi_race_123',
      client_secret: 'pi_race_secret',
    });

    vi.mocked(paymentRepository.create).mockReturnValue({
      orderId,
    } as PaymentEntity);

    const uniqueViolationError = Object.assign(
      new Error(
        'duplicate key value violates unique constraint "payments_idempotency_key_key"',
      ),
      { code: '23505' },
    );
    vi.mocked(paymentRepository.save).mockRejectedValue(uniqueViolationError);

    const dto: CreatePaymentIntentDto = {
      orderId,
      idempotencyKey: 'race-key',
    };

    await expect(service.createPaymentIntent(buyerId, dto)).rejects.toThrow(
      ConflictException,
    );
  });

  it('handles general database persistence failure after Stripe succeeds', async () => {
    vi.mocked(orderRepository.findOne).mockResolvedValue(mockOrder);
    vi.mocked(paymentRepository.findOne).mockResolvedValue(null);
    vi.mocked(paymentRepository.count).mockResolvedValue(0);

    mockStripe.paymentIntents.create.mockResolvedValue({
      id: 'pi_created_orphan',
      client_secret: 'pi_secret_orphan',
    });

    vi.mocked(paymentRepository.create).mockReturnValue({
      orderId,
    } as PaymentEntity);
    vi.mocked(paymentRepository.save).mockRejectedValue(
      new Error('Database disk full / connection timeout'),
    );

    const dto: CreatePaymentIntentDto = { orderId };

    await expect(service.createPaymentIntent(buyerId, dto)).rejects.toThrow(
      'Database disk full / connection timeout',
    );
  });
});
