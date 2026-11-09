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
});
