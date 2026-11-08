import { describe, expect, it } from 'vitest';
import { canTransitionOrder } from './order-status.js';

describe('canTransitionOrder', () => {
  it('cho phép các chuyển đổi trạng thái hợp lệ hiện có', () => {
    expect(canTransitionOrder('PENDING_PAYMENT', 'PAID')).toBe(true);
    expect(canTransitionOrder('PENDING_PAYMENT', 'CANCELLED')).toBe(true);
    expect(canTransitionOrder('PAID', 'PROCESSING')).toBe(true);
    expect(canTransitionOrder('PAID', 'CANCELLED')).toBe(true);
    expect(canTransitionOrder('PROCESSING', 'SHIPPED')).toBe(true);
    expect(canTransitionOrder('PROCESSING', 'CANCELLED')).toBe(true);
    expect(canTransitionOrder('SHIPPED', 'DELIVERED')).toBe(true);
    expect(canTransitionOrder('CANCELLED', 'REFUNDED')).toBe(true);
  });

  it('cho phép các chuyển đổi trạng thái phục vụ giải quyết khiếu nại (Dispute)', () => {
    // Chấp thuận khiếu nại: DELIVERED -> REFUND_REQUESTED
    expect(canTransitionOrder('DELIVERED', 'REFUND_REQUESTED')).toBe(true);
    // Bác bỏ khiếu nại: DELIVERED -> COMPLETED
    expect(canTransitionOrder('DELIVERED', 'COMPLETED')).toBe(true);
    // Xác nhận chuyển khoản hoàn tiền: REFUND_REQUESTED -> REFUNDED
    expect(canTransitionOrder('REFUND_REQUESTED', 'REFUNDED')).toBe(true);
  });

  it('chặn các chuyển đổi trạng thái không hợp lệ', () => {
    expect(canTransitionOrder('DELIVERED', 'PAID')).toBe(false);
    expect(canTransitionOrder('DELIVERED', 'PROCESSING')).toBe(false);
    expect(canTransitionOrder('DELIVERED', 'REFUNDED')).toBe(false); // Phải qua REFUND_REQUESTED
    expect(canTransitionOrder('COMPLETED', 'REFUND_REQUESTED')).toBe(false);
    expect(canTransitionOrder('REFUNDED', 'DELIVERED')).toBe(false);
    expect(canTransitionOrder('PENDING_PAYMENT', 'DELIVERED')).toBe(false);
  });
});
