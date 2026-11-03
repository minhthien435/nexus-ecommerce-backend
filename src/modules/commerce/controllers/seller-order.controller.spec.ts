import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SellerOrderController } from './seller-order.controller.js';
import type { OrderService } from '../services/order.service.js';
import type { QuerySellerOrdersDto } from '../dtos/query-seller-orders.dto.js';
import type { ConfirmSellerOrderDto } from '../dtos/confirm-seller-order.dto.js';
import type { ShipSellerOrderDto } from '../dtos/ship-seller-order.dto.js';

describe('SellerOrderController', () => {
  let controller: SellerOrderController;
  let orderService: OrderService;

  const sellerId = 'seller-uuid-1';
  const orderId = 'order-uuid-1';

  beforeEach(() => {
    orderService = {
      getSellerOrders: vi.fn(),
      getSellerOrderById: vi.fn(),
      confirmSellerOrder: vi.fn(),
      shipSellerOrder: vi.fn(),
    } as unknown as OrderService;

    controller = new SellerOrderController(orderService);
  });

  describe('getSellerOrders', () => {
    it('returns envelope format with seller orders and pagination metadata', async () => {
      const query: QuerySellerOrdersDto = {
        page: 1,
        limit: 10,
        status: 'PAID',
      };
      const serviceResult = {
        data: [{ id: orderId, sellerId, status: 'PAID' }],
        meta: { page: 1, limit: 10, totalItems: 1, totalPages: 1 },
      };

      vi.mocked(orderService.getSellerOrders).mockResolvedValue(
        serviceResult as never,
      );

      const response = await controller.getSellerOrders(sellerId, query);

      expect(orderService.getSellerOrders).toHaveBeenCalledWith(
        sellerId,
        query,
      );
      expect(response).toEqual({
        success: true,
        statusCode: 200,
        message: 'Lấy danh sách đơn hàng của người bán thành công',
        data: serviceResult.data,
        meta: serviceResult.meta,
      });
    });
  });

  describe('getSellerOrderById', () => {
    it('returns envelope format with order details', async () => {
      const orderDetail = {
        id: orderId,
        sellerId,
        status: 'PAID',
        items: [],
        history: [],
      };

      vi.mocked(orderService.getSellerOrderById).mockResolvedValue(
        orderDetail as never,
      );

      const response = await controller.getSellerOrderById(sellerId, orderId);

      expect(orderService.getSellerOrderById).toHaveBeenCalledWith(
        sellerId,
        orderId,
      );
      expect(response).toEqual({
        success: true,
        statusCode: 200,
        message: 'Lấy chi tiết đơn hàng của người bán thành công',
        data: orderDetail,
      });
    });
  });

  describe('confirmOrder', () => {
    it('confirms the order and returns transition response', async () => {
      const dto: ConfirmSellerOrderDto = { note: 'Shop chuẩn bị hàng ngay' };
      const serviceResult = {
        orderId,
        status: 'PROCESSING' as const,
        updatedAt: new Date('2026-11-03T10:00:00Z'),
      };

      vi.mocked(orderService.confirmSellerOrder).mockResolvedValue(
        serviceResult as never,
      );

      const response = await controller.confirmOrder(sellerId, orderId, dto);

      expect(orderService.confirmSellerOrder).toHaveBeenCalledWith(
        sellerId,
        orderId,
        dto,
      );
      expect(response).toEqual({
        success: true,
        statusCode: 200,
        message:
          'Xác nhận đơn hàng thành công, chuyển sang trạng thái đang xử lý',
        data: serviceResult,
      });
    });
  });

  describe('shipOrder', () => {
    it('marks order as shipped and returns carrier details', async () => {
      const dto: ShipSellerOrderDto = {
        trackingCode: 'GHN-VN-123456',
        carrierName: 'Giao Hàng Nhanh',
        note: 'Đã gửi tại bưu cục Thủ Đức',
      };
      const serviceResult = {
        orderId,
        status: 'SHIPPED' as const,
        trackingCode: 'GHN-VN-123456',
        carrierName: 'Giao Hàng Nhanh',
        updatedAt: new Date('2026-11-03T11:00:00Z'),
      };

      vi.mocked(orderService.shipSellerOrder).mockResolvedValue(
        serviceResult as never,
      );

      const response = await controller.shipOrder(sellerId, orderId, dto);

      expect(orderService.shipSellerOrder).toHaveBeenCalledWith(
        sellerId,
        orderId,
        dto,
      );
      expect(response).toEqual({
        success: true,
        statusCode: 200,
        message:
          'Bàn giao vận chuyển thành công, đơn hàng đang trên đường giao',
        data: serviceResult,
      });
    });
  });
});
