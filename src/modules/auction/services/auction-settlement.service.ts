import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';

import { AuctionEntity } from '../entities/auction.entity.js';
import { AuctionSettlementEntity } from '../entities/auction-settlement.entity.js';
import {
  AUCTION_PAYMENT_TIMEOUT_JOB,
  AUCTION_SETTLEMENT_QUEUE,
  type AuctionPaymentTimeoutJobPayload,
} from '../auction-settlement.constants.js';
import { AuctionOrderHandoffApi } from '../../commerce/auction-order-handoff.api.js';
import { InventoryReservationApi } from '../../fulfillment/inventory-reservation.api.js';
import { IdentitySupportLookupApi } from '../../identity/identity-support-lookup.api.js';
import { EmailService } from '../../../common/email/email.service.js';
import { AuctionEventsService } from '../ws/auction-events.service.js';

export interface SettleAuctionResult {
  outcome: 'SETTLED' | 'FAILED' | 'ALREADY_SETTLED';
  auctionId: string;
  status: string;
  settlementId?: string;
  orderId?: string | null;
  orderNumber?: string | null;
  winnerId?: string | null;
  finalPrice?: string | null;
  paymentDeadlineAt?: Date;
}

type PostCommitAction =
  | {
      type: 'SETTLED';
      auctionId: string;
      auctionCode?: string | null;
      winnerId: string;
      finalPrice: string;
      currency: string;
      productTitle: string;
      orderId: string;
      orderNumber: string;
      paymentDeadlineAt: Date;
    }
  | {
      type: 'FAILED';
      auctionId: string;
      auctionCode?: string | null;
      finalPrice: number;
    };

@Injectable()
export class AuctionSettlementService {
  private readonly logger = new Logger(AuctionSettlementService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(AuctionEntity)
    private readonly auctionRepository: Repository<AuctionEntity>,
    @InjectRepository(AuctionSettlementEntity)
    private readonly settlementRepository: Repository<AuctionSettlementEntity>,
    private readonly orderHandoffApi: AuctionOrderHandoffApi,
    private readonly inventoryReservation: InventoryReservationApi,
    private readonly identityLookup: IdentitySupportLookupApi,
    private readonly emailService: EmailService,
    private readonly auctionEventsService: AuctionEventsService,
    @Optional()
    @InjectQueue(AUCTION_SETTLEMENT_QUEUE)
    private readonly timeoutQueue?: Queue<AuctionPaymentTimeoutJobPayload>,
  ) {}

