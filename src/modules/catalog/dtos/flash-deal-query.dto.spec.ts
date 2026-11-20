import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { ActiveFlashDealQueryDto } from './flash-deal-query.dto.js';

describe('ActiveFlashDealQueryDto', () => {
  it.each([
    { page: '0', limit: '20' },
    { page: '1', limit: '0' },
    { page: '1', limit: '101' },
    { page: '1.5', limit: '20' },
    { page: '1', limit: '20', campaignId: 'not-a-uuid' },
  ])('rejects invalid paging/filter input %#', async (input) => {
    const errors = await validate(
      plainToInstance(ActiveFlashDealQueryDto, input),
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it('accepts a valid campaign filter and positive paging', async () => {
    const dto = plainToInstance(ActiveFlashDealQueryDto, {
      campaignId: '00000000-0000-4000-8000-000000000000',
      page: '2',
      limit: '10',
    });
    await expect(validate(dto)).resolves.toEqual([]);
    expect(dto).toMatchObject({ page: 2, limit: 10 });
  });
});
