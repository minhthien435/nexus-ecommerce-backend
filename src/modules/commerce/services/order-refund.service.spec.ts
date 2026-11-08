import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AuditLogEntity } from '../../identity/domain/audit-log.entity.js';
import { OrderRefundEntity } from '../domain/entities/order-refund.entity.js';
import { OrderEntity } from '../domain/entities/order.entity.js';
import { PaymentEntity } from '../domain/entities/payment.entity.js';
import type { OrderStateMachineService } from './order-state-machine.service.js';
import { OrderRefundService } from './order-refund.service.js';

function qb(value: unknown) {
  const builder = {
    setLock: vi.fn(),
    where: vi.fn(),
    andWhere: vi.fn(),
    orderBy: vi.fn(),
    getOne: vi.fn(async () => value),
  };
  builder.setLock.mockReturnValue(builder);
  builder.where.mockReturnValue(builder);
  builder.andWhere.mockReturnValue(builder);
  builder.orderBy.mockReturnValue(builder);
  return builder;
}

function setup(
  options: {
    existing?: Partial<OrderRefundEntity> | null;
    existingAfterLock?: Partial<OrderRefundEntity> | null;
    locked?: Partial<OrderRefundEntity>;
    duplicate?: Partial<OrderRefundEntity> | null;
  } = {},
) {
  const saved: unknown[] = [];
  const buyerId = '11111111-1111-4111-8111-111111111111';
  let orderLookupCount = 0;
  const refundRepo = {
    findOne: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      if ('bankReferenceCode' in where) return options.duplicate ?? null;
      orderLookupCount += 1;
      return orderLookupCount === 1
        ? (options.existing ?? null)
        : (options.existingAfterLock ?? options.existing ?? null);
    }),
    create: vi.fn((value) => value),
    save: vi.fn(async (value) => {
      const result = { id: 'refund-1', ...value };
      saved.push(result);
      return result;
    }),
    createQueryBuilder: vi.fn(() =>
      qb(
        options.locked
          ? {
              id: 'refund-1',
              orderId: 'order-1',
              status: 'REQUESTED',
              notes: null,
              ...options.locked,
            }
          : null,
      ),
    ),
    findAndCount: vi.fn(async () => [
      [{ id: 'refund-1', orderId: 'order-1' }],
      1,
    ]),
  };
  const auditRepo = {
    create: vi.fn((value) => value),
    save: vi.fn(async (value) => value),
  };
  const orderRepo = {
    find: vi.fn(async () => [{ id: 'order-1', orderNumber: 'ORD-1', buyerId }]),
    createQueryBuilder: vi.fn(() =>
      qb({
        id: 'order-1',
        orderNumber: 'ORD-1',
        buyerId,
        status: 'CANCELLED',
      }),
    ),
  };
  const paymentRepo = {
    createQueryBuilder: vi.fn(() =>
      qb({
        id: 'payment-1',
        amount: '100.00',
        currency: 'VND',
        provider: 'PAYOS',
        providerPaymentId: 'payos-1',
        status: 'SUCCEEDED',
      }),
    ),
  };
  const manager = {
    queryRunner: { isTransactionActive: true },
    getRepository: vi.fn((entity) => {
      if (entity === OrderRefundEntity) return refundRepo;
      if (entity === OrderEntity) return orderRepo;
      if (entity === PaymentEntity) return paymentRepo;
      if (entity === AuditLogEntity) return auditRepo;
      throw new Error('unexpected repository');
    }),
  };
  const dataSource = {
    transaction: vi.fn(async (callback) => callback(manager)),
  };
  const stateMachine = { transition: vi.fn(async () => ({})) };
  const identity = {
    getUsersByIds: vi.fn(async () => [
      { id: buyerId, fullName: 'Nguyen Van A' },
    ]),
  };
  const service = new OrderRefundService(
    dataSource as never,
    refundRepo as never,
    orderRepo as never,
    identity as never,
    stateMachine as unknown as OrderStateMachineService,
  );
  return {
    service,
    manager,
    refundRepo,
    orderRepo,
    identity,
    auditRepo,
    stateMachine,
    saved,
  };
}

