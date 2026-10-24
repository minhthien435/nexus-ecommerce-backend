import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import {
  ORDER_EXPIRY_JOB,
  ORDER_EXPIRY_QUEUE,
} from '../order-expiry.constants.js';
import type { OrderExpiryJobPayload } from '../order-expiry.constants.js';
import { OrderExpirySchedulerApi } from '../order-expiry-scheduler.api.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class OrderExpirySchedulerService extends OrderExpirySchedulerApi {
  constructor(
    @InjectQueue(ORDER_EXPIRY_QUEUE)
    private readonly queue: Queue<OrderExpiryJobPayload>,
  ) {
    super();
  }

  async schedule(orderId: string, holdExpiresAt: Date): Promise<void> {
    if (typeof orderId !== 'string' || !(holdExpiresAt instanceof Date)) {
      this.invalidInput();
    }
    const normalizedOrderId = orderId.toLowerCase();
    const expiryTime = holdExpiresAt.getTime();
    if (!UUID_PATTERN.test(normalizedOrderId) || !Number.isFinite(expiryTime)) {
      this.invalidInput();
    }
    await this.queue.add(
      ORDER_EXPIRY_JOB,
      { orderId: normalizedOrderId },
      {
        jobId: `order-expiry-${normalizedOrderId}`,
        delay: Math.max(0, expiryTime - Date.now()),
        attempts: 5,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: true,
      },
    );
  }

  private invalidInput(): never {
    throw new BadRequestException({
      errorCode: 'INVALID_ORDER_EXPIRY',
      message: 'A valid order UUID and expiry time are required',
    });
  }
}
