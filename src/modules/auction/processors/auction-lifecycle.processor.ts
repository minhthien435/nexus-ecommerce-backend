import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import type { Job } from 'bullmq';
import { LessThanOrEqual, Repository } from 'typeorm';
import {
  ACTIVATE_AUCTION_JOB,
  AUCTION_LIFECYCLE_QUEUE,
  CLOSE_AUCTION_JOB,
  SWEEP_AUCTIONS_JOB,
  type AuctionLifecycleJob,
} from '../auction-lifecycle.constants.js';
import { AuctionService } from '../auction.service.js';
import { AuctionEntity } from '../entities/auction.entity.js';

@Processor(AUCTION_LIFECYCLE_QUEUE)
export class AuctionLifecycleProcessor extends WorkerHost {
  private readonly logger = new Logger(AuctionLifecycleProcessor.name);

  constructor(
    private readonly auctionService: AuctionService,
    @InjectRepository(AuctionEntity)
    private readonly auctions: Repository<AuctionEntity>,
  ) {
    super();
  }

  async process(job: Job<AuctionLifecycleJob>): Promise<void> {
    if (job.name === SWEEP_AUCTIONS_JOB) {
      const due = LessThanOrEqual(new Date());
      const auctions = await this.auctions.find({
        select: { id: true },
        where: [
          { status: 'SCHEDULED', startsAt: due },
          { status: 'ACTIVE', endsAt: due },
          { status: 'ENDED', endsAt: due },
        ],
      });
      for (const { id } of auctions) {
        try {
          await this.auctionService.advanceLifecycle(id);
        } catch (error) {
          this.logger.error(`Failed to advance auction ${id}`, error);
        }
      }
      return;
    }
    if (
      job.data.auctionId &&
      [ACTIVATE_AUCTION_JOB, CLOSE_AUCTION_JOB].includes(job.name)
    ) {
      await this.auctionService.advanceLifecycle(job.data.auctionId);
    }
  }
}
