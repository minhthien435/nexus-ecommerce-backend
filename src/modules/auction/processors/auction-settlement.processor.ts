import {
  BadRequestException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { DelayedError, type Job } from 'bullmq';
import { DataSource } from 'typeorm';

import {
  AUCTION_PAYMENT_TIMEOUT_JOB,
  AUCTION_SETTLEMENT_QUEUE,
  type AuctionPaymentTimeoutJobPayload,
} from '../auction-settlement.constants.js';
import { AuctionSettlementEntity } from '../entities/auction-settlement.entity.js';
import { AuctionEntity } from '../entities/auction.entity.js';
import { AuctionOrderHandoffApi } from '../../commerce/auction-order-handoff.api.js';
import { InventoryReservationApi } from '../../fulfillment/inventory-reservation.api.js';
import { IdentityReputationApi } from '../../identity/identity-reputation.api.js';
import { IdentitySupportLookupApi } from '../../identity/identity-support-lookup.api.js';
import { EmailService } from '../../../common/email/email.service.js';

@Processor(AUCTION_SETTLEMENT_QUEUE)
export class AuctionSettlementProcessor extends WorkerHost {
  private readonly logger = new Logger(AuctionSettlementProcessor.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly orderHandoffApi: AuctionOrderHandoffApi,
    private readonly inventoryReservation: InventoryReservationApi,
    private readonly reputationApi: IdentityReputationApi,
    private readonly identityLookup: IdentitySupportLookupApi,
    private readonly emailService: EmailService,
  ) {
    super();
  }

  async process(
    job: Job<AuctionPaymentTimeoutJobPayload>,
    token?: string,
  ): Promise<void> {
    if (job.name !== AUCTION_PAYMENT_TIMEOUT_JOB) {
      return;
    }

    const { settlementId, auctionId, orderId, winnerId } = job.data ?? {};
    if (!settlementId || !auctionId || !winnerId) {
      throw new BadRequestException('Invalid auction payment timeout payload');
    }

    let timeoutApplied = false;
    let auctionCode: string | null = null;
    let cancelledOrderNumber: string | null = null;

    await this.dataSource.transaction(async (manager) => {
      // 1. Lock commerce.orders FIRST if targetOrderId is known, to strictly mirror
      // PaymentWebhookService's lock order (orders -> auction_settlements) and eliminate deadlocks.
      const targetOrderId = orderId;
      if (targetOrderId) {
        const orderRows = await manager.query(
          `SELECT id, status, order_number FROM commerce.orders WHERE id = $1 FOR UPDATE`,
          [targetOrderId],
        );
        const lockedOrder = orderRows[0];

        // If order is already PAID, skip timeout penalty immediately
        if (lockedOrder && lockedOrder.status === 'PAID') {
          this.logger.log(
            `AuctionSettlementProcessor: Order ${targetOrderId} is already PAID. Skipping timeout.`,
          );
          return;
        }
      }

      // 2. Lock settlement record SECOND
      const settlement = await manager
        .getRepository(AuctionSettlementEntity)
        .createQueryBuilder('s')
        .setLock('pessimistic_write')
        .where('s.id = :settlementId', { settlementId })
        .getOne();

      if (!settlement) {
        this.logger.warn(
          `AuctionSettlementProcessor: Settlement ${settlementId} not found. Skipping.`,
        );
        return;
      }

      // If already PAID or already timed out, ignore safely
      if (settlement.status !== 'PENDING_PAYMENT') {
        this.logger.log(
          `AuctionSettlementProcessor: Settlement ${settlementId} is '${settlement.status}'. Skipping timeout penalty.`,
        );
        return;
      }

      // Check deadline
      const deadline = new Date(settlement.paymentDeadlineAt).getTime();
      const now = Date.now();
      if (deadline > now) {
        this.logger.log(
          `AuctionSettlementProcessor: Settlement ${settlementId} not yet expired. Moving to delayed.`,
        );
        await job.moveToDelayed(deadline, token);
        throw new DelayedError();
      }

      // 3. Mark settlement as PAYMENT_TIMEOUT
      settlement.status = 'PAYMENT_TIMEOUT';
      await manager.save(settlement);

      // 4. Cancel Commerce order if present
      const finalOrderId = settlement.orderId ?? targetOrderId;
      let warehouseIdFromItem: string | null = null;
      if (finalOrderId) {
        try {
          // Look up warehouseId snapshot from order_items
          const orderItems = await manager.query(
            `SELECT warehouse_id FROM commerce.order_items WHERE order_id = $1 LIMIT 1`,
            [finalOrderId],
          );
          warehouseIdFromItem = orderItems[0]?.warehouse_id ?? null;

          await this.orderHandoffApi.cancelAuctionOrder(
            finalOrderId,
            'PAYMENT_TIMEOUT',
          );
        } catch (orderErr) {
          this.logger.warn(
            `Failed to cancel auction order ${finalOrderId}: ${(orderErr as Error).message}`,
          );
        }
      }

      // 5. Release inventory reservation reliably
      const auction = await manager
        .getRepository(AuctionEntity)
        .findOne({ where: { id: settlement.auctionId } });

      if (!auction) {
        throw new NotFoundException(
          `Auction ${settlement.auctionId} not found during timeout processing`,
        );
      }

      auctionCode = auction.code ?? auction.id;
      if (auction.skuId) {
        let warehouseId = warehouseIdFromItem;
        if (!warehouseId) {
          const invRow = await manager.query(
            `SELECT warehouse_id FROM fulfillment.inventory_items WHERE sku_id = $1 LIMIT 1`,
            [auction.skuId],
          );
          warehouseId = invRow[0]?.warehouse_id ?? null;
        }

        if (!warehouseId) {
          throw new ServiceUnavailableException({
            errorCode: 'WAREHOUSE_NOT_RESOLVED',
            message: `Cannot resolve warehouse for sku ${auction.skuId} in auction ${auction.id}`,
          });
        }

        // Lock inventory item to inspect reserved_qty authoritatively
        const invCheck = await manager.query(
          `SELECT reserved_qty FROM fulfillment.inventory_items 
           WHERE sku_id = $1 AND warehouse_id = $2 
           FOR UPDATE`,
          [auction.skuId, warehouseId],
        );

        const currentReserved = Number(invCheck[0]?.reserved_qty ?? 0);
        if (currentReserved >= 1) {
          // Normal path: has reserved stock -> release authoritatively
          await this.inventoryReservation.release(
            [{ skuId: auction.skuId, quantity: 1, warehouseId }],
            manager,
            {
              actorId: settlement.winnerId,
              operation: 'ORDER_CANCELLATION',
              operationId: `timeout-${settlement.id}`,
            },
          );
        } else {
          // Reserved qty is 0. Check whether it was legitimately released already
          const wasCancelledByExpiry = finalOrderId
            ? (
                await manager.query(
                  `SELECT id FROM commerce.order_status_history 
                   WHERE order_id = $1 AND reason = 'PAYMENT_HOLD_EXPIRED' LIMIT 1`,
                  [finalOrderId],
                )
              ).length > 0
            : false;

          if (wasCancelledByExpiry) {
            this.logger.log(
              `AuctionSettlementProcessor: Reservation for order ${finalOrderId} was already released by OrderExpiryProcessor. Skipping duplicate release.`,
            );
          } else {
            this.logger.warn(
              `AuctionSettlementProcessor: SKU ${auction.skuId} at warehouse ${warehouseId} has reserved_qty = 0. No reservation held.`,
            );
          }
        }
      }

      // 6. Apply reputation penalty (-30) and update bidder eligibility
      try {
        await this.reputationApi.penalizeAuctionPaymentTimeout(
          settlement.winnerId,
          settlement.auctionId,
          manager,
        );
      } catch (repErr) {
        this.logger.error(
          `Failed to apply reputation penalty for user ${settlement.winnerId}: ${(repErr as Error).message}`,
        );
      }

      timeoutApplied = true;
    });

    // 6. Post-commit notification email
    if (timeoutApplied) {
      try {
        const [winner] = await this.identityLookup.getUsersByIds([winnerId]);
        const orderInfo = orderId
          ? await this.orderHandoffApi.findOrderByAuctionId(auctionId)
          : null;
        cancelledOrderNumber = orderInfo?.orderNumber ?? 'ORD-AUC';

        if (winner?.email) {
          await this.emailService.sendAuctionPaymentTimeout({
            recipient: winner.email,
            winnerName: winner.fullName,
            auctionCode: auctionCode || auctionId,
            orderNumber: cancelledOrderNumber,
            penaltyPoints: 30,
          });
        }
      } catch (emailErr) {
        this.logger.error(
          `Failed to send auction payment timeout email: ${(emailErr as Error).message}`,
        );
      }
    }
  }
}
