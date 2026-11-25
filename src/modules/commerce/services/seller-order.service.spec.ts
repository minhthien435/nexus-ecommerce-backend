import { describe, expect, it, vi } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { OrderService } from './order.service.js';
import type { OrderStatus } from '../domain/entities/order.entity.js';

const sellerAId = '11111111-1111-4111-8111-111111111111';
const sellerBId = '22222222-2222-4222-8222-222222222222';
const orderAId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function setup(options?: {
  ghnClientService?: unknown;
  hasPaidPayment?: number;
  paymentMethod?: string;
}) {
  const expiryCandidatesQb = {
    innerJoin: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    getRawMany: vi.fn().mockResolvedValue([]),
  };
  const orderRepo = {
    createQueryBuilder: vi.fn().mockReturnValue(expiryCandidatesQb),
    findOne: vi.fn(),
    save: vi.fn(async (order) => ({
      ...order,
      updatedAt: new Date('2026-11-04T10:00:00Z'),
    })),
  };

  const orderHistoryRepo = {
    find: vi.fn().mockResolvedValue([]),
  };

  const orderStateMachine = {
    transition: vi.fn(async (_manager, input) => ({
      id: input.orderId,
      status: input.toStatus,
      updatedAt: new Date('2026-11-04T09:00:00Z'),
    })),
  };
  const catalogApi = {
    getCartSkus: vi.fn().mockResolvedValue([{ id: 'sku-1', weightGrams: 200 }]),
  };

  const dataSource = {
    transaction: vi.fn(
      async (_mode: unknown, callback: (manager: unknown) => unknown) => {
        return callback({
          getRepository: (_entity: unknown) => {
            return {
              findOne: vi.fn(async (query) => {
                if (query?.where?.id && query?.select?.paymentMethod) {
                  return {
                    id: query.where.id,
                    paymentMethod: options?.paymentMethod ?? 'COD',
                  };
                }
                const res = await orderRepo.findOne(query);
                if (
                  res &&
                  res.paymentMethod === undefined &&
                  res.checkoutSession === undefined &&
                  res.checkoutSessionId === undefined
                ) {
                  return {
                    ...res,
                    paymentMethod: options?.paymentMethod ?? 'COD',
                  };
                }
                return res;
              }),
              find: vi.fn().mockResolvedValue([
                {
                  skuId: 'sku-1',
                  quantity: 2,
                  productNameSnapshot: 'Ao khoac Gio',
                  weightGramsSnapshot: 200,
                },
              ]),
              count: vi.fn().mockResolvedValue(options?.hasPaidPayment ?? 0),
              save: orderRepo.save,
            };
          },
        });
      },
    ),
    query: vi.fn().mockResolvedValue([]),
  };

  const inventoryReservation = {
    reserve: vi.fn(),
    release: vi.fn(),
    deduct: vi.fn().mockResolvedValue(undefined),
    restoreStock: vi.fn().mockResolvedValue(undefined),
  };

  const service = new OrderService(
    dataSource as never,
    {} as never,
    {} as never,
    {} as never,
    orderRepo as never,
    {} as never,
    orderHistoryRepo as never,
    {} as never,
    catalogApi as never,
    {} as never,
    orderStateMachine as never,
    inventoryReservation as never,
    {} as never,
    undefined,
    options?.ghnClientService as never,
  );

  return {
    service,
    orderRepo,
    expiryCandidatesQb,
    orderHistoryRepo,
    orderStateMachine,
    inventoryReservation,
    dataSource,
  };
}

