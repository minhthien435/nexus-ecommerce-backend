import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { ListShopsQueryDto, UpdateShopStatusDto } from './admin-shop.dto.js';

describe('admin shop DTOs', () => {
  it('trims filters and applies bounded pagination defaults', async () => {
    const dto = plainToInstance(ListShopsQueryDto, {
      search: '  pottery  ',
      status: 'ACTIVE',
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto).toMatchObject({ search: 'pottery', page: 1, limit: 20 });
    expect(
      await validate(
        plainToInstance(ListShopsQueryDto, { page: 0, limit: 101 }),
      ),
    ).not.toHaveLength(0);
  });

  it('accepts only known status and a nonblank trimmed reason', async () => {
    const valid = plainToInstance(UpdateShopStatusDto, {
      status: 'SUSPENDED',
      reason: '  policy breach  ',
    });
    expect(await validate(valid)).toHaveLength(0);
    expect(valid.reason).toBe('policy breach');
    expect(
      await validate(
        plainToInstance(UpdateShopStatusDto, {
          status: 'INVALID',
          reason: '   ',
        }),
      ),
    ).not.toHaveLength(0);
  });
});