describe('OrderRefundService', () => {
  it('creates a full refund linked to the successful payment and audits it', async () => {
    const { service, manager, refundRepo, auditRepo } = setup();
    await expect(
      service.requestFullRefund(
        'order-1',
        'staff-1',
        'cancelled',
        manager as never,
      ),
    ).resolves.toEqual({ refundId: 'refund-1', status: 'REQUESTED' });
    expect(refundRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentId: 'payment-1',
        amount: '100.00',
        idempotencyKey: 'order-refund:order-1',
      }),
    );
    expect(auditRepo.save).toHaveBeenCalledOnce();
  });

  it('returns the existing requested refund on retry', async () => {
    const { service, manager, refundRepo } = setup({
      existing: { id: 'existing-1', status: 'REQUESTED' },
    });
    await expect(
      service.requestFullRefund(
        'order-1',
        'staff-1',
        'retry',
        manager as never,
      ),
    ).resolves.toEqual({ refundId: 'existing-1', status: 'REQUESTED' });
    expect(refundRepo.save).not.toHaveBeenCalled();
  });

  it('returns a refund created by a concurrent request after acquiring the order lock', async () => {
    const { service, manager, refundRepo } = setup({
      existingAfterLock: { id: 'concurrent-1', status: 'REQUESTED' },
    });
    await expect(
      service.requestFullRefund(
        'order-1',
        'staff-1',
        'retry',
        manager as never,
      ),
    ).resolves.toEqual({ refundId: 'concurrent-1', status: 'REQUESTED' });
    expect(refundRepo.save).not.toHaveBeenCalled();
  });

  it('lists filtered refunds with stable pagination metadata', async () => {
    const { service, refundRepo, orderRepo, identity } = setup();
    await expect(
      service.list({ status: 'REQUESTED', page: 2, limit: 10 }),
    ).resolves.toEqual({
      items: [
        {
          id: 'refund-1',
          orderId: 'order-1',
          orderNumber: 'ORD-1',
          buyerName: 'Nguyen Van A',
        },
      ],
      meta: { page: 2, limit: 10, totalItems: 1, totalPages: 1 },
    });
    expect(refundRepo.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'REQUESTED' },
        skip: 10,
        take: 10,
      }),
    );
    expect(orderRepo.find).toHaveBeenCalledOnce();
    expect(identity.getUsersByIds).toHaveBeenCalledWith([
      '11111111-1111-4111-8111-111111111111',
    ]);
  });

  it('returns one total page for an empty refund list', async () => {
    const { service, refundRepo, orderRepo, identity } = setup();
    refundRepo.findAndCount.mockResolvedValueOnce([[], 0]);

    await expect(service.list({ page: 1, limit: 20 })).resolves.toEqual({
      items: [],
      meta: { page: 1, limit: 20, totalItems: 0, totalPages: 1 },
    });
    expect(orderRepo.find).not.toHaveBeenCalled();
    expect(identity.getUsersByIds).toHaveBeenCalledWith([]);
  });

  it('moves a requested refund to processing', async () => {
    const { service } = setup({ locked: { status: 'REQUESTED' } });
    await expect(service.process('refund-1', 'staff-1')).resolves.toEqual(
      expect.objectContaining({ status: 'PROCESSING' }),
    );
  });

  it('completes the refund and transitions the cancelled order atomically', async () => {
    const { service, stateMachine } = setup({
      locked: { status: 'PROCESSING' },
    });
    await expect(
      service.confirmTransferred('refund-1', 'staff-1', 'BANK-1', 'done'),
    ).resolves.toEqual(
      expect.objectContaining({
        status: 'COMPLETED',
        bankReferenceCode: 'BANK-1',
      }),
    );
    expect(stateMachine.transition).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orderId: 'order-1',
        toStatus: 'REFUNDED',
        actorId: 'staff-1',
      }),
    );
  });

  it('rejects duplicate bank references without transitioning the order', async () => {
    const { service, stateMachine } = setup({
      locked: { status: 'REQUESTED' },
      duplicate: { id: 'other' },
    });
    await expect(
      service.confirmTransferred('refund-1', 'staff-1', 'BANK-1'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(stateMachine.transition).not.toHaveBeenCalled();
  });

  it('rejects active refunds while preserving the cancelled order', async () => {
    const { service, stateMachine } = setup({
      locked: { status: 'PROCESSING' },
    });
    await expect(
      service.reject('refund-1', 'staff-1', 'invalid account'),
    ).resolves.toEqual(
      expect.objectContaining({ status: 'REJECTED', notes: 'invalid account' }),
    );
    expect(stateMachine.transition).not.toHaveBeenCalled();
  });

  it('blocks terminal refund mutations', async () => {
    const { service } = setup({ locked: { status: 'COMPLETED' } });
    await expect(service.process('refund-1', 'staff-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
