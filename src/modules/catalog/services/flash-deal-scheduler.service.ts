import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import {
  ACTIVATE_FLASH_DEAL_JOB,
  CLOSE_FLASH_DEAL_JOB,
  FLASH_DEAL_LIFECYCLE_QUEUE,
  FLASH_DEAL_SWEEP_INTERVAL_MS,
  SWEEP_FLASH_DEALS_JOB,
  type FlashDealLifecycleJob,
} from '../flash-deal-lifecycle.constants.js';
import {
  FlashDealCampaignStatus,
  type FlashDealCampaignEntity,
} from '../domain/entities/flash-deal-campaign.entity.js';

@Injectable()
export class FlashDealSchedulerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(FlashDealSchedulerService.name);

  constructor(
    @InjectQueue(FLASH_DEAL_LIFECYCLE_QUEUE)
    private readonly queue: Queue<FlashDealLifecycleJob>,
  ) {}

  onApplicationBootstrap(): void {
    void this.queue
      .upsertJobScheduler(
        SWEEP_FLASH_DEALS_JOB,
        { every: FLASH_DEAL_SWEEP_INTERVAL_MS },
        { name: SWEEP_FLASH_DEALS_JOB, data: {} },
      )
      .catch((error: unknown) => {
        this.logger.error(
          'Failed to register flash deal lifecycle sweep',
          error,
        );
      });
  }

  schedule(
    campaign: Pick<
      FlashDealCampaignEntity,
      'id' | 'status' | 'startsAt' | 'endsAt'
    >,
  ): void {
    if (campaign.status === FlashDealCampaignStatus.SCHEDULED) {
      this.enqueue(
        ACTIVATE_FLASH_DEAL_JOB,
        campaign.id,
        new Date(campaign.startsAt),
      );
    }
    if (
      campaign.status === FlashDealCampaignStatus.SCHEDULED ||
      campaign.status === FlashDealCampaignStatus.ACTIVE
    ) {
      this.enqueue(
        CLOSE_FLASH_DEAL_JOB,
        campaign.id,
        new Date(campaign.endsAt),
      );
    }
  }

  private enqueue(name: string, campaignId: string, at: Date): void {
    void this.queue
      .add(
        name,
        { campaignId },
        {
          // BullMQ reserves colons in custom job IDs.
          jobId: `${name}-${campaignId}-${at.getTime()}`,
          delay: Math.max(0, at.getTime() - Date.now()),
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: true,
          removeOnFail: 100,
        },
      )
      .catch((error: unknown) => {
        this.logger.error(
          `Failed to enqueue ${name} for flash deal campaign ${campaignId}`,
          error,
        );
      });
  }
}
