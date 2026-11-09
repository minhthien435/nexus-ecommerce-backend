import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { OrderService } from './order.service.js';
import { QuerySellerOrdersDto } from '../dtos/query-seller-orders.dto.js';
import { PaymentsService } from './payments.service.js';
import { ConfigService } from '@nestjs/config';

const userId = '11111111-1111-4111-8111-111111111111';
const cartId = '22222222-2222-4222-8222-222222222222';
const seller1 = '33333333-3333-4333-8333-333333333333';
const seller2 = '44444444-4444-4444-8444-444444444444';
const addressId = '55555555-5555-4555-8555-555555555555';

function candidateQueryBuilder(orderIds: string[] = []) {
  return {
    innerJoin: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    getRawMany: vi
      .fn()
      .mockResolvedValue(orderIds.map((orderId) => ({ orderId }))),
  };
}

function setup(ghn?: { createNewAddressOrder: ReturnType<typeof vi.fn> }) {
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
      paymentMethod: 'PAYOS',
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
      addressScheme: 'ghn_v3',
      provinceName: 'Hồ Chí Minh',
      wardName: 'Ward',
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
    expire: vi.fn().mockResolvedValue({ outcome: 'SKIPPED' }),
    finalizeExpiry: vi.fn().mockResolvedValue(undefined),
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
      if (entity.name === 'CartEntity') return cartRepo;
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
      if (entity.name === 'UserAddressEntity') return addressRepo;
      if (entity.name === 'OrderItemEntity') return orderItemRepo;
      if (entity.name === 'OrderStatusHistoryEntity') return orderHistoryRepo;
      if (entity.name === 'CheckoutSessionEntity')
        return transactionCheckoutSessionRepo;
      if (entity.name === 'PaymentEntity')
        return { find: vi.fn().mockResolvedValue([]) };
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

  const shippingQuotes = {
    quoteNewAddress: vi.fn().mockResolvedValue({ fee: 30000 }),
  };
  const inventoryRead = {
    getDefaultWarehouseStock: vi.fn(async (ids: string[]) =>
      ids.map((skuId) => ({ skuId, availableQuantity: 100 })),
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
    undefined,
    ghn as never,
    shippingQuotes as never,
    inventoryRead as never,
  );

  return {
    shippingQuotes,
    inventoryRead,
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
  it('locks the seller order and leaves it unshipped when GHN fails', async () => {
    const ghn = {
      createNewAddressOrder: vi
        .fn()
        .mockRejectedValue(new Error('GHN unavailable')),
    };
    const s = setup(ghn);
    s.orderRepo.findOne.mockResolvedValue({
      id: 'order-1',
      sellerId: seller1,
      status: 'PROCESSING',
      shippingAddressSnapshot: {
        addressScheme: 'ghn_v3',
        recipientName: 'Buyer',
        recipientPhone: '0901234567',
        addressLine: 'Street',
        provinceName: 'Hà Nội',
        wardName: 'Ward',
      },
    } as never);
    s.orderItemRepo.find.mockResolvedValue([
      {
        skuId: 'sku-1',
        quantity: 2,
        productNameSnapshot: 'Product',
        weightGramsSnapshot: 250,
      },
    ] as never);
    s.catalogApi.getCartSkus.mockResolvedValue([
      { id: 'sku-1', weightGrams: 250 },
    ] as never);
    await expect(
      s.service.shipSellerOrderWithGhn(seller1, 'order-1'),
    ).rejects.toThrow('GHN unavailable');
    expect(s.orderRepo.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'order-1', sellerId: seller1 },
        lock: { mode: 'pessimistic_write' },
      }),
    );
    expect(ghn.createNewAddressOrder).toHaveBeenCalledWith(
      expect.objectContaining({ clientOrderCode: 'order-1', weightGrams: 500 }),
    );
    expect(s.orderStateMachine.transition).not.toHaveBeenCalled();
    expect(s.orderRepo.save).not.toHaveBeenCalled();
    expect(s.catalogApi.getCartSkus).not.toHaveBeenCalled();
  });

  it('rejects shipment of historical items without a weight snapshot', async () => {
    const ghn = { createNewAddressOrder: vi.fn() };
    const s = setup(ghn);
    s.orderRepo.findOne.mockResolvedValue({
      id: 'order-1',
      sellerId: seller1,
      status: 'PROCESSING',
      shippingAddressSnapshot: {
        addressScheme: 'ghn_v3',
        recipientName: 'Buyer',
        recipientPhone: '0901234567',
        addressLine: 'Street',
        provinceName: 'Hà Nội',
        wardName: 'Ward',
      },
    } as never);
    s.orderItemRepo.find.mockResolvedValue([
      {
        skuId: 'sku-1',
        quantity: 1,
        productNameSnapshot: 'Product',
        weightGramsSnapshot: null,
      },
    ] as never);
    await expect(
      s.service.shipSellerOrderWithGhn(seller1, 'order-1'),
    ).rejects.toThrow('weight snapshot');
    expect(ghn.createNewAddressOrder).not.toHaveBeenCalled();
  });
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

  it('rejects checkout when the buyer owns a selected product', async () => {
    const s = setup();
    s.cartItemRepo.find.mockResolvedValue([
      { id: 'item-1', cartId, skuId: 'sku-1', quantity: 1 },
    ]);
    s.catalogApi.getCartSkus.mockResolvedValue([
      {
        id: 'sku-1',
        sellerId: userId,
        isActive: true,
        productStatus: 'ACTIVE',
        productDeletedAt: null,
        productName: 'Own product',
      },
    ]);

    await expect(s.service.checkout(userId, {})).rejects.toMatchObject({
      status: 403,
      response: { errorCode: 'CANNOT_BUY_OWN_PRODUCT' },
    });
    expect(s.dataSource.transaction).not.toHaveBeenCalled();
  });

  it('successfully creates checkout session and splits orders per seller', async () => {
    const s = setup();

    s.shippingQuotes.quoteNewAddress
      .mockResolvedValueOnce({ fee: 30000 })
      .mockResolvedValueOnce({ fee: 40000 })
      .mockResolvedValueOnce({ fee: 30000 })
      .mockResolvedValueOnce({ fee: 40000 });
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
        weightGrams: 250,
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
        weightGrams: 250,
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
        weightGrams: 250,
        price: '200000.00',
        currency: 'VND',
        isActive: true,
        productName: 'Product 2',
        productSlug: 'product-2',
        productStatus: 'ACTIVE',
        productDeletedAt: null,
      },
    ]);

    const quote = await s.service.quoteCart(userId, {
      addressId,
      selectedCartItemIds: ['item-1', 'item-2', 'item-3'],
    });
    expect(quote.totalFee).toBe(70000);
    expect(quote.sellers).toEqual([
      { sellerId: seller1, weightGrams: 750, fee: 30000 },
      { sellerId: seller2, weightGrams: 750, fee: 40000 },
    ]);
    s.shippingQuotes.quoteNewAddress.mockClear();
    const result = await s.service.checkout(userId, {
      paymentMethod: 'PAYOS',
    });

    // Check checkout session totals:
    // Seller 1: 2 * 100,000 + 1 * 150,000 = 350,000
    // Seller 2: 3 * 200,000 = 600,000
    // Total: 950,000 merchandise + 70,000 shipping.
    expect(result.totalAmount).toBe('1020000.00');
    expect(s.manager.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ skuId: 'sku-1', weightGramsSnapshot: 250 }),
    );
    expect(result.orders).toHaveLength(2);
    expect(s.shippingQuotes.quoteNewAddress).toHaveBeenCalledTimes(2);
    expect(s.shippingQuotes.quoteNewAddress).toHaveBeenNthCalledWith(1, {
      recipientName: 'Nguyen Van A',
      recipientPhone: '0901234567',
      addressLine: '123 Nguyen Hue',
      provinceName: 'Hồ Chí Minh',
      wardName: 'Ward',
      weightGrams: 750,
      content: 'Product 1, Product 1',
    });
    expect(s.shippingQuotes.quoteNewAddress).toHaveBeenNthCalledWith(2, {
      recipientName: 'Nguyen Van A',
      recipientPhone: '0901234567',
      addressLine: '123 Nguyen Hue',
      provinceName: 'Hồ Chí Minh',
      wardName: 'Ward',
      weightGrams: 750,
      content: 'Product 2',
    });
    // Existing PayOS API creates one link per seller order. Their sum must match checkout.
    const payos = {
      createPaymentLink: vi.fn().mockResolvedValue({
        paymentLinkId: 'test',
        checkoutUrl: 'https://example.test',
        qrCode: 'test',
      }),
    };
    const payments = {
      findOne: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn((value) => value),
      save: vi.fn(async (value) => value),
    };
    const paymentOrders = { findOne: vi.fn() };
    const paymentService = new PaymentsService(
      paymentOrders as never,
      payments as never,
      payos as never,
      new ConfigService({
        PAYOS_RETURN_URL: 'https://example.test/return',
        PAYOS_CANCEL_URL: 'https://example.test/cancel',
      }),
    );
    for (const order of result.orders) {
      paymentOrders.findOne.mockResolvedValue({
        ...order,
        buyerId: userId,
        currency: 'VND',
        checkoutSessionId: result.checkoutSessionId,
      });
      await paymentService.createPayosPaymentLink(userId, {
        orderId: order.id,
      });
    }
    expect(
      payos.createPaymentLink.mock.calls.map(([input]) => input.amount),
    ).toEqual([380000, 640000]);
    expect(
      payos.createPaymentLink.mock.calls.reduce(
        (sum, [input]) => sum + input.amount,
        0,
      ),
    ).toBe(Number(result.totalAmount));

    const orderSeller1 = result.orders.find((o) => o.sellerId === seller1);
    const orderSeller2 = result.orders.find((o) => o.sellerId === seller2);

    expect(orderSeller1).toBeDefined();
    expect(orderSeller1!.total).toBe('380000.00');
    expect(orderSeller1!.status).toBe('PENDING_PAYMENT');

    expect(orderSeller2).toBeDefined();
    expect(orderSeller2!.total).toBe('640000.00');
    expect(orderSeller2!.status).toBe('PENDING_PAYMENT');

    // PayOS rows remain in the cart and are mapped to their exact seller order.
    expect(s.manager.delete).not.toHaveBeenCalled();
    expect(s.manager.update).toHaveBeenCalledTimes(2);
    const cartReservations = s.manager.update.mock.calls.map((call) => ({
      itemIds: (call[1] as { id: { value: string[] } }).id.value,
      orderId: (call[2] as { reservedOrderId: string }).reservedOrderId,
    }));
    expect(cartReservations).toEqual(
      expect.arrayContaining([
        { itemIds: ['item-1', 'item-2'], orderId: orderSeller1!.id },
        { itemIds: ['item-3'], orderId: orderSeller2!.id },
      ]),
    );
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
        weightGrams: 250,
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
        weightGrams: 250,
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
        weightGrams: 250,
        price: '100000.00',
        isActive: true,
        productName: 'Product 1',
        productStatus: 'ACTIVE',
        productDeletedAt: null,
      },
    ]);

    const result = await s.service.checkout(userId, {
      paymentMethod: 'COD',
      selectedCartItemIds: ['item-1'],
    });

    expect(s.manager.delete).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ id: expect.any(Object) }),
    );
    expect(s.manager.update).not.toHaveBeenCalled();
    expect(s.expiryOutbox.schedule).not.toHaveBeenCalled();
    expect(result.orders[0].status).toBe('PROCESSING');
    expect(result.orders[0].holdExpiresAt).toBeNull();
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
        weightGrams: 250,
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
        weightGrams: 250,
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
    const candidatesQb = candidateQueryBuilder();
    const qb = {
      leftJoinAndSelect: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      take: vi.fn().mockReturnThis(),
      getManyAndCount: vi.fn().mockResolvedValue([
        [
          {
            id: 'order-1',
            total: '100000.00',
            items: [{ id: 'item-1', productId: 'prod-1' }],
          },
        ],
        1,
      ]),
    };
    s.orderRepo.createQueryBuilder
      .mockReturnValueOnce(candidatesQb as never)
      .mockReturnValueOnce(qb as never);

    (s.dataSource as unknown as { query: typeof vi.fn }).query = vi
      .fn()
      .mockResolvedValue([
        { productId: 'prod-1', url: 'https://img.nexus.com/p1.png' },
      ]);

    const result = await s.service.getBuyerOrders(userId, {
      page: 1,
      limit: 10,
    });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].items![0].imageUrl).toBe(
      'https://img.nexus.com/p1.png',
    );
    expect(result.meta).toEqual({
      page: 1,
      limit: 10,
      totalItems: 1,
      totalPages: 1,
    });
    expect(candidatesQb.innerJoin).toHaveBeenCalledWith(
      'order.checkoutSession',
      'checkoutSession',
    );
    expect(candidatesQb.andWhere).toHaveBeenCalledWith(
      'checkoutSession.paymentMethod = :paymentMethod',
      { paymentMethod: 'PAYOS' },
    );
    expect(candidatesQb.andWhere).toHaveBeenCalledWith(
      'order.status = :pendingStatus',
      { pendingStatus: 'PENDING_PAYMENT' },
    );
    expect(candidatesQb.andWhere).toHaveBeenCalledWith(
      'order.holdExpiresAt IS NOT NULL',
    );
    expect(candidatesQb.andWhere).toHaveBeenCalledWith(
      'order.holdExpiresAt <= clock_timestamp()',
    );
    expect(s.dataSource.transaction).not.toHaveBeenCalled();
  });

  it('getOrderById returns order detail with enriched image or throws NotFoundException', async () => {
    const s = setup();
    const candidatesQb = candidateQueryBuilder();
    s.orderRepo.createQueryBuilder.mockReturnValue(candidatesQb as never);
    s.orderRepo.findOne.mockResolvedValueOnce({
      id: 'order-1',
      buyerId: userId,
      items: [{ id: 'item-1', productId: 'prod-1' }],
    });
    (s.dataSource as unknown as { query: typeof vi.fn }).query = vi
      .fn()
      .mockResolvedValue([
        { productId: 'prod-1', url: 'https://img.nexus.com/p1.png' },
      ]);

    const orderNumber = 'ORD-20261108-000001';
    const order = await s.service.getOrderById(userId, orderNumber);
    expect(order.id).toBe('order-1');
    expect(order.items![0].imageUrl).toBe('https://img.nexus.com/p1.png');

    expect(order.history).toEqual([]);
    expect(s.orderRepo.findOne).toHaveBeenCalledWith({
      where: { orderNumber, buyerId: userId },
      relations: { items: true, checkoutSession: true },
    });
    expect(s.orderHistoryRepo.find).toHaveBeenCalledWith({
      where: { orderId: 'order-1' },
      order: { createdAt: 'ASC', id: 'ASC' },
    });

    s.orderRepo.findOne.mockResolvedValueOnce(null);
    await expect(
      s.service.getOrderById(userId, 'order-not-found'),
    ).rejects.toThrow(NotFoundException);
    expect(candidatesQb.andWhere).toHaveBeenCalledWith(
      'order.orderNumber = :orderReference',
      { orderReference: orderNumber },
    );
    expect(candidatesQb.andWhere).toHaveBeenCalledWith(
      'order.orderNumber = :orderReference',
      { orderReference: 'order-not-found' },
    );
  });

  it('reconciles overdue PayOS orders before applying the buyer list status filter', async () => {
    const s = setup();
    const candidatesQb = candidateQueryBuilder(['order-1']);
    const listQb = {
      leftJoinAndSelect: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      take: vi.fn().mockReturnThis(),
      getManyAndCount: vi
        .fn()
        .mockResolvedValue([[{ id: 'order-1', status: 'CANCELLED' }], 1]),
    };
    const receipts = [
      {
        skuId: 'sku-1',
        quantity: 1,
        warehouseId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
    ];
    s.orderRepo.createQueryBuilder
      .mockReturnValueOnce(candidatesQb as never)
      .mockReturnValueOnce(listQb as never);
    s.orderStateMachine.expire.mockResolvedValue({
      outcome: 'EXPIRED',
      inventoryReceipts: receipts,
    });

    const result = await s.service.getBuyerOrders(userId.toUpperCase(), {
      page: 1,
      limit: 10,
      status: 'CANCELLED',
    });

    expect(result.data).toEqual([{ id: 'order-1', status: 'CANCELLED' }]);
    expect(candidatesQb.where).toHaveBeenCalledWith(
      'order.buyerId = :buyerId',
      { buyerId: userId },
    );
    expect(candidatesQb.andWhere).toHaveBeenCalledWith(
      'order.holdExpiresAt <= clock_timestamp()',
    );
    expect(s.dataSource.transaction).toHaveBeenCalledWith(
      'READ COMMITTED',
      expect.any(Function),
    );
    expect(s.orderStateMachine.expire).toHaveBeenCalledWith(
      'order-1',
      s.manager,
    );
    expect(s.inventoryReservation.release).toHaveBeenCalledWith(
      receipts,
      s.manager,
    );
    expect(s.orderStateMachine.finalizeExpiry).toHaveBeenCalledWith(
      'order-1',
      s.manager,
    );
    expect(listQb.andWhere).toHaveBeenCalledWith('order.status = :status', {
      status: 'CANCELLED',
    });
    expect(
      s.orderStateMachine.finalizeExpiry.mock.invocationCallOrder[0],
    ).toBeLessThan(listQb.getManyAndCount.mock.invocationCallOrder[0]);
  });

  it('reconciles an overdue owned order before returning refreshed detail and history', async () => {
    const s = setup();
    const candidatesQb = candidateQueryBuilder(['order-1']);
    s.orderRepo.createQueryBuilder.mockReturnValue(candidatesQb as never);
    s.orderStateMachine.expire.mockResolvedValue({
      outcome: 'EXPIRED',
      inventoryReceipts: [],
    });
    s.orderRepo.findOne.mockResolvedValue({
      id: 'order-1',
      buyerId: userId,
      status: 'CANCELLED',
      items: [],
    });
    s.orderHistoryRepo.find.mockResolvedValue([
      { toStatus: 'CANCELLED', reason: 'PAYMENT_HOLD_EXPIRED' },
    ]);

    const result = await s.service.getOrderById(userId, 'order-1');

    expect(result).toMatchObject({
      id: 'order-1',
      status: 'CANCELLED',
      history: [{ toStatus: 'CANCELLED' }],
    });
    expect(candidatesQb.andWhere).toHaveBeenCalledWith(
      'order.orderNumber = :orderReference',
      { orderReference: 'order-1' },
    );
    expect(s.orderStateMachine.finalizeExpiry).toHaveBeenCalledWith(
      'order-1',
      s.manager,
    );
    expect(
      s.orderStateMachine.finalizeExpiry.mock.invocationCallOrder[0],
    ).toBeLessThan(s.orderRepo.findOne.mock.invocationCallOrder[0]);
  });

  it.each(['SKIPPED', 'NOT_FOUND'] as const)(
    'does not release or finalize when a concurrent worker leaves outcome %s',
    async (outcome) => {
      const s = setup();
      const candidatesQb = candidateQueryBuilder(['order-1']);
      const listQb = {
        leftJoinAndSelect: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        take: vi.fn().mockReturnThis(),
        getManyAndCount: vi.fn().mockResolvedValue([[], 0]),
      };
      s.orderRepo.createQueryBuilder
        .mockReturnValueOnce(candidatesQb as never)
        .mockReturnValueOnce(listQb as never);
      s.orderStateMachine.expire.mockResolvedValue({ outcome });

      await s.service.getBuyerOrders(userId, {});

      expect(s.inventoryReservation.release).not.toHaveBeenCalled();
      expect(s.orderStateMachine.finalizeExpiry).not.toHaveBeenCalled();
      expect(listQb.getManyAndCount).toHaveBeenCalledOnce();
    },
  );

  it.each([
    ['inventory release', 'release'],
    ['expiry finalization', 'finalize'],
  ] as const)(
    'propagates %s failure and does not return a stale buyer list',
    async (_label, failurePoint) => {
      const s = setup();
      const transactionState = { commits: 0, rollbacks: 0 };
      s.dataSource.transaction.mockImplementation(
        async (isolationOrCallback, callback) => {
          const operation =
            typeof isolationOrCallback === 'function'
              ? isolationOrCallback
              : callback!;
          try {
            const result = await operation(s.manager);
            transactionState.commits += 1;
            return result;
          } catch (error) {
            transactionState.rollbacks += 1;
            throw error;
          }
        },
      );
      const candidatesQb = candidateQueryBuilder(['order-1']);
      const listQb = {
        leftJoinAndSelect: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        take: vi.fn().mockReturnThis(),
        getManyAndCount: vi.fn().mockResolvedValue([[], 0]),
      };
      s.orderRepo.createQueryBuilder
        .mockReturnValueOnce(candidatesQb as never)
        .mockReturnValueOnce(listQb as never);
      s.orderStateMachine.expire.mockResolvedValue({
        outcome: 'EXPIRED',
        inventoryReceipts: [],
      });
      if (failurePoint === 'release') {
        s.inventoryReservation.release.mockRejectedValue(
          new Error('release failed'),
        );
      } else {
        s.orderStateMachine.finalizeExpiry.mockRejectedValue(
          new Error('finalize failed'),
        );
      }

      await expect(s.service.getBuyerOrders(userId, {})).rejects.toThrow(
        `${failurePoint} failed`,
      );
      expect(transactionState).toEqual({ commits: 0, rollbacks: 1 });
      expect(listQb.getManyAndCount).not.toHaveBeenCalled();
    },
  );

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
    ['PAYOS', 'COMPLETED'],
    ['PAYOS', 'CANCELLED'],
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

describe('OrderService - Seller Orders (NEX-FAST-02)', () => {
  const sellerOrder = {
    id: '66666666-6666-4666-8666-666666666666',
    orderNumber: 'ORD-123456-TEST',
    buyerId: userId,
    sellerId: seller1,
    status: 'PAID' as const,
    subtotal: '550000.00',
    shippingFee: '30000.00',
    discountAmount: '0.00',
    tax: '0.00',
    total: '580000.00',
    currency: 'VND',
    shippingAddressSnapshot: {
      recipientName: 'Nguyen Van A',
      recipientPhone: '0987654321',
      addressLine: '123 Nguyen Hue',
    },
    createdAt: new Date('2026-11-03T08:30:00Z'),
    updatedAt: new Date('2026-11-03T08:45:00Z'),
    checkoutSession: { paymentMethod: 'PAYOS' },
    items: [
      {
        id: '77777777-7777-4777-8777-777777777777',
        productId: '88888888-8888-4888-8888-888888888888',
        skuId: '99999999-9999-4999-8999-999999999999',
        productNameSnapshot: 'Áo Thun Oversize Nexus',
        skuAttributesSnapshot: { Color: 'Đen', Size: 'L' },
        unitPrice: '275000.00',
        quantity: 2,
        discountAmount: '0.00',
        lineTotal: '550000.00',
      },
    ],
  };

  it('lists only owned orders with status filtering and contract mapping', async () => {
    const s = setup();
    const candidatesQb = candidateQueryBuilder();
    const qb = {
      leftJoinAndSelect: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      addOrderBy: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      take: vi.fn().mockReturnThis(),
      getManyAndCount: vi.fn().mockResolvedValue([[sellerOrder], 11]),
    };
    s.orderRepo.createQueryBuilder
      .mockReturnValueOnce(candidatesQb as never)
      .mockReturnValueOnce(qb as never);
    (
      s.dataSource as typeof s.dataSource & { query: ReturnType<typeof vi.fn> }
    ).query = vi
      .fn()
      .mockResolvedValue([
        { productId: sellerOrder.items[0].productId, url: 'image.jpg' },
      ]);

    const result = await s.service.getSellerOrders(seller1.toUpperCase(), {
      page: 2,
      limit: 10,
      status: 'PAID',
    });

    expect(qb.where).toHaveBeenCalledWith('order.sellerId = :sellerId', {
      sellerId: seller1,
    });
    expect(qb.andWhere).toHaveBeenCalledWith('order.status != :unpaidStatus', {
      unpaidStatus: 'PENDING_PAYMENT',
    });
    expect(candidatesQb.where).toHaveBeenCalledWith(
      'order.sellerId = :sellerId',
      { sellerId: seller1 },
    );
    expect(qb.andWhere).toHaveBeenCalledWith('order.status = :status', {
      status: 'PAID',
    });
    expect(qb.addOrderBy).toHaveBeenCalledWith('order.id', 'DESC');
    expect(qb.skip).toHaveBeenCalledWith(10);
    expect(result.meta).toEqual({
      page: 2,
      limit: 10,
      total: 11,
      totalItems: 11,
      totalPages: 2,
    });
    expect(result.data[0]).toMatchObject({
      orderCode: sellerOrder.orderNumber,
      totalAmount: '580000.00',
      paymentMethod: 'PAYOS',
      buyerName: 'Nguyen Van A',
      buyerPhone: '0987654321',
      itemCount: 2,
      itemsSummary: [
        expect.objectContaining({
          productName: 'Áo Thun Oversize Nexus',
          imageUrl: 'image.jpg',
        }),
      ],
    });
  });

  it('returns owned detail with sparse snapshot, null image, and ordered history', async () => {
    const s = setup();
    const candidatesQb = candidateQueryBuilder();
    s.orderRepo.createQueryBuilder.mockReturnValue(candidatesQb as never);
    const sparseOrder = {
      ...sellerOrder,
      shippingAddressSnapshot: { recipientName: 'Nguyen Van A' },
      items: sellerOrder.items.map((item) => ({ ...item })),
    };
    const history = [
      {
        id: 'history-1',
        orderId: sellerOrder.id,
        fromStatus: 'PENDING_PAYMENT',
        toStatus: 'PAID',
        reason: 'PAYMENT_SUCCEEDED',
        changedBy: userId,
        createdAt: new Date('2026-11-03T08:31:00Z'),
      },
    ];
    s.orderRepo.findOne.mockResolvedValue(sparseOrder);
    s.orderHistoryRepo.find.mockResolvedValue(history);
    (
      s.dataSource as typeof s.dataSource & { query: ReturnType<typeof vi.fn> }
    ).query = vi.fn().mockResolvedValue([]);

    const result = await s.service.getSellerOrderById(
      seller1.toUpperCase(),
      sellerOrder.id,
    );

    expect(s.orderRepo.findOne).toHaveBeenCalledWith({
      where: { id: sellerOrder.id, sellerId: seller1 },
      relations: { items: true, checkoutSession: true },
    });
    expect(candidatesQb.where).toHaveBeenCalledWith(
      'order.sellerId = :sellerId',
      { sellerId: seller1 },
    );
    expect(candidatesQb.andWhere).toHaveBeenCalledWith(
      'order.id = :orderReference',
      { orderReference: sellerOrder.id },
    );
    expect(s.orderHistoryRepo.find).toHaveBeenCalledWith({
      where: { orderId: sellerOrder.id },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    expect(result.shippingAddress).toEqual({ recipientName: 'Nguyen Van A' });
    expect(result.paymentMethod).toBe('PAYOS');
    expect(result.items[0].imageUrl).toBeNull();
    expect(result.history).toEqual([
      {
        fromStatus: 'PENDING_PAYMENT',
        toStatus: 'PAID',
        reason: 'PAYMENT_SUCCEEDED',
        createdAt: new Date('2026-11-03T08:31:00Z'),
      },
    ]);
    expect(result.history[0]).not.toHaveProperty('orderId');
    expect(result.history[0]).not.toHaveProperty('changedBy');
  });

  it('resolves an owned seller order by its human-facing order number', async () => {
    const s = setup();
    const candidatesQb = candidateQueryBuilder();
    s.orderRepo.createQueryBuilder.mockReturnValue(candidatesQb as never);
    s.orderRepo.findOne.mockResolvedValue(sellerOrder);
    (
      s.dataSource as typeof s.dataSource & { query: ReturnType<typeof vi.fn> }
    ).query = vi.fn().mockResolvedValue([]);

    const result = await s.service.getSellerOrderById(
      seller1,
      sellerOrder.orderNumber,
    );

    expect(s.orderRepo.findOne).toHaveBeenCalledWith({
      where: { orderNumber: sellerOrder.orderNumber, sellerId: seller1 },
      relations: { items: true, checkoutSession: true },
    });
    expect(result.orderCode).toBe(sellerOrder.orderNumber);
  });

  it('hides missing and foreign-owned orders behind NotFoundException', async () => {
    const s = setup();
    const candidatesQb = candidateQueryBuilder();
    s.orderRepo.createQueryBuilder.mockReturnValue(candidatesQb as never);
    s.orderRepo.findOne.mockResolvedValue(null);

    await expect(
      s.service.getSellerOrderById(seller2, 'ORD-20261108-000001'),
    ).rejects.toThrow(NotFoundException);
    expect(s.orderRepo.findOne).toHaveBeenCalledWith({
      where: {
        orderNumber: 'ORD-20261108-000001',
        sellerId: seller2,
      },
      relations: { items: true, checkoutSession: true },
    });
    expect(s.orderHistoryRepo.find).not.toHaveBeenCalled();
  });

  it('reconciles an overdue PayOS order before applying the seller list status filter', async () => {
    const s = setup();
    const candidatesQb = candidateQueryBuilder([sellerOrder.id]);
    const listQb = {
      leftJoinAndSelect: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      addOrderBy: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      take: vi.fn().mockReturnThis(),
      getManyAndCount: vi
        .fn()
        .mockResolvedValue([[{ ...sellerOrder, status: 'CANCELLED' }], 1]),
    };
    s.orderRepo.createQueryBuilder
      .mockReturnValueOnce(candidatesQb as never)
      .mockReturnValueOnce(listQb as never);
    s.orderStateMachine.expire.mockResolvedValue({
      outcome: 'EXPIRED',
      inventoryReceipts: [],
    });
    (
      s.dataSource as typeof s.dataSource & { query: ReturnType<typeof vi.fn> }
    ).query = vi.fn().mockResolvedValue([]);

    const result = await s.service.getSellerOrders(seller1.toUpperCase(), {
      page: 1,
      limit: 10,
      status: 'CANCELLED',
    });

    expect(candidatesQb.where).toHaveBeenCalledWith(
      'order.sellerId = :sellerId',
      { sellerId: seller1 },
    );
    expect(s.orderStateMachine.expire).toHaveBeenCalledWith(
      sellerOrder.id,
      s.manager,
    );
    expect(s.inventoryReservation.release).toHaveBeenCalledWith([], s.manager);
    expect(s.orderStateMachine.finalizeExpiry).toHaveBeenCalledWith(
      sellerOrder.id,
      s.manager,
    );
    expect(listQb.andWhere).toHaveBeenCalledWith('order.status = :status', {
      status: 'CANCELLED',
    });
    expect(result.data[0].status).toBe('CANCELLED');
  });

  it('rejects statuses outside the seller order contract', async () => {
    const dto = plainToInstance(QuerySellerOrdersDto, {
      page: 1,
      limit: 10,
      status: 'PENDING_PAYMENT',
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('status');
  });
});

describe('Checkout shipping failure and stale quote protection', () => {
  function shippingSetup() {
    const s = setup();
    const item = { id: 'item-1', cartId, skuId: 'sku-1', quantity: 2 };
    const sku = {
      id: 'sku-1',
      productId: 'product-1',
      productName: 'Product',
      sellerId: seller1,
      weightGrams: 250,
      price: '100000.00',
      isActive: true,
      productStatus: 'ACTIVE',
      productDeletedAt: null,
    };
    s.cartItemRepo.find.mockResolvedValue([item]);
    s.catalogApi.getCartSkus.mockResolvedValue([sku]);
    return { ...s, item, sku };
  }
  it('permits expired reservations in a quote but rejects active reservations', async () => {
    const s = shippingSetup();
    s.cartItemRepo.find.mockResolvedValue([
      {
        ...s.item,
        reservedOrderId: 'old',
        reservationExpiresAt: new Date(Date.now() - 1000),
      },
    ]);
    await expect(
      s.service.quoteCart(userId, {
        addressId,
        selectedCartItemIds: ['item-1'],
      }),
    ).resolves.toMatchObject({ totalFee: 30000 });
    s.cartItemRepo.find.mockResolvedValue([
      {
        ...s.item,
        reservedOrderId: 'active',
        reservationExpiresAt: new Date(Date.now() + 60000),
      },
    ]);
    await expect(
      s.service.quoteCart(userId, {
        addressId,
        selectedCartItemIds: ['item-1'],
      }),
    ).rejects.toThrow('reserved');
  });
  it('rejects quantities above available stock, including multiple rows for one SKU', async () => {
    const s = shippingSetup();
    s.cartItemRepo.find.mockResolvedValue([
      s.item,
      { ...s.item, id: 'item-2' },
    ]);
    s.inventoryRead.getDefaultWarehouseStock.mockResolvedValue([
      { skuId: 'sku-1', availableQuantity: 3 },
    ]);
    await expect(
      s.service.quoteCart(userId, {
        addressId,
        selectedCartItemIds: ['item-1', 'item-2'],
      }),
    ).rejects.toThrow('Insufficient available inventory');
    expect(s.shippingQuotes.quoteNewAddress).not.toHaveBeenCalled();
  });
  it('fails before transaction when GHN cannot quote', async () => {
    const s = shippingSetup();
    s.shippingQuotes.quoteNewAddress.mockRejectedValue(
      new Error('GHN unavailable'),
    );
    await expect(s.service.checkout(userId, {})).rejects.toThrow(
      'GHN unavailable',
    );
    expect(s.dataSource.transaction).not.toHaveBeenCalled();
    expect(s.inventoryReservation.reserve).not.toHaveBeenCalled();
  });
  it('rejects an address changed after the quote before reserving inventory', async () => {
    const s = shippingSetup();
    const original = await s.addressRepo.findOne();
    s.addressRepo.findOne
      .mockReset()
      .mockResolvedValueOnce(original)
      .mockResolvedValueOnce({ ...original, addressLine: 'Changed street' });
    await expect(
      s.service.checkout(userId, { addressId }),
    ).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({ errorCode: 'SHIPPING_QUOTE_STALE' }),
    });
    expect(s.inventoryReservation.reserve).not.toHaveBeenCalled();
  });
  it('rejects missing persisted weight before requesting a quote', async () => {
    const s = shippingSetup();
    s.catalogApi.getCartSkus.mockResolvedValue([
      { ...s.sku, weightGrams: null },
    ]);
    await expect(s.service.checkout(userId, {})).rejects.toMatchObject({
      status: 400,
    });
    expect(s.shippingQuotes.quoteNewAddress).not.toHaveBeenCalled();
    expect(s.manager.save).not.toHaveBeenCalled();
  });
  it('rejects missing destination codes before quoting or creating payable data', async () => {
    const s = shippingSetup();
    await expect(
      s.service.checkout(userId, {
        shippingAddress: {
          recipientName: 'Buyer',
          recipientPhone: '0901234567',
          addressLine: 'Street',
        },
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(s.shippingQuotes.quoteNewAddress).not.toHaveBeenCalled();
    expect(s.dataSource.transaction).not.toHaveBeenCalled();
  });
  it('does not create any order when the second seller quote fails', async () => {
    const s = shippingSetup();
    s.cartItemRepo.find.mockResolvedValue([
      s.item,
      { ...s.item, id: 'item-2', skuId: 'sku-2' },
    ]);
    s.catalogApi.getCartSkus.mockResolvedValue([
      s.sku,
      { ...s.sku, id: 'sku-2', sellerId: seller2 },
    ]);
    s.shippingQuotes.quoteNewAddress
      .mockResolvedValueOnce({ fee: 30000 })
      .mockRejectedValueOnce(new Error('second quote failed'));
    await expect(s.service.checkout(userId, {})).rejects.toThrow(
      'second quote failed',
    );
    expect(s.dataSource.transaction).not.toHaveBeenCalled();
    expect(s.manager.save).not.toHaveBeenCalled();
  });
  it.each(['quantity', 'sku', 'seller', 'weight', 'addition'])(
    'rejects concurrent %s change before reserving inventory',
    async (change) => {
      const s = shippingSetup();
      if (change === 'quantity' || change === 'sku' || change === 'addition') {
        const items =
          change === 'addition'
            ? [s.item, { ...s.item, id: 'item-2' }]
            : [
                {
                  ...s.item,
                  ...(change === 'quantity'
                    ? { quantity: 3 }
                    : { skuId: 'sku-2' }),
                },
              ];
        s.cartItemRepo.find
          .mockResolvedValueOnce([s.item])
          .mockResolvedValueOnce(items);
      } else {
        s.catalogApi.getCartSkus
          .mockResolvedValueOnce([s.sku])
          .mockResolvedValueOnce([
            {
              ...s.sku,
              ...(change === 'seller'
                ? { sellerId: seller2 }
                : { weightGrams: 500 }),
            },
          ]);
      }
      await expect(s.service.checkout(userId, {})).rejects.toMatchObject({
        status: 409,
        response: expect.objectContaining({
          errorCode: 'SHIPPING_QUOTE_STALE',
        }),
      });
      expect(s.inventoryReservation.reserve).not.toHaveBeenCalled();
      expect(s.manager.save).not.toHaveBeenCalled();
    },
  );
});
