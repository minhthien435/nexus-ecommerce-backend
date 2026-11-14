import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import {
  ACTIVATE_AUCTION_JOB,
  AUCTION_LIFECYCLE_QUEUE,
  CLOSE_AUCTION_JOB,
  SWEEP_AUCTIONS_JOB,
  type AuctionLifecycleJob,
} from '../auction-lifecycle.constants.js';
import type { AuctionEntity } from '../entities/auction.entity.js';

@Injectable()
export class AuctionSchedulerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AuctionSchedulerService.name);

  constructor(
    @InjectQueue(AUCTION_LIFECYCLE_QUEUE)
    private readonly queue: Queue<AuctionLifecycleJob>,
  ) {}

  onApplicationBootstrap(): void {
    void this.queue
      .upsertJobScheduler(
        SWEEP_AUCTIONS_JOB,
        { every: 60_000 },
        { name: SWEEP_AUCTIONS_JOB, data: {} },
      )
      .catch((error: unknown) => {
        this.logger.error('Failed to register auction lifecycle sweep', error);
      });
  }

  schedule(auction: AuctionEntity): void {
    if (auction.status === 'SCHEDULED') {
      this.enqueue(ACTIVATE_AUCTION_JOB, auction.id, auction.startsAt);
    }
    if (
      auction.status === 'SCHEDULED' ||
      auction.status === 'ACTIVE' ||
      auction.status === 'ENDED'
    ) {
      this.enqueue(CLOSE_AUCTION_JOB, auction.id, auction.endsAt);
    }
  }

  private enqueue(name: string, auctionId: string, at: Date): void {
    void this.queue
      .add(
        name,
        { auctionId },
        {
          // BullMQ reserves colons in custom job IDs.
          jobId: `${name}-${auctionId}-${at.getTime()}`,
          delay: Math.max(0, at.getTime() - Date.now()),
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: true,
          removeOnFail: 100,
        },
      )
      .catch((error: unknown) => {
        this.logger.warn(
          `Failed to schedule ${name} for auction ${auctionId}: ${String(error)}`,
        );
      });
  }
}
