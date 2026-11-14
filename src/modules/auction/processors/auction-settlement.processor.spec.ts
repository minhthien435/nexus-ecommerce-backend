import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuctionSettlementProcessor } from './auction-settlement.processor.js';
import { AUCTION_PAYMENT_TIMEOUT_JOB } from '../auction-settlement.constants.js';
import { DelayedError } from 'bullmq';

describe('AuctionSettlementProcessor', () => {
  let processor: AuctionSettlementProcessor;
  let dataSourceMock: any;
  let orderHandoffApiMock: any;
  let inventoryReservationMock: any;
  let reputationApiMock: any;
  let identityLookupMock: any;
  let emailServiceMock: any;
  let managerMock: any;

  beforeEach(() => {
    managerMock = {
      getRepository: vi.fn(),
      query: vi.fn().mockResolvedValue([]),
      save: vi.fn().mockImplementation(async (entity) => entity),
    };

    dataSourceMock = {
      transaction: vi.fn().mockImplementation(async (callback) => {
        return callback(managerMock);
      }),
    };

    orderHandoffApiMock = {
      cancelAuctionOrder: vi.fn().mockResolvedValue(undefined),
      findOrderByAuctionId: vi.fn().mockResolvedValue({
        orderId: 'ord-123',
        orderNumber: 'ORD-AUC-12345',
      }),
    };

    inventoryReservationMock = {
      release: vi.fn().mockResolvedValue(undefined),
    };

    reputationApiMock = {
      penalizeAuctionPaymentTimeout: vi.fn().mockResolvedValue({
        userId: 'winner-1',
        newScore: 20,
        trustLevel: 'UNTRUSTED',
        isRestricted: true,
      }),
    };

    identityLookupMock = {
      getUsersByIds: vi.fn().mockResolvedValue([
        {
          id: 'winner-1',
          fullName: 'Duy Nguyen',
          email: 'duy@example.com',
        },
      ]),
    };

    emailServiceMock = {
      sendAuctionPaymentTimeout: vi.fn().mockResolvedValue(undefined),
    };

    processor = new AuctionSettlementProcessor(
      dataSourceMock as any,
      orderHandoffApiMock as any,
      inventoryReservationMock as any,
      reputationApiMock as any,
      identityLookupMock as any,
      emailServiceMock as any,
    );
  });

  it('marks settlement as PAYMENT_TIMEOUT, cancels order, releases inventory, penalizes 30 reputation and sends email', async () => {
    const expiredDeadline = new Date(Date.now() - 3600 * 1000); // 1 hour ago
    const mockSettlement = {
      id: 'settlement-1',
      auctionId: 'auc-1',
      winnerId: 'winner-1',
      orderId: 'ord-123',
      status: 'PENDING_PAYMENT',
      paymentDeadlineAt: expiredDeadline,
    };

    const mockAuction = {
      id: 'auc-1',
      code: 'AUC-123',
      skuId: 'sku-1',
    };

    managerMock.getRepository.mockReturnValue({
      createQueryBuilder: vi.fn().mockReturnValue({
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue(mockSettlement),
      }),
      findOne: vi.fn().mockResolvedValue(mockAuction),
    });

    managerMock.query.mockImplementation(async (sql: string) => {
      if (sql.includes('fulfillment.inventory_items')) {
        return [{ warehouse_id: 'wh-1', reserved_qty: 1 }];
      }
      return [];
    });

    const mockJob: any = {
      name: AUCTION_PAYMENT_TIMEOUT_JOB,
      data: {
        settlementId: 'settlement-1',
        auctionId: 'auc-1',
        orderId: 'ord-123',
        winnerId: 'winner-1',
      },
      moveToDelayed: vi.fn(),
    };

    await processor.process(mockJob);

    // Verify status updated to PAYMENT_TIMEOUT
    expect(mockSettlement.status).toBe('PAYMENT_TIMEOUT');
    expect(managerMock.save).toHaveBeenCalledWith(mockSettlement);

    // Verify order cancelled with manager passed
    expect(orderHandoffApiMock.cancelAuctionOrder).toHaveBeenCalledWith(
      'ord-123',
      'PAYMENT_TIMEOUT',
      managerMock,
    );

    // Verify inventory released
    expect(inventoryReservationMock.release).toHaveBeenCalledWith(
      [{ skuId: 'sku-1', quantity: 1, warehouseId: 'wh-1' }],
      managerMock,
      expect.objectContaining({
        actorId: 'winner-1',
        operation: 'ORDER_CANCELLATION',
        operationId: 'timeout-settlement-1',
      }),
    );

    // Verify reputation penalty applied (-30)
    expect(
      reputationApiMock.penalizeAuctionPaymentTimeout,
    ).toHaveBeenCalledWith('winner-1', 'auc-1', managerMock);

    // Verify timeout notification email sent
    expect(emailServiceMock.sendAuctionPaymentTimeout).toHaveBeenCalledWith({
      recipient: 'duy@example.com',
      winnerName: 'Duy Nguyen',
      auctionCode: 'AUC-123',
      orderNumber: 'ORD-AUC-12345',
      penaltyPoints: 30,
    });
  });

  it('skips timeout when settlement is already in PAID status', async () => {
    const mockSettlement = {
      id: 'settlement-paid',
      auctionId: 'auc-1',
      winnerId: 'winner-1',
      orderId: 'ord-123',
      status: 'PAID',
      paymentDeadlineAt: new Date(Date.now() - 3600 * 1000),
    };

    managerMock.getRepository.mockReturnValue({
      createQueryBuilder: vi.fn().mockReturnValue({
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue(mockSettlement),
      }),
    });

    const mockJob: any = {
      name: AUCTION_PAYMENT_TIMEOUT_JOB,
      data: {
        settlementId: 'settlement-paid',
        auctionId: 'auc-1',
        winnerId: 'winner-1',
      },
      moveToDelayed: vi.fn(),
    };

    await processor.process(mockJob);

    expect(mockSettlement.status).toBe('PAID');
    expect(orderHandoffApiMock.cancelAuctionOrder).not.toHaveBeenCalled();
    expect(
      reputationApiMock.penalizeAuctionPaymentTimeout,
    ).not.toHaveBeenCalled();
    expect(emailServiceMock.sendAuctionPaymentTimeout).not.toHaveBeenCalled();
  });

  it('skips timeout immediately when locked commerce order is already PAID (deadlock prevention)', async () => {
    managerMock.query.mockImplementation(async (sql: string) => {
      if (sql.includes('commerce.orders')) {
        return [{ id: 'ord-123', status: 'PAID', order_number: 'ORD-AUC-123' }];
      }
      return [];
    });

    const mockJob: any = {
      name: AUCTION_PAYMENT_TIMEOUT_JOB,
      data: {
        settlementId: 'settlement-1',
        auctionId: 'auc-1',
        orderId: 'ord-123',
        winnerId: 'winner-1',
      },
      moveToDelayed: vi.fn(),
    };

    await processor.process(mockJob);

    // Verify manager.save on settlement was never called
    expect(managerMock.save).not.toHaveBeenCalled();
    expect(orderHandoffApiMock.cancelAuctionOrder).not.toHaveBeenCalled();
    expect(
      reputationApiMock.penalizeAuctionPaymentTimeout,
    ).not.toHaveBeenCalled();
    expect(emailServiceMock.sendAuctionPaymentTimeout).not.toHaveBeenCalled();
  });

  it('moves job to delayed when payment deadline has not yet arrived', async () => {
    const futureDeadline = new Date(Date.now() + 3600 * 1000); // 1 hour in future
    const mockSettlement = {
      id: 'settlement-future',
      auctionId: 'auc-1',
      winnerId: 'winner-1',
      status: 'PENDING_PAYMENT',
      paymentDeadlineAt: futureDeadline,
    };

    managerMock.getRepository.mockReturnValue({
      createQueryBuilder: vi.fn().mockReturnValue({
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue(mockSettlement),
      }),
    });

    const mockJob: any = {
      name: AUCTION_PAYMENT_TIMEOUT_JOB,
      data: {
        settlementId: 'settlement-future',
        auctionId: 'auc-1',
        winnerId: 'winner-1',
      },
      moveToDelayed: vi.fn().mockResolvedValue(undefined),
    };

    await expect(processor.process(mockJob, 'token-123')).rejects.toThrow(
      DelayedError,
    );

    expect(mockJob.moveToDelayed).toHaveBeenCalledWith(
      futureDeadline.getTime(),
      'token-123',
    );
    expect(
      reputationApiMock.penalizeAuctionPaymentTimeout,
    ).not.toHaveBeenCalled();
  });

  it('skips duplicate release if reservation was already released by OrderExpiryProcessor', async () => {
    const expiredDeadline = new Date(Date.now() - 3600 * 1000);
    const mockSettlement = {
      id: 'settlement-already-expired',
      auctionId: 'auc-1',
      winnerId: 'winner-1',
      orderId: 'ord-123',
      status: 'PENDING_PAYMENT',
      paymentDeadlineAt: expiredDeadline,
    };

    const mockAuction = {
      id: 'auc-1',
      code: 'AUC-123',
      skuId: 'sku-1',
    };

    managerMock.getRepository.mockReturnValue({
      createQueryBuilder: vi.fn().mockReturnValue({
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue(mockSettlement),
      }),
      findOne: vi.fn().mockResolvedValue(mockAuction),
    });

    managerMock.query.mockImplementation(async (sql: string) => {
      if (sql.includes('commerce.order_items')) {
        return [{ warehouse_id: 'wh-1' }];
      }
      if (sql.includes('fulfillment.inventory_items')) {
        // reserved_qty is already 0
        return [{ reserved_qty: 0 }];
      }
      if (sql.includes('commerce.order_status_history')) {
        // Was cancelled by payment hold expired
        return [{ id: 'hist-1' }];
      }
      return [];
    });

    const mockJob: any = {
      name: AUCTION_PAYMENT_TIMEOUT_JOB,
      data: {
        settlementId: 'settlement-already-expired',
        auctionId: 'auc-1',
        orderId: 'ord-123',
        winnerId: 'winner-1',
      },
      moveToDelayed: vi.fn(),
    };

    await processor.process(mockJob);

    // Verify inventory release was NOT called twice
    expect(inventoryReservationMock.release).not.toHaveBeenCalled();
    // But penalty and status transition still applied
    expect(mockSettlement.status).toBe('PAYMENT_TIMEOUT');
    expect(
      reputationApiMock.penalizeAuctionPaymentTimeout,
    ).toHaveBeenCalledWith('winner-1', 'auc-1', managerMock);
  });

  it('releases inventory using auction.reservationReceipt when present, clears receipt, and saves auction', async () => {
    const expiredDeadline = new Date(Date.now() - 3600 * 1000);
    const mockSettlement = {
      id: 'settlement-receipt',
      auctionId: 'auc-receipt-1',
      winnerId: 'winner-1',
      orderId: 'ord-receipt-1',
      status: 'PENDING_PAYMENT',
      paymentDeadlineAt: expiredDeadline,
    };

    const mockAuction = {
      id: 'auc-receipt-1',
      code: 'AUC-REC',
      skuId: 'sku-1',
      reservationReceipt: [
        { skuId: 'sku-1', quantity: 1, warehouseId: 'wh-khoa-custom' },
      ],
    };

    managerMock.getRepository.mockReturnValue({
      createQueryBuilder: vi.fn().mockReturnValue({
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue(mockSettlement),
      }),
      findOne: vi.fn().mockResolvedValue(mockAuction),
    });

    managerMock.query.mockImplementation(async (sql: string) => {
      if (sql.includes('commerce.order_items')) {
        return [{ warehouse_id: 'wh-fallback' }];
      }
      if (sql.includes('fulfillment.inventory_items')) {
        return [{ reserved_qty: 1 }];
      }
      return [];
    });

    const mockJob: any = {
      name: AUCTION_PAYMENT_TIMEOUT_JOB,
      data: {
        settlementId: 'settlement-receipt',
        auctionId: 'auc-receipt-1',
        orderId: 'ord-receipt-1',
        winnerId: 'winner-1',
      },
      moveToDelayed: vi.fn(),
    };

    await processor.process(mockJob);

    // Verify inventory release used auction.reservationReceipt
    expect(inventoryReservationMock.release).toHaveBeenCalledWith(
      [{ skuId: 'sku-1', quantity: 1, warehouseId: 'wh-khoa-custom' }],
      managerMock,
      expect.objectContaining({
        actorId: 'winner-1',
        operation: 'ORDER_CANCELLATION',
      }),
    );
    expect(mockAuction.reservationReceipt).toBeNull();
    expect(managerMock.save).toHaveBeenCalledWith(mockAuction);
  });
});
