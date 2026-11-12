import { describe, expect, it, vi } from 'vitest';
import { OrderController } from './order.controller.js';

describe('OrderController', () => {
  it('adds a masked refund projection to buyer order detail', async () => {
    const orderService = {
      getOrderById: vi
        .fn()
        .mockResolvedValue({ id: 'order-1', status: 'REFUNDED' }),
    };
    const refundService = {
      getBuyerRefundForOrder: vi.fn().mockResolvedValue({
        refundCode: 'REF-ORD-1',
        buyerAccountNumber: '******6789',
      }),
    };
    const controller = new OrderController(
      orderService as never,
      refundService as never,
    );

    const result = await controller.getOrderById('buyer-1', 'order-1');

    expect(refundService.getBuyerRefundForOrder).toHaveBeenCalledWith(
      'order-1',
    );
    expect(result.data).toEqual({
      id: 'order-1',
      status: 'REFUNDED',
      refund: {
        refundCode: 'REF-ORD-1',
        buyerAccountNumber: '******6789',
      },
    });
  });

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

  it('calls refundService.updateBuyerRefundAccount on updateRefundAccount and returns envelope', async () => {
    const mockResult = {
      refundId: 'refund-1',
      orderId: 'order-1',
      refundCode: 'REF-ORD-1',
      status: 'REQUESTED',
      amount: '150000.00',
      currency: 'VND',
      buyerBankName: 'Vietcombank',
      buyerAccountNumber: '1234567890',
      buyerAccountHolderName: 'NGUYEN VAN A',
      updatedAt: new Date('2026-11-10T15:30:00Z'),
    };
    const orderService = {};
    const refundService = {
      updateBuyerRefundAccount: vi.fn().mockResolvedValue(mockResult),
    };

    const controller = new OrderController(
      orderService as never,
      refundService as never,
    );

    const dto = {
      bankName: 'Vietcombank',
      accountNumber: '1234567890',
      accountHolderName: 'NGUYEN VAN A',
    };

    const result = await controller.updateRefundAccount(
      'buyer-1',
      'order-1',
      dto,
    );

    expect(refundService.updateBuyerRefundAccount).toHaveBeenCalledWith(
      'order-1',
      'buyer-1',
      dto,
    );
    expect(result).toEqual({
      success: true,
      statusCode: 200,
      message: 'Cập nhật thông tin tài khoản hoàn tiền thành công',
      data: mockResult,
    });
  });
});
