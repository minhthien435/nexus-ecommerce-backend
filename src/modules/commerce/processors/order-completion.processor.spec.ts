import { describe, expect, it, vi } from 'vitest';
import { OrderCompletionProcessor } from './order-completion.processor.js';

describe('OrderCompletionProcessor', () => {
  it('automatically transitions eligible DELIVERED orders past 72h with no disputes to COMPLETED', async () => {
    const mockOrders = [
      { id: 'order-1', order_number: 'ORD-001' },
      { id: 'order-2', order_number: 'ORD-002' },
    ];
    const orderRepo = {
      save: vi.fn().mockImplementation((order) => Promise.resolve(order)),
    };
    const manager = {
      query: vi.fn().mockResolvedValue(mockOrders),
      getRepository: vi.fn().mockReturnValue(orderRepo),
    };
    const dataSource = {
      transaction: vi.fn().mockImplementation((_mode, cb) => cb(manager)),
    };
    const stateMachine = {
      transition: vi.fn().mockImplementation((_mgr, input) =>
        Promise.resolve({
          id: input.orderId,
          status: input.toStatus,
          updatedAt: new Date(),
        }),
      ),
    };

    const processor = new OrderCompletionProcessor(
      dataSource as never,
      stateMachine as never,
    );

    const count = await processor.process({} as never);
    expect(count).toBe(2);
    expect(stateMachine.transition).toHaveBeenCalledTimes(2);
    expect(stateMachine.transition).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        orderId: 'order-1',
        toStatus: 'COMPLETED',
        actorId: null,
      }),
    );
    expect(orderRepo.save).toHaveBeenCalledTimes(2);
  });

  it('returns 0 when no eligible orders need completion', async () => {
    const manager = {
      query: vi.fn().mockResolvedValue([]),
      getRepository: vi.fn(),
    };
    const dataSource = {
      transaction: vi.fn().mockImplementation((_mode, cb) => cb(manager)),
    };
    const stateMachine = {
      transition: vi.fn(),
    };

    const processor = new OrderCompletionProcessor(
      dataSource as never,
      stateMachine as never,
    );

    const count = await processor.process({} as never);
    expect(count).toBe(0);
    expect(stateMachine.transition).not.toHaveBeenCalled();
  });
});
