import { SupportOrderService } from './support-order.service.js';

const orderId = '33333333-3333-4333-8333-333333333333';
const buyerId = '11111111-1111-4111-8111-111111111111';
const sellerId = '22222222-2222-4222-8222-222222222222';

describe('SupportOrderService', () => {
  function setup() {
    const qb = {
      leftJoinAndSelect: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      addOrderBy: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      take: vi.fn().mockReturnThis(),
      getManyAndCount: vi.fn(),
    };
    const orders = {
      createQueryBuilder: vi.fn().mockReturnValue(qb),
      findOne: vi.fn(),
    };
    const payments = { find: vi.fn().mockResolvedValue([]) };
    const history = { find: vi.fn().mockResolvedValue([]) };
    const identity = {
      findBuyerIdsByEmail: vi.fn(),
      getUsersByIds: vi.fn().mockResolvedValue([]),
      getShopsBySellerIds: vi.fn().mockResolvedValue([]),
    };
    return {
      service: new SupportOrderService(
        orders as never,
        payments as never,
        history as never,
        identity as never,
      ),
      qb,
      orders,
      payments,
      history,
      identity,
    };
  }

  const order = {
    id: orderId,
    orderNumber: 'ORD-123',
    buyerId,
    sellerId,
    status: 'PROCESSING',
    total: '450000.00',
    currency: 'VND',
    trackingCode: 'GHN123',
    carrierName: 'GHN',
    shippingAddressSnapshot: {
      recipientName: 'Nguyen Van A',
      recipientPhone: '0987654321',
    },
    items: [],
    checkoutSession: { paymentMethod: 'PAYOS' },
    createdAt: new Date('2026-11-06T08:30:00Z'),
    updatedAt: new Date('2026-11-06T09:30:00Z'),
    subtotal: '440000.00',
    shippingFee: '10000.00',
    discountAmount: '0.00',
    tax: '0.00',
  };

  it('filters, paginates and batch-enriches the all-orders list', async () => {
    const { service, qb, identity, payments } = setup();
    identity.findBuyerIdsByEmail.mockResolvedValue([buyerId]);
    identity.getUsersByIds.mockResolvedValue([
      {
        id: buyerId,
        fullName: 'Buyer',
        email: 'buyer@example.com',
        phone: null,
        status: 'ACTIVE',
      },
    ]);
    identity.getShopsBySellerIds.mockResolvedValue([
      { sellerId, name: 'Shop', status: 'ACTIVE', logoUrl: null },
    ]);
    payments.find.mockResolvedValue([
      {
        orderId,
        provider: 'PAYOS',
        status: 'SUCCEEDED',
        amount: '450000.00',
        currency: 'VND',
        updatedAt: new Date(),
      },
    ]);
    qb.getManyAndCount.mockResolvedValue([[order], 1]);

    const result = await service.list({
      page: 2,
      limit: 20,
      q: 'ORD-123',
      buyerEmail: 'buyer@example.com',
      status: 'PROCESSING',
      fromDate: '2026-11-01',
      toDate: '2026-11-07',
    });

    expect(identity.findBuyerIdsByEmail).toHaveBeenCalledWith(
      'buyer@example.com',
    );
    expect(qb.skip).toHaveBeenCalledWith(20);
    expect(qb.take).toHaveBeenCalledWith(20);
    expect(qb.andWhere).toHaveBeenCalledWith('order.createdAt >= :fromDate', {
      fromDate: '2026-11-01T00:00:00.000Z',
    });
    expect(qb.andWhere).toHaveBeenCalledWith('order.createdAt <= :toDate', {
      toDate: '2026-11-07T23:59:59.999Z',
    });
    expect(result.data[0]).toMatchObject({
      orderNumber: 'ORD-123',
      buyer: { email: 'buyer@example.com' },
      sellerShop: { name: 'Shop' },
      payment: { status: 'SUCCEEDED' },
      recipientPhone: '0987654321',
    });
    expect(result.meta).toEqual({
      page: 2,
      limit: 20,
      totalItems: 1,
      totalPages: 1,
    });
  });

  it('returns an empty page without querying orders when email has no users', async () => {
    const { service, orders, identity } = setup();
    identity.findBuyerIdsByEmail.mockResolvedValue([]);

    await expect(
      service.list({ buyerEmail: 'missing@example.com', page: 1, limit: 20 }),
    ).resolves.toEqual({
      data: [],
      meta: { page: 1, limit: 20, totalItems: 0, totalPages: 1 },
    });
    expect(orders.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('returns safe order details with history and payment', async () => {
    const { service, orders, history } = setup();
    orders.findOne.mockResolvedValue(order);
    history.find.mockResolvedValue([
      {
        fromStatus: 'PAID',
        toStatus: 'PROCESSING',
        reason: 'confirmed',
        changedBy: sellerId,
        createdAt: new Date(),
      },
    ]);

    const result = await service.detail(orderId);

    expect(result).toMatchObject({
      id: orderId,
      paymentMethod: 'PAYOS',
      shippingAddress: order.shippingAddressSnapshot,
      statusHistory: [{ toStatus: 'PROCESSING' }],
    });
  });

  it('uses a stable not-found error contract', async () => {
    const { service, orders } = setup();
    orders.findOne.mockResolvedValue(null);
    await expect(service.detail(orderId)).rejects.toMatchObject({
      response: { errorCode: 'ORDER_NOT_FOUND' },
    });
  });
});
