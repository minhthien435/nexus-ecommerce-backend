import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OrderService } from './order.service.js';

const userId = '11111111-1111-4111-8111-111111111111';
const cartId = '22222222-2222-4222-8222-222222222222';
const seller1 = '33333333-3333-4333-8333-333333333333';
const seller2 = '44444444-4444-4444-8444-444444444444';
const addressId = '55555555-5555-4555-8555-555555555555';

function setup() {
  const cartRepo = {
    findOne: vi.fn().mockResolvedValue({
      id: cartId,
      userId,
      status: 'ACTIVE',
    }),
  };

  const cartItemRepo = {
    find: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue({ affected: 1 }),
  };

  const checkoutSessionRepo = {
    findOne: vi.fn(),
    save: vi.fn(),
  };

  const checkoutSessionQueryBuilder = {
    setLock: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    getOne: vi.fn().mockResolvedValue({
      id: 'session-1',
      status: 'INITIATED',
      paymentMethod: 'STRIPE',
    }),
  };

  const transactionCheckoutSessionRepo = {
    createQueryBuilder: vi.fn().mockReturnValue(checkoutSessionQueryBuilder),
    update: vi.fn().mockImplementation((...args) => manager.update(...args)),
  };

  const orderRepo = {
    findOne: vi.fn().mockResolvedValue({
      id: 'order-1',
      buyerId: userId,
      status: 'PENDING_PAYMENT',
      checkoutSessionId: 'session-1',
    }),
    save: vi.fn(),
    createQueryBuilder: vi.fn(() => ({
      setLock: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      getOne: vi.fn().mockResolvedValue({
        id: 'order-1',
        buyerId: userId,
        status: 'PENDING_PAYMENT',
        checkoutSessionId: 'session-1',
      }),
      getMany: vi.fn().mockResolvedValue([
        {
          id: 'order-1',
          buyerId: userId,
          status: 'PENDING_PAYMENT',
          checkoutSessionId: 'session-1',
        },
      ]),
    })),
  };

  const orderItemRepo = {
    find: vi.fn(),
    save: vi.fn(),
  };

  const orderHistoryRepo = {
    find: vi.fn().mockResolvedValue([]),
  };

  const addressRepo = {
    findOne: vi.fn().mockResolvedValue({
      id: addressId,
      userId,
      recipientName: 'Nguyen Van A',
      recipientPhone: '0901234567',
      addressLine: '123 Nguyen Hue',
      provinceCode: '79',
      districtCode: '760',
      wardCode: '26734',
      isDefault: true,
    }),
  };

  const catalogApi = {
    getCartSkus: vi.fn().mockResolvedValue([]),
  };

  const orderStateMachine = {
    transition: vi.fn(),
  };

  const inventoryReservation = {
    release: vi.fn(),
    reserve: vi.fn().mockImplementation(async (items) =>
      items.map((item: { skuId: string; quantity: number }) => ({
        ...item,
        warehouseId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      })),
    ),
  };

  const expiryOutbox = {
    schedule: vi.fn().mockResolvedValue(undefined),
    reconcile: vi.fn().mockResolvedValue(undefined),
  };

  const manager = {
    create: vi.fn((_entityClass, data) => ({
      id: 'mock-id-' + Math.random(),
      ...data,
    })),
    save: vi.fn(async (_entityClassOrData, data) => data || _entityClassOrData),
    delete: vi.fn().mockResolvedValue({ affected: 1 }),
    update: vi.fn().mockResolvedValue({ affected: 1 }),
    getRepository: vi.fn((entity) => {
      if (entity.name === 'CartItemEntity')
        return {
          ...cartItemRepo,
          update: manager.update,
          createQueryBuilder: vi.fn(() => ({
            setLock: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            andWhere: vi.fn().mockReturnThis(),
            orderBy: vi.fn().mockReturnThis(),
            addOrderBy: vi.fn().mockReturnThis(),
            getMany: vi.fn(() => cartItemRepo.find()),
          })),
        };
      if (entity.name === 'OrderEntity') return orderRepo;
      if (entity.name === 'OrderItemEntity') return orderItemRepo;
      if (entity.name === 'OrderStatusHistoryEntity') return orderHistoryRepo;
      if (entity.name === 'CheckoutSessionEntity')
        return transactionCheckoutSessionRepo;
      throw new Error(`Unexpected repository: ${entity.name}`);
    }),
  };

  const dataSource = {
    transaction: vi.fn(
      async (
        isolationOrCallback: string | ((value: typeof manager) => unknown),
        callback?: (value: typeof manager) => unknown,
      ) =>
        typeof isolationOrCallback === 'function'
          ? isolationOrCallback(manager)
          : callback!(manager),
    ),
  };

  const service = new OrderService(
    dataSource as never,
    cartRepo as never,
    cartItemRepo as never,
    checkoutSessionRepo as never,
    orderRepo as never,
    orderItemRepo as never,
    orderHistoryRepo as never,
    addressRepo as never,
    catalogApi as never,
    orderStateMachine as never,
    inventoryReservation as never,
    expiryOutbox as never,
  );

  return {
    cartRepo,
    cartItemRepo,
    checkoutSessionRepo,
    checkoutSessionQueryBuilder,
    transactionCheckoutSessionRepo,
    orderRepo,
    orderItemRepo,
    orderHistoryRepo,
    addressRepo,
    catalogApi,
    orderStateMachine,
    inventoryReservation,
    expiryOutbox,
    manager,
    dataSource,
    service,
  };
}

