import { describe, expect, it, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { OrderService } from './order.service.js';
import type { OrderStatus } from '../domain/entities/order.entity.js';

const sellerId = 'seller-uuid-1';
const otherSellerId = 'seller-uuid-2';
const orderId = 'order-uuid-1';

function setup() {
  const orderRepo = {
    createQueryBuilder: vi.fn(),
    findOne: vi.fn(),
  };

  const orderHistoryRepo = {
    find: vi.fn().mockResolvedValue([]),
  };

  const orderStateMachine = {
    transition: vi.fn(),
  };

  const dataSource = {
    transaction: vi.fn(
      async (_mode: unknown, callback: (manager: unknown) => unknown) => {
        return callback({
          getRepository: (entity: unknown) => {
            return {
              findOne: orderRepo.findOne,
            };
          },
        });
      },
    ),
    query: vi.fn().mockResolvedValue([]),
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
    {} as never,
    orderStateMachine as never,
    {} as never,
    {} as never,
  );

  return {
    service,
    orderRepo,
    orderHistoryRepo,
    orderStateMachine,
    dataSource,
  };
}

describe('OrderService - Seller Orders', () => {
  describe('getSellerOrders', () => {
    it('queries orders filtered by sellerId and optional status with pagination', async () => {
      const { service, orderRepo } = setup();

      const mockOrders = [
        { id: 'o-1', sellerId, status: 'PAID' as OrderStatus, items: [] },
        { id: 'o-2', sellerId, status: 'PAID' as OrderStatus, items: [] },
      ];

      const qb = {
        leftJoinAndSelect: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        take: vi.fn().mockReturnThis(),
        getManyAndCount: vi.fn().mockResolvedValue([mockOrders, 2]),
      };

      orderRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getSellerOrders(sellerId, {
        page: 1,
        limit: 10,
        status: 'PAID',
      });

      expect(orderRepo.createQueryBuilder).toHaveBeenCalledWith('order');
      expect(qb.where).toHaveBeenCalledWith('order.sellerId = :sellerId', {
        sellerId,
      });
      expect(qb.andWhere).toHaveBeenCalledWith('order.status = :status', {
        status: 'PAID',
      });
      expect(result.data).toHaveLength(2);
      expect(result.meta).toEqual({
        page: 1,
        limit: 10,
        totalItems: 2,
        totalPages: 1,
      });
    });
  });

  describe('getSellerOrderById', () => {
    it('returns order with history when seller owns the order', async () => {
      const { service, orderRepo, orderHistoryRepo } = setup();

      const mockOrder = {
        id: orderId,
        sellerId,
        status: 'PAID' as OrderStatus,
        items: [],
      };
      const mockHistory = [
        { id: 'h-1', orderId, fromStatus: null, toStatus: 'PAID' },
      ];

      orderRepo.findOne.mockResolvedValue(mockOrder);
      orderHistoryRepo.find.mockResolvedValue(mockHistory);

      const result = await service.getSellerOrderById(sellerId, orderId);

      expect(orderRepo.findOne).toHaveBeenCalledWith({
        where: { id: orderId, sellerId },
        relations: { items: true, checkoutSession: true },
      });
      expect(result.id).toBe(orderId);
      expect(result.history).toEqual(mockHistory);
    });

    it('throws NotFoundException when order does not exist or belongs to another seller (IDOR protection)', async () => {
      const { service, orderRepo } = setup();

      orderRepo.findOne.mockResolvedValue(null);

      await expect(
        service.getSellerOrderById(otherSellerId, orderId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('confirmSellerOrder', () => {
    it('transitions order from PAID to PROCESSING', async () => {
      const { service, orderRepo, orderStateMachine } = setup();

      const mockOrder = {
        id: orderId,
        sellerId,
        status: 'PAID' as OrderStatus,
      };

      orderRepo.findOne.mockResolvedValue(mockOrder);

      const result = await service.confirmSellerOrder(sellerId, orderId, {
        note: 'Đóng gói gửi sớm',
      });

      expect(orderStateMachine.transition).toHaveBeenCalledWith(
        expect.anything(),
        {
          orderId,
          toStatus: 'PROCESSING',
          actorId: sellerId,
          reason: 'Đóng gói gửi sớm',
        },
      );
      expect(result.status).toBe('PROCESSING');
      expect(result.orderId).toBe(orderId);
    });

    it('rejects confirmation if order status is not PAID', async () => {
      const { service, orderRepo } = setup();

      const mockOrder = {
        id: orderId,
        sellerId,
        status: 'PENDING_PAYMENT' as OrderStatus,
      };

      orderRepo.findOne.mockResolvedValue(mockOrder);

      await expect(
        service.confirmSellerOrder(sellerId, orderId),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects confirmation if seller does not own order', async () => {
      const { service, orderRepo } = setup();

      orderRepo.findOne.mockResolvedValue(null);

      await expect(
        service.confirmSellerOrder(otherSellerId, orderId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('shipSellerOrder', () => {
    it('transitions order from PROCESSING to SHIPPED with tracking info', async () => {
      const { service, orderRepo, orderStateMachine } = setup();

      const mockOrder = {
        id: orderId,
        sellerId,
        status: 'PROCESSING' as OrderStatus,
      };

      orderRepo.findOne.mockResolvedValue(mockOrder);

      const result = await service.shipSellerOrder(sellerId, orderId, {
        carrierName: 'Giao Hàng Nhanh',
        trackingCode: 'GHN-VN-987654',
        note: 'Bưu tá đã lấy hàng',
      });

      expect(orderStateMachine.transition).toHaveBeenCalledWith(
        expect.anything(),
        {
          orderId,
          toStatus: 'SHIPPED',
          actorId: sellerId,
          reason:
            'Đơn vị vận chuyển: Giao Hàng Nhanh | Mã vận đơn: GHN-VN-987654 | Ghi chú: Bưu tá đã lấy hàng',
        },
      );
      expect(result.status).toBe('SHIPPED');
      expect(result.trackingCode).toBe('GHN-VN-987654');
      expect(result.carrierName).toBe('Giao Hàng Nhanh');
    });

    it('rejects shipping if order status is not PROCESSING', async () => {
      const { service, orderRepo } = setup();

      const mockOrder = {
        id: orderId,
        sellerId,
        status: 'PAID' as OrderStatus,
      };

      orderRepo.findOne.mockResolvedValue(mockOrder);

      await expect(
        service.shipSellerOrder(sellerId, orderId, {
          trackingCode: 'GHN-123',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects shipping if seller does not own order', async () => {
      const { service, orderRepo } = setup();

      orderRepo.findOne.mockResolvedValue(null);

      await expect(
        service.shipSellerOrder(otherSellerId, orderId),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
