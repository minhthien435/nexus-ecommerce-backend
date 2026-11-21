import { describe, expect, it, vi } from 'vitest';
import { FlashDealQuotaService } from './flash-deal-quota.service.js';
import type { CartSku } from '../../catalog/catalog-cart.api.js';

const now = new Date('2026-11-21T00:00:00Z');
const sku = {
  id: 'sku',
  productId: 'product',
  sellerId: 'seller',
  isActive: true,
  productStatus: 'ACTIVE',
  productDeletedAt: null,
} as CartSku;
function deal(overrides = {}) {
  return {
    id: 'item',
    campaignId: 'campaign',
    skuId: 'sku',
    productId: 'product',
    sellerId: 'seller',
    flashPrice: '80.00',
    regularPrice: '100.00',
    quotaQty: 10,
    soldQty: 0,
    maxPerBuyer: 2,
    status: 'ACTIVE',
    campaignStatus: 'ACTIVE',
    startsAt: new Date(now.getTime() - 1),
    endsAt: new Date(now.getTime() + 1),
    ...overrides,
  };
}
function setup(deals = [deal()]) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('clock_timestamp() AS')) return [{ observedTime: now }];
    if (sql.includes('SUM(quantity)')) return [];
    return deals;
  });
  const manager = { query };
  const source = {
    manager: {
      query: vi.fn(() => {
        throw new Error('default manager reached');
      }),
    },
  };
  const catalog = { getCartSkus: vi.fn().mockResolvedValue([sku]) };
  return {
    query,
    manager,
    service: new FlashDealQuotaService(source as never, catalog),
  };
}
describe('FlashDealQuotaService focused contracts', () => {
  it('auto-selects the only running deal and preserves its server price', async () => {
    const s = setup();
    const result = await s.service.resolveForCheckout(
      { ...s.manager, queryRunner: { isTransactionActive: true } } as never,
      [{ id: 'cart-item', skuId: 'sku', quantity: 2 }],
      [sku],
    );
    expect(result.get('cart-item')).toEqual({
      cartItemId: 'cart-item',
      itemId: 'item',
      skuId: 'sku',
      quantity: 2,
      unitPrice: '80.00',
    });
  });
  it('rejects ambiguity only when two deals are running for the SKU', async () => {
    const s = setup([deal(), deal({ id: 'item-2' })]);
    await expect(
      s.service.resolveForCheckout(
        { ...s.manager, queryRunner: { isTransactionActive: true } } as never,
        [{ id: 'cart-item', skuId: 'sku', quantity: 1 }],
        [sku],
      ),
    ).rejects.toMatchObject({
      response: { errorCode: 'FLASH_DEAL_AMBIGUOUS' },
    });
  });
  it('validates an explicit deal identity and expected decimal VND price', async () => {
    const s = setup();
    const manager = {
      ...s.manager,
      queryRunner: { isTransactionActive: true },
    } as never;
    await expect(
      s.service.resolveForCheckout(
        manager,
        [{ id: 'cart-item', skuId: 'sku', quantity: 1 }],
        [sku],
        [
          {
            cartItemId: 'cart-item',
            flashDealItemId: 'item',
            expectedUnitPrice: '79.00',
          },
        ],
      ),
    ).rejects.toMatchObject({
      response: { errorCode: 'FLASH_DEAL_PRICE_CHANGED' },
    });
  });
  it('requires the caller transaction for batch locks, including empty batches', async () => {
    const s = setup();
    await expect(
      s.service.prelockByOrderIds(s.manager as never, []),
    ).rejects.toMatchObject({ status: 500 });
    await s.service.prelockByOrderIds(
      { ...s.manager, queryRunner: { isTransactionActive: true } } as never,
      [],
    );
    expect(s.query).not.toHaveBeenCalled();
  });
  it('does not query for empty carts or query buyer usage for guests', async () => {
    const s = setup();
    expect(await s.service.projectForCart([], new Map(), null)).toEqual(
      new Map(),
    );
    expect(s.query).not.toHaveBeenCalled();
    expect(
      (
        await s.service.projectForCart(
          [sku],
          new Map([['sku', 1]]),
          null,
          s.manager as never,
        )
      ).get('sku')?.warningCode,
    ).toBe('FLASH_DEAL_SIGN_IN_REQUIRED');
    expect(
      s.query.mock.calls.some(([sql]) => sql.includes('SUM(quantity)')),
    ).toBe(false);
  });
  it('batches item and buyer reads through the supplied manager only', async () => {
    const s = setup([deal(), deal({ id: 'other-item', skuId: 'other-sku' })]);
    const result = await s.service.projectForCart(
      [sku, { ...sku, id: 'other-sku' }, { ...sku, id: 'regular' }],
      new Map([
        ['sku', 1],
        ['other-sku', 1],
      ]),
      'buyer',
      s.manager as never,
    );
    expect(result.size).toBe(2);
    expect(result.get('sku')?.flashDeal?.itemId).toBe('item');
    expect(s.query).toHaveBeenCalledTimes(3);
    expect(s.query).toHaveBeenCalledWith(
      expect.stringContaining('SUM(quantity)'),
      ['buyer', ['item', 'other-item']],
    );
  });
  it.each([
    { flashPrice: '0.00' },
    { flashPrice: '100.00' },
    { flashPrice: 'oops' },
    { productId: 'other' },
    { sellerId: 'other' },
    { campaignStatus: 'CANCELLED' },
  ])('rejects invalid price or product mapping %j', async (overrides) => {
    const s = setup([deal(overrides)]);
    const projection = (
      await s.service.projectForCart(
        [sku],
        new Map([['sku', 1]]),
        'buyer',
        s.manager as never,
      )
    ).get('sku');
    expect(projection).toMatchObject({
      flashDeal: null,
      warningCode: 'FLASH_DEAL_INVALID',
    });
  });
  it.each([
    { isActive: false },
    { productStatus: 'DRAFT' },
    { productDeletedAt: now },
  ])('withholds prices for invalid catalog SKU %j', async (overrides) => {
    const s = setup();
    expect(
      (
        await s.service.projectForCart(
          [{ ...sku, ...overrides }],
          new Map([['sku', 1]]),
          'buyer',
          s.manager as never,
        )
      ).get('sku')?.warningCode,
    ).toBe('FLASH_DEAL_INVALID');
  });
  it('fails explicitly if database clock is unavailable', async () => {
    const s = setup();
    s.query.mockImplementation(async (sql: string) =>
      sql.includes('clock_timestamp() AS') ? [] : [deal()],
    );
    await expect(
      s.service.projectForCart([sku], new Map(), 'buyer', s.manager as never),
    ).rejects.toThrow('Flash deal database clock unavailable');
  });
  it('returns no promotion when a batch has no deal rows', async () => {
    const s = setup([]);
    expect(
      await s.service.projectForCart(
        [sku],
        new Map(),
        'buyer',
        s.manager as never,
      ),
    ).toEqual(new Map());
    expect(s.query).toHaveBeenCalledTimes(1);
  });
  it.each([
    { buyerId: '', orders: [] },
    { buyerId: 'buyer', orders: [] },
    { buyerId: 'buyer', orders: [{ orderId: 'order', items: [] }] },
    {
      buyerId: 'buyer',
      orders: [
        { orderId: 'order', items: [] },
        { orderId: 'order', items: [] },
      ],
    },
  ])('rejects invalid reserve shape without queries', async (input) => {
    const s = setup();
    await expect(
      s.service.reserve(
        { queryRunner: { isTransactionActive: true }, query: s.query } as never,
        input,
      ),
    ).rejects.toMatchObject({
      response: { errorCode: 'FLASH_DEAL_INVALID_REQUEST' },
    });
    expect(s.query).not.toHaveBeenCalled();
  });
});
