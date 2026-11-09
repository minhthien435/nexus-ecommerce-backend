import { describe, expect, it, vi } from 'vitest';
import { OrderController } from './order.controller.js';

describe('OrderController', () => {
  it('calls orderService.confirmOrderDeliveryByBuyer on completeOrder and returns envelope', async () => {
    const orderService = {
      checkout: vi.fn(),
      getBuyerOrders: vi.fn(),
      getOrderById: vi.fn(),
      cancelOrder: vi.fn(),
      confirmOrderDeliveryByBuyer: vi.fn().mockResolvedValue({
        orderId: 'order-123',
        orderNumber: 'ORD-123',
        status: 'COMPLETED',
        updatedAt: new Date('2026-11-09T08:00:00Z'),
      }),
    };

    const controller = new OrderController(orderService as never);
    const result = await controller.completeOrder('buyer-1', 'order-123');

    expect(orderService.confirmOrderDeliveryByBuyer).toHaveBeenCalledWith(
      'buyer-1',
      'order-123',
    );
    expect(result).toEqual({
      success: true,
      statusCode: 200,
      message: 'Xác nhận nhận hàng thành công. Đơn hàng đã hoàn tất.',
      data: {
        orderId: 'order-123',
        orderNumber: 'ORD-123',
        status: 'COMPLETED',
        updatedAt: new Date('2026-11-09T08:00:00Z'),
      },
    });
  });

  it('calls orderService.getOrderDisputeByBuyer on getOrderDispute and returns envelope', async () => {
    const mockDispute = {
      id: 'dispute-1',
      orderId: 'order-1',
      orderNumber: '#ORD-1',
      status: 'PENDING_STAFF_REVIEW',
      reasonCategory: 'DAMAGED',
      evidenceDescription: 'Broken box',
      evidenceImages: [],
      staffDecisionNote: null,
      resolvedAt: null,
      createdAt: new Date('2026-11-09T08:00:00Z'),
      updatedAt: new Date('2026-11-09T08:00:00Z'),
    };
    const orderService = {
      getOrderDisputeByBuyer: vi.fn().mockResolvedValue(mockDispute),
    };

    const controller = new OrderController(orderService as never);
    const result = await controller.getOrderDispute('buyer-1', '#ORD-1');

    expect(orderService.getOrderDisputeByBuyer).toHaveBeenCalledWith(
      'buyer-1',
      '#ORD-1',
    );
    expect(result).toEqual({
      success: true,
      statusCode: 200,
      message: 'Lấy thông tin khiếu nại của đơn hàng thành công',
      data: mockDispute,
    });
  });

  it('returns data null and appropriate message when order has no dispute', async () => {
    const orderService = {
      getOrderDisputeByBuyer: vi.fn().mockResolvedValue(null),
    };

    const controller = new OrderController(orderService as never);
    const result = await controller.getOrderDispute('buyer-1', '#ORD-1');

    expect(result).toEqual({
      success: true,
      statusCode: 200,
      message: 'Đơn hàng chưa có khiếu nại nào',
      data: null,
    });
  });
});
