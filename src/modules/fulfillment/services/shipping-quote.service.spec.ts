import { describe, expect, it, vi } from 'vitest';
import { ShippingQuoteService } from './shipping-quote.service.js';

const input = { districtId: 1442, wardCode: '20101', weightGrams: 750 };
function setup() {
  const ghn = {
    getShopOrigin: vi
      .fn()
      .mockResolvedValue({ districtId: 1452, wardCode: '21007', shopId: 123 }),
    request: vi
      .fn()
      .mockResolvedValueOnce([{ service_id: 53320, service_type_id: 2 }])
      .mockResolvedValueOnce({ total: 32500 })
      .mockResolvedValueOnce({ leadtime: 1800000000 }),
  };
  return { ghn, service: new ShippingQuoteService(ghn as never) };
}
describe('ShippingQuoteService', () => {
  it('uses actual shop origin, selected service and exact gram weight', async () => {
    const { ghn, service } = setup();
    await expect(service.quote(input)).resolves.toMatchObject({
      fee: 32500,
      currency: 'VND',
      weightGrams: 750,
      expectedDeliveryTime: new Date(1800000000000).toISOString(),
    });
    expect(ghn.request).toHaveBeenNthCalledWith(2, 'v2/shipping-order/fee', {
      from_district_id: 1452,
      from_ward_code: '21007',
      to_district_id: 1442,
      to_ward_code: '20101',
      service_type_id: 2,
      weight: 750,
      insurance_value: 0,
    });
  });
  it.each([
    { weightGrams: 0 },
    { weightGrams: 1.1 },
    { weightGrams: 5000001 },
    { districtId: 0 },
    { wardCode: '' },
    { wardCode: ' ' },
  ])('rejects invalid input before GHN: %j', async (change) => {
    const { ghn, service } = setup();
    await expect(service.quote({ ...input, ...change })).rejects.toMatchObject({
      status: 400,
    });
    expect(ghn.getShopOrigin).not.toHaveBeenCalled();
  });
  it.each([undefined, -1, 1.25, Number.POSITIVE_INFINITY])(
    'rejects malformed fee %s',
    async (total) => {
      const { ghn, service } = setup();
      ghn.request
        .mockReset()
        .mockResolvedValueOnce([{ service_type_id: 2 }])
        .mockResolvedValueOnce({ total });
      await expect(service.quote(input)).rejects.toMatchObject({ status: 503 });
    },
  );
  it('propagates fee failure without fabricating zero', async () => {
    const { ghn, service } = setup();
    ghn.request
      .mockReset()
      .mockResolvedValueOnce([{ service_type_id: 2 }])
      .mockRejectedValueOnce(new Error('fee unavailable'));
    await expect(service.quote(input)).rejects.toThrow('fee unavailable');
  });
  it('allows unavailable delivery estimate after successful fee', async () => {
    const { ghn, service } = setup();
    ghn.request
      .mockReset()
      .mockResolvedValueOnce([{ service_type_id: 2 }])
      .mockResolvedValueOnce({ total: 32500 })
      .mockRejectedValueOnce(new Error('estimate unavailable'));
    await expect(service.quote(input)).resolves.toMatchObject({
      fee: 32500,
      expectedDeliveryTime: null,
    });
  });
  it('selects heavy service for parcels at 20kg', async () => {
    const { ghn, service } = setup();
    ghn.request
      .mockReset()
      .mockResolvedValueOnce([{ service_type_id: 2 }, { service_type_id: 5 }])
      .mockResolvedValueOnce({ total: 100000 })
      .mockResolvedValueOnce({});
    await expect(
      service.quote({ ...input, weightGrams: 20000 }),
    ).resolves.toMatchObject({ serviceTypeId: 5 });
  });
});
