import { SupportOrderController } from './support-order.controller.js';

describe('SupportOrderController', () => {
  it('returns the project envelope for list and detail', async () => {
    const service = {
      list: vi.fn().mockResolvedValue({
        data: [{ id: 'order-1' }],
        meta: { page: 1, limit: 20, totalItems: 1, totalPages: 1 },
      }),
      detail: vi.fn().mockResolvedValue({ id: 'order-1' }),
    };
    const controller = new SupportOrderController(service as never);

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
  });
});
