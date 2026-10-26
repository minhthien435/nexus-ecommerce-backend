import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import type Stripe from 'stripe';
import { OrderEntity } from '../domain/entities/order.entity.js';
import { OrderStatusHistoryEntity } from '../domain/entities/order-status-history.entity.js';
import { PaymentCallbackEntity } from '../domain/entities/payment-callback.entity.js';
import { PaymentEntity } from '../domain/entities/payment.entity.js';
import {
  ORDER_EXPIRY_QUEUE,
  type OrderExpiryJobPayload,
} from '../order-expiry.constants.js';
import { toStripeAmount } from '../utils/stripe-amount.util.js';
import { StripeClientService } from './stripe-client.service.js';

export interface WebhookProcessingResult {
  received: boolean;
  duplicate?: boolean;
}

@Injectable()
export class PaymentWebhookService {
  private readonly logger = new Logger(PaymentWebhookService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly stripeClientService: StripeClientService,
    @Optional()
    @InjectQueue(ORDER_EXPIRY_QUEUE)
    private readonly expiryQueue?: Queue<OrderExpiryJobPayload>,
  ) {}

  async handleWebhook(
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ): Promise<WebhookProcessingResult> {
    // 1. Verify signature and construct verified event
    const event = this.stripeClientService.constructWebhookEvent(
      rawBody,
      signature,
    );

    let orderIdToCancelExpiry: string | null = null;

    // 2. Process inside a database transaction with idempotency
    try {
      const result = await this.dataSource.transaction(async (manager) => {
        // Pre-check for duplicate event already committed
        const existingCallback = await manager.findOne(PaymentCallbackEntity, {
          where: { providerEventId: event.id },
        });

        if (existingCallback) {
          this.logger.warn(
            `Duplicate Stripe webhook event '${event.id}' (${event.type}) already processed at ${existingCallback.processedAt.toISOString()}. Skipping side effects.`,
          );
          return { received: true, duplicate: true };
        }

        // 3. Process business event types
        let reconciliationRequired = false;
        let reconciliationReason: string | null = null;
        let reconciliationOrderId: string | null = null;
        let reconciliationOrderStatus: string | null = null;

        if (event.type === 'payment_intent.succeeded') {
          const pi = event.data.object as Stripe.PaymentIntent;

          const payment = await manager.findOne(PaymentEntity, {
            where: { providerPaymentId: pi.id },
            lock: { mode: 'pessimistic_write' },
          });

          if (!payment) {
            throw new NotFoundException(
              `Payment record for provider_payment_id '${pi.id}' not found`,
            );
          }

          const order = await manager.findOne(OrderEntity, {
            where: { id: payment.orderId! },
            lock: { mode: 'pessimistic_write' },
          });

          if (!order) {
            throw new NotFoundException(
              `Order '${payment.orderId}' for payment '${payment.id}' not found`,
            );
          }

          // Metadata consistency check
          if (pi.metadata?.orderId && pi.metadata.orderId !== order.id) {
            throw new BadRequestException(
              `PaymentIntent metadata.orderId ('${pi.metadata.orderId}') does not match order id ('${order.id}')`,
            );
          }

          // Amount and currency verification using authoritative Stripe amount rules
          const expectedStripeAmount = toStripeAmount(
            order.total,
            order.currency,
          );
          const receivedAmount = pi.amount_received ?? pi.amount;

          if (receivedAmount !== expectedStripeAmount) {
            throw new BadRequestException(
              `Received amount (${receivedAmount}) does not match expected order amount (${expectedStripeAmount})`,
            );
          }

          if (
            pi.currency.toLowerCase().trim() !==
            order.currency.toLowerCase().trim()
          ) {
            throw new BadRequestException(
              `Received currency ('${pi.currency}') does not match order currency ('${order.currency}')`,
            );
          }

          // Order state transition
          if (order.status === 'PENDING_PAYMENT') {
            const previousStatus = order.status;
            order.status = 'PAID';
            await manager.save(order);

            payment.status = 'SUCCEEDED';
            await manager.save(payment);

            const statusHistory = manager.create(OrderStatusHistoryEntity, {
              orderId: order.id,
              fromStatus: previousStatus,
              toStatus: 'PAID',
              reason: `Stripe payment succeeded (${pi.id})`,
              changedBy: null,
            });
            await manager.save(statusHistory);

            this.logger.log(
              `Order ${order.id} transitioned to PAID via Stripe event ${event.id}`,
            );
            orderIdToCancelExpiry = order.id;
          } else if (order.status === 'PAID') {
            if (payment.status !== 'SUCCEEDED') {
              payment.status = 'SUCCEEDED';
              await manager.save(payment);
            }
          } else {
            reconciliationRequired = true;
            reconciliationOrderId = order.id;
            reconciliationOrderStatus = order.status;
            reconciliationReason = `RECONCILIATION_REQUIRED: Stripe payment (${pi.id}) succeeded for order ${order.id} in terminal/ineligible state '${order.status}'. Order remains '${order.status}'. Manual reconciliation or refund required.`;
            this.logger.error(
              `CRITICAL_PAYMENT_MISMATCH: ${reconciliationReason}`,
            );

            if (payment.status !== 'SUCCEEDED') {
              payment.status = 'SUCCEEDED';
            }
            payment.failureReason = reconciliationReason;
            await manager.save(payment);

            const statusHistory = manager.create(OrderStatusHistoryEntity, {
              orderId: order.id,
              fromStatus: order.status,
              toStatus: order.status,
              reason: reconciliationReason,
              changedBy: null,
            });
            await manager.save(statusHistory);
          }
        } else if (event.type === 'payment_intent.payment_failed') {
          const pi = event.data.object as Stripe.PaymentIntent;

          const payment = await manager.findOne(PaymentEntity, {
            where: { providerPaymentId: pi.id },
            lock: { mode: 'pessimistic_write' },
          });

          if (payment) {
            // Do not allow a stale failure event to overwrite an already-succeeded payment
            if (payment.status !== 'SUCCEEDED') {
              payment.status = 'FAILED';
              payment.failureReason =
                pi.last_payment_error?.message ?? 'Payment failed';
              await manager.save(payment);
            }
          } else {
            this.logger.warn(
              `Received payment_intent.payment_failed for unknown providerPaymentId: ${pi.id}`,
            );
          }
        } else {
          this.logger.log(`Ignored unhandled Stripe event type: ${event.type}`);
        }

        // 4. Save callback record in the same atomic transaction
        const callback = manager.create(PaymentCallbackEntity, {
          provider: 'STRIPE',
          providerEventId: event.id,
          maskedPayload: {
            id: event.id,
            type: event.type,
            created: event.created,
            ...(reconciliationRequired
              ? {
                  reconciliationRequired: true,
                  reconciliationReason,
                  orderId: reconciliationOrderId,
                  orderStatus: reconciliationOrderStatus,
                }
              : {}),
          },
          processedAt: new Date(),
        });
        await manager.save(callback);

        return { received: true };
      });

      // 5. Post-commit side effects: Cancel order expiry BullMQ job if order transitioned to PAID
      if (orderIdToCancelExpiry) {
        await this.cancelOrderExpiryJob(orderIdToCancelExpiry);
      }

      return result;
    } catch (error) {
      const pgError = error as {
        code?: string;
        constraint?: string;
        message?: string;
      };
      // Check PostgreSQL unique-violation code 23505 specifically for provider_event_id
      if (
        pgError?.code === '23505' &&
        (pgError?.constraint === 'payment_callbacks_provider_event_id_key' ||
          pgError?.message?.includes('payment_callbacks_provider_event_id_key'))
      ) {
        this.logger.warn(
          `Concurrent duplicate Stripe webhook event '${event.id}' detected during callback insert. Acknowledging safely.`,
        );
        return { received: true, duplicate: true };
      }

      this.logger.error(
        `Failed to process Stripe webhook event '${event.id}' (${event.type}): ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error;
    }
  }

  private async cancelOrderExpiryJob(orderId: string): Promise<void> {
    if (!this.expiryQueue) {
      this.logger.debug(
        `Expiry queue not available; skipping cancellation for order ${orderId}`,
      );
      return;
    }

    const normalizedOrderId = orderId.toLowerCase();
    const jobId = `order-expiry-${normalizedOrderId}`;

    try {
      const job = await this.expiryQueue.getJob(jobId);
      if (job) {
        await job.remove();
        this.logger.log(
          `Cancelled order expiry job '${jobId}' for order ${orderId}`,
        );
      } else {
        this.logger.debug(
          `Order expiry job '${jobId}' not found for order ${orderId}; it may have already completed or not been scheduled`,
        );
      }
    } catch (queueError) {
      this.logger.warn(
        `Failed to cancel order expiry job '${jobId}' for order ${orderId}: ${(queueError as Error).message}. ` +
          `Order status is already committed as PAID; OrderExpiryProcessor will safely skip expiry.`,
        (queueError as Error).stack,
      );
    }
  }
}
