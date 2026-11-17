import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Repository } from 'typeorm';
import { OrderEntity } from '../domain/entities/order.entity.js';
import { PaymentEntity } from '../domain/entities/payment.entity.js';
import { CreatePayosPaymentLinkDto } from '../dtos/create-payos-payment-link.dto.js';
import { PaymentsService } from './payments.service.js';
import { PayosClientService } from './payos-client.service.js';

describe('PaymentsService', () => {
  let service: PaymentsService;
  let orderRepository: Repository<OrderEntity>;
  let paymentRepository: Repository<PaymentEntity>;
  let payosClientService: PayosClientService;
  let configService: ConfigService;
  const coinQuery = vi.fn();

  const buyerId = '11111111-1111-4111-8111-111111111111';
  const otherBuyerId = '22222222-2222-4222-8222-222222222222';
  const orderId = '33333333-3333-4333-8333-333333333333';

  const mockOrder: OrderEntity = {
    id: orderId,
    orderNumber: 'NEXUS-20261102-001',
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
    trackingCode: null,
    carrierName: null,
    deliveredAt: null,
    shippingAddressSnapshot: { city: 'HCM' },
    holdExpiresAt: new Date(),
    idempotencyKey: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockPayosResponse = {
    bin: '970407',
    accountNumber: '123456789',
    accountName: 'NEXUS STORE',
    amount: 550000,
    description: 'Don hang NEXUS-20261102-0',
    orderCode: 1793584893952001,
    currency: 'VND',
    paymentLinkId: 'link_payos_123',
    status: 'PENDING' as const,
    checkoutUrl: 'https://pay.payos.vn/web/123456',
    qrCode: 'vietqr://pay?amount=550000',
  };

  beforeEach(() => {
    orderRepository = {
      findOne: vi.fn(),
      save: vi.fn(),
    } as unknown as Repository<OrderEntity>;

    paymentRepository = {
      findOne: vi.fn(),
      count: vi.fn(),
      create: vi
        .fn()
        .mockImplementation((dto) => ({ id: 'pay_uuid_1', ...dto })),
      save: vi.fn().mockImplementation((entity) => Promise.resolve(entity)),
    } as unknown as Repository<PaymentEntity>;

    payosClientService = {
      createPaymentLink: vi.fn().mockResolvedValue(mockPayosResponse),
    } as unknown as PayosClientService;

    configService = {
      get: vi.fn((key: string) => {
        if (key === 'PAYOS_RETURN_URL') return 'http://localhost:5173/return';
        if (key === 'PAYOS_CANCEL_URL') return 'http://localhost:5173/cancel';
        return undefined;
      }),
    } as unknown as ConfigService;

    coinQuery.mockReset().mockResolvedValue([{ applied: true }]);
    service = new PaymentsService(
      {
        transaction: (run: (manager: unknown) => unknown) =>
          run({
            getRepository: (entity: unknown) =>
              entity === OrderEntity ? orderRepository : paymentRepository,
            query: coinQuery,
          }),
      } as never,
      payosClientService,
      configService,
    );
  });

  it('creates a PayOS payment link successfully when valid order and ownership', async () => {
    vi.mocked(orderRepository.findOne).mockResolvedValue(mockOrder);
    vi.mocked(paymentRepository.count).mockResolvedValue(0);

    const dto: CreatePayosPaymentLinkDto = { orderId };
    const result = await service.createPayosPaymentLink(buyerId, dto);

    expect(result).toBeDefined();
    expect(result.orderId).toBe(orderId);
    expect(result.amount).toBe(550000);
    expect(result.currency).toBe('VND');
    expect(result.checkoutUrl).toBe('https://pay.payos.vn/web/123456');
    expect(result.qrCode).toBe('vietqr://pay?amount=550000');
    expect(result.orderCode).toBeGreaterThan(0);
    expect(result.paymentLinkId).toBe('link_payos_123');

    expect(payosClientService.createPaymentLink).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 550000,
        cancelUrl: 'http://localhost:5173/cancel',
        returnUrl: 'http://localhost:5173/return',
        expiredAt: expect.any(Number),
      }),
    );

    expect(paymentRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId,
        provider: 'PAYOS',
        currency: 'VND',
        status: 'PENDING',
      }),
    );
    expect(paymentRepository.save).toHaveBeenCalled();
  });

  it('throws NotFoundException when order does not exist', async () => {
    vi.mocked(orderRepository.findOne).mockResolvedValue(null);

    const dto: CreatePayosPaymentLinkDto = { orderId };
    await expect(service.createPayosPaymentLink(buyerId, dto)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('throws ForbiddenException when buyer does not own the order', async () => {
    vi.mocked(orderRepository.findOne).mockResolvedValue(mockOrder);

    const dto: CreatePayosPaymentLinkDto = { orderId };
    await expect(
      service.createPayosPaymentLink(otherBuyerId, dto),
    ).rejects.toThrow(ForbiddenException);
  });

  it('throws ConflictException when order is already in PAID status', async () => {
    vi.mocked(orderRepository.findOne).mockResolvedValue({
      ...mockOrder,
      status: 'PAID',
    });

    const dto: CreatePayosPaymentLinkDto = { orderId };
    await expect(service.createPayosPaymentLink(buyerId, dto)).rejects.toThrow(
      ConflictException,
    );
  });

  it('throws BadRequestException when order status is not PENDING_PAYMENT', async () => {
    vi.mocked(orderRepository.findOne).mockResolvedValue({
      ...mockOrder,
      status: 'PROCESSING',
    });

    const dto: CreatePayosPaymentLinkDto = { orderId };
    await expect(service.createPayosPaymentLink(buyerId, dto)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('throws BadRequestException when order currency is not VND', async () => {
    vi.mocked(orderRepository.findOne).mockResolvedValue({
      ...mockOrder,
      currency: 'USD',
    });

    const dto: CreatePayosPaymentLinkDto = { orderId };
    await expect(service.createPayosPaymentLink(buyerId, dto)).rejects.toThrow(
      'PayOS only supports VND currency',
    );
  });

  it('throws BadRequestException when order total is zero or negative', async () => {
    vi.mocked(orderRepository.findOne).mockResolvedValue({
      ...mockOrder,
      total: '0.00',
    });

    const dto: CreatePayosPaymentLinkDto = { orderId };
    await expect(service.createPayosPaymentLink(buyerId, dto)).rejects.toThrow(
      'Order total must be greater than 0',
    );
  });

  it('returns cached payment link when same idempotencyKey is used', async () => {
    vi.mocked(orderRepository.findOne).mockResolvedValue(mockOrder);
    const cachedData = {
      orderCode: 1793584893952001,
      paymentLinkId: 'link_payos_123',
      checkoutUrl: 'https://pay.payos.vn/web/123456',
      qrCode: 'vietqr://pay?amount=550000',
    };
    vi.mocked(paymentRepository.findOne).mockResolvedValue({
      id: 'pay_existing_1',
      orderId,
      status: 'PENDING',
      failureReason: JSON.stringify(cachedData),
    } as PaymentEntity);

    const dto: CreatePayosPaymentLinkDto = {
      orderId,
      idempotencyKey: 'idem_key_123',
    };
    const result = await service.createPayosPaymentLink(buyerId, dto);

    expect(result.checkoutUrl).toBe('https://pay.payos.vn/web/123456');
    expect(result.orderCode).toBe(1793584893952001);
    expect(payosClientService.createPaymentLink).not.toHaveBeenCalled();
  });

  it('applies auction Coin before creating a link for the reduced amount', async () => {
    vi.mocked(orderRepository.findOne).mockResolvedValue({
      ...mockOrder,
      source: 'AUCTION',
      holdExpiresAt: new Date(Date.now() + 3_600_000),
    });
    vi.mocked(paymentRepository.count).mockResolvedValue(0);

    const result = await service.createPayosPaymentLink(buyerId, {
      orderId,
      useCoins: 30_000,
    });

    expect(coinQuery).toHaveBeenCalledWith(expect.any(String), [
      buyerId,
      orderId,
      -30_000,
    ]);
    expect(orderRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        discountAmount: '30000.00',
        total: '520000.00',
      }),
    );
    expect(payosClientService.createPaymentLink).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 520_000 }),
    );
    expect(result).toMatchObject({
      amount: 520_000,
      coinDiscountAmount: 30_000,
    });
  });

  it('rejects changes to the auction Coin selection once a payment exists', async () => {
    vi.mocked(orderRepository.findOne).mockResolvedValue({
      ...mockOrder,
      source: 'AUCTION',
      holdExpiresAt: new Date(Date.now() + 3_600_000),
    });
    vi.mocked(paymentRepository.count).mockResolvedValue(1);

    await expect(
      service.createPayosPaymentLink(buyerId, { orderId, useCoins: 30_000 }),
    ).rejects.toThrow(ConflictException);
    expect(coinQuery).not.toHaveBeenCalled();
    expect(payosClientService.createPaymentLink).not.toHaveBeenCalled();
  });

  it('handles PayOS SDK failure by throwing ServiceUnavailableException', async () => {
    vi.mocked(orderRepository.findOne).mockResolvedValue(mockOrder);
    vi.mocked(payosClientService.createPaymentLink).mockRejectedValue(
      new Error('PayOS gateway timeout'),
    );

    const dto: CreatePayosPaymentLinkDto = { orderId };
    await expect(service.createPayosPaymentLink(buyerId, dto)).rejects.toThrow(
      ServiceUnavailableException,
    );
  });
});