describe('OrderService - Checkout Flow (NEX-301.1)', () => {
  it('throws BadRequestException if user has no active cart', async () => {
    const s = setup();
    s.cartRepo.findOne.mockResolvedValue(null);

    await expect(s.service.checkout(userId, {})).rejects.toThrow(
      BadRequestException,
    );
  });

  it('throws BadRequestException if cart has no items', async () => {
    const s = setup();
    s.cartItemRepo.find.mockResolvedValue([]);

    await expect(s.service.checkout(userId, {})).rejects.toThrow(
      BadRequestException,
    );
  });

  it('throws BadRequestException if any selected item is inactive or discontinued', async () => {
    const s = setup();
    s.cartItemRepo.find.mockResolvedValue([
      {
        id: 'item-1',
        cartId,
        skuId: 'sku-1',
        quantity: 2,
        productNameSnapshot: 'Test Item',
      },
    ]);
    s.catalogApi.getCartSkus.mockResolvedValue([
      {
        id: 'sku-1',
        isActive: false, // Inactive!
        productStatus: 'ACTIVE',
        productDeletedAt: null,
        productName: 'Test Item',
      },
    ]);

    await expect(s.service.checkout(userId, {})).rejects.toThrow(
      BadRequestException,
    );
  });

  it('successfully creates checkout session and splits orders per seller', async () => {
    const s = setup();

    // 2 items from seller 1, 1 item from seller 2
    s.cartItemRepo.find.mockResolvedValue([
      { id: 'item-1', cartId, skuId: 'sku-1', quantity: 2 },
      { id: 'item-2', cartId, skuId: 'sku-2', quantity: 1 },
      { id: 'item-3', cartId, skuId: 'sku-3', quantity: 3 },
    ]);

    s.catalogApi.getCartSkus.mockResolvedValue([
      {
        id: 'sku-1',
        productId: 'prod-1',
        sellerId: seller1,
        skuCode: 'SKU-1',
        variantAttributes: { color: 'Blue' },
        price: '100000.00',
        currency: 'VND',
        isActive: true,
        productName: 'Product 1',
        productSlug: 'product-1',
        productStatus: 'ACTIVE',
        productDeletedAt: null,
      },
      {
        id: 'sku-2',
        productId: 'prod-1',
        sellerId: seller1,
        skuCode: 'SKU-2',
        variantAttributes: { color: 'Red' },
        price: '150000.00',
        currency: 'VND',
        isActive: true,
        productName: 'Product 1',
        productSlug: 'product-1',
        productStatus: 'ACTIVE',
        productDeletedAt: null,
      },
      {
        id: 'sku-3',
        productId: 'prod-2',
        sellerId: seller2,
        skuCode: 'SKU-3',
        variantAttributes: { size: 'XL' },
        price: '200000.00',
        currency: 'VND',
        isActive: true,
        productName: 'Product 2',
        productSlug: 'product-2',
        productStatus: 'ACTIVE',
        productDeletedAt: null,
      },
    ]);

    const result = await s.service.checkout(userId, {
      paymentMethod: 'STRIPE',
    });

    // Check checkout session totals:
    // Seller 1: 2 * 100,000 + 1 * 150,000 = 350,000
    // Seller 2: 3 * 200,000 = 600,000
    // Total: 950,000.00
    expect(result.totalAmount).toBe('950000.00');
    expect(result.orders).toHaveLength(2);

    const orderSeller1 = result.orders.find((o) => o.sellerId === seller1);
    const orderSeller2 = result.orders.find((o) => o.sellerId === seller2);

    expect(orderSeller1).toBeDefined();
    expect(orderSeller1!.total).toBe('350000.00');
    expect(orderSeller1!.status).toBe('PENDING_PAYMENT');

    expect(orderSeller2).toBeDefined();
    expect(orderSeller2!.total).toBe('600000.00');
    expect(orderSeller2!.status).toBe('PENDING_PAYMENT');

    // Stripe rows remain in the cart and are mapped to their exact seller order.
    expect(s.manager.delete).not.toHaveBeenCalled();
    expect(s.manager.update).toHaveBeenCalledTimes(2);
    expect(s.inventoryReservation.reserve).toHaveBeenCalledOnce();
    expect(s.expiryOutbox.schedule).toHaveBeenCalledTimes(2);
    expect(s.expiryOutbox.reconcile).toHaveBeenCalledOnce();
    expect(s.manager.create).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        skuId: 'sku-1',
        warehouseId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      }),
    );
  });

  it('does not create checkout data or clear the cart when reservation fails', async () => {
    const s = setup();
    s.cartItemRepo.find.mockResolvedValue([
      { id: 'item-1', cartId, skuId: 'sku-1', quantity: 2 },
    ]);
    s.catalogApi.getCartSkus.mockResolvedValue([
      {
        id: 'sku-1',
        productId: 'prod-1',
        sellerId: seller1,
        price: '100000.00',
        isActive: true,
        productName: 'Product 1',
        productStatus: 'ACTIVE',
        productDeletedAt: null,
      },
    ]);
    s.inventoryReservation.reserve.mockRejectedValue(
      new BadRequestException('insufficient stock'),
    );

    await expect(s.service.checkout(userId, {})).rejects.toThrow(
      BadRequestException,
    );
    expect(s.manager.save).not.toHaveBeenCalled();
    expect(s.manager.delete).not.toHaveBeenCalled();
    expect(s.expiryOutbox.schedule).not.toHaveBeenCalled();
    expect(s.expiryOutbox.reconcile).not.toHaveBeenCalled();
  });

  it('rejects a selected row that already has a reservation marker', async () => {
    const s = setup();
    s.cartItemRepo.find.mockResolvedValue([
      {
        id: 'item-1',
        cartId,
        skuId: 'sku-1',
        quantity: 1,
        reservedOrderId: 'existing-order',
      },
    ]);
    s.catalogApi.getCartSkus.mockResolvedValue([
      {
        id: 'sku-1',
        productId: 'prod-1',
        sellerId: seller1,
        price: '100000.00',
        isActive: true,
        productName: 'Product 1',
        productStatus: 'ACTIVE',
        productDeletedAt: null,
      },
    ]);

    await expect(s.service.checkout(userId, {})).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({ errorCode: 'CART_ITEM_RESERVED' }),
    });
    expect(s.inventoryReservation.reserve).not.toHaveBeenCalled();
  });

  it('deletes selected COD rows only after their orders are persisted', async () => {
    const s = setup();
    s.cartItemRepo.find.mockResolvedValue([
      { id: 'item-1', cartId, skuId: 'sku-1', quantity: 1 },
    ]);
    s.catalogApi.getCartSkus.mockResolvedValue([
      {
        id: 'sku-1',
        productId: 'prod-1',
        sellerId: seller1,
        price: '100000.00',
        isActive: true,
        productName: 'Product 1',
        productStatus: 'ACTIVE',
        productDeletedAt: null,
      },
    ]);

    await s.service.checkout(userId, {
      paymentMethod: 'COD',
      selectedCartItemIds: ['item-1'],
    });

    expect(s.manager.delete).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ id: expect.any(Object) }),
    );
    expect(s.manager.update).not.toHaveBeenCalled();
  });

  it('allows at most one of two racing checkouts to reserve the same row', async () => {
    const s = setup();
    const row = {
      id: 'item-1',
      cartId,
      skuId: 'sku-1',
      quantity: 1,
      reservedOrderId: null as string | null,
    };
    s.cartItemRepo.find.mockResolvedValue([row]);
    s.catalogApi.getCartSkus.mockResolvedValue([
      {
        id: 'sku-1',
        productId: 'prod-1',
        sellerId: seller1,
        price: '100000.00',
        isActive: true,
        productName: 'Product 1',
        productStatus: 'ACTIVE',
        productDeletedAt: null,
      },
    ]);
    let gate = Promise.resolve();
    s.dataSource.transaction.mockImplementation(async (work, callback) => {
      const previous = gate;
      let release!: () => void;
      gate = new Promise<void>((resolve) => (release = resolve));
      await previous;
      try {
        const operation = typeof work === 'function' ? work : callback!;
        return await operation(s.manager);
      } finally {
        release();
      }
    });
    s.manager.update.mockImplementation(async (...args: unknown[]) => {
      const changes = args.at(-1) as { reservedOrderId?: string };
      if (changes.reservedOrderId)
        row.reservedOrderId = changes.reservedOrderId;
      return { affected: 1 };
    });

    const results = await Promise.allSettled([
      s.service.checkout(userId, {}),
      s.service.checkout(userId, {}),
    ]);

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    expect(s.inventoryReservation.reserve).toHaveBeenCalledOnce();
  });

  it('returns after commit without waiting for outbox reconciliation', async () => {
    const s = setup();
    s.cartItemRepo.find.mockResolvedValue([
      { id: 'item-1', cartId, skuId: 'sku-1', quantity: 1 },
    ]);
    s.catalogApi.getCartSkus.mockResolvedValue([
      {
        id: 'sku-1',
        productId: 'prod-1',
        sellerId: seller1,
        price: '100000.00',
        isActive: true,
        productName: 'Product 1',
        productStatus: 'ACTIVE',
        productDeletedAt: null,
      },
    ]);
    s.expiryOutbox.reconcile.mockReturnValue(new Promise(() => undefined));

    await expect(s.service.checkout(userId, {})).resolves.toMatchObject({
      orders: expect.any(Array),
    });
    expect(s.expiryOutbox.reconcile).toHaveBeenCalledOnce();
  });

  it('getBuyerOrders returns paginated results with Envelope meta', async () => {
    const s = setup();
    const qb = {
      leftJoinAndSelect: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      take: vi.fn().mockReturnThis(),
      getManyAndCount: vi
        .fn()
        .mockResolvedValue([[{ id: 'order-1', total: '100000.00' }], 1]),
    };
    s.orderRepo.createQueryBuilder.mockReturnValue(qb as never);

    const result = await s.service.getBuyerOrders(userId, {
      page: 1,
      limit: 10,
    });
    expect(result.data).toHaveLength(1);
    expect(result.meta).toEqual({
      page: 1,
      limit: 10,
      totalItems: 1,
      totalPages: 1,
    });
  });

  it('getOrderById returns order detail or throws NotFoundException', async () => {
    const s = setup();
    s.orderRepo.findOne.mockResolvedValueOnce({
      id: 'order-1',
      buyerId: userId,
    });

    const order = await s.service.getOrderById(userId, 'order-1');
    expect(order.id).toBe('order-1');
    expect(order.history).toEqual([]);
    expect(s.orderHistoryRepo.find).toHaveBeenCalledWith({
      where: { orderId: 'order-1' },
      order: { createdAt: 'ASC', id: 'ASC' },
    });

    s.orderRepo.findOne.mockResolvedValueOnce(null);
    await expect(
      s.service.getOrderById(userId, 'order-not-found'),
    ).rejects.toThrow(NotFoundException);
  });

  it('cancels an owned pending order and releases its persisted items in one transaction', async () => {
    const s = setup();
    const persistedItems = [
      {
        skuId: 'sku-1',
        quantity: 2,
        warehouseId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
    ];
    s.orderItemRepo.find.mockResolvedValue(persistedItems);
    s.orderRepo.findOne
      .mockResolvedValueOnce({
        id: 'order-1',
        buyerId: userId,
        status: 'PENDING_PAYMENT',
        checkoutSessionId: 'session-1',
      })
      .mockResolvedValueOnce({
        id: 'order-1',
        buyerId: userId,
        status: 'CANCELLED',
      });

    await expect(
      s.service.cancelOrder(userId, 'order-1'),
    ).resolves.toMatchObject({
      id: 'order-1',
      status: 'CANCELLED',
      history: [],
    });
    expect(s.orderStateMachine.transition).toHaveBeenCalledWith(s.manager, {
      orderId: 'order-1',
      toStatus: 'CANCELLED',
      actorId: userId,
      expectedBuyerId: userId,
      reason: 'CHECKOUT_CANCELLED_BY_BUYER',
    });
    expect(s.inventoryReservation.release).toHaveBeenCalledWith(
      persistedItems,
      s.manager,
    );
    expect(s.checkoutSessionQueryBuilder.setLock).toHaveBeenCalledWith(
      'pessimistic_write',
    );
    expect(s.orderRepo.createQueryBuilder).toHaveBeenCalledOnce();
  });

  it.each([
    ['COD', 'INITIATED'],
    ['STRIPE', 'COMPLETED'],
    ['STRIPE', 'CANCELLED'],
  ])(
    'rejects a %s session in %s before locking sibling orders',
    async (paymentMethod, status) => {
      const s = setup();
      s.checkoutSessionQueryBuilder.getOne.mockResolvedValue({
        id: 'session-1',
        paymentMethod,
        status,
      });

      await expect(
        s.service.cancelOrder(userId, 'order-1'),
      ).rejects.toMatchObject({
        status: 409,
        response: expect.objectContaining({
          errorCode: 'CHECKOUT_SESSION_NOT_CANCELLABLE',
        }),
      });
      expect(s.checkoutSessionQueryBuilder.setLock).toHaveBeenCalledWith(
        'pessimistic_write',
      );
      expect(s.orderRepo.createQueryBuilder).not.toHaveBeenCalled();
      expect(s.inventoryReservation.release).not.toHaveBeenCalled();
    },
  );

  it('cancels every pending seller sibling without releasing terminal or unrelated orders', async () => {
    const s = setup();
    const pendingA = {
      id: 'order-a',
      buyerId: userId,
      status: 'PENDING_PAYMENT',
      checkoutSessionId: 'session-1',
    };
    const pendingB = { ...pendingA, id: 'order-b' };
    const terminal = { ...pendingA, id: 'order-paid', status: 'PAID' };
    const unrelated = {
      ...pendingA,
      id: 'order-other',
      checkoutSessionId: 'session-2',
    };
    const siblingQb = {
      setLock: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([pendingB, terminal, pendingA]),
    };
    s.orderRepo.createQueryBuilder.mockReturnValueOnce(siblingQb as never);
    s.orderItemRepo.find.mockImplementation(({ where }) =>
      Promise.resolve([
        {
          skuId: `sku-${where.orderId}`,
          quantity: 1,
          warehouseId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        },
      ]),
    );
    s.orderRepo.findOne
      .mockResolvedValueOnce(pendingA)
      .mockResolvedValueOnce({ ...pendingA, status: 'CANCELLED' });

    await s.service.cancelOrder(userId, pendingA.id);

    expect(
      s.orderStateMachine.transition.mock.calls.map((call) => call[1].orderId),
    ).toEqual(['order-b', 'order-a']);
    expect(
      s.inventoryReservation.release.mock.calls.map((call) => call[0][0].skuId),
    ).toEqual(['sku-order-b', 'sku-order-a']);
    expect(s.orderItemRepo.find).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { orderId: terminal.id } }),
    );
    expect(s.orderItemRepo.find).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { orderId: unrelated.id } }),
    );
    expect(s.manager.update).toHaveBeenCalledWith(
      expect.objectContaining({ reservedOrderId: expect.any(Object) }),
      { reservedOrderId: null, reservationExpiresAt: null },
    );
    expect(s.manager.update).toHaveBeenCalledWith(
      { id: 'session-1' },
      { status: 'CANCELLED' },
    );
  });

  it('rejects repeat cancellation when the session has no pending siblings', async () => {
    const s = setup();
    const chosen = {
      id: 'order-1',
      buyerId: userId,
      status: 'CANCELLED',
      checkoutSessionId: 'session-1',
    };
    const siblingQb = {
      setLock: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([chosen]),
    };
    s.orderRepo.findOne.mockResolvedValueOnce(chosen);
    s.orderRepo.createQueryBuilder.mockReturnValueOnce(siblingQb as never);

    await expect(
      s.service.cancelOrder(userId, chosen.id),
    ).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({
        errorCode: 'ORDER_TRANSITION_NOT_ALLOWED',
      }),
    });
    expect(s.inventoryReservation.release).not.toHaveBeenCalled();
    expect(s.manager.update).not.toHaveBeenCalled();
  });

  it('propagates release failures so the transaction can roll back', async () => {
    const s = setup();
    s.orderItemRepo.find.mockResolvedValue([
      {
        skuId: 'sku-1',
        quantity: 1,
        warehouseId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
    ]);
    s.inventoryReservation.release.mockRejectedValue(
      new Error('release failed'),
    );

    await expect(s.service.cancelOrder(userId, 'order-1')).rejects.toThrow(
      'release failed',
    );
    expect(s.orderRepo.findOne).toHaveBeenCalledWith({
      where: { id: 'order-1', buyerId: userId },
    });
  });

  it('rejects missing warehouse receipts without calling release', async () => {
    const s = setup();
    s.orderItemRepo.find.mockResolvedValue([
      {
        skuId: 'sku-1',
        quantity: 1,
        warehouseId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
      { skuId: 'sku-2', quantity: 2, warehouseId: null },
    ]);
    await expect(
      s.service.cancelOrder(userId, 'order-1'),
    ).rejects.toMatchObject({
      status: 503,
      response: expect.objectContaining({
        errorCode: 'ORDER_INVENTORY_RECEIPT_MISSING',
      }),
    });
    expect(s.inventoryReservation.release).not.toHaveBeenCalled();
    expect(s.orderRepo.findOne).toHaveBeenCalledOnce();
  });
});
