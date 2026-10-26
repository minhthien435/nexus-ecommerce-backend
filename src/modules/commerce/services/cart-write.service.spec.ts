import { ServiceUnavailableException } from '@nestjs/common';
import { CartEntity } from '../domain/entities/cart.entity.js';
import { CartItemEntity } from '../domain/entities/cart-item.entity.js';
import { CartService } from './cart.service.js';
import { CartWriteService } from './cart-write.service.js';

const userId = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';
const skuId = 'BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB';
const now = new Date('2026-10-17T12:00:00Z');
const expiry = new Date('2026-10-24T12:00:00Z');

function setup() {
  const events: string[] = [];
  const state = { carts: [] as any[], items: [] as any[] };
  let failAt = '';
  let clock = now;
  let config: unknown = 7;
  let gate = Promise.resolve();
  const catalog = {
    getCartSkus: vi.fn().mockResolvedValue([
      {
        id: skuId.toLowerCase(),
        productId: 'product',
        sellerId: 'seller',
        productName: 'Original',
        productSlug: 'original',
        price: '100000.00',
        currency: 'VND',
        isActive: true,
        productStatus: 'ACTIVE',
        productDeletedAt: null,
      },
    ]),
  };
  const inventory = {
    getDefaultWarehouseStock: vi
      .fn()
      .mockResolvedValue([
        { skuId: skuId.toLowerCase(), availableQuantity: 2147483647 },
      ]),
  };
  const fault = (event: string) => {
    events.push(event);
    if (event === failAt) throw new Error(`fault:${event}`);
  };
  const source = {
    transaction: vi.fn(async (isolation: string, work: any) => {
      expect(isolation).toBe('READ COMMITTED');
      let release!: () => void;
      let before: typeof state | undefined;
      const previous = gate;
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const repository = (kind: 'carts' | 'items') => ({
        findOne: vi.fn(async (options: any) => {
          fault(`${kind}:read`);
          expect(options.lock).toEqual({ mode: 'pessimistic_write' });
          return (
            state[kind].find((row) =>
              Object.entries(options.where).every(
                ([key, value]) => row[key] === value,
              ),
            ) ?? null
          );
        }),
        find: vi.fn(async (options: any) => {
          fault('projection');
          return state.items.filter(
            (row) => row.cartId === options.where.cartId,
          );
        }),
        create: (input: any) => ({ ...input }),
        save: vi.fn(async (input: any) => {
          const row = {
            ...input,
            id: input.id ?? `${kind}-${state[kind].length}`,
          };
          state[kind].push(row);
          fault(`${kind}:insert`);
          return row;
        }),
        update: vi.fn(async (criteria: any, changes: any) => {
          const row = state[kind].find((entry) =>
            typeof criteria === 'string'
              ? entry.id === criteria
              : Object.entries(criteria).every(
                  ([key, value]) => entry[key] === value,
                ),
          );
          Object.assign(row, changes);
          fault(`${kind}:update`);
          return { affected: 1 };
        }),
        delete: vi.fn(async (id: string) => {
          state[kind] = state[kind].filter((row) => row.id !== id);
          fault(`${kind}:delete`);
          return { affected: 1 };
        }),
      });
      const carts = repository('carts');
      const items = repository('items');
      const manager = {
        getRepository: (entity: unknown) =>
          entity === CartEntity
            ? carts
            : entity === CartItemEntity
              ? items
              : (() => {
                  throw new Error('wrong entity');
                })(),
        query: vi.fn(async (sql: string, params?: unknown[]) => {
          if (sql.includes('pg_advisory_xact_lock')) {
            expect(params).toEqual([`commerce:cart:${userId.toLowerCase()}`]);
            await previous;
            before = structuredClone(state);
            fault('lock');
            return [];
          }
          expect(events).toContain('lock');
          if (sql.includes('clock_timestamp')) {
            fault('clock');
            return [{ observedTime: clock }];
          }
          if (sql.includes('commerce.service_configs')) {
            fault('config');
            return config === undefined ? [] : [{ value: config }];
          }
          throw new Error(`Unexpected SQL ${sql}`);
        }),
      };
      try {
        const result = await work(manager);
        fault('commit');
        return result;
      } catch (error) {
        if (before) Object.assign(state, before);
        events.push('rollback');
        throw error;
      } finally {
        release();
      }
    }),
  };
  const forbidden = new Proxy(
    {},
    {
      get: () => {
        throw new Error('default repository reached');
      },
    },
  );
  const reader = new CartService(
    forbidden as never,
    forbidden as never,
    catalog,
    inventory,
  );
  const service = new CartWriteService(
    source as never,
    reader,
    catalog,
    inventory,
  );
  return {
    state,
    events,
    source,
    catalog,
    inventory,
    service,
    fail: (at: string) => {
      failAt = at;
    },
    time: (at: Date) => {
      clock = at;
    },
    config: (value: unknown) => {
      config = value;
    },
    add: (quantity = 1) => service.addItem(userId, { skuId, quantity }),
    patch: (quantity: number) =>
      service.updateItem(userId, skuId, { quantity }),
    merge: (input = [{ skuId, quantity: 1 }]) =>
      service.mergeItems(userId, input),
  };
}

