import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import {
  ACTIVATE_FLASH_DEAL_JOB,
  CLOSE_FLASH_DEAL_JOB,
  FLASH_DEAL_LIFECYCLE_QUEUE,
  SWEEP_FLASH_DEALS_JOB,
  type FlashDealLifecycleJob,
} from '../flash-deal-lifecycle.constants.js';
import { FlashDealAdminService } from '../services/flash-deal-admin.service.js';

@Processor(FLASH_DEAL_LIFECYCLE_QUEUE)
export class FlashDealLifecycleProcessor extends WorkerHost {
  private readonly logger = new Logger(FlashDealLifecycleProcessor.name);

  constructor(private readonly adminService: FlashDealAdminService) {
    super();
  }

  async process(job: Job<FlashDealLifecycleJob>): Promise<void> {
    if (job.name === SWEEP_FLASH_DEALS_JOB) {
      await this.adminService.sweepDueCampaigns();
      return;
    }

    if (
      job.data?.campaignId &&
      [ACTIVATE_FLASH_DEAL_JOB, CLOSE_FLASH_DEAL_JOB].includes(job.name)
    ) {
      try {
        await this.adminService.advanceLifecycle(job.data.campaignId);
      } catch (error) {
        this.logger.error(
          `Failed to advance flash deal campaign ${job.data.campaignId}`,
          error,
        );
        throw error;
      }
    }
  }
}
