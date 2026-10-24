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

  const orderRepo = {
    findOne: vi.fn(),
    save: vi.fn(),
    createQueryBuilder: vi.fn(),
  };

  const orderItemRepo = {
    save: vi.fn(),
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

  const manager = {
    create: vi.fn((_entityClass, data) => ({
      id: 'mock-id-' + Math.random(),
      ...data,
    })),
    save: vi.fn(async (_entityClassOrData, data) => data || _entityClassOrData),
    delete: vi.fn().mockResolvedValue({ affected: 1 }),
  };

  const dataSource = {
    transaction: vi.fn(async (cb) => cb(manager)),
  };

  const service = new OrderService(
    dataSource as never,
    cartRepo as never,
    cartItemRepo as never,
    checkoutSessionRepo as never,
    orderRepo as never,
    orderItemRepo as never,
    addressRepo as never,
    catalogApi as never,
  );

  return {
    cartRepo,
    cartItemRepo,
    checkoutSessionRepo,
    orderRepo,
    orderItemRepo,
    addressRepo,
    catalogApi,
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

    // Cart items deleted inside transaction
    expect(s.manager.delete).toHaveBeenCalled();
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
    s.orderRepo.createQueryBuilder.mockReturnValue(qb);

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

    s.orderRepo.findOne.mockResolvedValueOnce(null);
    await expect(
      s.service.getOrderById(userId, 'order-not-found'),
    ).rejects.toThrow(NotFoundException);
  });
});
