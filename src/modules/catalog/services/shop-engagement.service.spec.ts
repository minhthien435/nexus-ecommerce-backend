import { describe, expect, it, vi } from 'vitest';
import { ShopEngagementService } from './shop-engagement.service.js';

describe('ShopEngagementService', () => {
  it('rejects a seller following their own shop before changing its count', async () => {
    const query = vi
      .fn()
      .mockResolvedValue([{ id: 'shop', sellerId: 'owner' }]);
    const service = new ShopEngagementService({
      transaction: (
        work: (manager: { query: typeof query }) => Promise<unknown>,
      ) => work({ query }),
    } as never);

    await expect(
      service.setFollow('owner', 'shop', true),
    ).rejects.toMatchObject({
      status: 403,
      response: { errorCode: 'CANNOT_FOLLOW_OWN_SHOP' },
    });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('returns 404 for a follow lookup when no visible shop matches', async () => {
    const service = new ShopEngagementService({
      query: vi.fn().mockResolvedValue([]),
    } as never);
    await expect(service.getFollow('buyer', 'missing')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('returns 404 when adding an unavailable product to a wishlist', async () => {
    const service = new ShopEngagementService({
      query: vi.fn().mockResolvedValue([{ available: false }]),
    } as never);
    await expect(
      service.setWishlist('buyer', 'missing', true),
    ).rejects.toMatchObject({ status: 404 });
  });
});