describe('CartWriteService guest merge (mock transaction orchestration)', () => {
  const otherId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  it('skips empty input before opening a transaction', async () => {
    const s = setup();
    expect(await s.merge([])).toEqual({
      status: 'skipped',
      accepted: [],
      skipped: [],
    });
    expect(s.source.transaction).not.toHaveBeenCalled();
  });
  it('normalizes duplicates, adds to the user line and preserves its snapshots and expiry', async () => {
    const s = setup();
    await s.add(2);
    const before = structuredClone(s.state);
    const current = (await s.catalog.getCartSkus())[0];
    s.catalog.getCartSkus.mockResolvedValue([
      { ...current, price: '25000.50', productName: 'Changed' },
    ]);
    s.catalog.getCartSkus.mockClear();
    s.inventory.getDefaultWarehouseStock.mockClear();
    s.events.length = 0;
    const result = await s.merge([
      { skuId, quantity: 1 },
      { skuId: skuId.toLowerCase(), quantity: 2 },
    ]);
    expect(result).toMatchObject({
      status: 'merged',
      accepted: [{ skuId: skuId.toLowerCase(), quantityAdded: 3, quantity: 5 }],
      skipped: [],
      cart: { expiresAt: expiry, subtotal: '125002.50' },
    });
    expect(s.state.carts).toEqual(before.carts);
    expect(s.state.items[0]).toEqual({ ...before.items[0], quantity: 5 });
    expect(s.events.slice(0, 3)).toEqual(['lock', 'clock', 'config']);
    const manager = s.catalog.getCartSkus.mock.calls[0][1];
    expect(manager).toBeDefined();
    for (const call of [
      ...s.catalog.getCartSkus.mock.calls,
      ...s.inventory.getDefaultWarehouseStock.mock.calls,
    ])
      expect(call[1]).toBe(manager);
    expect(s.catalog.getCartSkus).toHaveBeenCalledTimes(2);
    await s.merge([{ skuId, quantity: 3 }]);
    expect(s.state.items[0].quantity).toBe(8); // Successful replay is additive.
  });
  it.each([
    'missing',
    'sku',
    'product',
    'deleted',
    'identity',
    'stock',
    'overflow',
    'duplicates-overflow',
  ])('skips %s without changing the existing line', async (kind) => {
    const s = setup();
    await s.add(2);
    const before = structuredClone(s.state);
    const current = (await s.catalog.getCartSkus())[0];
    if (kind === 'missing') s.catalog.getCartSkus.mockResolvedValue([]);
    if (['sku', 'product', 'deleted', 'identity'].includes(kind))
      s.catalog.getCartSkus.mockResolvedValue([
        {
          ...current,
          ...(kind === 'sku'
            ? { isActive: false }
            : kind === 'product'
              ? { productStatus: 'DRAFT' }
              : kind === 'deleted'
                ? { productDeletedAt: now }
                : { productId: 'changed' }),
        },
      ]);
    if (kind === 'stock')
      s.inventory.getDefaultWarehouseStock.mockResolvedValue([
        { skuId: skuId.toLowerCase(), availableQuantity: 4 },
      ]);
    const overflow = kind.includes('overflow');
    const input =
      kind === 'duplicates-overflow'
        ? [
            { skuId, quantity: 2147483647 },
            { skuId, quantity: 2147483647 },
          ]
        : [{ skuId, quantity: overflow ? 2147483647 : 3 }];
    const result = await s.merge(input);
    expect(result).toEqual({
      status: 'skipped',
      accepted: [],
      skipped: [
        {
          skuId: skuId.toLowerCase(),
          reason:
            kind === 'missing'
              ? 'SKU_NOT_FOUND'
              : kind === 'stock'
                ? 'INSUFFICIENT_STOCK'
                : overflow
                  ? 'CART_QUANTITY_OVERFLOW'
                  : 'SKU_UNAVAILABLE',
        },
      ],
    });
    expect(s.state).toEqual(before);
  });
  it.each(['absent', 'expired'])(
    'creates no cart or expiry writes for all-skipped %s cart',
    async (kind) => {
      const s = setup();
      if (kind === 'expired') {
        await s.add();
        s.time(expiry);
      }
      const before = structuredClone(s.state);
      s.catalog.getCartSkus.mockResolvedValue([]);
      const result = await s.merge();
      expect(result.status).toBe('skipped');
      expect(s.state).toEqual(before);
    },
  );
  it('atomically accepts only eligible SKUs and takes new snapshots from Catalog', async () => {
    const s = setup();
    const current = (await s.catalog.getCartSkus())[0];
    s.catalog.getCartSkus.mockResolvedValue([
      current,
      { ...current, id: otherId, isActive: false },
    ]);
    s.inventory.getDefaultWarehouseStock.mockResolvedValue([
      { skuId: skuId.toLowerCase(), availableQuantity: 20 },
      { skuId: otherId, availableQuantity: 20 },
    ]);
    const result = await s.merge([
      { skuId, quantity: 2 },
      { skuId: otherId, quantity: 3 },
    ]);
    expect(result).toMatchObject({
      status: 'partial',
      accepted: [{ skuId: skuId.toLowerCase(), quantityAdded: 2, quantity: 2 }],
      skipped: [{ skuId: otherId, reason: 'SKU_UNAVAILABLE' }],
      cart: { expiresAt: expiry },
    });
    expect(s.state.items).toHaveLength(1);
    expect(s.state.items[0]).toMatchObject({
      sellerId: current.sellerId,
      productId: current.productId,
      productNameSnapshot: current.productName,
      unitPriceSnapshot: current.price,
    });
  });
  it('accepts the integer limit and checks final accumulated stock exactly', async () => {
    const s = setup();
    await s.add(2);
    s.inventory.getDefaultWarehouseStock.mockResolvedValue([
      { skuId: skuId.toLowerCase(), availableQuantity: 5 },
    ]);
    expect((await s.merge([{ skuId, quantity: 3 }])).status).toBe('merged');
    const limit = setup();
    const result = await limit.merge([{ skuId, quantity: 2147483647 }]);
    expect(result.accepted[0].quantity).toBe(2147483647);
    expect(result.cart?.subtotal).toBe('214748364700000.00');
  });
  it.each([undefined, null, '7', 0, 6, 8, NaN])(
    'fails invalid expiration config %s before writes',
    async (config) => {
      const s = setup();
      s.config(config);
      await expect(s.merge()).rejects.toMatchObject({ status: 503 });
      expect(s.state).toEqual({ carts: [], items: [] });
    },
  );
  it.each([
    'missing warehouse',
    'multiple warehouses',
    'catalog',
    'missing stock',
  ])('fails %s dependency errors without acceptance', async (kind) => {
    const s = setup();
    if (kind === 'catalog')
      s.catalog.getCartSkus.mockRejectedValue(new Error('dependency'));
    else if (kind === 'missing stock')
      s.inventory.getDefaultWarehouseStock.mockResolvedValue([]);
    else
      s.inventory.getDefaultWarehouseStock.mockRejectedValue(new Error(kind));
    await expect(s.merge()).rejects.toThrow();
    expect(s.state).toEqual({ carts: [], items: [] });
  });
  it.each([
    'lock',
    'clock',
    'config',
    'carts:read',
    'items:read',
    'carts:update',
    'carts:insert',
    'items:insert',
    'projection',
    'commit',
  ])(
    'rolls back all writes and overdue predecessor expiration after %s fault',
    async (at) => {
      const s = setup();
      await s.add();
      if (at !== 'items:read') s.time(expiry);
      const before = structuredClone(s.state);
      s.fail(at);
      await expect(s.merge()).rejects.toThrow(`fault:${at}`);
      expect(s.state).toEqual(before);
    },
  );
  it('rolls back an earlier accepted SKU after a later insert or projection failure', async () => {
    const s = setup();
    await s.add(2);
    const current = (await s.catalog.getCartSkus())[0];
    s.catalog.getCartSkus.mockResolvedValue([
      current,
      { ...current, id: otherId },
    ]);
    s.inventory.getDefaultWarehouseStock.mockResolvedValue([
      { skuId: skuId.toLowerCase(), availableQuantity: 20 },
      { skuId: otherId, availableQuantity: 20 },
    ]);
    const before = structuredClone(s.state);
    s.fail('items:insert');
    await expect(
      s.merge([
        { skuId, quantity: 3 },
        { skuId: otherId, quantity: 1 },
      ]),
    ).rejects.toThrow();
    expect(s.state).toEqual(before);
  });
  it.each(['stock', 'catalog', 'quantity', 'missing-line'])(
    'rolls back all accepted lines when projection changes %s',
    async (kind) => {
      const s = setup();
      await s.add(2);
      const before = structuredClone(s.state);
      if (kind === 'stock')
        s.inventory.getDefaultWarehouseStock
          .mockResolvedValueOnce([
            { skuId: skuId.toLowerCase(), availableQuantity: 5 },
          ])
          .mockResolvedValueOnce([
            { skuId: skuId.toLowerCase(), availableQuantity: 4 },
          ]);
      if (kind === 'catalog') {
        const current = (await s.catalog.getCartSkus())[0];
        s.catalog.getCartSkus
          .mockResolvedValueOnce([current])
          .mockResolvedValueOnce([{ ...current, isActive: false }]);
      }
      if (kind === 'quantity' || kind === 'missing-line') {
        const reader = s.service['reader'];
        const original = reader.projectCart.bind(reader);
        vi.spyOn(reader, 'projectCart').mockImplementationOnce(
          async (...args) => {
            const result = await original(...args);
            if (kind === 'quantity') result.items[0].quantity = 99;
            else result.items = [];
            return result;
          },
        );
      }
      await expect(s.merge([{ skuId, quantity: 3 }])).rejects.toMatchObject({
        status: 409,
      });
      expect(s.state).toEqual(before);
    },
  );
  it('serializes merge/add/update using the same mocked account lock', async () => {
    const s = setup();
    await Promise.all([
      s.merge([{ skuId, quantity: 2 }]),
      s.add(3),
      s.patch(4),
      s.merge([{ skuId, quantity: 5 }]),
    ]);
    expect(s.state.carts).toHaveLength(1);
    expect(s.state.items[0].quantity).toBe(9);
  });
  it('samples database time after a delayed merge lock resumes', async () => {
    const s = setup();
    await s.add(2);
    const current = (await s.catalog.getCartSkus())[0];
    let resume!: (value: any) => void;
    let entered!: () => void;
    const entry = new Promise<void>((resolve) => {
      entered = resolve;
    });
    s.catalog.getCartSkus.mockImplementationOnce(() => {
      entered();
      return new Promise((resolve) => {
        resume = resolve;
      });
    });
    const first = s.add();
    await entry;
    const waiting = s.merge([{ skuId, quantity: 3 }]);
    s.time(expiry);
    resume([current]);
    await first;
    const result = await waiting;
    expect(result.cart?.cartId).toBe('carts-1');
    expect(result.cart?.expiresAt).toEqual(new Date('2026-10-31T12:00:00Z'));
    expect(s.state.carts.map((cart) => cart.status)).toEqual([
      'EXPIRED',
      'ACTIVE',
    ]);
    expect(s.state.items.at(-1).quantity).toBe(3);
  });
  it.each(
    [
      null,
      {},
      [{ skuId: 'bad', quantity: 1 }],
      [{ skuId, quantity: 0 }],
      [{ skuId, quantity: '1' }],
      [{ skuId, quantity: 2147483648 }],
      Array.from({ length: 101 }, () => ({ skuId, quantity: 1 })),
    ].map((value) => [value]),
  )('defends the merge service boundary for %j', async (input) => {
    const s = setup();
    await expect(
      s.service.mergeItems(userId, input as never),
    ).rejects.toMatchObject({ status: 400 });
    expect(s.source.transaction).not.toHaveBeenCalled();
  });
  it('rejects malformed authenticated ownership before a transaction', async () => {
    const s = setup();
    await expect(
      s.service.mergeItems('forged', [{ skuId, quantity: 1 }]),
    ).rejects.toMatchObject({ status: 400 });
    expect(s.source.transaction).not.toHaveBeenCalled();
  });
});

