import { describe, expect, it, vi } from 'vitest';
import { SupportOrderController } from './support-order.controller.js';

describe('SupportOrderController', () => {
  it('returns the project envelope for list, detail, and markDelivered', async () => {
    const service = {
      list: vi.fn().mockResolvedValue({
        data: [{ id: 'order-1' }],
        meta: { page: 1, limit: 20, totalItems: 1, totalPages: 1 },
      }),
      detail: vi.fn().mockResolvedValue({ id: 'order-1' }),
    };
    const orderService = {
      markOrderAsDelivered: vi.fn().mockResolvedValue({
        orderId: 'order-1',
        orderNumber: 'ORD-123',
        status: 'DELIVERED',
        deliveredAt: new Date('2026-11-09T08:00:00Z'),
        updatedAt: new Date('2026-11-09T08:00:00Z'),
      }),
    };
    const controller = new SupportOrderController(
      service as never,
      orderService as never,
    );

    await expect(controller.list({ page: 1, limit: 20 })).resolves.toEqual({
      success: true,
      statusCode: 200,
      message: 'Lấy danh sách đơn hàng hỗ trợ thành công',
      data: [{ id: 'order-1' }],
      meta: { page: 1, limit: 20, totalItems: 1, totalPages: 1 },
    });

    await expect(controller.detail('order-1')).resolves.toEqual({
      success: true,
      statusCode: 200,
      message: 'Lấy chi tiết đơn hàng hỗ trợ thành công',
      data: { id: 'order-1' },
    });

    const markResult = await controller.markDelivered('staff-1', 'order-1', {
      reason: 'Khách hàng gọi tổng đài xác nhận đã nhận hàng',
    });
    expect(orderService.markOrderAsDelivered).toHaveBeenCalledWith({
      orderId: 'order-1',
      actorId: 'staff-1',
      reason: 'Khách hàng gọi tổng đài xác nhận đã nhận hàng',
      source: 'SUPPORT_MANUAL',
    });
    expect(markResult).toEqual({
      success: true,
      statusCode: 200,
      message: 'Xác nhận đơn hàng đã giao thành công',
      data: {
        orderId: 'order-1',
        orderNumber: 'ORD-123',
        status: 'DELIVERED',
        deliveredAt: new Date('2026-11-09T08:00:00Z'),
        updatedAt: new Date('2026-11-09T08:00:00Z'),
      },
    });
  });
});
