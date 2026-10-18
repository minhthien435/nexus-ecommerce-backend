import { CartService } from './cart.service.js';

const userId = '11111111-1111-4111-8111-111111111111';
const cartId = '22222222-2222-4222-8222-222222222222';

function setup() {
  const carts = {
    findOne: vi.fn().mockResolvedValue({
      id: cartId,
      expiresAt: new Date('2026-10-24T12:00:00Z'),
    }),
    query: vi
      .fn()
      .mockResolvedValue([{ observedTime: new Date('2026-10-17T12:00:00Z') }]),
  };
  const items = { find: vi.fn().mockResolvedValue([]) };
  const catalog = { getCartSkus: vi.fn().mockResolvedValue([]) };
  const inventory = { getDefaultWarehouseStock: vi.fn().mockResolvedValue([]) };
  const service = new CartService(
    carts as never,
    items as never,
    catalog,
    inventory,
  );
  return { carts, items, catalog, inventory, service };
}

function item(skuId: string, quantity = 1, snapshot = '0.10') {
  return {
    id: skuId,
    skuId,
    productId: 'product',
    quantity,
    unitPriceSnapshot: snapshot,
    productNameSnapshot: 'Old name',
  };
}

function sku(id: string, price = '0.10', overrides = {}) {
  return {
    id,
    productId: 'product',
    skuCode: id,
    variantAttributes: {},
    price,
    currency: 'VND',
    isActive: true,
    productName: 'Product',
    productSlug: 'product',
    productStatus: 'ACTIVE',
    productDeletedAt: null,
    ...overrides,
  };
}