describe('CartWriteService reserved rows', () => {
  async function reservedCart() {
    const s = setup();
    await s.add(1);
    Object.assign(s.state.items[0], {
      reservedOrderId: '11111111-1111-4111-8111-111111111111',
      reservationExpiresAt: new Date('2026-10-17T12:15:00Z'),
    });
    return s;
  }

  it.each([
    ['add-to-existing', (s: ReturnType<typeof setup>) => s.add(1)],
    ['merge', (s: ReturnType<typeof setup>) => s.merge()],
    ['update', (s: ReturnType<typeof setup>) => s.patch(2)],
    ['delete', (s: ReturnType<typeof setup>) => s.patch(0)],
  ])('rejects %s while preserving the reserved row', async (_name, action) => {
    const s = await reservedCart();
    const before = structuredClone(s.state.items);
    await expect(action(s)).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({ errorCode: 'CART_ITEM_RESERVED' }),
    });
    expect(s.state.items).toEqual(before);
  });
});

describe('CartWriteService transactional protocol (mock orchestration)', () => {
  it('locks the canonical account before reading, uses one manager, and expires exactly seven days after DB time', async () => {
    const s = setup();
    const result = await s.add();
    expect(s.events.indexOf('lock')).toBeLessThan(
      s.events.indexOf('carts:read'),
    );
    expect(s.events.indexOf('clock')).toBeLessThan(
      s.events.indexOf('carts:read'),
    );
    expect(s.source.transaction).toHaveBeenCalledTimes(1);
    expect(s.state.carts[0]).toMatchObject({
      userId: userId.toLowerCase(),
      status: 'ACTIVE',
      createdAt: now,
      expiresAt: expiry,
    });
    expect(s.state.items[0]).toMatchObject({
      skuId: skuId.toLowerCase(),
      productId: 'product',
      sellerId: 'seller',
      quantity: 1,
      unitPriceSnapshot: '100000.00',
    });
    expect(result).toMatchObject({ expiresAt: expiry, subtotal: '100000.00' });
    const manager = s.catalog.getCartSkus.mock.calls[0][1];
    expect(manager).toBeDefined();
    for (const call of [
      ...s.catalog.getCartSkus.mock.calls,
      ...s.inventory.getDefaultWarehouseStock.mock.calls,
    ])
      expect(call[1]).toBe(manager);
    expect(s.events.at(-1)).toBe('commit');
  });

  it('preserves first snapshots and expiry while projecting current prices with accumulated quantity', async () => {
    const s = setup();
    await s.add();
    const firstSku = (await s.catalog.getCartSkus.mock.results[0].value)[0];
    s.catalog.getCartSkus.mockResolvedValue([
      { ...firstSku, price: '120000.00', productName: 'Changed' },
    ]);
    s.time(new Date(now.getTime() + 10000));
    const result = await s.add();
    expect(s.state.carts).toHaveLength(1);
    expect(s.state.items).toHaveLength(1);
    expect(s.state.items[0]).toMatchObject({
      quantity: 2,
      unitPriceSnapshot: '100000.00',
      productNameSnapshot: 'Original',
    });
    expect(result).toMatchObject({
      expiresAt: expiry,
      subtotal: '240000.00',
      items: [
        expect.objectContaining({
          unitPrice: '120000.00',
          lineTotal: '240000.00',
          priceChanged: true,
        }),
      ],
    });
  });

  it('adds a different SKU as a distinct line while retaining the first snapshot and cart expiry', async () => {
    const s = setup();
    await s.add(2);
    const firstCart = structuredClone(s.state.carts[0]);
    const firstItem = structuredClone(s.state.items[0]);
    const firstSku = (await s.catalog.getCartSkus.mock.results[0].value)[0];
    const secondSku = {
      ...firstSku,
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      productId: 'second-product',
      sellerId: 'second-seller',
      productName: 'Second product',
      price: '25000.50',
    };
    const currentSkus = [{ ...firstSku, price: '120000.00' }, secondSku];
    s.catalog.getCartSkus.mockImplementation(async (ids: string[]) =>
      currentSkus.filter((sku) => ids.includes(sku.id)),
    );
    s.inventory.getDefaultWarehouseStock.mockImplementation(
      async (ids: string[]) =>
        ids.map((id) => ({ skuId: id, availableQuantity: 10 })),
    );
    s.time(new Date(now.getTime() + 60000));

    const result = await s.service.addItem(userId, {
      skuId: secondSku.id,
      quantity: 3,
    });

    expect(s.state.carts).toEqual([firstCart]);
    expect(s.state.items).toHaveLength(2);
    expect(s.state.items[0]).toEqual(firstItem);
    expect(s.state.items[1]).toMatchObject({
      skuId: secondSku.id,
      productId: secondSku.productId,
      sellerId: secondSku.sellerId,
      quantity: 3,
      unitPriceSnapshot: '25000.50',
    });
    expect(result).toMatchObject({
      cartId: firstCart.id,
      expiresAt: firstCart.expiresAt,
      subtotal: '315001.50',
      items: [
        expect.objectContaining({
          skuId: firstSku.id,
          quantity: 2,
          unitPriceSnapshot: '100000.00',
          unitPrice: '120000.00',
          lineTotal: '240000.00',
        }),
        expect.objectContaining({
          skuId: secondSku.id,
          quantity: 3,
          unitPriceSnapshot: '25000.50',
          unitPrice: '25000.50',
          lineTotal: '75001.50',
        }),
      ],
    });
  });

  it.each([4, 0])(
    'checks accumulated quantity against only returned default stock (%s)',
    async (stock) => {
      const s = setup();
      await s.add(2);
      s.inventory.getDefaultWarehouseStock.mockResolvedValue([
        { skuId: skuId.toLowerCase(), availableQuantity: stock },
      ]);
      await expect(s.add(3)).rejects.toMatchObject({ status: 409 });
      expect(s.state.items[0].quantity).toBe(2);
    },
  );
  it('accepts exact accumulated stock and integer limit, rejects overflow before writes', async () => {
    const s = setup();
    await s.add(2);
    s.inventory.getDefaultWarehouseStock.mockResolvedValue([
      { skuId: skuId.toLowerCase(), availableQuantity: 5 },
    ]);
    await s.add(3);
    expect(s.state.items[0].quantity).toBe(5);
    const limit = setup();
    await limit.add(2147483646);
    await limit.add();
    expect(limit.state.items[0].quantity).toBe(2147483647);
    await expect(limit.add()).rejects.toMatchObject({ status: 400 });
    expect(limit.state.items[0].quantity).toBe(2147483647);
  });
  it.each(['missing', 'sku', 'product', 'deleted'])(
    'rejects %s catalog eligibility without writes',
    async (kind) => {
      const s = setup();
      const current = (await s.catalog.getCartSkus())[0];
      s.catalog.getCartSkus.mockResolvedValue(
        kind === 'missing'
          ? []
          : [
              {
                ...current,
                ...(kind === 'sku'
                  ? { isActive: false }
                  : kind === 'product'
                    ? { productStatus: 'DRAFT' }
                    : { productDeletedAt: now }),
              },
            ],
      );
      await expect(s.add()).rejects.toMatchObject({
        status: kind === 'missing' ? 404 : 409,
      });
      expect(s.state).toEqual({ carts: [], items: [] });
    },
  );
  it.each([undefined, null, '7', 0, 6, 8, NaN])(
    'rejects conflicting expiration config %s without fallback',
    async (config) => {
      const s = setup();
      s.config(config);
      await expect(s.add()).rejects.toMatchObject({ status: 503 });
      expect(s.state).toEqual({ carts: [], items: [] });
    },
  );
  it('propagates warehouse configuration errors without creating a cart', async () => {
    const s = setup();
    s.inventory.getDefaultWarehouseStock.mockRejectedValue(
      new Error('warehouse configuration'),
    );
    await expect(s.add()).rejects.toThrow('warehouse configuration');
    expect(s.state).toEqual({ carts: [], items: [] });
  });
  it('expires and replaces an overdue cart only when the whole operation succeeds', async () => {
    const s = setup();
    await s.add();
    s.time(expiry);
    const result = await s.add(2);
    expect(s.state.carts.map((cart) => cart.status)).toEqual([
      'EXPIRED',
      'ACTIVE',
    ]);
    expect(result.cartId).toBe('carts-1');
    expect(result.expiresAt).toEqual(new Date('2026-10-31T12:00:00Z'));
  });
  it.each([
    'carts:update',
    'carts:insert',
    'items:insert',
    'projection',
    'commit',
  ])(
    'propagates %s failure and rolls back expiration/replacement',
    async (at) => {
      const s = setup();
      await s.add();
      s.time(expiry);
      const before = structuredClone(s.state);
      s.fail(at);
      await expect(s.add()).rejects.toThrow(`fault:${at}`);
      expect(s.state).toEqual(before);
      expect(s.events.at(-1)).toBe('rollback');
    },
  );
  it('rolls back a quantity update fault and rejects projection-time stock/eligibility changes', async () => {
    const s = setup();
    await s.add();
    s.fail('items:update');
    await expect(s.add()).rejects.toThrow('fault:items:update');
    expect(s.state.items[0].quantity).toBe(1);
    s.fail('');
    s.inventory.getDefaultWarehouseStock
      .mockResolvedValueOnce([
        { skuId: skuId.toLowerCase(), availableQuantity: 2 },
      ])
      .mockResolvedValueOnce([
        { skuId: skuId.toLowerCase(), availableQuantity: 1 },
      ]);
    await expect(s.add()).rejects.toMatchObject({ status: 409 });
    expect(s.state.items[0].quantity).toBe(1);
  });
  it('serializes competing first-cart and same-SKU calls in the mocked lock protocol without losing quantity', async () => {
    const s = setup();
    await Promise.all([s.add(2), s.add(3), s.add(4)]);
    expect(s.state.carts).toHaveLength(1);
    expect(s.state.items).toHaveLength(1);
    expect(s.state.items[0].quantity).toBe(9);
  });
  it('samples time after a blocked lock resumes across expiration', async () => {
    const s = setup();
    await s.add();
    const firstSku = (await s.catalog.getCartSkus.mock.results[0].value)[0];
    let resume!: (value: any) => void;
    let entered!: () => void;
    const entry = new Promise<void>((resolve) => {
      entered = resolve;
    });
    s.catalog.getCartSkus.mockImplementationOnce(() => {
      entered();
      return new Promise((resolve) => {
        resume = resolve;
      });
    });
    const first = s.add();
    await entry;
    const waiting = s.add(3);
    s.time(expiry);
    resume([firstSku]);
    await first;
    const result = await waiting;
    expect(result.cartId).toBe('carts-1');
    expect(result.items[0].quantity).toBe(3);
    expect(s.state.carts.map((cart) => cart.status)).toEqual([
      'EXPIRED',
      'ACTIVE',
    ]);
  });
  it('rolls back a competing failure before permitting the next addition', async () => {
    const s = setup();
    s.catalog.getCartSkus.mockRejectedValueOnce(new Error('catalog failed'));
    const [failed, succeeded] = await Promise.allSettled([s.add(2), s.add(3)]);
    expect(failed.status).toBe('rejected');
    expect(succeeded.status).toBe('fulfilled');
    expect(s.state.carts).toHaveLength(1);
    expect(s.state.items[0].quantity).toBe(3);
  });
  it('rejects missing stock and catalog eligibility changes during projection', async () => {
    const s = setup();
    s.inventory.getDefaultWarehouseStock.mockResolvedValue([]);
    await expect(s.add()).rejects.toMatchObject({ status: 503 });
    expect(s.state).toEqual({ carts: [], items: [] });
    const changed = setup();
    const firstSku = (await changed.catalog.getCartSkus())[0];
    changed.catalog.getCartSkus
      .mockResolvedValueOnce([firstSku])
      .mockResolvedValueOnce([{ ...firstSku, isActive: false }]);
    await expect(changed.add()).rejects.toMatchObject({ status: 409 });
    expect(changed.state).toEqual({ carts: [], items: [] });
  });
  it.each([0, 1.5, 2147483648])(
    'defends the service boundary against invalid quantity %s',
    async (quantity) => {
      const s = setup();
      await expect(s.add(quantity)).rejects.toMatchObject({ status: 400 });
      expect(s.source.transaction).not.toHaveBeenCalled();
    },
  );
});
describe('CartWriteService PATCH transactional protocol (mock orchestration)', () => {
  it('sets absolute quantities 3, 1, 1 and preserves snapshots, cart and expiry with current-price totals', async () => {
    const s = setup();
    await s.add(2);
    const before = structuredClone(s.state);
    const current = (await s.catalog.getCartSkus())[0];
    s.catalog.getCartSkus.mockResolvedValue([
      { ...current, price: '120000.00', productName: 'Changed' },
    ]);
    s.catalog.getCartSkus.mockClear();
    s.inventory.getDefaultWarehouseStock.mockClear();
    s.events.length = 0;
    s.config(undefined);
    const result = await s.patch(3);
    expect(result).toMatchObject({
      cartId: before.carts[0].id,
      expiresAt: expiry,
      subtotal: '360000.00',
      items: [
        expect.objectContaining({
          quantity: 3,
          unitPrice: '120000.00',
          unitPriceSnapshot: '100000.00',
          lineTotal: '360000.00',
        }),
      ],
    });
    expect(s.state.carts).toEqual(before.carts);
    expect(s.state.items[0]).toEqual({ ...before.items[0], quantity: 3 });
    expect(s.events).toEqual([
      'lock',
      'clock',
      'carts:read',
      'items:read',
      'items:update',
      'projection',
      'commit',
    ]);
    const manager = s.catalog.getCartSkus.mock.calls[0][1];
    expect(manager).toBeDefined();
    for (const call of [
      ...s.catalog.getCartSkus.mock.calls,
      ...s.inventory.getDefaultWarehouseStock.mock.calls,
    ])
      expect(call[1]).toBe(manager);
    await s.patch(1);
    await s.patch(1);
    expect(s.state.items[0].quantity).toBe(1);
    expect(s.catalog.getCartSkus).toHaveBeenCalledTimes(6);
    expect(s.inventory.getDefaultWarehouseStock).toHaveBeenCalledTimes(6);
  });

  it('compares stock to the absolute request, accepting exactly 3 and rejecting 2 without mutation', async () => {
    const s = setup();
    await s.add(2);
    s.inventory.getDefaultWarehouseStock.mockResolvedValue([
      { skuId: skuId.toLowerCase(), availableQuantity: 3 },
    ]);
    await s.patch(3);
    const before = structuredClone(s.state);
    s.inventory.getDefaultWarehouseStock.mockResolvedValue([
      { skuId: skuId.toLowerCase(), availableQuantity: 2 },
    ]);
    await expect(s.patch(3)).rejects.toMatchObject({ status: 409 });
    expect(s.state).toEqual(before);
  });

  it.each(['missing', 'sku', 'product', 'deleted', 'identity'])(
    'rejects positive and unchanged quantities when catalog is %s',
    async (kind) => {
      const s = setup();
      await s.add(2);
      const before = structuredClone(s.state);
      const current = (await s.catalog.getCartSkus())[0];
      s.catalog.getCartSkus.mockResolvedValue(
        kind === 'missing'
          ? []
          : [
              {
                ...current,
                ...(kind === 'sku'
                  ? { isActive: false }
                  : kind === 'product'
                    ? { productStatus: 'DRAFT' }
                    : kind === 'deleted'
                      ? { productDeletedAt: now }
                      : { productId: 'changed' }),
              },
            ],
      );
      await expect(s.patch(2)).rejects.toMatchObject({
        status: kind === 'missing' ? 404 : 409,
      });
      expect(s.state).toEqual(before);
    },
  );

  it.each(['missing', 'ambiguous'])(
    'propagates the %s default warehouse configuration error without writes',
    async () => {
      const s = setup();
      await s.add(2);
      const before = structuredClone(s.state);
      s.inventory.getDefaultWarehouseStock.mockRejectedValue(
        new ServiceUnavailableException({
          errorCode: 'DEFAULT_WAREHOUSE_NOT_CONFIGURED',
        }),
      );
      await expect(s.patch(3)).rejects.toMatchObject({
        status: 503,
        response: { errorCode: 'DEFAULT_WAREHOUSE_NOT_CONFIGURED' },
      });
      expect(s.state).toEqual(before);
    },
  );

  it.each(['eligible', 'discontinued', 'missing'])(
    'deletes the final %s line without target catalog or inventory reads and retains the cart',
    async (kind) => {
      const s = setup();
      await s.add(2);
      const before = structuredClone(s.state.carts);
      if (kind === 'missing') s.catalog.getCartSkus.mockResolvedValue([]);
      if (kind === 'discontinued')
        s.catalog.getCartSkus.mockResolvedValue([
          { ...(await s.catalog.getCartSkus())[0], isActive: false },
        ]);
      s.catalog.getCartSkus.mockClear();
      s.inventory.getDefaultWarehouseStock.mockClear();
      const result = await s.patch(0);
      expect(s.state.carts).toEqual(before);
      expect(s.state.items).toEqual([]);
      expect(result).toMatchObject({
        cartId: before[0].id,
        expiresAt: expiry,
        items: [],
        subtotal: '0.00',
      });
      expect(s.catalog.getCartSkus).not.toHaveBeenCalled();
      expect(s.inventory.getDefaultWarehouseStock).not.toHaveBeenCalled();
    },
  );

  it.each([
    'absent',
    'expired',
    'at-expiry',
    'inactive',
    'missing-line',
    'other-account',
    'other-cart-line',
  ])(
    'returns 404 for %s before target catalog/inventory validation or writes',
    async (kind) => {
      const s = setup();
      if (kind !== 'absent') await s.add(2);
      if (kind === 'expired') s.time(new Date(expiry.getTime() + 1));
      if (kind === 'at-expiry') s.time(expiry);
      if (kind === 'inactive') s.state.carts[0].status = 'EXPIRED';
      if (kind === 'missing-line') s.state.items = [];
      if (kind === 'other-account') s.state.carts[0].userId = 'other-account';
      if (kind === 'other-cart-line') s.state.items[0].cartId = 'other-cart';
      const before = structuredClone(s.state);
      s.catalog.getCartSkus.mockClear();
      s.inventory.getDefaultWarehouseStock.mockClear();
      for (const quantity of [0, 3])
        await expect(s.patch(quantity)).rejects.toMatchObject({ status: 404 });
      expect(s.state).toEqual(before);
      expect(s.catalog.getCartSkus).not.toHaveBeenCalled();
      expect(s.inventory.getDefaultWarehouseStock).not.toHaveBeenCalled();
    },
  );

  it.each([
    'lock',
    'clock',
    'carts:read',
    'items:read',
    'items:update',
    'projection',
    'commit',
  ])(
    'rejects %s faults and restores all state after positive updates',
    async (at) => {
      const s = setup();
      await s.add(2);
      const before = structuredClone(s.state);
      s.fail(at);
      await expect(s.patch(3)).rejects.toThrow(`fault:${at}`);
      expect(s.state).toEqual(before);
      expect(s.events.at(-1)).toBe('rollback');
    },
  );

  it.each(['items:delete', 'projection', 'commit'])(
    'rejects %s faults and restores deleted lines and cart state',
    async (at) => {
      const s = setup();
      await s.add(2);
      const before = structuredClone(s.state);
      s.fail(at);
      await expect(s.patch(0)).rejects.toThrow(`fault:${at}`);
      expect(s.state).toEqual(before);
    },
  );

  it('rolls back deletion if projection of a remaining line fails, without validating the removed SKU', async () => {
    const s = setup();
    await s.add(2);
    const otherSku = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    s.state.items.push({
      ...s.state.items[0],
      id: 'other-line',
      skuId: otherSku,
    });
    const before = structuredClone(s.state);
    s.catalog.getCartSkus.mockClear();
    s.inventory.getDefaultWarehouseStock.mockRejectedValue(
      new Error('remaining stock failed'),
    );
    await expect(s.patch(0)).rejects.toThrow('remaining stock failed');
    expect(s.catalog.getCartSkus).toHaveBeenCalledWith(
      [otherSku],
      expect.anything(),
    );
    expect(s.state).toEqual(before);
  });

  it.each(['stock', 'catalog', 'quantity', 'missing-line'])(
    'rolls back positive updates when projection changes %s',
    async (kind) => {
      const s = setup();
      await s.add(2);
      const before = structuredClone(s.state);
      if (kind === 'stock')
        s.inventory.getDefaultWarehouseStock
          .mockResolvedValueOnce([
            { skuId: skuId.toLowerCase(), availableQuantity: 3 },
          ])
          .mockResolvedValueOnce([
            { skuId: skuId.toLowerCase(), availableQuantity: 2 },
          ]);
      if (kind === 'catalog') {
        const current = (await s.catalog.getCartSkus())[0];
        s.catalog.getCartSkus
          .mockResolvedValueOnce([current])
          .mockResolvedValueOnce([{ ...current, isActive: false }]);
      }
      if (kind === 'quantity' || kind === 'missing-line') {
        const reader = s.service['reader'];
        const original = reader.projectCart.bind(reader);
        vi.spyOn(reader, 'projectCart').mockImplementationOnce(
          async (...args) => {
            const result = await original(...args);
            if (kind === 'quantity') result.items[0].quantity = 99;
            else result.items = [];
            return result;
          },
        );
      }
      await expect(s.patch(3)).rejects.toMatchObject({ status: 409 });
      expect(s.state).toEqual(before);
    },
  );

  it('rejects a missing stock result and accepts the integer maximum without changing inventory', async () => {
    const s = setup();
    await s.add(2);
    const before = structuredClone(s.state);
    s.inventory.getDefaultWarehouseStock.mockResolvedValueOnce([]);
    await expect(s.patch(3)).rejects.toMatchObject({ status: 503 });
    expect(s.state).toEqual(before);
    const result = await s.patch(2147483647);
    expect(result.items[0]).toMatchObject({
      quantity: 2147483647,
      availableQuantity: 2147483647,
      lineTotal: '214748364700000.00',
    });
  });

  it.each(['POST-PATCH', 'PATCH-POST'])(
    'serializes competing %s calls using the common account lock with absolute semantics',
    async (order) => {
      const s = setup();
      await s.add(2);
      const operations =
        order === 'POST-PATCH'
          ? [s.add(3), s.patch(4)]
          : [s.patch(4), s.add(3)];
      await Promise.all(operations);
      expect(s.state.items[0].quantity).toBe(order === 'POST-PATCH' ? 4 : 7);
      expect(s.state.carts).toHaveLength(1);
    },
  );

  it.each(['POST-PATCH', 'PATCH-POST'])(
    'rolls back a failing %s predecessor before allowing the waiting mutation',
    async (order) => {
      const s = setup();
      await s.add(2);
      s.catalog.getCartSkus.mockRejectedValueOnce(new Error('catalog failed'));
      const operations =
        order === 'POST-PATCH'
          ? [s.add(3), s.patch(4)]
          : [s.patch(4), s.add(3)];
      const [failed, succeeded] = await Promise.allSettled(operations);
      expect(failed.status).toBe('rejected');
      expect(succeeded.status).toBe('fulfilled');
      expect(s.state.items[0].quantity).toBe(order === 'POST-PATCH' ? 4 : 5);
      expect(s.state.carts).toHaveLength(1);
    },
  );

  it('observes expiry only after a blocked PATCH acquires the account lock', async () => {
    const s = setup();
    await s.add(2);
    const current = (await s.catalog.getCartSkus())[0];
    let resume!: (value: any) => void;
    let entered!: () => void;
    const entry = new Promise<void>((resolve) => {
      entered = resolve;
    });
    s.catalog.getCartSkus.mockImplementationOnce(() => {
      entered();
      return new Promise((resolve) => {
        resume = resolve;
      });
    });
    const first = s.add();
    await entry;
    const waiting = s.patch(4);
    const rejected = expect(waiting).rejects.toMatchObject({ status: 404 });
    s.time(expiry);
    resume([current]);
    await first;
    await rejected;
    expect(s.state.items[0].quantity).toBe(3);
    expect(s.state.carts[0]).toMatchObject({
      status: 'ACTIVE',
      expiresAt: expiry,
    });
  });

  it.each([-1, 1.5, 2147483648, NaN, '1', null, true])(
    'rejects invalid service quantity %s before a transaction',
    async (quantity) => {
      const s = setup();
      await expect(s.patch(quantity as number)).rejects.toMatchObject({
        status: 400,
      });
      expect(s.source.transaction).not.toHaveBeenCalled();
    },
  );

  it('rejects malformed account and SKU identities before a transaction', async () => {
    const s = setup();
    await expect(
      s.service.updateItem('bad', skuId, { quantity: 1 }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      s.service.updateItem(userId, 'bad', { quantity: 1 }),
    ).rejects.toMatchObject({ status: 400 });
    expect(s.source.transaction).not.toHaveBeenCalled();
  });
});
