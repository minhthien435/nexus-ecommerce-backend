import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuctionOrderHandoffService } from './auction-order-handoff.service.js';
import type { CreateAuctionOrderInput } from '../auction-order-handoff.api.js';

describe('AuctionOrderHandoffService', () => {
  let service: AuctionOrderHandoffService;
  let dataSourceMock: any;
  let orderRepoMock: any;
  let orderItemRepoMock: any;
  let orderHistoryRepoMock: any;
  let addressRepoMock: any;
  let expiryOutboxMock: any;
  let managerMock: any;

  const mockInput: CreateAuctionOrderInput = {
    auctionId: '00000000-0000-0000-0000-000000000001',
    auctionCode: 'AUC-12345',
    winnerId: '11111111-1111-1111-1111-111111111111',
    sellerId: '22222222-2222-2222-2222-222222222222',
    skuId: '33333333-3333-3333-3333-333333333333',
    productId: '44444444-4444-4444-4444-444444444444',
    titleSnapshot: 'Đồng hồ vàng đấu giá',
    finalPrice: '5000000.00',
    currency: 'VND',
    paymentDeadlineAt: new Date('2026-11-15T12:00:00.000Z'),
    warehouseId: '55555555-5555-5555-5555-555555555555',
  };

  beforeEach(() => {
    managerMock = {
      getRepository: vi.fn().mockReturnValue({
        createQueryBuilder: vi.fn().mockReturnValue({
          setLock: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          getOne: vi.fn().mockResolvedValue(null),
        }),
      }),
      query: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockImplementation((entityClass, data) => ({
        id: 'ord-uuid-1',
        ...data,
      })),
      save: vi.fn().mockImplementation(async (entity) => ({
        id: entity.id || 'ord-uuid-1',
        ...entity,
      })),
    };

    dataSourceMock = {
      transaction: vi.fn().mockImplementation(async (callback) => {
        return callback(managerMock);
      }),
    };

    orderRepoMock = {
      findOne: vi.fn().mockResolvedValue(null),
      save: vi.fn().mockImplementation(async (entity) => entity),
    };

    orderItemRepoMock = {
      create: vi.fn().mockImplementation((data) => data),
      save: vi.fn().mockImplementation(async (entity) => entity),
    };

    orderHistoryRepoMock = {
      create: vi.fn().mockImplementation((data) => data),
      save: vi.fn().mockImplementation(async (entity) => entity),
    };

    addressRepoMock = {
      findOne: vi.fn().mockResolvedValue({
        recipientName: 'Duy Nguyen',
        recipientPhone: '0901234567',
        addressLine: '123 Đường Số 1',
        provinceName: 'Hồ Chí Minh',
        districtCode: '760',
        wardName: 'Bến Nghé',
        addressScheme: 'ghn_v3',
      }),
    };

    expiryOutboxMock = {
      schedule: vi.fn().mockResolvedValue(undefined),
    };

    service = new AuctionOrderHandoffService(
      dataSourceMock as any,
      orderRepoMock as any,
      orderItemRepoMock as any,
      orderHistoryRepoMock as any,
      addressRepoMock as any,
      expiryOutboxMock as any,
    );
  });

  describe('createAuctionOrder', () => {
    it('creates an Order with source AUCTION, matching prices, address snapshot and schedules expiry', async () => {
      const result = await service.createAuctionOrder(mockInput);

      expect(result.orderId).toBeDefined();
      expect(result.orderNumber).toMatch(/^ORD-AUC-/);

      // Verify Order creation parameters
      expect(managerMock.create).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          source: 'AUCTION',
          auctionId: mockInput.auctionId,
          buyerId: mockInput.winnerId,
          sellerId: mockInput.sellerId,
          status: 'PENDING_PAYMENT',
          subtotal: mockInput.finalPrice,
          total: mockInput.finalPrice,
          holdExpiresAt: mockInput.paymentDeadlineAt,
          shippingAddressSnapshot: expect.objectContaining({
            recipientName: 'Duy Nguyen',
            provinceName: 'Hồ Chí Minh',
          }),
        }),
      );

      // Verify OrderItem creation parameters
      expect(managerMock.create).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          skuId: mockInput.skuId,
          productId: mockInput.productId,
          unitPrice: mockInput.finalPrice,
          quantity: 1,
          lineTotal: mockInput.finalPrice,
        }),
      );

      // Verify order expiry outbox scheduled
      expect(expiryOutboxMock.schedule).toHaveBeenCalledWith(
        expect.any(String),
        mockInput.paymentDeadlineAt,
        managerMock,
      );
    });

    it('returns existing order idempotently if order already exists outside transaction', async () => {
      orderRepoMock.findOne.mockResolvedValueOnce({
        id: 'existing-ord-id',
        orderNumber: 'ORD-AUC-EXISTING',
      });

      const result = await service.createAuctionOrder(mockInput);

      expect(result).toEqual({
        orderId: 'existing-ord-id',
        orderNumber: 'ORD-AUC-EXISTING',
      });
      expect(dataSourceMock.transaction).not.toHaveBeenCalled();
    });

    it('returns existing order idempotently if order was committed inside transaction', async () => {
      managerMock.getRepository = vi.fn().mockReturnValue({
        createQueryBuilder: vi.fn().mockReturnValue({
          setLock: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          getOne: vi.fn().mockResolvedValue({
            id: 'in-tx-order-id',
            orderNumber: 'ORD-AUC-IN-TX',
          }),
        }),
      });

      const result = await service.createAuctionOrder(mockInput);

      expect(result).toEqual({
        orderId: 'in-tx-order-id',
        orderNumber: 'ORD-AUC-IN-TX',
      });
    });

    it('creates an order using externalManager directly without creating a new transaction', async () => {
      const customManagerMock = {
        getRepository: vi.fn().mockReturnValue({
          createQueryBuilder: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnThis(),
            getOne: vi.fn().mockResolvedValue(null),
          }),
          findOne: vi.fn().mockResolvedValue({
            recipientName: 'Custom Winner',
            provinceName: 'Hà Nội',
          }),
        }),
        query: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockImplementation((entityClass, data) => ({
          id: 'custom-ord-id',
          ...data,
        })),
        save: vi.fn().mockImplementation(async (entity) => ({
          id: entity.id || 'custom-ord-id',
          ...entity,
        })),
      };

      const result = await service.createAuctionOrder(
        mockInput,
        customManagerMock as any,
      );

      expect(result.orderId).toBe('custom-ord-id');
      expect(dataSourceMock.transaction).not.toHaveBeenCalled();
      expect(customManagerMock.create).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          source: 'AUCTION',
          auctionId: mockInput.auctionId,
        }),
      );
      expect(expiryOutboxMock.schedule).toHaveBeenCalledWith(
        'custom-ord-id',
        mockInput.paymentDeadlineAt,
        customManagerMock,
      );
    });
  });

  describe('cancelAuctionOrder', () => {
    it('cancels order when order status is PENDING_PAYMENT', async () => {
      const pendingOrder = {
        id: 'ord-1',
        status: 'PENDING_PAYMENT',
      };
      managerMock.getRepository = vi.fn().mockReturnValue({
        createQueryBuilder: vi.fn().mockReturnValue({
          setLock: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          getOne: vi.fn().mockResolvedValue(pendingOrder),
        }),
      });

      await service.cancelAuctionOrder('ord-1', 'PAYMENT_TIMEOUT');

      expect(pendingOrder.status).toBe('CANCELLED');
      expect(managerMock.save).toHaveBeenCalledWith(pendingOrder);
    });

    it('cancels order directly using externalManager without creating a new transaction', async () => {
      const pendingOrder = {
        id: 'ord-external',
        status: 'PENDING_PAYMENT',
      };
      const customManagerMock = {
        getRepository: vi.fn().mockReturnValue({
          createQueryBuilder: vi.fn().mockReturnValue({
            setLock: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            getOne: vi.fn().mockResolvedValue(pendingOrder),
          }),
        }),
        create: vi.fn().mockImplementation((entityClass, data) => data),
        save: vi.fn().mockImplementation(async (entity) => entity),
      };

      await service.cancelAuctionOrder(
        'ord-external',
        'PAYMENT_TIMEOUT',
        customManagerMock as any,
      );

      expect(pendingOrder.status).toBe('CANCELLED');
      expect(customManagerMock.save).toHaveBeenCalledWith(pendingOrder);
      expect(dataSourceMock.transaction).not.toHaveBeenCalled();
    });
  });
});