describe('CartService read cart', () => {
  it('routes cart, clock, items, Catalog and Inventory through the supplied manager only', async () => {
    const s = setup();
    s.items.find.mockResolvedValue([item('a')]);
    s.catalog.getCartSkus.mockResolvedValue([sku('a')] as never);
    s.inventory.getDefaultWarehouseStock.mockResolvedValue([
      { skuId: 'a', availableQuantity: 1 },
    ] as never);
    const manager = {
      getRepository: vi
        .fn()
        .mockReturnValueOnce(s.carts)
        .mockReturnValueOnce(s.items),
      query: s.carts.query,
    };
    const forbidden = new Proxy(
      {},
      {
        get: () => {
          throw new Error('default repository reached');
        },
      },
    );
    const service = new CartService(
      forbidden as never,
      forbidden as never,
      s.catalog,
      s.inventory,
    );
    expect((await service.getCart(userId, manager as never)).subtotal).toBe(
      '0.10',
    );
    expect(s.catalog.getCartSkus).toHaveBeenCalledWith(['a'], manager);
    expect(s.inventory.getDefaultWarehouseStock).toHaveBeenCalledWith(
      ['a'],
      manager,
    );
  });
  it.each([-1, 0, 1])(
    'treats expiry offset %s against DB time as read-only',
    async (offset) => {
      const s = setup();
      const observed = new Date('2026-10-17T12:00:00Z');
      const expiresAt = new Date(observed.getTime() + offset);
      s.carts.findOne.mockResolvedValue({ id: cartId, expiresAt });
      const result = await s.service.getCart(userId);
      expect(result.cartId).toBe(offset > 0 ? cartId : null);
      expect(result.expiresAt).toEqual(offset > 0 ? expiresAt : null);
      expect(s.carts.query).toHaveBeenCalledWith(
        'SELECT clock_timestamp() AS "observedTime"',
      );
      if (offset <= 0) expect(s.items.find).not.toHaveBeenCalled();
    },
  );
  it('returns zero without creating a missing cart or loading other contexts', async () => {
    const s = setup();
    s.carts.findOne.mockResolvedValue(null);
    await expect(s.service.getCart(userId)).resolves.toMatchObject({
      items: [],
      subtotal: '0.00',
      hasExcludedItems: false,
    });
    expect(s.carts.findOne).toHaveBeenCalledWith({
      where: { userId, status: 'ACTIVE' },
    });
    expect(s.items.find).not.toHaveBeenCalled();
    expect(s.inventory.getDefaultWarehouseStock).not.toHaveBeenCalled();
  });

  it('returns an existing empty cart without querying stock', async () => {
    const s = setup();
    await expect(s.service.getCart(userId)).resolves.toMatchObject({
      cartId,
      items: [],
      subtotal: '0.00',
    });
    expect(s.items.find).toHaveBeenCalledWith({
      where: { cartId },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    expect(s.catalog.getCartSkus).not.toHaveBeenCalled();
  });

  it('uses current prices with exact decimal math and leaves snapshots and quantities intact', async () => {
    const s = setup();
    const rows = [item('a', 3), item('b', 2, '0.20')];
    s.items.find.mockResolvedValue(rows as never);
    s.catalog.getCartSkus.mockResolvedValue([
      sku('a', '0.20'),
      sku('b', '0.10'),
    ] as never);
    s.inventory.getDefaultWarehouseStock.mockResolvedValue([
      { skuId: 'a', availableQuantity: 3 },
      { skuId: 'b', availableQuantity: 20 },
    ] as never);
    const before = structuredClone(rows);
    const result = await s.service.getCart(userId);
    expect(result.subtotal).toBe('0.80');
    expect(result.currency).toBe('VND');
    expect(result.items[0]).toMatchObject({
      unitPrice: '0.20',
      lineTotal: '0.60',
      priceChanged: true,
      includedInSubtotal: true,
    });
    expect(rows).toEqual(before);
  });

  it('keeps invalid lines visible and excludes out-of-stock, insufficient and discontinued lines', async () => {
    const s = setup();
    s.items.find.mockResolvedValue([
      item('a'),
      item('b', 3),
      item('c'),
      item('d'),
      item('e'),
      item('f'),
      item('g'),
    ] as never);
    s.catalog.getCartSkus.mockResolvedValue([
      sku('a'),
      sku('b'),
      sku('c', '1.00', { isActive: false }),
      sku('d', '1.00', { productStatus: 'DRAFT' }),
      sku('e', '1.00', { productDeletedAt: new Date() }),
      sku('g', '1.00', { productId: 'other' }),
    ] as never);
    s.inventory.getDefaultWarehouseStock.mockResolvedValue(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((skuId) => ({
        skuId,
        availableQuantity: skuId === 'b' ? 2 : 0,
      })) as never,
    );
    const result = await s.service.getCart(userId);
    expect(result.items.map((i) => i.exclusionReason)).toEqual([
      'OUT_OF_STOCK',
      'INSUFFICIENT_STOCK',
      'DISCONTINUED',
      'DISCONTINUED',
      'DISCONTINUED',
      'DISCONTINUED',
      'DISCONTINUED',
    ]);
    expect(result).toMatchObject({
      subtotal: '0.00',
      hasExcludedItems: true,
      excludedItemCount: 7,
    });
  });

  it('preserves precision beyond Number.MAX_SAFE_INTEGER', async () => {
    const s = setup();
    s.items.find.mockResolvedValue([item('a', 2)] as never);
    s.catalog.getCartSkus.mockResolvedValue([
      sku('a', '9999999999999999.99'),
    ] as never);
    s.inventory.getDefaultWarehouseStock.mockResolvedValue([
      { skuId: 'a', availableQuantity: 2 },
    ] as never);
    expect((await s.service.getCart(userId)).subtotal).toBe(
      '19999999999999999.98',
    );
  });

  it('does not add different currencies into a single subtotal', async () => {
    const s = setup();
    s.items.find.mockResolvedValue([item('a'), item('b')] as never);
    s.catalog.getCartSkus.mockResolvedValue([
      sku('a'),
      sku('b', '1.00', { currency: 'USD' }),
    ] as never);
    s.inventory.getDefaultWarehouseStock.mockResolvedValue([
      { skuId: 'a', availableQuantity: 1 },
      { skuId: 'b', availableQuantity: 1 },
    ] as never);
    await expect(s.service.getCart(userId)).rejects.toMatchObject({
      status: 409,
    });
  });

  it('fails explicitly when Inventory omits a requested stock result', async () => {
    const s = setup();
    s.items.find.mockResolvedValue([item('a')] as never);
    s.catalog.getCartSkus.mockResolvedValue([sku('a')] as never);
    await expect(s.service.getCart(userId)).rejects.toMatchObject({
      status: 503,
      response: expect.objectContaining({ errorCode: 'INVENTORY_UNAVAILABLE' }),
    });
  });
});
