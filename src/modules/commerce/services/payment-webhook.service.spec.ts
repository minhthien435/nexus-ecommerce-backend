import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataSource, EntityManager } from 'typeorm';
import type Stripe from 'stripe';
import { OrderEntity } from '../domain/entities/order.entity.js';
import { OrderStatusHistoryEntity } from '../domain/entities/order-status-history.entity.js';
import { PaymentCallbackEntity } from '../domain/entities/payment-callback.entity.js';
import { PaymentEntity } from '../domain/entities/payment.entity.js';
import { PaymentWebhookService } from './payment-webhook.service.js';
import { StripeClientService } from './stripe-client.service.js';

describe('PaymentWebhookService', () => {
  let service: PaymentWebhookService;
  let dataSource: DataSource;
  let stripeClientService: StripeClientService;
  let manager: EntityManager;

  beforeEach(() => {
    manager = {
      findOne: vi.fn(),
      save: vi.fn().mockImplementation((entity) => Promise.resolve(entity)),
      create: vi.fn().mockImplementation((_entityClass, dto) => dto),
    } as unknown as EntityManager;

    dataSource = {
      transaction: vi.fn().mockImplementation((cb) => cb(manager)),
    } as unknown as DataSource;

    stripeClientService = {
      constructWebhookEvent: vi.fn(),
    } as unknown as StripeClientService;

    service = new PaymentWebhookService(dataSource, stripeClientService);
  });

  describe('handleWebhook', () => {
    const rawBody = Buffer.from('{"id":"evt_test_123"}');
    const signature = 't=123,v1=abc';

    it('rejects if signature verification fails in StripeClientService', async () => {
      vi.mocked(stripeClientService.constructWebhookEvent).mockImplementation(
        () => {
          throw new BadRequestException('Invalid Stripe webhook signature');
        },
      );

      await expect(service.handleWebhook(rawBody, signature)).rejects.toThrow(
        BadRequestException,
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('returns { received: true, duplicate: true } when event was already processed previously', async () => {
      const event: Stripe.Event = {
        id: 'evt_dup_1',
        type: 'payment_intent.succeeded',
        created: 123456789,
        data: { object: {} as Stripe.PaymentIntent },
      } as Stripe.Event;

      vi.mocked(stripeClientService.constructWebhookEvent).mockReturnValue(
        event,
      );
      vi.mocked(manager.findOne).mockResolvedValueOnce({
        id: 'callback-1',
        providerEventId: 'evt_dup_1',
        processedAt: new Date(),
      } as PaymentCallbackEntity);

      const result = await service.handleWebhook(rawBody, signature);

      expect(result).toEqual({ received: true, duplicate: true });
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('handles concurrent duplicate event via PostgreSQL 23505 error gracefully', async () => {
      const event: Stripe.Event = {
        id: 'evt_concurrent_1',
        type: 'payment_intent.succeeded',
        created: 123456789,
        data: { object: {} as Stripe.PaymentIntent },
      } as Stripe.Event;

      vi.mocked(stripeClientService.constructWebhookEvent).mockReturnValue(
        event,
      );
      vi.mocked(dataSource.transaction).mockRejectedValueOnce({
        code: '23505',
        constraint: 'payment_callbacks_provider_event_id_key',
        message: 'duplicate key value violates unique constraint',
      });

      const result = await service.handleWebhook(rawBody, signature);

      expect(result).toEqual({ received: true, duplicate: true });
    });

    it('processes payment_intent.succeeded: updates order to PAID, payment to SUCCEEDED, and writes history', async () => {
      const pi: Partial<Stripe.PaymentIntent> = {
        id: 'pi_test_123',
        amount: 550000,
        amount_received: 550000,
        currency: 'vnd',
        metadata: { orderId: 'order-123' },
      };
      const event: Stripe.Event = {
        id: 'evt_pi_succeeded_1',
        type: 'payment_intent.succeeded',
        created: 123456789,
        data: { object: pi as Stripe.PaymentIntent },
      } as Stripe.Event;

      vi.mocked(stripeClientService.constructWebhookEvent).mockReturnValue(
        event,
      );

      const paymentRecord = {
        id: 'payment-uuid-1',
        orderId: 'order-123',
        providerPaymentId: 'pi_test_123',
        status: 'PENDING',
      } as PaymentEntity;

      const orderRecord = {
        id: 'order-123',
        status: 'PENDING_PAYMENT',
        total: '550000.00',
        currency: 'VND',
      } as OrderEntity;

      vi.mocked(manager.findOne)
        .mockResolvedValueOnce(null) // existingCallback -> not found
        .mockResolvedValueOnce(paymentRecord) // PaymentEntity
        .mockResolvedValueOnce(orderRecord); // OrderEntity

      const result = await service.handleWebhook(rawBody, signature);

      expect(result).toEqual({ received: true });
      expect(orderRecord.status).toBe('PAID');
      expect(paymentRecord.status).toBe('SUCCEEDED');

      // Verify OrderStatusHistory was created
      expect(manager.create).toHaveBeenCalledWith(OrderStatusHistoryEntity, {
        orderId: 'order-123',
        fromStatus: 'PENDING_PAYMENT',
        toStatus: 'PAID',
        reason: 'Stripe payment succeeded (pi_test_123)',
        changedBy: null,
      });

      // Verify PaymentCallback was created
      expect(manager.create).toHaveBeenCalledWith(
        PaymentCallbackEntity,
        expect.objectContaining({
          provider: 'STRIPE',
          providerEventId: 'evt_pi_succeeded_1',
        }),
      );
    });

    it('processes payment_intent.succeeded on USD currency with minor units conversion', async () => {
      const pi: Partial<Stripe.PaymentIntent> = {
        id: 'pi_test_usd',
        amount: 2550,
        amount_received: 2550,
        currency: 'usd',
        metadata: { orderId: 'order-usd' },
      };
      const event: Stripe.Event = {
        id: 'evt_usd_1',
        type: 'payment_intent.succeeded',
        created: 123456789,
        data: { object: pi as Stripe.PaymentIntent },
      } as Stripe.Event;

      vi.mocked(stripeClientService.constructWebhookEvent).mockReturnValue(
        event,
      );

      const paymentRecord = {
        id: 'payment-usd-1',
        orderId: 'order-usd',
        providerPaymentId: 'pi_test_usd',
        status: 'PENDING',
      } as PaymentEntity;

      const orderRecord = {
        id: 'order-usd',
        status: 'PENDING_PAYMENT',
        total: '25.50',
        currency: 'USD',
      } as OrderEntity;

      vi.mocked(manager.findOne)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(paymentRecord)
        .mockResolvedValueOnce(orderRecord);

      const result = await service.handleWebhook(rawBody, signature);

      expect(result).toEqual({ received: true });
      expect(orderRecord.status).toBe('PAID');
      expect(paymentRecord.status).toBe('SUCCEEDED');
    });

    it('throws NotFoundException if payment record does not exist for provider_payment_id', async () => {
      const pi: Partial<Stripe.PaymentIntent> = {
        id: 'pi_unknown',
        amount: 550000,
        currency: 'vnd',
      };
      const event: Stripe.Event = {
        id: 'evt_not_found',
        type: 'payment_intent.succeeded',
        data: { object: pi as Stripe.PaymentIntent },
      } as Stripe.Event;

      vi.mocked(stripeClientService.constructWebhookEvent).mockReturnValue(
        event,
      );
      vi.mocked(manager.findOne)
        .mockResolvedValueOnce(null) // callback
        .mockResolvedValueOnce(null); // payment not found

      await expect(service.handleWebhook(rawBody, signature)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException if order does not exist for payment.orderId', async () => {
      const pi: Partial<Stripe.PaymentIntent> = {
        id: 'pi_order_not_found',
        amount: 550000,
        currency: 'vnd',
      };
      const event: Stripe.Event = {
        id: 'evt_order_not_found',
        type: 'payment_intent.succeeded',
        data: { object: pi as Stripe.PaymentIntent },
      } as Stripe.Event;

      vi.mocked(stripeClientService.constructWebhookEvent).mockReturnValue(
        event,
      );
      vi.mocked(manager.findOne)
        .mockResolvedValueOnce(null) // callback
        .mockResolvedValueOnce({
          id: 'pay-1',
          orderId: 'ghost-order',
          providerPaymentId: 'pi_order_not_found',
        } as PaymentEntity) // payment
        .mockResolvedValueOnce(null); // order not found

      await expect(service.handleWebhook(rawBody, signature)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException if metadata.orderId does not match order.id', async () => {
      const pi: Partial<Stripe.PaymentIntent> = {
        id: 'pi_mismatch_meta',
        amount: 550000,
        currency: 'vnd',
        metadata: { orderId: 'different-order' },
      };
      const event: Stripe.Event = {
        id: 'evt_meta_mismatch',
        type: 'payment_intent.succeeded',
        data: { object: pi as Stripe.PaymentIntent },
      } as Stripe.Event;

      vi.mocked(stripeClientService.constructWebhookEvent).mockReturnValue(
        event,
      );
      vi.mocked(manager.findOne)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'pay-1',
          orderId: 'order-actual',
          providerPaymentId: 'pi_mismatch_meta',
        } as PaymentEntity)
        .mockResolvedValueOnce({
          id: 'order-actual',
          total: '550000.00',
          currency: 'VND',
        } as OrderEntity);

      await expect(service.handleWebhook(rawBody, signature)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException if received amount does not match expected order amount', async () => {
      const pi: Partial<Stripe.PaymentIntent> = {
        id: 'pi_wrong_amount',
        amount: 100000, // expected 550000
        currency: 'vnd',
      };
      const event: Stripe.Event = {
        id: 'evt_wrong_amount',
        type: 'payment_intent.succeeded',
        data: { object: pi as Stripe.PaymentIntent },
      } as Stripe.Event;

      vi.mocked(stripeClientService.constructWebhookEvent).mockReturnValue(
        event,
      );
      vi.mocked(manager.findOne)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'pay-1',
          orderId: 'order-1',
          providerPaymentId: 'pi_wrong_amount',
        } as PaymentEntity)
        .mockResolvedValueOnce({
          id: 'order-1',
          total: '550000.00',
          currency: 'VND',
        } as OrderEntity);

      await expect(service.handleWebhook(rawBody, signature)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException if received currency does not match order currency', async () => {
      const pi: Partial<Stripe.PaymentIntent> = {
        id: 'pi_wrong_curr',
        amount: 550000,
        currency: 'usd',
      };
      const event: Stripe.Event = {
        id: 'evt_wrong_curr',
        type: 'payment_intent.succeeded',
        data: { object: pi as Stripe.PaymentIntent },
      } as Stripe.Event;

      vi.mocked(stripeClientService.constructWebhookEvent).mockReturnValue(
        event,
      );
      vi.mocked(manager.findOne)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'pay-1',
          orderId: 'order-1',
          providerPaymentId: 'pi_wrong_curr',
        } as PaymentEntity)
        .mockResolvedValueOnce({
          id: 'order-1',
          total: '550000.00',
          currency: 'VND',
        } as OrderEntity);

      await expect(service.handleWebhook(rawBody, signature)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('handles successful payment for CANCELLED order safely: preserves CANCELLED, flags payment, writes history and callback with reconciliation required', async () => {
      const pi: Partial<Stripe.PaymentIntent> = {
        id: 'pi_cancelled_order',
        amount: 550000,
        currency: 'vnd',
      };
      const event: Stripe.Event = {
        id: 'evt_cancelled_order_succ',
        type: 'payment_intent.succeeded',
        data: { object: pi as Stripe.PaymentIntent },
      } as Stripe.Event;

      vi.mocked(stripeClientService.constructWebhookEvent).mockReturnValue(
        event,
      );

      const paymentRecord = {
        id: 'pay-cancelled',
        orderId: 'order-cancelled',
        providerPaymentId: 'pi_cancelled_order',
        status: 'PENDING',
        failureReason: null,
      } as PaymentEntity;

      const orderRecord = {
        id: 'order-cancelled',
        status: 'CANCELLED',
        total: '550000.00',
        currency: 'VND',
      } as OrderEntity;

      vi.mocked(manager.findOne)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(paymentRecord)
        .mockResolvedValueOnce(orderRecord);

      const result = await service.handleWebhook(rawBody, signature);

      expect(result).toEqual({ received: true });
      // 1. Order status must NEVER be transitioned to PAID or resurrected
      expect(orderRecord.status).toBe('CANCELLED');

      // 2. Payment status is SUCCEEDED (funds collected at Stripe)
      expect(paymentRecord.status).toBe('SUCCEEDED');

      // 3. Payment record has explicit diagnostic failureReason for reconciliation
      expect(paymentRecord.failureReason).toContain('RECONCILIATION_REQUIRED');
      expect(paymentRecord.failureReason).toContain('pi_cancelled_order');

      // 4. OrderStatusHistoryEntity audit entry is created without changing order status
      expect(manager.create).toHaveBeenCalledWith(OrderStatusHistoryEntity, {
        orderId: 'order-cancelled',
        fromStatus: 'CANCELLED',
        toStatus: 'CANCELLED',
        reason: expect.stringContaining('RECONCILIATION_REQUIRED'),
        changedBy: null,
      });

      // 5. PaymentCallbackEntity maskedPayload records reconciliation required
      expect(manager.create).toHaveBeenCalledWith(
        PaymentCallbackEntity,
        expect.objectContaining({
          provider: 'STRIPE',
          providerEventId: 'evt_cancelled_order_succ',
          maskedPayload: expect.objectContaining({
            reconciliationRequired: true,
            orderId: 'order-cancelled',
            orderStatus: 'CANCELLED',
            reconciliationReason: expect.stringContaining(
              'RECONCILIATION_REQUIRED',
            ),
          }),
        }),
      );
    });

    it('does not repeat reconciliation side effects or audit logs upon duplicate delivery for a cancelled order', async () => {
      const event: Stripe.Event = {
        id: 'evt_cancelled_dup',
        type: 'payment_intent.succeeded',
        created: 123456789,
        data: {
          object: {
            id: 'pi_cancelled_dup',
            amount: 550000,
            currency: 'vnd',
          } as Stripe.PaymentIntent,
        },
      } as Stripe.Event;

      vi.mocked(stripeClientService.constructWebhookEvent).mockReturnValue(
        event,
      );

      // Pre-existing callback in DB from prior delivery
      vi.mocked(manager.findOne).mockResolvedValueOnce({
        id: 'callback-existing-1',
        provider: 'STRIPE',
        providerEventId: 'evt_cancelled_dup',
        processedAt: new Date(),
        maskedPayload: {
          reconciliationRequired: true,
          orderId: 'order-cancelled',
          orderStatus: 'CANCELLED',
        },
      } as PaymentCallbackEntity);

      const result = await service.handleWebhook(rawBody, signature);

      expect(result).toEqual({ received: true, duplicate: true });
      // Neither Order, Payment, nor OrderStatusHistory are queried or modified
      expect(manager.save).not.toHaveBeenCalled();
      expect(manager.create).not.toHaveBeenCalled();
    });

    it('handles payment_intent.payment_failed: updates payment to FAILED with failureReason', async () => {
      const pi: Partial<Stripe.PaymentIntent> = {
        id: 'pi_failed_123',
        last_payment_error: {
          message: 'Your card was declined.',
        } as Stripe.PaymentIntent.LastPaymentError,
      };
      const event: Stripe.Event = {
        id: 'evt_failed_1',
        type: 'payment_intent.payment_failed',
        data: { object: pi as Stripe.PaymentIntent },
      } as Stripe.Event;

      vi.mocked(stripeClientService.constructWebhookEvent).mockReturnValue(
        event,
      );

      const paymentRecord = {
        id: 'pay-fail',
        orderId: 'order-fail',
        providerPaymentId: 'pi_failed_123',
        status: 'PENDING',
        failureReason: null,
      } as PaymentEntity;

      vi.mocked(manager.findOne)
        .mockResolvedValueOnce(null) // callback
        .mockResolvedValueOnce(paymentRecord); // payment

      const result = await service.handleWebhook(rawBody, signature);

      expect(result).toEqual({ received: true });
      expect(paymentRecord.status).toBe('FAILED');
      expect(paymentRecord.failureReason).toBe('Your card was declined.');
    });

    it('does not overwrite payment status to FAILED if payment is already SUCCEEDED', async () => {
      const pi: Partial<Stripe.PaymentIntent> = {
        id: 'pi_stale_fail',
        last_payment_error: {
          message: 'Network error',
        } as Stripe.PaymentIntent.LastPaymentError,
      };
      const event: Stripe.Event = {
        id: 'evt_stale_fail',
        type: 'payment_intent.payment_failed',
        data: { object: pi as Stripe.PaymentIntent },
      } as Stripe.Event;

      vi.mocked(stripeClientService.constructWebhookEvent).mockReturnValue(
        event,
      );

      const paymentRecord = {
        id: 'pay-succ',
        orderId: 'order-succ',
        providerPaymentId: 'pi_stale_fail',
        status: 'SUCCEEDED',
        failureReason: null,
      } as PaymentEntity;

      vi.mocked(manager.findOne)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(paymentRecord);

      const result = await service.handleWebhook(rawBody, signature);

      expect(result).toEqual({ received: true });
      expect(paymentRecord.status).toBe('SUCCEEDED');
      expect(paymentRecord.failureReason).toBeNull();
    });

    it('safely ignores unhandled Stripe event types (e.g. customer.created) and saves callback', async () => {
      const event: Stripe.Event = {
        id: 'evt_customer_created',
        type: 'customer.created' as any,
        created: 123456789,
        data: { object: { id: 'cus_123' } },
      } as Stripe.Event;

      vi.mocked(stripeClientService.constructWebhookEvent).mockReturnValue(
        event,
      );
      vi.mocked(manager.findOne).mockResolvedValueOnce(null);

      const result = await service.handleWebhook(rawBody, signature);

      expect(result).toEqual({ received: true });
      expect(manager.create).toHaveBeenCalledWith(
        PaymentCallbackEntity,
        expect.objectContaining({
          provider: 'STRIPE',
          providerEventId: 'evt_customer_created',
        }),
      );
    });

    it('rethrows unexpected database errors so Stripe gets a 500 and retries', async () => {
      const event: Stripe.Event = {
        id: 'evt_db_error',
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_1' } as Stripe.PaymentIntent },
      } as Stripe.Event;

      vi.mocked(stripeClientService.constructWebhookEvent).mockReturnValue(
        event,
      );
      vi.mocked(dataSource.transaction).mockRejectedValueOnce(
        new Error('Database connection lost'),
      );

      await expect(service.handleWebhook(rawBody, signature)).rejects.toThrow(
        'Database connection lost',
      );
    });

    it('does NOT treat non-callback 23505 errors as duplicate and rethrows them for retry', async () => {
      const event: Stripe.Event = {
        id: 'evt_other_conflict',
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_1' } as Stripe.PaymentIntent },
      } as Stripe.Event;

      vi.mocked(stripeClientService.constructWebhookEvent).mockReturnValue(
        event,
      );
      vi.mocked(dataSource.transaction).mockRejectedValueOnce({
        code: '23505',
        constraint: 'orders_order_number_key',
        message:
          'duplicate key value violates unique constraint "orders_order_number_key"',
      });

      await expect(
        service.handleWebhook(rawBody, signature),
      ).rejects.toMatchObject({
        code: '23505',
        constraint: 'orders_order_number_key',
      });
    });
  });
});