describe('OrderService - Seller Orders Unit & Security Tests (NEX-FAST-04)', () => {
  describe('Scenario 1 — Seller A retrieves their own orders', () => {
    it('strictly filters orders by Seller A normalized seller ID without exposing Seller B orders', async () => {
      const { service, orderRepo, expiryCandidatesQb } = setup();

      const sellerAOrders = [
        {
          id: orderAId,
          orderNumber: 'ORD-SELLER-A-1',
          sellerId: sellerAId,
          status: 'PAID' as OrderStatus,
          subtotal: '200000.00',
          shippingFee: '30000.00',
          discountAmount: '0.00',
          tax: '0.00',
          total: '230000.00',
          currency: 'VND',
          createdAt: new Date('2026-11-03T09:00:00Z'),
          items: [],
          checkoutSession: { paymentMethod: 'PAYOS' },
        },
      ];

      const qb = {
        leftJoinAndSelect: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        addOrderBy: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        take: vi.fn().mockReturnThis(),
        getManyAndCount: vi.fn().mockResolvedValue([sellerAOrders, 1]),
      };

      orderRepo.createQueryBuilder
        .mockReturnValueOnce(expiryCandidatesQb)
        .mockReturnValueOnce(qb);

      const result = await service.getSellerOrders(sellerAId, {
        page: 1,
        limit: 10,
        status: 'PAID',
      });

      expect(orderRepo.createQueryBuilder).toHaveBeenCalledWith('order');
      expect(qb.leftJoinAndSelect).toHaveBeenCalledWith('order.items', 'items');
      expect(qb.leftJoinAndSelect).toHaveBeenCalledWith(
        'order.checkoutSession',
        'checkoutSession',
      );
      expect(qb.where).toHaveBeenCalledWith('order.sellerId = :sellerId', {
        sellerId: sellerAId.toLowerCase(),
      });
      expect(qb.where).not.toHaveBeenCalledWith('order.sellerId = :sellerId', {
        sellerId: sellerBId.toLowerCase(),
      });
      expect(qb.andWhere).toHaveBeenCalledWith('order.status = :status', {
        status: 'PAID',
      });
      expect(qb.skip).toHaveBeenCalledWith(0);
      expect(qb.take).toHaveBeenCalledWith(10);

      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe(orderAId);
      expect(result.data[0].orderCode).toBe('ORD-SELLER-A-1');
      expect(result.data[0].status).toBe('PAID');
      expect(result.meta).toEqual({
        page: 1,
        limit: 10,
        total: 1,
        totalItems: 1,
        totalPages: 1,
      });
    });

    it('handles pagination calculation accurately when multiple pages exist', async () => {
      const { service, orderRepo, expiryCandidatesQb } = setup();

      const qb = {
        leftJoinAndSelect: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        addOrderBy: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        take: vi.fn().mockReturnThis(),
        getManyAndCount: vi.fn().mockResolvedValue([[], 45]),
      };

      orderRepo.createQueryBuilder
        .mockReturnValueOnce(expiryCandidatesQb)
        .mockReturnValueOnce(qb);

      const result = await service.getSellerOrders(sellerAId, {
        page: 3,
        limit: 10,
      });

      expect(qb.skip).toHaveBeenCalledWith(20);
      expect(qb.take).toHaveBeenCalledWith(10);
      expect(qb.andWhere).toHaveBeenCalledWith(
        'order.status != :unpaidStatus',
        { unpaidStatus: 'PENDING_PAYMENT' },
      );
      expect(result.meta).toEqual({
        page: 3,
        limit: 10,
        total: 45,
        totalItems: 45,
        totalPages: 5,
      });
    });
  });

  describe('Scenario 2 — Seller B attempts to access Seller A order (IDOR Protection)', () => {
    it('getSellerOrderById rejects cross-shop query and throws NotFoundException', async () => {
      const { service, orderRepo } = setup();

      orderRepo.findOne.mockResolvedValue(null);

      await expect(
        service.getSellerOrderById(sellerBId, orderAId),
      ).rejects.toThrow(NotFoundException);

      expect(orderRepo.findOne).toHaveBeenCalledWith({
        where: {
          id: orderAId,
          sellerId: sellerBId.toLowerCase(),
        },
        relations: { items: true, checkoutSession: true },
      });
    });

    it('confirmSellerOrder rejects Seller B confirmation on Seller A order without mutating state', async () => {
      const { service, orderRepo, orderStateMachine } = setup();

      orderRepo.findOne.mockResolvedValue(null);

      await expect(
        service.confirmSellerOrder(sellerBId, orderAId, {
          note: 'Malicious attempt by Seller B',
        }),
      ).rejects.toThrow(NotFoundException);

      expect(orderRepo.findOne).toHaveBeenCalledWith({
        where: { id: orderAId, sellerId: sellerBId },
      });
      expect(orderStateMachine.transition).not.toHaveBeenCalled();
    });

    it('shipSellerOrder rejects Seller B shipping on Seller A order without mutating state', async () => {
      const { service, orderRepo, orderStateMachine } = setup();

      orderRepo.findOne.mockResolvedValue(null);

      await expect(
        service.shipSellerOrder(sellerBId, orderAId, {
          trackingCode: 'ILLEGAL-TRACK',
          carrierName: 'HackerExpress',
        }),
      ).rejects.toThrow(NotFoundException);

      expect(orderRepo.findOne).toHaveBeenCalledWith({
        where: { id: orderAId, sellerId: sellerBId },
      });
      expect(orderStateMachine.transition).not.toHaveBeenCalled();
    });
  });

  describe('Scenario 3 — PENDING_PAYMENT order cannot be confirmed', () => {
    it('rejects confirmation with ConflictException ORDER_STATUS_INVALID when order is unpaid', async () => {
      const { service, orderRepo, orderStateMachine } = setup();

      const unpaidOrder = {
        id: orderAId,
        sellerId: sellerAId,
        status: 'PENDING_PAYMENT' as OrderStatus,
      };

      orderRepo.findOne.mockResolvedValue(unpaidOrder);

      const promise = service.confirmSellerOrder(sellerAId, orderAId, {
        note: 'Attempting to confirm unpaid order',
      });

      await expect(promise).rejects.toThrow(ConflictException);
      await expect(promise).rejects.toMatchObject({
        response: {
          errorCode: 'ORDER_STATUS_INVALID',
          message: expect.stringContaining(
            'Chỉ có thể xác nhận đơn hàng đang ở trạng thái PAID',
          ),
        },
      });

      expect(unpaidOrder.status).toBe('PENDING_PAYMENT');
      expect(orderStateMachine.transition).not.toHaveBeenCalled();
    });

    it('rejects confirmation when order is already in PROCESSING, CANCELLED or DELIVERED status', async () => {
      const { service, orderRepo, orderStateMachine } = setup();

      const invalidStatuses: OrderStatus[] = [
        'PROCESSING',
        'SHIPPED',
        'DELIVERED',
        'CANCELLED',
      ];

      for (const invalidStatus of invalidStatuses) {
        orderRepo.findOne.mockResolvedValue({
          id: orderAId,
          sellerId: sellerAId,
          status: invalidStatus,
        });

        await expect(
          service.confirmSellerOrder(sellerAId, orderAId),
        ).rejects.toThrow(ConflictException);
      }

      expect(orderStateMachine.transition).not.toHaveBeenCalled();
    });
  });

  describe('Scenario 4 — Successful confirmation and shipping', () => {
    it('successfully confirms a PAID order, invokes StateMachine with PROCESSING, and returns valid response', async () => {
      const { service, orderRepo, orderStateMachine } = setup();

      const paidOrder = {
        id: orderAId,
        sellerId: sellerAId,
        status: 'PAID' as OrderStatus,
      };

      orderRepo.findOne.mockResolvedValue(paidOrder);

      const result = await service.confirmSellerOrder(sellerAId, orderAId, {
        note: 'Đóng gói chuẩn bị giao ngay',
      });

      expect(orderStateMachine.transition).toHaveBeenCalledWith(
        expect.anything(),
        {
          orderId: orderAId,
          toStatus: 'PROCESSING',
          actorId: sellerAId,
          reason: 'Đóng gói chuẩn bị giao ngay',
        },
      );

      expect(result).toEqual({
        orderId: orderAId,
        status: 'PROCESSING',
        updatedAt: expect.any(Date),
      });
    });

    it('successfully ships a PROCESSING order with normalized trackingCode and carrierName in transition reason', async () => {
      const { service, orderRepo, orderStateMachine } = setup();

      const processingOrder = {
        id: orderAId,
        sellerId: sellerAId,
        status: 'PROCESSING' as OrderStatus,
        paymentMethod: 'COD',
      };

      orderRepo.findOne.mockResolvedValue(processingOrder);

      const result = await service.shipSellerOrder(sellerAId, orderAId, {
        carrierName: 'Viettel Post',
        trackingCode: 'VTP-VN-888999',
        note: 'Đã bàn giao cho bưu tá tại kho Q9',
      });

      expect(orderStateMachine.transition).toHaveBeenCalledWith(
        expect.anything(),
        {
          orderId: orderAId,
          toStatus: 'SHIPPED',
          actorId: sellerAId,
          reason:
            'Đơn vị vận chuyển: Viettel Post | Mã vận đơn: VTP-VN-888999 | Ghi chú: Đã bàn giao cho bưu tá tại kho Q9',
        },
      );

      expect(result).toEqual({
        orderId: orderAId,
        status: 'SHIPPED',
        trackingCode: 'VTP-VN-888999',
        carrierName: 'Viettel Post',
        updatedAt: expect.any(Date),
      });

      // Finding B: COD orders (no successful payment) deduct total_qty & release reserved_qty upon shipment
      const codSetup = setup({ hasPaidPayment: 0 });
      codSetup.orderRepo.findOne.mockResolvedValue(processingOrder);
      await codSetup.service.shipSellerOrder(sellerAId, orderAId, {
        carrierName: 'Viettel Post',
        trackingCode: 'VTP-VN-888999',
      });
      expect(codSetup.inventoryReservation.deduct).toHaveBeenCalledWith(
        [{ skuId: 'sku-1', quantity: 2, warehouseId: undefined }],
        expect.anything(),
        expect.objectContaining({
          orderId: orderAId,
          actorId: sellerAId,
        }),
      );

      // Paid orders (hasPaidPayment > 0) do NOT deduct again on shipment
      const paidSetup = setup({ hasPaidPayment: 1 });
      paidSetup.orderRepo.findOne.mockResolvedValue({
        ...processingOrder,
        paymentMethod: 'PAYOS',
      });
      await paidSetup.service.shipSellerOrder(sellerAId, orderAId, {
        carrierName: 'Viettel Post',
        trackingCode: 'VTP-VN-888999',
      });
      expect(paidSetup.inventoryReservation.deduct).not.toHaveBeenCalled();

      // PayOS orders without successful payment must reject safely and NOT deduct stock
      const payosUnpaidSetup = setup({ hasPaidPayment: 0 });
      payosUnpaidSetup.orderRepo.findOne.mockResolvedValue({
        ...processingOrder,
        paymentMethod: 'PAYOS',
      });
      await expect(
        payosUnpaidSetup.service.shipSellerOrder(sellerAId, orderAId, {
          carrierName: 'Viettel Post',
          trackingCode: 'VTP-VN-888999',
        }),
      ).rejects.toMatchObject({
        status: 409,
        response: { errorCode: 'ORDER_PAYMENT_UNCONFIRMED' },
      });
      expect(
        payosUnpaidSetup.inventoryReservation.deduct,
      ).not.toHaveBeenCalled();

      // Stripe orders without successful payment must reject safely and NOT deduct stock
      const stripeUnpaidSetup = setup({ hasPaidPayment: 0 });
      stripeUnpaidSetup.orderRepo.findOne.mockResolvedValue({
        ...processingOrder,
        paymentMethod: 'STRIPE',
      });
      await expect(
        stripeUnpaidSetup.service.shipSellerOrder(sellerAId, orderAId, {
          carrierName: 'Viettel Post',
          trackingCode: 'VTP-VN-888999',
        }),
      ).rejects.toMatchObject({
        status: 409,
        response: { errorCode: 'ORDER_PAYMENT_UNCONFIRMED' },
      });
      expect(
        stripeUnpaidSetup.inventoryReservation.deduct,
      ).not.toHaveBeenCalled();

      // NULL or unknown payment method without successful payment must reject safely
      const nullMethodSetup = setup({ hasPaidPayment: 0 });
      nullMethodSetup.orderRepo.findOne.mockResolvedValue({
        ...processingOrder,
        paymentMethod: null,
      });
      await expect(
        nullMethodSetup.service.shipSellerOrder(sellerAId, orderAId, {
          carrierName: 'Viettel Post',
          trackingCode: 'VTP-VN-888999',
        }),
      ).rejects.toMatchObject({
        status: 409,
        response: { errorCode: 'ORDER_PAYMENT_UNCONFIRMED' },
      });
      expect(
        nullMethodSetup.inventoryReservation.deduct,
      ).not.toHaveBeenCalled();

      const unknownMethodSetup = setup({ hasPaidPayment: 0 });
      unknownMethodSetup.orderRepo.findOne.mockResolvedValue({
        ...processingOrder,
        paymentMethod: 'CRYPTO_UNKNOWN',
      });
      await expect(
        unknownMethodSetup.service.shipSellerOrder(sellerAId, orderAId, {
          carrierName: 'Viettel Post',
          trackingCode: 'VTP-VN-888999',
        }),
      ).rejects.toMatchObject({
        status: 409,
        response: { errorCode: 'ORDER_PAYMENT_UNCONFIRMED' },
      });
      expect(
        unknownMethodSetup.inventoryReservation.deduct,
      ).not.toHaveBeenCalled();
    });

    it.each([
      undefined,
      {},
      { trackingCode: '   ', carrierName: 'Carrier' },
      { trackingCode: 'TRACK', carrierName: '' },
      { trackingCode: 'x'.repeat(101), carrierName: 'Carrier' },
      { trackingCode: 'TRACK', carrierName: 'x'.repeat(101) },
    ])('rejects invalid shipping payload %j before mutation', async (dto) => {
      const { service, orderStateMachine, orderRepo, dataSource } = setup();
      await expect(
        service.shipSellerOrder(sellerAId, orderAId, dto as never),
      ).rejects.toThrow(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(orderStateMachine.transition).not.toHaveBeenCalled();
      expect(orderRepo.save).not.toHaveBeenCalled();
    });

    it('rejects the transaction when shipment persistence fails', async () => {
      const { service, orderRepo } = setup();
      orderRepo.findOne.mockResolvedValue({
        id: orderAId,
        status: 'PROCESSING',
      });
      orderRepo.save.mockRejectedValue(new Error('Database failure'));
      await expect(
        service.shipSellerOrder(sellerAId, orderAId, {
          trackingCode: 'TRACK',
          carrierName: 'Carrier',
        }),
      ).rejects.toThrow('Database failure');
    });

    it('persists trimmed tracking and returns it on Seller and Buyer detail reload', async () => {
      const { service, orderRepo } = setup();
      orderRepo.findOne.mockResolvedValue({
        id: orderAId,
        status: 'PROCESSING',
      });
      const result = await service.shipSellerOrder(sellerAId, orderAId, {
        trackingCode: ' TRACK ',
        carrierName: ' Carrier ',
      });
      expect(orderRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: orderAId,
          status: 'SHIPPED',
          trackingCode: 'TRACK',
          carrierName: 'Carrier',
        }),
      );
      expect(result.updatedAt).toEqual(new Date('2026-11-04T10:00:00Z'));
      const stored = { ...orderRepo.save.mock.calls[0][0], items: [] };
      orderRepo.findOne.mockResolvedValue(stored);
      const qb = {
        innerJoin: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getRawMany: vi.fn().mockResolvedValue([]),
      };
      orderRepo.createQueryBuilder.mockReturnValue(qb);
      for (const detail of [
        await service.getSellerOrderById(sellerAId, orderAId),
        await service.getOrderById('buyer', orderAId),
      ]) {
        expect(detail).toMatchObject({
          status: 'SHIPPED',
          trackingCode: 'TRACK',
          carrierName: 'Carrier',
        });
      }
    });

    it('rejects shipping with ConflictException ORDER_STATUS_INVALID if order is still in PAID or PENDING_PAYMENT status', async () => {
      const { service, orderRepo, orderStateMachine } = setup();

      const notProcessingStatuses: OrderStatus[] = [
        'PAID',
        'PENDING_PAYMENT',
        'SHIPPED',
        'DELIVERED',
      ];

      for (const status of notProcessingStatuses) {
        orderRepo.findOne.mockResolvedValue({
          id: orderAId,
          sellerId: sellerAId,
          status,
        });

        const promise = service.shipSellerOrder(sellerAId, orderAId, {
          trackingCode: 'VTP-123',
          carrierName: 'Viettel Post',
        });

        await expect(promise).rejects.toThrow(ConflictException);
        await expect(promise).rejects.toMatchObject({
          response: {
            errorCode: 'ORDER_STATUS_INVALID',
            message: expect.stringContaining(
              'Chỉ có thể giao đơn hàng đang ở trạng thái PROCESSING',
            ),
          },
        });
      }

      expect(orderStateMachine.transition).not.toHaveBeenCalled();
    });
  });

  describe('Scenario 4 — GHN Express Auto-shipping & Webhook Lifecycle', () => {
    describe('shipSellerOrderWithGhn', () => {
      it('throws ServiceUnavailableException when ghnClientService is not configured', async () => {
        const { service } = setup();
        await expect(
          service.shipSellerOrderWithGhn(sellerAId, orderAId),
        ).rejects.toThrow(ServiceUnavailableException);
      });

      it('throws NotFoundException when order does not exist or belongs to another seller', async () => {
        const ghnClient = { createNewAddressOrder: vi.fn() };
        const { service, orderRepo } = setup({ ghnClientService: ghnClient });
        orderRepo.findOne.mockResolvedValue(null);

        await expect(
          service.shipSellerOrderWithGhn(sellerAId, orderAId),
        ).rejects.toThrow(NotFoundException);
        expect(ghnClient.createNewAddressOrder).not.toHaveBeenCalled();
      });

      it('throws ConflictException when order status is not PROCESSING', async () => {
        const ghnClient = { createNewAddressOrder: vi.fn() };
        const { service, orderRepo } = setup({ ghnClientService: ghnClient });
        orderRepo.findOne.mockResolvedValue({
          id: orderAId,
          sellerId: sellerAId,
          status: 'PAID',
        });

        await expect(
          service.shipSellerOrderWithGhn(sellerAId, orderAId),
        ).rejects.toThrow(ConflictException);
        expect(ghnClient.createNewAddressOrder).not.toHaveBeenCalled();
      });

      it('successfully creates GHN shipping order and transitions status to SHIPPED', async () => {
        const ghnClient = {
          createNewAddressOrder: vi.fn().mockResolvedValue({
            order_code: 'GHN-AUTO-999',
            total_fee: 32000,
            expected_delivery_time: '2026-11-09T18:00:00Z',
            print_url: 'https://print.ghn.vn/order/GHN-AUTO-999',
          }),
        };
        const { service, orderRepo, orderStateMachine } = setup({
          ghnClientService: ghnClient,
        });

        orderRepo.findOne.mockResolvedValue({
          id: orderAId,
          sellerId: sellerAId,
          status: 'PROCESSING',
          paymentMethod: 'COD',
          shippingAddressSnapshot: {
            recipientName: 'Nguyen Van A',
            recipientPhone: '0987654321',
            addressLine: '123 Nguyen Hue',
            addressScheme: 'ghn_v3',
            wardName: 'Ward',
            provinceName: 'Hà Nội',
          },
          items: [
            {
              productNameSnapshot: 'Ao khoac Gio',
              skuId: 'sku-1',
              quantity: 2,
              unitPrice: '150000.00',
            },
          ],
        });

        const result = await service.shipSellerOrderWithGhn(
          sellerAId,
          orderAId,
        );

        expect(ghnClient.createNewAddressOrder).toHaveBeenCalledWith(
          expect.objectContaining({
            recipientName: 'Nguyen Van A',
            recipientPhone: '0987654321',
            addressLine: '123 Nguyen Hue',
            wardName: 'Ward',
            provinceName: 'Hà Nội',
            weightGrams: 400,
            clientOrderCode: orderAId,
          }),
        );

        expect(orderStateMachine.transition).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            orderId: orderAId,
            toStatus: 'SHIPPED',
            actorId: sellerAId,
          }),
        );

        expect(orderRepo.save).toHaveBeenCalledWith(
          expect.objectContaining({
            trackingCode: 'GHN-AUTO-999',
            carrierName: 'GHN',
          }),
        );

        expect(result).toEqual({
          orderId: orderAId,
          status: 'SHIPPED',
          trackingCode: 'GHN-AUTO-999',
          carrierName: 'GHN',
          totalFee: 32000,
          expectedDeliveryTime: '2026-11-09T18:00:00Z',
          printUrl: 'https://print.ghn.vn/order/GHN-AUTO-999',
          updatedAt: expect.any(Date),
        });
      });

      it('rejects shipSellerOrderWithGhn safely when online order (PayOS) has not been paid', async () => {
        const ghnClient = {
          createNewAddressOrder: vi.fn().mockResolvedValue({
            order_code: 'GHN-AUTO-999',
          }),
        };
        const { service, orderRepo, inventoryReservation } = setup({
          ghnClientService: ghnClient,
          hasPaidPayment: 0,
        });

        orderRepo.findOne.mockResolvedValue({
          id: orderAId,
          sellerId: sellerAId,
          status: 'PROCESSING',
          paymentMethod: 'PAYOS',
          shippingAddressSnapshot: {
            recipientName: 'Nguyen Van A',
            recipientPhone: '0987654321',
            addressLine: '123 Nguyen Hue',
            addressScheme: 'ghn_v3',
            wardName: 'Ward',
            provinceName: 'Hà Nội',
          },
          items: [
            {
              productNameSnapshot: 'Ao khoac Gio',
              skuId: 'sku-1',
              quantity: 2,
              unitPrice: '150000.00',
            },
          ],
        });

        await expect(
          service.shipSellerOrderWithGhn(sellerAId, orderAId),
        ).rejects.toMatchObject({
          status: 409,
          response: { errorCode: 'ORDER_PAYMENT_UNCONFIRMED' },
        });

        expect(inventoryReservation.deduct).not.toHaveBeenCalled();
      });
    });

    describe('markOrderAsDeliveredViaCarrier', () => {
      it('throws NotFoundException when order with tracking code is not found', async () => {
        const { service, orderRepo } = setup();
        orderRepo.findOne.mockResolvedValue(null);

        await expect(
          service.markOrderAsDeliveredViaCarrier('NON-EXISTENT'),
        ).rejects.toThrow(NotFoundException);
      });

      it('is idempotent: returns alreadyDelivered: true if order is already DELIVERED', async () => {
        const { service, orderRepo, orderStateMachine } = setup();
        orderRepo.findOne.mockResolvedValue({
          id: orderAId,
          orderNumber: 'ORD-DELIVERED-001',
          status: 'DELIVERED',
          trackingCode: 'GHN-DELIVERED-001',
          deliveredAt: new Date('2026-11-05T12:00:00Z'),
          updatedAt: new Date('2026-11-05T12:00:00Z'),
        });

        const result =
          await service.markOrderAsDeliveredViaCarrier('GHN-DELIVERED-001');

        expect(result).toEqual({
          orderId: orderAId,
          orderNumber: 'ORD-DELIVERED-001',
          status: 'DELIVERED',
          trackingCode: 'GHN-DELIVERED-001',
          deliveredAt: new Date('2026-11-05T12:00:00Z'),
          alreadyDelivered: true,
          updatedAt: new Date('2026-11-05T12:00:00Z'),
        });
        expect(orderStateMachine.transition).not.toHaveBeenCalled();
      });

      it('throws ConflictException if order is not in SHIPPED status', async () => {
        const { service, orderRepo, orderStateMachine } = setup();
        orderRepo.findOne.mockResolvedValue({
          id: orderAId,
          status: 'PROCESSING',
          trackingCode: 'GHN-PROCESSING-001',
        });

        await expect(
          service.markOrderAsDeliveredViaCarrier('GHN-PROCESSING-001'),
        ).rejects.toThrow(ConflictException);
        expect(orderStateMachine.transition).not.toHaveBeenCalled();
      });

      it('transitions order from SHIPPED to DELIVERED successfully', async () => {
        const { service, orderRepo, orderStateMachine } = setup();
        orderRepo.findOne.mockResolvedValue({
          id: orderAId,
          orderNumber: 'ORD-SHIPPED-001',
          status: 'SHIPPED',
          trackingCode: 'GHN-SHIPPED-001',
          updatedAt: new Date('2026-11-05T10:00:00Z'),
        });

        const result =
          await service.markOrderAsDeliveredViaCarrier('GHN-SHIPPED-001');

        expect(orderStateMachine.transition).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            orderId: orderAId,
            toStatus: 'DELIVERED',
            actorId: null,
          }),
        );
        expect(orderRepo.save).toHaveBeenCalled();
        expect(result).toEqual({
          orderId: orderAId,
          orderNumber: 'ORD-SHIPPED-001',
          status: 'DELIVERED',
          trackingCode: 'GHN-SHIPPED-001',
          deliveredAt: expect.any(Date),
          alreadyDelivered: false,
          updatedAt: expect.any(Date),
        });
      });
    });
  });
});
