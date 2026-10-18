import { LoginCartMergeService } from './login-cart-merge.service.js';

describe('LoginCartMergeService', () => {
  const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const input = [
    { skuId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', quantity: 3 },
  ];
  function setup() {
    const rbac = { hasAllPermissions: vi.fn().mockResolvedValue(true) };
    const result = { status: 'merged', accepted: input, skipped: [], cart: {} };
    const cart = { mergeItems: vi.fn().mockResolvedValue(result) };
    return {
      rbac,
      cart,
      result,
      service: new LoginCartMergeService(rbac as never, cart as never),
    };
  }
  it('skips empty input without permission or cart calls', async () => {
    const s = setup();
    expect(await s.service.merge(userId, [])).toEqual({
      status: 'skipped',
      accepted: [],
      skipped: [],
    });
    expect(s.rbac.hasAllPermissions).not.toHaveBeenCalled();
    expect(s.cart.mergeItems).not.toHaveBeenCalled();
  });
  it('requires existing CART.CREATE and passes only authenticated ownership', async () => {
    const s = setup();
    expect(await s.service.merge(userId, input)).toBe(s.result);
    expect(s.rbac.hasAllPermissions).toHaveBeenCalledWith(userId, [
      'CART.CREATE',
    ]);
    expect(s.cart.mergeItems).toHaveBeenCalledWith(userId, input);
    expect(s.rbac.hasAllPermissions.mock.invocationCallOrder[0]).toBeLessThan(
      s.cart.mergeItems.mock.invocationCallOrder[0],
    );
  });
  it('reports denial without a cart call', async () => {
    const s = setup();
    s.rbac.hasAllPermissions.mockResolvedValue(false);
    expect(await s.service.merge(userId, input)).toEqual({
      status: 'forbidden',
      accepted: [],
      skipped: [],
    });
    expect(s.cart.mergeItems).not.toHaveBeenCalled();
  });
  it.each(['permission', 'cart'])(
    'sanitizes %s failures without claiming acceptance',
    async (at) => {
      const s = setup();
      (at === 'permission'
        ? s.rbac.hasAllPermissions
        : s.cart.mergeItems
      ).mockRejectedValue(new Error('secret SQL credentials'));
      expect(await s.service.merge(userId, input)).toEqual({
        status: 'failed',
        accepted: [],
        skipped: [],
      });
      if (at === 'permission') expect(s.cart.mergeItems).not.toHaveBeenCalled();
    },
  );
});
