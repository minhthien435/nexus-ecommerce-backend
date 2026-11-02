import { BadRequestException, Logger, Optional } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { DelayedError, type Job } from 'bullmq';
import { DataSource, In } from 'typeorm';
import { InventoryReservationApi } from '../../fulfillment/inventory-reservation.api.js';
import { PaymentEntity } from '../domain/entities/payment.entity.js';
import { PayosClientService } from '../services/payos-client.service.js';
import {
  ORDER_EXPIRY_JOB,
  ORDER_EXPIRY_QUEUE,
  type OrderExpiryJobPayload,
} from '../order-expiry.constants.js';
import { OrderExpiryTransitionApi } from '../order-expiry-transition.api.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Processor(ORDER_EXPIRY_QUEUE)
export class OrderExpiryProcessor extends WorkerHost {
  private readonly logger = new Logger(OrderExpiryProcessor.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly transition: OrderExpiryTransitionApi,
    private readonly inventory: InventoryReservationApi,
    @Optional()
    private readonly payosClientService?: PayosClientService,
  ) {
    super();
  }

  async process(
    job: Job<OrderExpiryJobPayload>,
    token?: string,
  ): Promise<void> {
    const orderId = this.validate(job);
    const result = await this.dataSource.transaction(
      'READ COMMITTED',
      async (manager) => {
        const transition = await this.transition.expire(orderId, manager);
        if (transition.outcome === 'EXPIRED') {
          await this.inventory.release(transition.inventoryReceipts, manager);
          await this.transition.finalizeExpiry(orderId, manager);

          if (this.payosClientService) {
            const pendingPayment = await manager
              .getRepository(PaymentEntity)
              .findOne({
                where: {
                  orderId,
                  provider: 'PAYOS',
                  status: In(['INITIATED', 'PENDING']),
                },
              });
            if (pendingPayment?.providerPaymentId) {
              try {
                await this.payosClientService.cancelPaymentLink(
                  pendingPayment.providerPaymentId,
                  'Đơn hàng hết hạn thanh toán 15 phút',
                );
              } catch (err) {
                this.logger.warn(
                  `Failed to cancel PayOS link on expiry for order ${orderId}: ${(err as Error).message}`,
                );
              }
            }
          }
        }
        return transition;
      },
    );

    if (result.outcome === 'NOT_DUE') {
      const timestamp = result.holdExpiresAt.getTime();
      if (!Number.isFinite(timestamp)) this.invalidJob();
      await job.moveToDelayed(timestamp, token);
      throw new DelayedError();
    }
  }

  private validate(job: Job<OrderExpiryJobPayload>): string {
    const orderId = job?.data?.orderId;
    if (
      job?.name !== ORDER_EXPIRY_JOB ||
      typeof orderId !== 'string' ||
      !UUID_PATTERN.test(orderId)
    ) {
      this.invalidJob();
    }
    return orderId.toLowerCase();
  }

  private invalidJob(): never {
    throw new BadRequestException({
      errorCode: 'INVALID_ORDER_EXPIRY_JOB',
      message: 'Invalid order expiry payload',
    });
  }
}
