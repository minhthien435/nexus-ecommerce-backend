import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { PlaceBidDto } from './place-bid.dto.js';

describe('PlaceBidDto', () => {
  it('trims a valid idempotency key before validation', async () => {
    const dto = plainToInstance(PlaceBidDto, {
      amount: 110,
      idempotencyKey: ' retry-key ',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.idempotencyKey).toBe('retry-key');
  });

  it('rejects a whitespace-only idempotency key', async () => {
    const dto = plainToInstance(PlaceBidDto, {
      amount: 110,
      idempotencyKey: '   ',
    });

    const errors = await validate(dto);
    expect(errors.some(({ property }) => property === 'idempotencyKey')).toBe(
      true,
    );
  });
});
