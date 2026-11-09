import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { DataSource } from 'typeorm';
import { OrderEntity } from '../domain/entities/order.entity.js';
import { ORDER_COMPLETION_QUEUE } from '../order-completion.constants.js';
import { OrderStateMachineService } from '../services/order-state-machine.service.js';

@Processor(ORDER_COMPLETION_QUEUE)
export class OrderCompletionProcessor extends WorkerHost {
  private readonly logger = new Logger(OrderCompletionProcessor.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly orderStateMachine: OrderStateMachineService,
  ) {
    super();
  }

  async process(_job: Job): Promise<number> {
    this.logger.log(
      'Bắt đầu quét các đơn hàng DELIVERED quá 72h để tự động hoàn tất COMPLETED...',
    );

    return this.dataSource.transaction('READ COMMITTED', async (manager) => {
      const orderRepo = manager.getRepository(OrderEntity);

      // 1. Lọc theo delivered_at <= 72h và loại bỏ các đơn có bất kỳ khiếu nại nào trong commerce.order_disputes
      const eligibleOrders = await manager.query<
        Array<{ id: string; order_number: string }>
      >(`
        SELECT o.id, o.order_number
          FROM "commerce"."orders" o
         WHERE o.status = 'DELIVERED'
           AND o.delivered_at IS NOT NULL
           AND o.delivered_at <= NOW() - INTERVAL '72 hours'
           AND o.id NOT IN (
             SELECT order_id FROM "commerce"."order_disputes"
           )
         LIMIT 100
      `);

      if (eligibleOrders.length === 0) {
        this.logger.log('Không có đơn hàng nào cần tự động hoàn tất đợt này.');
        return 0;
      }

      let completedCount = 0;
      for (const row of eligibleOrders) {
        try {
          const completed = await this.orderStateMachine.transition(manager, {
            orderId: row.id,
            toStatus: 'COMPLETED',
            actorId: null,
            reason:
              'Hệ thống tự động hoàn tất đơn hàng sau 72 giờ không có khiếu nại',
          });
          await orderRepo.save(completed);
          completedCount++;
          this.logger.log(
            `Tự động COMPLETED đơn hàng #${row.order_number} (${row.id})`,
          );
        } catch (err) {
          this.logger.error(
            `Lỗi khi tự động hoàn tất đơn ${row.id}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      this.logger.log(
        `Hoàn tất quét: Đã chuyển ${completedCount}/${eligibleOrders.length} đơn sang COMPLETED.`,
      );
      return completedCount;
    });
  }
}
