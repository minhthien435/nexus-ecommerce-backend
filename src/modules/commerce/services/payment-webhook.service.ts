import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import type { Webhook, WebhookData } from '@payos/node';
import { OrderEntity } from '../domain/entities/order.entity.js';
import { OrderStatusHistoryEntity } from '../domain/entities/order-status-history.entity.js';
import { PaymentCallbackEntity } from '../domain/entities/payment-callback.entity.js';
import { PaymentEntity } from '../domain/entities/payment.entity.js';
import { CartItemEntity } from '../domain/entities/cart-item.entity.js';
import {
  ORDER_EXPIRY_QUEUE,
  type OrderExpiryJobPayload,
} from '../order-expiry.constants.js';
import { PayosClientService } from './payos-client.service.js';

export interface WebhookProcessingResult {
  received: boolean;
  duplicate?: boolean;
}

@Injectable()
export class PaymentWebhookService {
  private readonly logger = new Logger(PaymentWebhookService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly payosClientService: PayosClientService,
    @Optional()
    @InjectQueue(ORDER_EXPIRY_QUEUE)
    private readonly expiryQueue?: Queue<OrderExpiryJobPayload>,
  ) {}

  async handlePayosWebhook(body: Webhook): Promise<WebhookProcessingResult> {
    if (!this.payosClientService) {
      throw new ServiceUnavailableException('PayOS service is not available');
    }

    if (!body) {
      throw new BadRequestException('Missing PayOS webhook payload');
    }

    // 1. Verify webhook signature using PayOS SDK
    let verifiedData: WebhookData;
    try {
      verifiedData = await this.payosClientService.verifyWebhook(body);
    } catch (verifyError) {
      const errorMsg =
        (verifyError as Error)?.message || 'Signature verification failed';
      this.logger.warn(`Failed to verify PayOS webhook signature: ${errorMsg}`);
      throw new BadRequestException(
        `Invalid PayOS webhook signature: ${errorMsg}`,
      );
    }

    if (!verifiedData || !verifiedData.orderCode) {
      throw new BadRequestException(
        'PayOS webhook missing orderCode in verified data',
      );
    }

    // 2. Formulate unique event ID for idempotency deduplication
    const providerEventId = verifiedData.reference
      ? `payos_${verifiedData.reference}`
      : `payos_${verifiedData.orderCode}_${verifiedData.paymentLinkId || 'default'}`;

    let orderIdToCancelExpiry: string | null = null;

    try {
      // 3. Process inside a database transaction with idempotency
      const result = await this.dataSource.transaction(async (manager) => {
        // Pre-check within transaction for duplicate callback
        const inTxExisting = await manager.findOne(PaymentCallbackEntity, {
          where: { providerEventId },
        });
        if (inTxExisting) {
          this.logger.warn(
            `Duplicate PayOS webhook event '${providerEventId}' already processed at ${inTxExisting.processedAt.toISOString()}. Skipping side effects.`,
          );
          return { received: true, duplicate: true };
        }

        // Locate PaymentEntity by orderCode (stored in providerPaymentId)
        const payment = await manager.findOne(PaymentEntity, {
          where: {
            provider: 'PAYOS',
            providerPaymentId: String(verifiedData.orderCode),
          },
        });

        if (!payment) {
          if (
            verifiedData.orderCode === 123 ||
            verifiedData.description?.includes('VQRIO123')
          ) {
            this.logger.log(
              'Received PayOS webhook validation ping (test orderCode 123). Acknowledging 200 OK.',
            );
            return { received: true };
          }

          this.logger.error(
            `Payment record not found for PayOS orderCode ${verifiedData.orderCode}`,
          );
          throw new NotFoundException(
            `Payment record for orderCode '${verifiedData.orderCode}' not found`,
          );
        }

        // Locate OrderEntity
        const order = await manager.findOne(OrderEntity, {
          where: { id: payment.orderId! },
        });

        if (!order) {
          this.logger.error(
            `Order with id '${payment.orderId}' not found for PayOS payment ${payment.id}`,
          );
          throw new NotFoundException(
            `Order with id '${payment.orderId}' not found`,
          );
        }

        // Authoritative amount validation directly against order.total
        const expectedAmount = Math.round(Number(order.total));
        if (Number(verifiedData.amount) !== expectedAmount) {
          this.logger.error(
            `CRITICAL_PAYMENT_MISMATCH: RECONCILIATION_REQUIRED: PayOS payment amount (${verifiedData.amount}) does not match order ${order.id} expected total (${expectedAmount})`,
          );
          throw new BadRequestException(
            `PayOS payment amount does not match authoritative order total: expected ${expectedAmount}, received ${verifiedData.amount}`,
          );
        }

        // Process status based on PayOS return code (code "00" = SUCCESS)
        const isSuccess = verifiedData.code === '00' || body.code === '00';

        if (isSuccess) {
          if (order.status === 'PAID') {
            this.logger.log(
              `Order ${order.id} is already in PAID state. Acknowledging safely.`,
            );
            await manager.delete(CartItemEntity, {
              reservedOrderId: order.id,
            });
            payment.status = 'SUCCEEDED';
            await manager.save(payment);
          } else if (
            ['CANCELLED', 'REFUNDED', 'EXPIRED'].includes(order.status)
          ) {
            this.logger.error(
              `CRITICAL_PAYMENT_MISMATCH: RECONCILIATION_REQUIRED: PayOS payment (${verifiedData.orderCode}) succeeded for order ${order.id} in terminal/ineligible state '${order.status}'. Order remains '${order.status}'. Manual reconciliation or refund required.`,
            );
            payment.status = 'SUCCEEDED';
            payment.failureReason = `PayOS payment arrived while order is in state ${order.status}`;
            await manager.save(payment);
          } else {
            const previousStatus = order.status;
            order.status = 'PAID';
            await manager.save(order);

            await manager.delete(CartItemEntity, {
              reservedOrderId: order.id,
            });

            const statusHistory = manager.create(OrderStatusHistoryEntity, {
              orderId: order.id,
              fromStatus: previousStatus,
              toStatus: 'PAID',
              reason: `PayOS payment confirmed via webhook (${verifiedData.orderCode})`,
              changedBy: null,
            });
            await manager.save(statusHistory);

            payment.status = 'SUCCEEDED';
            await manager.save(payment);

            this.logger.log(
              `Order ${order.id} transitioned to PAID via PayOS event ${providerEventId}`,
            );

            orderIdToCancelExpiry = order.id;
          }
        } else {
          // PayOS payment failure / cancellation
          if (payment.status !== 'SUCCEEDED') {
            payment.status = 'FAILED';
            payment.failureReason = `PayOS code ${verifiedData.code}: ${verifiedData.desc || 'Payment failed'}`;
            await manager.save(payment);
          }
        }

        // Record callback for durable idempotency
        const callback = manager.create(PaymentCallbackEntity, {
          providerEventId,
          provider: 'PAYOS',
          maskedPayload: {
            orderCode: verifiedData.orderCode,
            paymentLinkId: verifiedData.paymentLinkId,
            reference: verifiedData.reference,
            code: verifiedData.code,
            amount: verifiedData.amount,
          },
          processedAt: new Date(),
        });
        await manager.save(callback);

        return { received: true };
      });

      // 4. Post-commit side effects: Cancel BullMQ order expiry job if order transitioned to PAID
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
      if (
        pgError?.code === '23505' &&
        (pgError?.constraint === 'payment_callbacks_provider_event_id_key' ||
          pgError?.message?.includes('payment_callbacks_provider_event_id_key'))
      ) {
        this.logger.warn(
          `Concurrent duplicate PayOS webhook event '${providerEventId}' detected during callback insert. Acknowledging safely.`,
        );
        return { received: true, duplicate: true };
      }

      this.logger.error(
        `Failed to process PayOS webhook event '${providerEventId}': ${(error as Error).message}`,
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

    const jobId = `order-expiry-${orderId.toLowerCase()}`;
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
    } catch (jobError) {
      this.logger.warn(
        `Failed to cancel order expiry job '${jobId}' for order ${orderId}: ${(jobError as Error).message}. Order status is already committed as PAID; OrderExpiryProcessor will safely skip expiry.`,
      );
    }
  }
}
