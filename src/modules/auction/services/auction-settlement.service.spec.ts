import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuctionSettlementService } from './auction-settlement.service.js';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('AuctionSettlementService', () => {
  let service: AuctionSettlementService;
  let dataSourceMock: any;
  let auctionRepoMock: any;
  let settlementRepoMock: any;
  let orderHandoffApiMock: any;
  let inventoryReservationMock: any;
  let identityLookupMock: any;
  let emailServiceMock: any;
  let auctionEventsServiceMock: any;
  let notificationMock: any;
  let timeoutQueueMock: any;
  let managerMock: any;

  beforeEach(() => {
    managerMock = {
      getRepository: vi.fn(),
      query: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockImplementation((entityClass, data) => ({
        id: 'settlement-uuid-1',
        ...data,
      })),
      save: vi.fn().mockImplementation(async (entity) => ({
        id: entity.id || 'saved-uuid',
        ...entity,
      })),
    };

    dataSourceMock = {
      transaction: vi.fn().mockImplementation(async (callback) => {
        return callback(managerMock);
      }),
    };

    auctionRepoMock = {
      findOne: vi.fn(),
    };

    settlementRepoMock = {
      findOne: vi.fn().mockResolvedValue(null),
      save: vi.fn().mockImplementation(async (entity) => entity),
    };

    orderHandoffApiMock = {
      createAuctionOrder: vi.fn().mockResolvedValue({
        orderId: 'order-uuid-123',
        orderNumber: 'ORD-AUC-12345',
      }),
      findOrderByAuctionId: vi.fn().mockResolvedValue({
        orderId: 'order-uuid-123',
        orderNumber: 'ORD-AUC-12345',
        status: 'PENDING_PAYMENT',
      }),
      cancelAuctionOrder: vi.fn().mockResolvedValue(undefined),
    };

    inventoryReservationMock = {
      release: vi.fn().mockResolvedValue(undefined),
    };

    identityLookupMock = {
      getUsersByIds: vi.fn().mockResolvedValue([
        {
          id: 'winner-1',
          fullName: 'Duy Nguyen',
          email: 'duy@example.com',
          phone: '0901234567',
          status: 'ENDED',
        },
      ]),
    };

    emailServiceMock = {
      sendAuctionWon: vi.fn().mockResolvedValue(undefined),
      sendAuctionPaymentTimeout: vi.fn().mockResolvedValue(undefined),
    };

    auctionEventsServiceMock = {
      emitAuctionEnded: vi.fn(),
    };

    notificationMock = {
      notify: vi.fn().mockResolvedValue(undefined),
      notifyMany: vi.fn().mockResolvedValue(undefined),
    };

    timeoutQueueMock = {
      add: vi.fn().mockResolvedValue({ id: 'job-1' }),
    };

    service = new AuctionSettlementService(
      dataSourceMock as any,
      auctionRepoMock as any,
      settlementRepoMock as any,
      orderHandoffApiMock as any,
      inventoryReservationMock as any,
      identityLookupMock as any,
      emailServiceMock as any,
      auctionEventsServiceMock as any,
      notificationMock as any,
      timeoutQueueMock as any,
    );
  });

  describe('settleAuction', () => {
    it('throws BadRequestException if auctionId is empty', async () => {
      await expect(service.settleAuction('')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws NotFoundException if auction does not exist', async () => {
      managerMock.getRepository.mockReturnValue({
        createQueryBuilder: vi.fn().mockReturnValue({
          setLock: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          getOne: vi.fn().mockResolvedValue(null),
        }),
      });

      await expect(service.settleAuction('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('settles auction as FAILED when there are no bids (bidCount = 0)', async () => {
      const mockAuction = {
        id: 'auc-no-bids',
        code: 'AUC-001',
        sellerId: 'seller-1',
        skuId: 'sku-1',
        bidCount: 0,
        highestBidId: null,
        highestBidderId: null,
        currentPrice: '100000.00',
        reservePrice: '500000.00',
        status: 'ENDED',
      };

      managerMock.getRepository.mockReturnValue({
        createQueryBuilder: vi.fn().mockReturnValue({
          setLock: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          getOne: vi.fn().mockResolvedValue(mockAuction),
        }),
      });

      const result = await service.settleAuction('auc-no-bids');

      expect(result.outcome).toBe('FAILED');
      expect(result.status).toBe('FAILED');
      expect(mockAuction.status).toBe('FAILED');

      // Verify seller counter decremented
      expect(managerMock.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE auction.seller_auction_counters'),
        ['seller-1'],
      );

      expect(inventoryReservationMock.release).not.toHaveBeenCalled();

      // Verify socket emitted with winnerId = null
      expect(auctionEventsServiceMock.emitAuctionEnded).toHaveBeenCalledWith({
        sessionId: 'auc-no-bids',
        auctionCode: 'AUC-001',
        winnerId: null,
        finalPrice: 100000,
        status: 'FAILED',
      });
    });

    it('settles auction as FAILED when currentPrice < reservePrice and releases reservationReceipt directly', async () => {
      const mockAuction = {
        id: 'auc-below-reserve',
        code: 'AUC-002',
        sellerId: 'seller-1',
        skuId: 'sku-1',
        bidCount: 3,
        highestBidId: 'bid-1',
        highestBidderId: 'bidder-1',
        currentPrice: '300000.00',
        reservePrice: '500000.00',
        status: 'ENDED',
        reservationReceipt: [
          { skuId: 'sku-1', quantity: 1, warehouseId: 'wh-khoa-1' },
        ],
      };

      managerMock.getRepository.mockReturnValue({
        createQueryBuilder: vi.fn().mockReturnValue({
          setLock: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          getOne: vi.fn().mockResolvedValue(mockAuction),
        }),
      });
      managerMock.query.mockImplementation(async (sql: string) =>
        sql.includes('FROM auction.bids')
          ? [{ bidder_id: 'bidder-1' }, { bidder_id: 'bidder-2' }]
          : [],
      );

      const result = await service.settleAuction('auc-below-reserve');

      expect(result.outcome).toBe('FAILED');
      expect(result.status).toBe('FAILED');
      expect(mockAuction.status).toBe('FAILED');
      expect(mockAuction.reservationReceipt).toBeNull();
      expect(inventoryReservationMock.release).toHaveBeenCalledWith(
        [{ skuId: 'sku-1', quantity: 1, warehouseId: 'wh-khoa-1' }],
        managerMock,
        expect.objectContaining({
          actorId: 'seller-1',
          operation: 'ORDER_CANCELLATION',
        }),
      );
      expect(managerMock.save).toHaveBeenCalledWith(mockAuction);
      expect(orderHandoffApiMock.createAuctionOrder).not.toHaveBeenCalled();
      expect(notificationMock.notifyMany).toHaveBeenCalledWith([
        expect.objectContaining({
          userId: 'bidder-1',
          type: 'AUCTION_LOST',
          sourceEventId: 'auc-below-reserve',
        }),
        expect.objectContaining({
          userId: 'bidder-2',
          content: expect.stringContaining('chưa đạt giá sàn'),
        }),
      ]);
    });

    it('settles auction as SETTLED when bids exist and meet reserve price', async () => {
      const mockAuction = {
        id: 'auc-win',
        code: 'AUC-WINNER',
        sellerId: 'seller-1',
        skuId: 'sku-1',
        productId: 'prod-1',
        titleSnapshot: 'MacBook Pro M3 Max',
        bidCount: 5,
        highestBidId: 'bid-top',
        highestBidderId: 'winner-1',
        currentPrice: '60000000.00',
        reservePrice: '50000000.00',
        currency: 'VND',
        status: 'ENDED',
        reservationReceipt: [
          { skuId: 'sku-1', quantity: 1, warehouseId: 'wh-win-1' },
        ],
      };

      managerMock.getRepository.mockReturnValue({
        createQueryBuilder: vi.fn().mockReturnValue({
          setLock: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          getOne: vi.fn().mockResolvedValue(mockAuction),
        }),
      });
      managerMock.query.mockImplementation(async (sql: string) =>
        sql.includes('FROM auction.bids')
          ? [{ bidder_id: 'loser-1' }, { bidder_id: 'loser-2' }]
          : [],
      );

      const result = await service.settleAuction('auc-win');

      expect(result.outcome).toBe('SETTLED');
      expect(result.status).toBe('SETTLED');
      expect(result.winnerId).toBe('winner-1');
      expect(result.finalPrice).toBe('60000000.00');
      expect(result.orderId).toBe('order-uuid-123');

      // Verify auction entity updated
      expect(mockAuction.status).toBe('SETTLED');
      expect((mockAuction as any).winnerId).toBe('winner-1');
      expect((mockAuction as any).finalPrice).toBe('60000000.00');

      // Verify settlement entity created
      expect(managerMock.create).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          auctionId: 'auc-win',
          winnerId: 'winner-1',
          winningBidId: 'bid-top',
          finalPrice: '60000000.00',
          status: 'PENDING_PAYMENT',
        }),
      );

      // Verify order created in Commerce with manager and warehouseId passed
      expect(orderHandoffApiMock.createAuctionOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          auctionId: 'auc-win',
          winnerId: 'winner-1',
          sellerId: 'seller-1',
          skuId: 'sku-1',
          finalPrice: '60000000.00',
          warehouseId: 'wh-win-1',
        }),
        managerMock,
      );

      // Verify 24h payment timeout job queued in BullMQ
      expect(timeoutQueueMock.add).toHaveBeenCalledWith(
        'auction-payment-timeout',
        expect.objectContaining({
          auctionId: 'auc-win',
          winnerId: 'winner-1',
          orderId: 'order-uuid-123',
        }),
        expect.objectContaining({
          delay: expect.any(Number),
          attempts: 5,
        }),
      );
      expect(timeoutQueueMock.add).toHaveBeenCalledWith(
        'auction-payment-reminder',
        expect.objectContaining({
          auctionId: 'auc-win',
          winnerId: 'winner-1',
          orderId: 'order-uuid-123',
        }),
        expect.objectContaining({
          jobId: 'auction-reminder-settlement-uuid-1',
          delay: expect.any(Number),
        }),
      );

      expect(notificationMock.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'winner-1',
          type: 'AUCTION_WON',
          actionUrl: '/orders/order-uuid-123',
          sourceEventId: 'settlement-uuid-1',
        }),
      );
      expect(notificationMock.notifyMany).toHaveBeenCalledWith([
        expect.objectContaining({ userId: 'loser-1', type: 'AUCTION_LOST' }),
        expect.objectContaining({ userId: 'loser-2', type: 'AUCTION_LOST' }),
      ]);

      // Verify Winner email sent
      expect(emailServiceMock.sendAuctionWon).toHaveBeenCalledWith(
        expect.objectContaining({
          recipient: 'duy@example.com',
          winnerName: 'Duy Nguyen',
          auctionCode: 'AUC-WINNER',
          finalPrice: '60000000.00',
          orderId: 'order-uuid-123',
          orderNumber: 'ORD-AUC-12345',
        }),
      );

      // Verify socket emitted
      expect(auctionEventsServiceMock.emitAuctionEnded).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'auc-win',
          winnerId: 'winner-1',
          finalPrice: 60000000,
          status: 'SETTLED',
        }),
      );
    });

    it('returns ALREADY_SETTLED idempotently if settlement already exists before transaction', async () => {
      settlementRepoMock.findOne.mockResolvedValueOnce({
        id: 'settlement-existing',
        auctionId: 'auc-already-settled',
        winnerId: 'winner-1',
        finalPrice: '1000000.00',
        orderId: 'ord-existing-1',
        paymentDeadlineAt: new Date(),
      });

      const result = await service.settleAuction('auc-already-settled');

      expect(result.outcome).toBe('ALREADY_SETTLED');
      expect(result.settlementId).toBe('settlement-existing');
      expect(result.orderId).toBe('ord-existing-1');
      expect(dataSourceMock.transaction).not.toHaveBeenCalled();
    });

    it('heals and recovers when existing settlement exists but orderId is missing (crash recovery)', async () => {
      const mockSettlement = {
        id: 'settlement-orphaned',
        auctionId: 'auc-crash-recovery',
        winnerId: 'winner-crash',
        finalPrice: '5000000.00',
        orderId: null,
        status: 'PENDING_PAYMENT',
        paymentDeadlineAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
      };

      settlementRepoMock.findOne.mockResolvedValueOnce(mockSettlement);
      auctionRepoMock.findOne.mockResolvedValueOnce({
        id: 'auc-crash-recovery',
        code: 'AUC-CRASH',
        winnerId: 'winner-crash',
        sellerId: 'seller-crash',
        skuId: 'sku-crash',
        productId: 'prod-crash',
        titleSnapshot: 'Product Crash',
        finalPrice: '5000000.00',
        currency: 'VND',
      });

      orderHandoffApiMock.createAuctionOrder.mockResolvedValueOnce({
        orderId: 'healed-order-id',
        orderNumber: 'ORD-AUC-HEALED',
      });

      const result = await service.settleAuction('auc-crash-recovery');

      expect(result.outcome).toBe('ALREADY_SETTLED');
      expect(result.settlementId).toBe('settlement-orphaned');
      expect(result.orderId).toBe('healed-order-id');
      expect(result.orderNumber).toBe('ORD-AUC-HEALED');
      expect(orderHandoffApiMock.createAuctionOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          auctionId: 'auc-crash-recovery',
          winnerId: 'winner-crash',
        }),
      );
      expect(timeoutQueueMock.add).toHaveBeenCalledWith(
        'auction-payment-timeout',
        expect.objectContaining({
          settlementId: 'settlement-orphaned',
          orderId: 'healed-order-id',
        }),
        expect.objectContaining({
          jobId: 'auction-timeout-settlement-orphaned',
          delay: expect.any(Number),
        }),
      );
      expect(timeoutQueueMock.add).toHaveBeenCalledWith(
        'auction-payment-reminder',
        expect.objectContaining({ settlementId: 'settlement-orphaned' }),
        expect.objectContaining({
          jobId: 'auction-reminder-settlement-orphaned',
        }),
      );
    });

    it('does not enqueue a reminder when fewer than four hours remain', async () => {
      settlementRepoMock.findOne.mockResolvedValueOnce({
        id: 'settlement-short-deadline',
        auctionId: 'auc-short-deadline',
        winnerId: 'winner-short',
        finalPrice: '5000000.00',
        orderId: null,
        status: 'PENDING_PAYMENT',
        paymentDeadlineAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      });
      auctionRepoMock.findOne.mockResolvedValueOnce({
        id: 'auc-short-deadline',
        code: 'AUC-SHORT',
        winnerId: 'winner-short',
        sellerId: 'seller-short',
        skuId: 'sku-short',
        productId: 'prod-short',
        titleSnapshot: 'Short deadline product',
        finalPrice: '5000000.00',
        currency: 'VND',
      });

      await service.settleAuction('auc-short-deadline');

      expect(timeoutQueueMock.add).not.toHaveBeenCalledWith(
        'auction-payment-reminder',
        expect.anything(),
        expect.anything(),
      );
      expect(timeoutQueueMock.add).toHaveBeenCalledWith(
        'auction-payment-timeout',
        expect.anything(),
        expect.anything(),
      );
    });

    it('re-enqueues a deterministic reminder for an existing pending settlement with an order', async () => {
      settlementRepoMock.findOne.mockResolvedValueOnce({
        id: 'settlement-existing-pending',
        auctionId: 'auc-existing-pending',
        winnerId: 'winner-existing',
        finalPrice: '1000000.00',
        orderId: 'order-existing',
        status: 'PENDING_PAYMENT',
        paymentDeadlineAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
      });

      await service.settleAuction('auc-existing-pending');

      expect(timeoutQueueMock.add).toHaveBeenCalledWith(
        'auction-payment-reminder',
        {
          settlementId: 'settlement-existing-pending',
          auctionId: 'auc-existing-pending',
          orderId: 'order-existing',
          winnerId: 'winner-existing',
        },
        expect.objectContaining({
          jobId: 'auction-reminder-settlement-existing-pending',
        }),
      );
    });

    it('does not rollback settlement if post-commit email or winner notification fails', async () => {
      const mockAuction = {
        id: 'auc-email-fail',
        code: 'AUC-EMAIL',
        sellerId: 'seller-1',
        skuId: 'sku-1',
        bidCount: 1,
        highestBidId: 'bid-1',
        highestBidderId: 'winner-1',
        currentPrice: '2000000.00',
        reservePrice: '1000000.00',
        status: 'ENDED',
      };

      managerMock.getRepository.mockReturnValue({
        createQueryBuilder: vi.fn().mockReturnValue({
          setLock: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          getOne: vi.fn().mockResolvedValue(mockAuction),
        }),
      });
      managerMock.query.mockImplementation(async (sql: string) =>
        sql.includes('FROM auction.bids')
          ? [{ bidder_id: 'loser-after-failure' }]
          : [],
      );

      emailServiceMock.sendAuctionWon.mockRejectedValueOnce(
        new Error('SMTP unreachable'),
      );
      notificationMock.notify.mockRejectedValueOnce(new Error('push down'));
      timeoutQueueMock.add.mockRejectedValue(new Error('redis down'));

      const result = await service.settleAuction('auc-email-fail');

      expect(result.outcome).toBe('SETTLED');
      expect(result.status).toBe('SETTLED');
      expect(mockAuction.status).toBe('SETTLED');
      expect(notificationMock.notifyMany).toHaveBeenCalledWith([
        expect.objectContaining({ userId: 'loser-after-failure' }),
      ]);
    });
  });
});
