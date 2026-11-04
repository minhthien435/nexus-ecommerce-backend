import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataSource, EntityManager } from 'typeorm';
import type { Queue } from 'bullmq';
import type { Webhook, WebhookData } from '@payos/node';
import { OrderEntity } from '../domain/entities/order.entity.js';
import { PaymentCallbackEntity } from '../domain/entities/payment-callback.entity.js';
import { PaymentEntity } from '../domain/entities/payment.entity.js';
import type { OrderExpiryJobPayload } from '../order-expiry.constants.js';
import { PaymentWebhookService } from './payment-webhook.service.js';

import { PayosClientService } from './payos-client.service.js';

describe('PaymentWebhookService - PayOS Integration', () => {
  let service: PaymentWebhookService;
  let dataSource: DataSource;
  let payosClientService: PayosClientService;
  let expiryQueue: Queue<OrderExpiryJobPayload>;
  let manager: EntityManager;

  const orderId = '33333333-3333-4333-8333-333333333333';
  const orderCode = 1793584893952001;

  const mockWebhookData: WebhookData = {
    orderCode,
    amount: 550000,
    description: 'Don hang NEXUS-20261102-0',
    accountNumber: '123456789',
    reference: 'TF_PAYOS_998877',
    transactionDateTime: '2026-11-02 08:30:00',
    currency: 'VND',
    paymentLinkId: 'link_payos_123',
    code: '00',
    desc: 'success',
  };

  const mockWebhookPayload: Webhook = {
    code: '00',
    desc: 'success',
    success: true,
    data: mockWebhookData,
    signature: 'mock_valid_signature_hash',
  };

  const mockOrder: OrderEntity = {
    id: orderId,
    orderNumber: 'NEXUS-20261102-001',
    checkoutSessionId: '44444444-4444-4444-8444-444444444444',
    buyerId: 'buyer-uuid',
    sellerId: 'seller-uuid',
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
    shippingAddressSnapshot: {},
    holdExpiresAt: new Date(),
    idempotencyKey: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockPayment: PaymentEntity = {
    id: 'pay-uuid-1',
    orderId,
    checkoutSessionId: '44444444-4444-4444-8444-444444444444',
    provider: 'PAYOS',
    providerPaymentId: String(orderCode),
    amount: '550000.00',
    currency: 'VND',
    status: 'PENDING',
    attemptNo: 1,
    failureReason: null,
    idempotencyKey: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    manager = {
      findOne: vi.fn(),
      save: vi.fn().mockImplementation((entity) => Promise.resolve(entity)),
      create: vi.fn().mockImplementation((_entityClass, dto) => dto),
      delete: vi.fn().mockResolvedValue(undefined),
    } as unknown as EntityManager;

    dataSource = {
      transaction: vi.fn().mockImplementation((cb) => cb(manager)),
    } as unknown as DataSource;

    payosClientService = {
      verifyWebhook: vi.fn().mockResolvedValue(mockWebhookData),
    } as unknown as PayosClientService;

    expiryQueue = {
      getJob: vi.fn().mockResolvedValue({
        remove: vi.fn().mockResolvedValue(undefined),
      }),
    } as unknown as Queue<OrderExpiryJobPayload>;

    service = new PaymentWebhookService(
      dataSource,
      payosClientService,
      expiryQueue,
    );
  });

  it('rejects with BadRequestException when PayOS signature is invalid', async () => {
    vi.mocked(payosClientService.verifyWebhook).mockRejectedValue(
      new Error('Data not integrity'),
    );

    await expect(
      service.handlePayosWebhook(mockWebhookPayload),
    ).rejects.toThrow('Invalid PayOS webhook signature');
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('deduplicates and returns duplicate=true when event was already processed previously', async () => {
    vi.mocked(manager.findOne).mockImplementation((entityClass: unknown) => {
      if (entityClass === PaymentCallbackEntity) {
        return Promise.resolve({
          id: 'cb_1',
          providerEventId: 'payos_TF_PAYOS_998877',
          processedAt: new Date(),
        });
      }
      return Promise.resolve(null);
    });

    const result = await service.handlePayosWebhook(mockWebhookPayload);
    expect(result).toEqual({ received: true, duplicate: true });
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('successfully transitions Order to PAID, updates Payment to SUCCEEDED, and cancels BullMQ expiry', async () => {
    vi.mocked(manager.findOne).mockImplementation((entityClass: unknown) => {
      if (entityClass === PaymentCallbackEntity) return Promise.resolve(null);
      if (entityClass === PaymentEntity)
        return Promise.resolve({ ...mockPayment });
      if (entityClass === OrderEntity) return Promise.resolve({ ...mockOrder });
      return Promise.resolve(null);
    });

    const result = await service.handlePayosWebhook(mockWebhookPayload);

    expect(result).toEqual({ received: true });
    expect(manager.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: orderId, status: 'PAID' }),
    );
    expect(manager.save).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId,
        fromStatus: 'PENDING_PAYMENT',
        toStatus: 'PAID',
      }),
    );
    expect(manager.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'pay-uuid-1', status: 'SUCCEEDED' }),
    );
    expect(manager.save).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'PAYOS',
        providerEventId: 'payos_TF_PAYOS_998877',
      }),
    );
    expect(expiryQueue.getJob).toHaveBeenCalledWith(`order-expiry-${orderId}`);
  });

  it('throws BadRequestException when webhook amount does not match authoritative order.total', async () => {
    vi.mocked(manager.findOne).mockImplementation((entityClass: unknown) => {
      if (entityClass === PaymentCallbackEntity) return Promise.resolve(null);
      if (entityClass === PaymentEntity)
        return Promise.resolve({ ...mockPayment });
      if (entityClass === OrderEntity)
        return Promise.resolve({ ...mockOrder, total: '990000.00' });
      return Promise.resolve(null);
    });

    await expect(
      service.handlePayosWebhook(mockWebhookPayload),
    ).rejects.toThrow(BadRequestException);
    expect(expiryQueue.getJob).not.toHaveBeenCalled();
  });

  it('acknowledges 200 OK for PayOS webhook validation ping (test orderCode 123)', async () => {
    const pingPayload: Webhook = {
      ...mockWebhookPayload,
      data: {
        ...mockWebhookData,
        orderCode: 123,
        description: 'VQRIO123',
      },
    };

    vi.mocked(payosClientService.verifyWebhook).mockResolvedValue(
      pingPayload.data,
    );
    vi.mocked(manager.findOne).mockResolvedValue(null);

    const result = await service.handlePayosWebhook(pingPayload);
    expect(result).toEqual({ received: true });
  });

  it('throws NotFoundException when Payment record is not found for orderCode', async () => {
    vi.mocked(manager.findOne).mockImplementation((entityClass: unknown) => {
      if (entityClass === PaymentCallbackEntity) return Promise.resolve(null);
      if (entityClass === PaymentEntity) return Promise.resolve(null);
      return Promise.resolve(null);
    });

    await expect(
      service.handlePayosWebhook(mockWebhookPayload),
    ).rejects.toThrow(NotFoundException);
  });

  it('acknowledges safely without re-transitioning when order is already in PAID state', async () => {
    vi.mocked(manager.findOne).mockImplementation((entityClass: unknown) => {
      if (entityClass === PaymentCallbackEntity) return Promise.resolve(null);
      if (entityClass === PaymentEntity)
        return Promise.resolve({ ...mockPayment });
      if (entityClass === OrderEntity)
        return Promise.resolve({ ...mockOrder, status: 'PAID' });
      return Promise.resolve(null);
    });

    const result = await service.handlePayosWebhook(mockWebhookPayload);

    expect(result).toEqual({ received: true });
    expect(manager.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'SUCCEEDED' }),
    );
  });

  it('handles terminal order state (CANCELLED) by logging mismatch and marking payment SUCCEEDED', async () => {
    vi.mocked(manager.findOne).mockImplementation((entityClass: unknown) => {
      if (entityClass === PaymentCallbackEntity) return Promise.resolve(null);
      if (entityClass === PaymentEntity)
        return Promise.resolve({ ...mockPayment });
      if (entityClass === OrderEntity)
        return Promise.resolve({ ...mockOrder, status: 'CANCELLED' });
      return Promise.resolve(null);
    });

    const result = await service.handlePayosWebhook(mockWebhookPayload);

    expect(result).toEqual({ received: true });
    expect(manager.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'SUCCEEDED' }),
    );
  });

  it('updates payment status to FAILED when PayOS returns a non-success error code', async () => {
    const failedWebhookPayload: Webhook = {
      ...mockWebhookPayload,
      code: '01',
      data: {
        ...mockWebhookData,
        code: '01',
        desc: 'Buyer cancelled transaction',
      },
    };

    vi.mocked(payosClientService.verifyWebhook).mockResolvedValue(
      failedWebhookPayload.data,
    );

    vi.mocked(manager.findOne).mockImplementation((entityClass: unknown) => {
      if (entityClass === PaymentCallbackEntity) return Promise.resolve(null);
      if (entityClass === PaymentEntity)
        return Promise.resolve({ ...mockPayment });
      if (entityClass === OrderEntity) return Promise.resolve({ ...mockOrder });
      return Promise.resolve(null);
    });

    const result = await service.handlePayosWebhook(failedWebhookPayload);

    expect(result).toEqual({ received: true });
    expect(manager.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'FAILED',
        failureReason: expect.stringContaining('Buyer cancelled transaction'),
      }),
    );
  });

  it('handles concurrent duplicate (PostgreSQL 23505) safely', async () => {
    const pgError = new Error(
      'duplicate key value violates unique constraint',
    ) as Error & {
      code?: string;
      constraint?: string;
    };
    pgError.code = '23505';
    pgError.constraint = 'payment_callbacks_provider_event_id_key';

    vi.mocked(dataSource.transaction).mockRejectedValue(pgError);

    const result = await service.handlePayosWebhook(mockWebhookPayload);
    expect(result).toEqual({ received: true, duplicate: true });
  });
});
