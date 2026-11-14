import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataSource, EntityManager } from 'typeorm';
import type { Queue } from 'bullmq';
import type { Webhook, WebhookData } from '@payos/node';
import { OrderEntity } from '../domain/entities/order.entity.js';
import { PaymentCallbackEntity } from '../domain/entities/payment-callback.entity.js';
import { PaymentEntity } from '../domain/entities/payment.entity.js';
import { CartItemEntity } from '../domain/entities/cart-item.entity.js';
import type { OrderExpiryJobPayload } from '../order-expiry.constants.js';
import { PaymentWebhookService } from './payment-webhook.service.js';
import { PayosClientService } from './payos-client.service.js';

describe('PaymentWebhookService', () => {
  let service: PaymentWebhookService;
  let dataSource: DataSource;
  let payosClientService: PayosClientService;
  let expiryQueue: Queue<OrderExpiryJobPayload>;
  let manager: EntityManager;

  const orderId = '33333333-3333-4333-8333-333333333333';
  const orderCode = 1793584893952001;

  let mockWebhookData: WebhookData;
  let mockWebhookPayload: Webhook;
  let mockOrder: OrderEntity;
  let mockPayment: PaymentEntity;

  beforeEach(() => {
    mockWebhookData = {
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

    mockWebhookPayload = {
      code: '00',
      desc: 'success',
      success: true,
      data: mockWebhookData,
      signature: 'mock_valid_signature_hash',
    };

    mockOrder = {
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
      deliveredAt: null,
      shippingAddressSnapshot: { city: 'HCM' },
      idempotencyKey: null,
      holdExpiresAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockPayment = {
      id: 'pay-uuid-payos-1',
      checkoutSessionId: '44444444-4444-4444-8444-444444444444',
      orderId,
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

    manager = {
      findOne: vi.fn(),
      save: vi.fn().mockImplementation((entity) => Promise.resolve(entity)),
      create: vi.fn().mockImplementation((_entityClass, dto) => dto),
      delete: vi.fn().mockResolvedValue({ affected: 1 }),
    } as unknown as EntityManager;

    dataSource = {
      transaction: vi.fn().mockImplementation((cb) => cb(manager)),
    } as unknown as DataSource;

    payosClientService = {
      verifyWebhook: vi
        .fn()
        .mockImplementation(() => Promise.resolve(mockWebhookData)),
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
    ).rejects.toThrow(BadRequestException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('acknowledges duplicate PayOS event safely without re-processing side-effects', async () => {
    vi.mocked(manager.findOne).mockResolvedValueOnce({
      id: 'existing_cb_id',
      providerEventId: 'payos_TF_PAYOS_998877',
      processedAt: new Date(),
    } as PaymentCallbackEntity);

    const result = await service.handlePayosWebhook(mockWebhookPayload);

    expect(result).toEqual({ received: true, duplicate: true });
    expect(manager.save).not.toHaveBeenCalled();
    expect(manager.delete).not.toHaveBeenCalled();
  });

  it('transitions order to PAID and payment to SUCCEEDED upon successful payment webhook', async () => {
    vi.mocked(manager.findOne)
      .mockResolvedValueOnce(null) // no duplicate callback
      .mockResolvedValueOnce(mockPayment) // payment found
      .mockResolvedValueOnce(mockOrder); // order found

    const result = await service.handlePayosWebhook(mockWebhookPayload);

    expect(result).toEqual({ received: true });
    expect(mockOrder.status).toBe('PAID');
    expect(mockPayment.status).toBe('SUCCEEDED');
    expect(manager.delete).toHaveBeenCalledWith(CartItemEntity, {
      reservedOrderId: orderId,
    });
    expect(manager.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'PAID' }),
    );
    expect(manager.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'SUCCEEDED' }),
    );
    expect(expiryQueue.getJob).toHaveBeenCalledWith(`order-expiry-${orderId}`);
  });

  it('rolls back webhook processing when exact cart cleanup fails', async () => {
    vi.mocked(manager.findOne)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(mockPayment)
      .mockResolvedValueOnce(mockOrder);
    const deleteFailure = new Error('cart cleanup failed');
    vi.mocked(manager.delete).mockRejectedValueOnce(deleteFailure);

    await expect(
      service.handlePayosWebhook(mockWebhookPayload),
    ).rejects.toThrow(deleteFailure);
  });

  it('throws BadRequestException on amount mismatch against authoritative DB order total', async () => {
    vi.mocked(manager.findOne)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(mockPayment)
      .mockResolvedValueOnce({
        ...mockOrder,
        total: '990000.00', // DB expects 990,000 but webhook sent 550,000
      });

    await expect(
      service.handlePayosWebhook(mockWebhookPayload),
    ).rejects.toThrow(BadRequestException);
    expect(mockOrder.status).toBe('PENDING_PAYMENT');
    expect(manager.delete).not.toHaveBeenCalled();
  });

  it('handles PayOS test ping (orderCode 123) by returning 200 OK without failing', async () => {
    const testPingPayload: Webhook = {
      code: '00',
      desc: 'success',
      success: true,
      data: {
        ...mockWebhookData,
        orderCode: 123,
        description: 'VQRIO123 test ping',
      },
      signature: 'valid_ping_sig',
    };
    vi.mocked(payosClientService.verifyWebhook).mockResolvedValue(
      testPingPayload.data,
    );
    vi.mocked(manager.findOne).mockResolvedValueOnce(null); // no duplicate
    vi.mocked(manager.findOne).mockResolvedValueOnce(null); // no payment record for 123

    const result = await service.handlePayosWebhook(testPingPayload);

    expect(result).toEqual({ received: true });
    expect(manager.delete).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when payment record is not found for non-test orderCode', async () => {
    vi.mocked(manager.findOne)
      .mockResolvedValueOnce(null) // no duplicate
      .mockResolvedValueOnce(null); // payment not found

    await expect(
      service.handlePayosWebhook(mockWebhookPayload),
    ).rejects.toThrow(NotFoundException);
    expect(manager.delete).not.toHaveBeenCalled();
  });

  it('handles idempotent webhook for order already in PAID status safely', async () => {
    vi.mocked(manager.findOne)
      .mockResolvedValueOnce(null) // no duplicate callback record
      .mockResolvedValueOnce(mockPayment)
      .mockResolvedValueOnce({
        ...mockOrder,
        status: 'PAID',
      });

    const result = await service.handlePayosWebhook(mockWebhookPayload);

    expect(result).toEqual({ received: true });
    expect(mockPayment.status).toBe('SUCCEEDED');
    expect(manager.delete).toHaveBeenCalledWith(CartItemEntity, {
      reservedOrderId: orderId,
    });
    expect(manager.save).toHaveBeenCalledWith(mockPayment);
  });

  it('marks payment SUCCEEDED with reconciliation reason if order is in terminal CANCELLED state', async () => {
    vi.mocked(manager.findOne)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(mockPayment)
      .mockResolvedValueOnce({
        ...mockOrder,
        status: 'CANCELLED',
      });

    const result = await service.handlePayosWebhook(mockWebhookPayload);

    expect(result).toEqual({ received: true });
    expect(mockPayment.status).toBe('SUCCEEDED');
    expect(mockPayment.failureReason).toContain(
      'arrived while order is in state CANCELLED',
    );
    expect(manager.delete).not.toHaveBeenCalled();
  });

  it('marks payment FAILED when PayOS webhook indicates failure code', async () => {
    const failedPayload: Webhook = {
      code: '01',
      desc: 'User cancelled',
      success: false,
      data: {
        ...mockWebhookData,
        code: '01',
        desc: 'User cancelled',
      },
      signature: 'valid_sig',
    };
    vi.mocked(payosClientService.verifyWebhook).mockResolvedValue(
      failedPayload.data,
    );
    vi.mocked(manager.findOne)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(mockPayment)
      .mockResolvedValueOnce(mockOrder);

    const result = await service.handlePayosWebhook(failedPayload);

    expect(result).toEqual({ received: true });
    expect(mockPayment.status).toBe('FAILED');
    expect(mockPayment.failureReason).toContain('User cancelled');
    expect(manager.delete).not.toHaveBeenCalled();
  });

  it('recovers safely from concurrent duplicate insert collision (23505 unique error)', async () => {
    vi.mocked(manager.findOne)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(mockPayment)
      .mockResolvedValueOnce(mockOrder);

    const duplicateError = new Error('unique constraint violation') as Error & {
      code?: string;
      constraint?: string;
    };
    duplicateError.code = '23505';
    duplicateError.constraint = 'payment_callbacks_provider_event_id_key';

    vi.mocked(dataSource.transaction).mockRejectedValueOnce(duplicateError);

    const result = await service.handlePayosWebhook(mockWebhookPayload);

    expect(result).toEqual({ received: true, duplicate: true });
  });

  it('updates auction settlement to PAID, awards reputation, and creates rating eligibility for AUCTION order', async () => {
    const mockReputationApi = {
      rewardAuctionPayment: vi.fn().mockResolvedValue({
        userId: 'buyer-uuid',
        newScore: 53,
        trustLevel: 'STANDARD',
        alreadyRewarded: false,
      }),
      penalizeAuctionPaymentTimeout: vi.fn(),
    };

    const auctionOrder = {
      ...mockOrder,
      source: 'AUCTION' as const,
      auctionId: '00000000-0000-0000-0000-000000000001',
    };

    vi.mocked(manager.findOne)
      .mockResolvedValueOnce(null) // no duplicate callback
      .mockResolvedValueOnce(mockPayment) // payment found
      .mockResolvedValueOnce(auctionOrder); // order found

    (manager as any).query = vi.fn().mockImplementation(async (sql: string) => {
      if (
        sql.includes('auction.auction_settlements') &&
        sql.includes('SELECT')
      ) {
        return [{ id: 'settlement-1', status: 'PENDING_PAYMENT' }];
      }
      return [];
    });

    const auctionWebhookService = new PaymentWebhookService(
      dataSource,
      payosClientService,
      expiryQueue,
      undefined,
      mockReputationApi as any,
    );

    const result =
      await auctionWebhookService.handlePayosWebhook(mockWebhookPayload);

    expect(result).toEqual({ received: true });
    expect(auctionOrder.status).toBe('PAID');

    // Verify settlement update query
    expect((manager as any).query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE auction.auction_settlements'),
      ['settlement-1'],
    );

    // Verify reputation rewarded
    expect(mockReputationApi.rewardAuctionPayment).toHaveBeenCalledWith(
      'buyer-uuid',
      '00000000-0000-0000-0000-000000000001',
      manager,
    );

    // Verify rating eligibility created
    expect((manager as any).query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO identity.rating_eligibilities'),
      expect.arrayContaining([
        '00000000-0000-0000-0000-000000000001',
        'buyer-uuid',
        'seller-uuid',
      ]),
    );
  });
});
