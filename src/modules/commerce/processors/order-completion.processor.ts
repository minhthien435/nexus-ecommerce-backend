import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { DataSource } from 'typeorm';
import { IdentityReputationApi } from '../../identity/identity-reputation.api.js';
import { ORDER_COMPLETION_QUEUE } from '../order-completion.constants.js';
import { OrderStateMachineService } from '../services/order-state-machine.service.js';

@Processor(ORDER_COMPLETION_QUEUE)
export class OrderCompletionProcessor extends WorkerHost {
  private readonly logger = new Logger(OrderCompletionProcessor.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly orderStateMachine: OrderStateMachineService,
    private readonly reputation: IdentityReputationApi,
  ) {
    super();
  }

  async process(_job: Job): Promise<number> {
    const failedDeliveredIds: string[] = [];
    let completedCount = 0;

    // 1. Process up to 100 delivered orders per run, each in an independent transaction with SKIP LOCKED
    for (let i = 0; i < 100; i++) {
      let currentOrderId: string | null = null;
      try {
        const processed = await this.dataSource.transaction(
          'READ COMMITTED',
          async (manager) => {
            const params: unknown[] = [];
            let excludeClause = '';
            if (failedDeliveredIds.length > 0) {
              excludeClause = `AND o.id NOT IN (${failedDeliveredIds.map((_, idx) => `$${idx + 1}`).join(',')})`;
              params.push(...failedDeliveredIds);
            }

            const rows = await manager.query<Array<{ id: string }>>(
              `
              SELECT o.id FROM commerce.orders o
              WHERE o.status = 'DELIVERED'
                AND (SELECT MAX(h.created_at) FROM commerce.order_status_history h
                  WHERE h.order_id = o.id AND h.to_status = 'DELIVERED') < NOW() - INTERVAL '72 hours'
                AND NOT EXISTS (SELECT 1 FROM commerce.order_disputes d WHERE d.order_id = o.id)
                ${excludeClause}
              ORDER BY o.id LIMIT 1 FOR UPDATE OF o SKIP LOCKED
            `,
              params,
            );

            if (!rows.length) return false;
            currentOrderId = rows[0].id;

            await this.orderStateMachine.transition(manager, {
              orderId: rows[0].id,
              toStatus: 'COMPLETED',
              actorId: null,
              reason:
                'Automatically completed after the 72 hour complaint window',
            });
            return true;
          },
        );

        if (!processed) break;
        completedCount++;
      } catch (err) {
        if (currentOrderId) {
          failedDeliveredIds.push(currentOrderId);
          this.logger.error(
            `Failed to auto-complete order ${currentOrderId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        } else {
          this.logger.error(
            `Failed during auto-complete order query: ${err instanceof Error ? err.message : String(err)}`,
          );
          break;
        }
      }
    }

    // 2. Independent scan includes buyer confirmations and rejected disputes already COMPLETED.
    // Exclude consumed and ineligible rows before LIMIT to prevent head-of-batch starvation.
    const rewardOrders = await this.dataSource.query<Array<{ id: string }>>(`
      SELECT o.id FROM commerce.orders o
      JOIN identity.shops s ON s.seller_id = o.seller_id AND s.deleted_at IS NULL
      WHERE o.status = 'COMPLETED'
        AND (SELECT MAX(h.created_at) FROM commerce.order_status_history h
          WHERE h.order_id = o.id AND h.to_status = 'DELIVERED') < NOW() - INTERVAL '72 hours'
        AND NOT EXISTS (SELECT 1 FROM commerce.order_disputes d
          WHERE d.order_id = o.id AND d.status != 'REJECTED_PAY_SELLER')
        AND NOT EXISTS (SELECT 1 FROM commerce.order_refunds r WHERE r.order_id = o.id
          AND r.status IN ('REQUESTED','PROCESSING','COMPLETED') AND r.amount >= o.total)
        AND NOT EXISTS (SELECT 1 FROM identity.shop_reputation_rewards r
          WHERE r.source_type = 'ORDER_COMPLETION' AND r.reference_id = o.id)
      ORDER BY o.id LIMIT 100
    `);

    let rewardedCount = 0;
    for (const row of rewardOrders) {
      try {
        const rewardResult = await this.reputation.rewardCompletedOrder(row.id);
        if (rewardResult !== null && !rewardResult.alreadyRewarded) {
          rewardedCount++;
        }
      } catch (err) {
        this.logger.error(
          `Failed to reward completed order ${row.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    this.logger.log(
      `Completed ${completedCount} orders; rewarded ${rewardedCount}/${rewardOrders.length} shop rewards`,
    );
    return completedCount;
  }
}
