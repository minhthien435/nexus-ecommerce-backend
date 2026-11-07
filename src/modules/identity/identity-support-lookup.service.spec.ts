import { In, IsNull } from 'typeorm';
import { IdentitySupportLookupService } from './identity-support-lookup.service.js';

describe('IdentitySupportLookupService', () => {
  function setup() {
    const users = { find: vi.fn() };
    const shops = { find: vi.fn() };
    return {
      service: new IdentitySupportLookupService(users as never, shops as never),
      users,
      shops,
    };
  }

  it('normalizes email and returns matching active-record ids', async () => {
    const { service, users } = setup();
    users.find.mockResolvedValue([{ id: 'buyer-1' }]);

    await expect(
      service.findBuyerIdsByEmail(' Buyer@Example.com '),
    ).resolves.toEqual(['buyer-1']);
    expect(users.find).toHaveBeenCalledWith({
      select: { id: true },
      where: { email: 'buyer@example.com', deletedAt: IsNull() },
    });
  });

  it('deduplicates ids and returns support-safe user projections', async () => {
    const { service, users } = setup();
    users.find.mockResolvedValue([{ id: 'buyer-1', email: 'a@example.com' }]);

    await service.getUsersByIds(['BUYER-1', 'buyer-1']);

    expect(users.find).toHaveBeenCalledWith({
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        status: true,
      },
      where: { id: In(['buyer-1']), deletedAt: IsNull() },
    });
  });

  it('skips repositories for empty batches and loads shops by seller id', async () => {
    const { service, users, shops } = setup();
    await expect(service.getUsersByIds([])).resolves.toEqual([]);
    await expect(service.getShopsBySellerIds([])).resolves.toEqual([]);
    expect(users.find).not.toHaveBeenCalled();
    expect(shops.find).not.toHaveBeenCalled();

    shops.find.mockResolvedValue([{ sellerId: 'seller-1', name: 'Shop' }]);
    await service.getShopsBySellerIds(['SELLER-1']);
    expect(shops.find).toHaveBeenCalledWith({
      select: {
        sellerId: true,
        name: true,
        status: true,
        logoUrl: true,
      },
      where: { sellerId: In(['seller-1']), deletedAt: IsNull() },
    });
  });
});
