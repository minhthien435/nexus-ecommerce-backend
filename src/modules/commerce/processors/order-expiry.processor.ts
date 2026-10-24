import { BadRequestException } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { DelayedError, type Job } from 'bullmq';
import { DataSource } from 'typeorm';
import { InventoryReservationApi } from '../../fulfillment/inventory-reservation.api.js';
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
  constructor(
    private readonly dataSource: DataSource,
    private readonly transition: OrderExpiryTransitionApi,
    private readonly inventory: InventoryReservationApi,
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
      message: 'Expiry jobs require the stable job name and a valid order UUID',
    });
  }
}
