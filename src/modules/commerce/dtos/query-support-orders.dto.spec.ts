import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { QuerySupportOrdersDto } from './query-support-orders.dto.js';

describe('QuerySupportOrdersDto', () => {
  it('transforms pagination and accepts supported filters', async () => {
    const dto = plainToInstance(QuerySupportOrdersDto, {
      page: '2',
      limit: '50',
      q: ' ORD-123 ',
      buyerEmail: ' buyer@example.com ',
      sellerId: '11111111-1111-4111-8111-111111111111',
      status: 'PROCESSING',
      fromDate: '2026-11-01T00:00:00.000Z',
      toDate: '2026-11-07T23:59:59.000Z',
    });

    await expect(validate(dto)).resolves.toEqual([]);
    expect(dto).toMatchObject({
      page: 2,
      limit: 50,
      q: 'ORD-123',
      buyerEmail: 'buyer@example.com',
    });
  });

  it.each([
    { limit: 101 },
    { status: 'UNKNOWN' },
    { buyerEmail: 'not-email' },
    {
      fromDate: '2026-11-08T00:00:00.000Z',
      toDate: '2026-11-07T00:00:00.000Z',
    },
  ])('rejects invalid support order query %j', async (input) => {
    const errors = await validate(
      plainToInstance(QuerySupportOrdersDto, input),
    );
    expect(errors.length).toBeGreaterThan(0);
  });
});
