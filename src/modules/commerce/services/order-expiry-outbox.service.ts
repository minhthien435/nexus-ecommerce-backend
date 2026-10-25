import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { OrderExpiryOutboxEntity } from '../domain/entities/order-expiry-outbox.entity.js';
import { OrderExpiryOutboxApi } from '../order-expiry-outbox.api.js';
import { OrderExpirySchedulerApi } from '../order-expiry-scheduler.api.js';

const RECONCILE_INTERVAL_MS = 30_000;
const RECONCILE_BATCH_SIZE = 20;

@Injectable()
export class OrderExpiryOutboxService
  extends OrderExpiryOutboxApi
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(OrderExpiryOutboxService.name);
  private timer?: NodeJS.Timeout;
  private reconciling = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly scheduler: OrderExpirySchedulerApi,
  ) {
    super();
  }

  async schedule(
    orderId: string,
    holdExpiresAt: Date,
    manager: EntityManager,
  ): Promise<void> {
    await manager
      .createQueryBuilder()
      .insert()
      .into(OrderExpiryOutboxEntity)
      .values({ orderId, holdExpiresAt, nextAttemptAt: new Date() })
      .orIgnore()
      .execute();
  }

  async reconcile(): Promise<void> {
    if (this.reconciling) return;
    this.reconciling = true;
    try {
      await this.dataSource.transaction('READ COMMITTED', async (manager) => {
        const records = await manager
          .getRepository(OrderExpiryOutboxEntity)
          .createQueryBuilder('outbox')
          .setLock('pessimistic_write')
          .setOnLocked('skip_locked')
          .where('outbox.publishedAt IS NULL')
          .andWhere('outbox.nextAttemptAt <= clock_timestamp()')
          .orderBy('outbox.createdAt', 'ASC')
          .take(RECONCILE_BATCH_SIZE)
          .getMany();

        for (const record of records) {
          try {
            await this.scheduler.schedule(record.orderId, record.holdExpiresAt);
            record.publishedAt = new Date();
            record.lastError = null;
          } catch (error) {
            record.attemptCount += 1;
            record.lastError =
              error instanceof Error
                ? error.message.slice(0, 2000)
                : 'Unknown error';
            const delayMs = Math.min(
              60_000,
              1000 * 2 ** (record.attemptCount - 1),
            );
            record.nextAttemptAt = new Date(Date.now() + delayMs);
          }
          await manager.getRepository(OrderExpiryOutboxEntity).save(record);
        }
      });
    } finally {
      this.reconciling = false;
    }
  }

  onApplicationBootstrap(): void {
    void this.reconcileSafely();
    this.timer = setInterval(
      () => void this.reconcileSafely(),
      RECONCILE_INTERVAL_MS,
    );
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async reconcileSafely(): Promise<void> {
    try {
      await this.reconcile();
    } catch (error) {
      this.logger.error('Order expiry outbox reconciliation failed', error);
    }
  }
}
