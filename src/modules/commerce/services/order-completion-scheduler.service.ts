import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import {
  ORDER_AUTO_COMPLETE_JOB,
  ORDER_COMPLETION_QUEUE,
} from '../order-completion.constants.js';

@Injectable()
export class OrderCompletionSchedulerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(OrderCompletionSchedulerService.name);

  constructor(
    @InjectQueue(ORDER_COMPLETION_QUEUE)
    private readonly queue: Queue,
  ) {}

  async onApplicationBootstrap() {
    try {
      // Repeatable BullMQ job chạy mỗi 15 phút (BullMQ v6 upsertJobScheduler)
      await this.queue.upsertJobScheduler(
        ORDER_AUTO_COMPLETE_JOB,
        {
          every: 15 * 60 * 1000,
        },
        {
          name: ORDER_AUTO_COMPLETE_JOB,
          data: {},
        },
      );
      this.logger.log(
        'Đã khởi tạo BullMQ Repeatable Job tự động hoàn tất đơn hàng DELIVERED sau 72h',
      );
    } catch (err) {
      this.logger.warn(
        `Không thể đăng ký BullMQ repeatable job (có thể Redis chưa kết nối): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /** Cho phép kích hoạt quét ngay lập tức khi cần test hoặc manual */
  async triggerManualScan(): Promise<void> {
    await this.queue.add(ORDER_AUTO_COMPLETE_JOB, { manual: true });
  }
}