  async settleAuction(auctionId: string): Promise<SettleAuctionResult> {
    if (!auctionId) {
      throw new BadRequestException('auctionId is required for settlement');
    }

    // 1. Check if settlement already exists before entering transaction
    const existingSettlement = await this.settlementRepository.findOne({
      where: { auctionId },
    });
    if (existingSettlement) {
      let orderId = existingSettlement.orderId ?? null;
      let orderNumber: string | null = null;

      // Crash recovery: if settlement exists but orderId is missing, heal by creating the missing order
      if (!orderId) {
        this.logger.warn(
          `settleAuction: Found settlement ${existingSettlement.id} without orderId for auction ${auctionId}. Healing crash state.`,
        );
        const auction = await this.auctionRepository.findOne({
          where: { id: auctionId },
        });
        if (auction && auction.winnerId && auction.finalPrice) {
          const orderResult = await this.orderHandoffApi.createAuctionOrder({
            auctionId: auction.id,
            auctionCode: auction.code,
            winnerId: auction.winnerId,
            sellerId: auction.sellerId,
            skuId: auction.skuId,
            productId: auction.productId,
            titleSnapshot: auction.titleSnapshot,
            finalPrice: auction.finalPrice,
            currency: auction.currency || 'VND',
            paymentDeadlineAt: existingSettlement.paymentDeadlineAt,
            warehouseId: auction.reservationReceipt?.[0]?.warehouseId ?? null,
          });
          existingSettlement.orderId = orderResult.orderId;
          await this.settlementRepository.save(existingSettlement);
          orderId = orderResult.orderId;
          orderNumber = orderResult.orderNumber;

          // Enqueue missing BullMQ delayed payment timeout job
          if (this.timeoutQueue) {
            const delay = Math.max(
              0,
              new Date(existingSettlement.paymentDeadlineAt).getTime() -
                Date.now(),
            );
            try {
              await this.timeoutQueue.add(
                AUCTION_PAYMENT_TIMEOUT_JOB,
                {
                  settlementId: existingSettlement.id,
                  auctionId: auction.id,
                  orderId: orderResult.orderId,
                  winnerId: auction.winnerId,
                },
                {
                  jobId: `auction-timeout-${existingSettlement.id}`,
                  delay,
                  attempts: 5,
                  backoff: { type: 'exponential', delay: 1000 },
                  removeOnComplete: true,
                },
              );
            } catch (queueErr) {
              this.logger.error(
                `Failed to enqueue BullMQ payment timeout during recovery for settlement ${existingSettlement.id}: ${(queueErr as Error).message}`,
              );
            }
          }
        }
      } else {
        const existingOrder =
          await this.orderHandoffApi.findOrderByAuctionId(auctionId);
        orderNumber = existingOrder?.orderNumber ?? null;
      }

      this.logger.log(
        `settleAuction: Auction ${auctionId} is already settled (settlement ${existingSettlement.id}). Returning existing result.`,
      );
      return {
        outcome: 'ALREADY_SETTLED',
        auctionId,
        status: 'SETTLED',
        settlementId: existingSettlement.id,
        orderId,
        orderNumber,
        winnerId: existingSettlement.winnerId,
        finalPrice: existingSettlement.finalPrice,
        paymentDeadlineAt: existingSettlement.paymentDeadlineAt,
      };
    }

    const { result, postCommitAction } = await this.dataSource.transaction(
      async (
        manager,
      ): Promise<{
        result: SettleAuctionResult;
        postCommitAction: PostCommitAction | null;
      }> => {
        // 2. Lock auction with pessimistic write lock
        const auction = await manager
          .getRepository(AuctionEntity)
          .createQueryBuilder('auction')
          .setLock('pessimistic_write')
          .where('auction.id = :auctionId', { auctionId })
          .getOne();

        if (!auction) {
          throw new NotFoundException({
            errorCode: 'AUCTION_NOT_FOUND',
            message: `Auction with id ${auctionId} not found`,
          });
        }

        // Check if already in terminal state
        if (auction.status === 'SETTLED') {
          const settlement = await manager
            .getRepository(AuctionSettlementEntity)
            .findOne({ where: { auctionId } });
          return {
            result: {
              outcome: 'ALREADY_SETTLED',
              auctionId: auction.id,
              status: 'SETTLED',
              settlementId: settlement?.id,
              orderId: settlement?.orderId ?? null,
              winnerId: auction.winnerId,
              finalPrice: auction.finalPrice,
              paymentDeadlineAt: settlement?.paymentDeadlineAt,
            },
            postCommitAction: null,
          };
        }

        if (auction.status === 'FAILED') {
          return {
            result: {
              outcome: 'ALREADY_SETTLED',
              auctionId: auction.id,
              status: 'FAILED',
              winnerId: null,
              finalPrice: auction.currentPrice,
            },
            postCommitAction: null,
          };
        }

        if (auction.status !== 'ENDED') {
          throw new ConflictException({
            errorCode: 'AUCTION_NOT_ENDED',
            message: 'Chỉ có thể quyết toán phiên đấu giá đã kết thúc',
          });
        }

        const hasValidBid =
          auction.bidCount > 0 &&
          Boolean(auction.highestBidId) &&
          Boolean(auction.highestBidderId);

        const meetsReserve =
          hasValidBid &&
          Number(auction.currentPrice) >= Number(auction.reservePrice);

        // 3. FAILED branch
        if (!meetsReserve) {
          this.logger.log(
            `settleAuction: Auction ${auction.id} failed (bids: ${auction.bidCount}, current: ${auction.currentPrice}, reserve: ${auction.reservePrice}).`,
          );

          auction.status = 'FAILED';
          await manager.save(auction);

          // Decrement seller active auctions counter
          await manager.query(
            `UPDATE auction.seller_auction_counters
             SET active_auctions_count = GREATEST(0, active_auctions_count - 1),
                 updated_at = clock_timestamp()
             WHERE seller_id = $1`,
            [auction.sellerId],
          );

          // Release inventory reservation authoritatively
          const receiptsToRelease = auction.reservationReceipt?.length
            ? auction.reservationReceipt
            : null;

          if (receiptsToRelease) {
            await this.inventoryReservation.release(
              receiptsToRelease,
              manager,
              {
                actorId: auction.sellerId,
                operation: 'ORDER_CANCELLATION',
                operationId: `failed-auction-${auction.id}`,
              },
            );
            auction.reservationReceipt = null;
            await manager.save(auction);
          }

          const action: PostCommitAction = {
            type: 'FAILED',
            auctionId: auction.id,
            auctionCode: auction.code,
            finalPrice: Number(auction.currentPrice),
          };

          return {
            result: {
              outcome: 'FAILED',
              auctionId: auction.id,
              status: 'FAILED',
              winnerId: null,
              finalPrice: auction.currentPrice,
            },
            postCommitAction: action,
          };
        }

        // 4. SETTLED branch
        auction.winnerId = auction.highestBidderId;
        auction.finalPrice = auction.currentPrice;
        auction.status = 'SETTLED';
        await manager.save(auction);

        // Decrement seller counter
        await manager.query(
          `UPDATE auction.seller_auction_counters
           SET active_auctions_count = GREATEST(0, active_auctions_count - 1),
               updated_at = clock_timestamp()
           WHERE seller_id = $1`,
          [auction.sellerId],
        );

        const paymentDeadlineAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

        const settlement = manager.create(AuctionSettlementEntity, {
          auctionId: auction.id,
          winnerId: auction.winnerId!,
          winningBidId: auction.highestBidId!,
          finalPrice: auction.finalPrice!,
          currency: auction.currency || 'VND',
          status: 'PENDING_PAYMENT',
          paymentDeadlineAt,
        });

        const savedSettlement = await manager.save(settlement);

        // Create Order in Commerce with manager and warehouseId from reservationReceipt
        const warehouseId =
          auction.reservationReceipt?.[0]?.warehouseId ?? null;

        const orderResult = await this.orderHandoffApi.createAuctionOrder(
          {
            auctionId: auction.id,
            auctionCode: auction.code,
            winnerId: auction.winnerId!,
            sellerId: auction.sellerId,
            skuId: auction.skuId,
            productId: auction.productId,
            titleSnapshot: auction.titleSnapshot,
            finalPrice: auction.finalPrice!,
            currency: auction.currency || 'VND',
            paymentDeadlineAt,
            warehouseId,
          },
          manager,
        );

        savedSettlement.orderId = orderResult.orderId;
        await manager.save(savedSettlement);

        // Enqueue 24h BullMQ delayed payment timeout job
        if (this.timeoutQueue) {
          const delay = Math.max(0, paymentDeadlineAt.getTime() - Date.now());
          try {
            await this.timeoutQueue.add(
              AUCTION_PAYMENT_TIMEOUT_JOB,
              {
                settlementId: savedSettlement.id,
                auctionId: auction.id,
                orderId: orderResult.orderId,
                winnerId: auction.winnerId!,
              },
              {
                jobId: `auction-timeout-${savedSettlement.id}`,
                delay,
                attempts: 5,
                backoff: { type: 'exponential', delay: 1000 },
                removeOnComplete: true,
              },
            );
          } catch (queueErr) {
            this.logger.error(
              `Failed to enqueue BullMQ payment timeout for settlement ${savedSettlement.id}: ${(queueErr as Error).message}`,
            );
          }
        }

        const action: PostCommitAction = {
          type: 'SETTLED',
          auctionId: auction.id,
          auctionCode: auction.code,
          winnerId: auction.winnerId!,
          finalPrice: auction.finalPrice!,
          currency: auction.currency || 'VND',
          productTitle: auction.titleSnapshot,
          orderId: orderResult.orderId,
          orderNumber: orderResult.orderNumber,
          paymentDeadlineAt,
        };

        return {
          result: {
            outcome: 'SETTLED',
            auctionId: auction.id,
            status: 'SETTLED',
            settlementId: savedSettlement.id,
            orderId: orderResult.orderId,
            orderNumber: orderResult.orderNumber,
            winnerId: auction.winnerId,
            finalPrice: auction.finalPrice,
            paymentDeadlineAt,
          },
          postCommitAction: action,
        };
      },
    );

    // 5. Post-commit side effects (Emails, Sockets)
    if (postCommitAction) {
      if (postCommitAction.type === 'FAILED') {
        this.auctionEventsService.emitAuctionEnded({
          sessionId: postCommitAction.auctionId,
          auctionCode: postCommitAction.auctionCode,
          winnerId: null,
          finalPrice: postCommitAction.finalPrice,
          status: 'FAILED',
        });
      } else if (postCommitAction.type === 'SETTLED') {
        // Emit socket
        this.auctionEventsService.emitAuctionEnded({
          sessionId: postCommitAction.auctionId,
          auctionCode: postCommitAction.auctionCode,
          winnerId: postCommitAction.winnerId,
          finalPrice: Number(postCommitAction.finalPrice),
          status: 'SETTLED',
        });

        // Send Winner email safely
        try {
          const [winnerUser] = await this.identityLookup.getUsersByIds([
            postCommitAction.winnerId,
          ]);
          if (winnerUser?.email) {
            await this.emailService.sendAuctionWon({
              recipient: winnerUser.email,
              winnerName: winnerUser.fullName,
              auctionCode:
                postCommitAction.auctionCode || postCommitAction.auctionId,
              productTitle: postCommitAction.productTitle,
              finalPrice: postCommitAction.finalPrice,
              currency: postCommitAction.currency,
              orderId: postCommitAction.orderId,
              orderNumber: postCommitAction.orderNumber,
              paymentDeadlineAt: postCommitAction.paymentDeadlineAt,
            });
          }
        } catch (emailErr) {
          this.logger.error(
            `Failed to send auction won email for auction ${postCommitAction.auctionId}: ${(emailErr as Error).message}`,
          );
        }
      }
    }

    return result;
  }
}
