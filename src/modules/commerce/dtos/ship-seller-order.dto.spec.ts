import { ValidationPipe } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { ShipSellerOrderDto } from './ship-seller-order.dto.js';

const pipe = new ValidationPipe({ transform: true, whitelist: true });
const transform = (body: unknown) =>
  pipe.transform(body, { type: 'body', metatype: ShipSellerOrderDto });

describe('ShipSellerOrderDto', () => {
  it('trims required fields and preserves optional note', async () => {
    await expect(
      transform({
        trackingCode: ' TRACK ',
        carrierName: ' Carrier ',
        note: 'Handle carefully',
      }),
    ).resolves.toMatchObject({
      trackingCode: 'TRACK',
      carrierName: 'Carrier',
      note: 'Handle carefully',
    });
  });

  it.each(['trackingCode', 'carrierName'])(
    'rejects invalid %s with HTTP 400',
    async (field) => {
      for (const value of [
        undefined,
        null,
        '',
        ' \t\n ',
        123,
        {},
        'x'.repeat(101),
      ]) {
        await expect(
          transform({
            trackingCode: 'TRACK',
            carrierName: 'Carrier',
            [field]: value,
          }),
        ).rejects.toMatchObject({ status: 400 });
      }
    },
  );

  it('accepts the 100 character boundary and rejects an oversized note', async () => {
    await expect(
      transform({
        trackingCode: 'x'.repeat(100),
        carrierName: 'x'.repeat(100),
      }),
    ).resolves.toBeDefined();
    await expect(
      transform({
        trackingCode: 'TRACK',
        carrierName: 'Carrier',
        note: 'x'.repeat(501),
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
