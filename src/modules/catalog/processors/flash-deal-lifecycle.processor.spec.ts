import { describe, expect, it, vi } from 'vitest';
import {
  ACTIVATE_FLASH_DEAL_JOB,
  CLOSE_FLASH_DEAL_JOB,
  FLASH_DEAL_SWEEP_INTERVAL_MS,
  SWEEP_FLASH_DEALS_JOB,
} from '../flash-deal-lifecycle.constants.js';
import { FlashDealCampaignStatus } from '../domain/entities/flash-deal-campaign.entity.js';
import { FlashDealSchedulerService } from '../services/flash-deal-scheduler.service.js';
import { FlashDealLifecycleProcessor } from './flash-deal-lifecycle.processor.js';

describe('FlashDealSchedulerService & FlashDealLifecycleProcessor', () => {
  it('registers periodic 60s sweep and schedules activate/close jobs with colon-free IDs', () => {
    const queue = {
      upsertJobScheduler: vi.fn().mockResolvedValue(undefined),
      add: vi.fn().mockResolvedValue(undefined),
    };
    const scheduler = new FlashDealSchedulerService(queue as never);

    scheduler.onApplicationBootstrap();
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      SWEEP_FLASH_DEALS_JOB,
      { every: FLASH_DEAL_SWEEP_INTERVAL_MS },
      { name: SWEEP_FLASH_DEALS_JOB, data: {} },
    );

    const startsAt = new Date(Date.now() + 30 * 60_000);
    const endsAt = new Date(Date.now() + 90 * 60_000);
    scheduler.schedule({
      id: 'camp-1',
      status: FlashDealCampaignStatus.SCHEDULED,
      startsAt,
      endsAt,
    });

    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(queue.add.mock.calls[0][0]).toBe(ACTIVATE_FLASH_DEAL_JOB);
    expect(queue.add.mock.calls[0][2].jobId).not.toContain(':');
    expect(queue.add.mock.calls[1][0]).toBe(CLOSE_FLASH_DEAL_JOB);
    expect(queue.add.mock.calls[1][2].jobId).not.toContain(':');
  });

  it('dispatches sweep and single-campaign lifecycle jobs in FlashDealLifecycleProcessor', async () => {
    const adminService = {
      sweepDueCampaigns: vi.fn().mockResolvedValue({ activated: 1, ended: 0 }),
      advanceLifecycle: vi.fn().mockResolvedValue(undefined),
    };
    const processor = new FlashDealLifecycleProcessor(adminService as never);

    await processor.process({ name: SWEEP_FLASH_DEALS_JOB, data: {} } as never);
    expect(adminService.sweepDueCampaigns).toHaveBeenCalledOnce();

    await processor.process({
      name: ACTIVATE_FLASH_DEAL_JOB,
      data: { campaignId: 'camp-1' },
    } as never);
    expect(adminService.advanceLifecycle).toHaveBeenCalledWith('camp-1');

    await processor.process({
      name: CLOSE_FLASH_DEAL_JOB,
      data: { campaignId: 'camp-2' },
    } as never);
    expect(adminService.advanceLifecycle).toHaveBeenCalledWith('camp-2');
  });
});
