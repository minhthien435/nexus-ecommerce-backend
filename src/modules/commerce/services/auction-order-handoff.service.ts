import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, type EntityManager, Repository } from 'typeorm';
import {
  AuctionOrderHandoffApi,
  type AuctionOrderResult,
  type CreateAuctionOrderInput,
} from '../auction-order-handoff.api.js';
import { OrderEntity } from '../domain/entities/order.entity.js';
import { OrderItemEntity } from '../domain/entities/order-item.entity.js';
import { OrderStatusHistoryEntity } from '../domain/entities/order-status-history.entity.js';
import { UserAddressEntity } from '../../identity/users/entities/user-address.entity.js';
import { OrderExpiryOutboxApi } from '../order-expiry-outbox.api.js';

@Injectable()
export class AuctionOrderHandoffService extends AuctionOrderHandoffApi {
  private readonly logger = new Logger(AuctionOrderHandoffService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(OrderEntity)
    private readonly orderRepository: Repository<OrderEntity>,
    @InjectRepository(OrderItemEntity)
    private readonly orderItemRepository: Repository<OrderItemEntity>,
    @InjectRepository(OrderStatusHistoryEntity)
    private readonly orderHistoryRepository: Repository<OrderStatusHistoryEntity>,
    @InjectRepository(UserAddressEntity)
    private readonly addressRepository: Repository<UserAddressEntity>,
    private readonly orderExpiryOutbox: OrderExpiryOutboxApi,
  ) {
    super();
  }

  async createAuctionOrder(
    input: CreateAuctionOrderInput,
    externalManager?: EntityManager,
  ): Promise<AuctionOrderResult> {
    const runner = async (
      manager: EntityManager,
    ): Promise<AuctionOrderResult> => {
      // 1. Check if order already exists inside active transaction
      const inTxExisting = await manager
        .getRepository(OrderEntity)
        .createQueryBuilder('order')
        .where('order.auction_id = :auctionId', {
          auctionId: input.auctionId,
        })
        .getOne();

      if (inTxExisting) {
        return {
          orderId: inTxExisting.id,
          orderNumber: inTxExisting.orderNumber,
        };
      }

      // 2. Resolve Winner default shipping address snapshot
      const address = await this.addressRepository.findOne({
        where: { userId: input.winnerId.toLowerCase() },
        order: { isDefault: 'DESC', createdAt: 'DESC' },
      });

      const shippingSnapshot = address
        ? {
            recipientName: address.recipientName,
            recipientPhone: address.recipientPhone,
            addressLine: address.addressLine,
            provinceName: address.provinceName ?? 'Unknown',
            districtCode: address.districtCode ?? null,
            wardName: address.wardName ?? 'Unknown',
            addressScheme: address.addressScheme ?? 'ghn_v3',
          }
        : {
            recipientName: 'Auction Winner',
            recipientPhone: '0000000000',
            addressLine: 'Chưa cập nhật địa chỉ nhận hàng',
            provinceName: 'Chưa cập nhật',
            districtCode: null,
            wardName: 'Chưa cập nhật',
            addressScheme: 'ghn_v3',
          };

      const orderNumber = `ORD-AUC-${Date.now().toString().slice(-6)}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

      // Resolve productId & warehouseId if not supplied
      let productId = input.productId;
      if (!productId) {
        const skuRow = await manager.query(
          `SELECT product_id FROM catalog.product_skus WHERE id = $1 LIMIT 1`,
          [input.skuId],
        );
        productId = skuRow[0]?.product_id ?? input.skuId;
      }

      let warehouseId = input.warehouseId;
      if (!warehouseId) {
        const whRow = await manager.query(
          `SELECT warehouse_id FROM fulfillment.inventory_items WHERE sku_id = $1 LIMIT 1`,
          [input.skuId],
        );
        warehouseId = whRow[0]?.warehouse_id ?? null;
      }

      const newOrder = manager.create(OrderEntity, {
        orderNumber,
        buyerId: input.winnerId.toLowerCase(),
        sellerId: input.sellerId.toLowerCase(),
        source: 'AUCTION',
        auctionId: input.auctionId,
        status: 'PENDING_PAYMENT',
        subtotal: input.finalPrice,
        shippingFee: '0.00',
        discountAmount: '0.00',
        tax: '0.00',
        total: input.finalPrice,
        currency: input.currency || 'VND',
        shippingAddressSnapshot: shippingSnapshot,
        holdExpiresAt: input.paymentDeadlineAt,
        idempotencyKey: `auction-${input.auctionId}`,
      });

      const savedOrder = await manager.save(newOrder);

      const orderItem = manager.create(OrderItemEntity, {
        orderId: savedOrder.id,
        productId: productId!,
        skuId: input.skuId,
        warehouseId,
        productNameSnapshot: input.titleSnapshot || 'Sản phẩm đấu giá',
        skuAttributesSnapshot: null,
        unitPrice: input.finalPrice,
        quantity: 1,
        weightGramsSnapshot: 500,
        discountAmount: '0.00',
        lineTotal: input.finalPrice,
      });

      await manager.save(orderItem);

      const initialHistory = manager.create(OrderStatusHistoryEntity, {
        orderId: savedOrder.id,
        fromStatus: null,
        toStatus: 'PENDING_PAYMENT',
        reason: 'AUCTION_ORDER_CREATED',
        changedBy: input.winnerId.toLowerCase(),
      });
      await manager.save(initialHistory);

      // Schedule Commerce order expiry
      await this.orderExpiryOutbox.schedule(
        savedOrder.id,
        input.paymentDeadlineAt,
        manager,
      );

      return { orderId: savedOrder.id, orderNumber: savedOrder.orderNumber };
    };

    if (externalManager) {
      return runner(externalManager);
    }

    // 1. Idempotency pre-check if standalone
    const existing = await this.orderRepository.findOne({
      where: { auctionId: input.auctionId },
    });
    if (existing) {
      return { orderId: existing.id, orderNumber: existing.orderNumber };
    }

    try {
      return await this.dataSource.transaction(runner);
    } catch (error) {
      // Race condition catch for Postgres code 23505 (unique violation on idx_orders_auction_unique)
      const err = error as { code?: string; message?: string };
      if (err.code === '23505' || err.message?.includes('duplicate key')) {
        this.logger.warn(
          `Concurrent createAuctionOrder hit unique constraint for auction ${input.auctionId}. Fetching existing order.`,
        );
        const duplicate = await this.orderRepository.findOne({
          where: { auctionId: input.auctionId },
        });
        if (duplicate) {
          return {
            orderId: duplicate.id,
            orderNumber: duplicate.orderNumber,
          };
        }
      }
      throw error;
    }
  }

  async cancelAuctionOrder(
    orderId: string,
    reason: string,
    externalManager?: EntityManager,
  ): Promise<void> {
    const runner = async (manager: EntityManager): Promise<void> => {
      const order = await manager
        .getRepository(OrderEntity)
        .createQueryBuilder('order')
        .setLock('pessimistic_write')
        .where('order.id = :orderId', { orderId })
        .getOne();

      if (!order) {
        this.logger.warn(`cancelAuctionOrder: Order ${orderId} not found.`);
        return;
      }

      // If already paid or already cancelled, do not alter
      if (order.status !== 'PENDING_PAYMENT') {
        this.logger.log(
          `cancelAuctionOrder: Order ${orderId} is in status '${order.status}'. Skipping cancellation.`,
        );
        return;
      }

      order.status = 'CANCELLED';
      await manager.save(order);

      const history = manager.create(OrderStatusHistoryEntity, {
        orderId: order.id,
        fromStatus: 'PENDING_PAYMENT',
        toStatus: 'CANCELLED',
        reason: `AUCTION_CANCELLED: ${reason}`,
        changedBy: null,
      });
      await manager.save(history);

      this.logger.log(
        `cancelAuctionOrder: Order ${orderId} cancelled with reason: ${reason}`,
      );
    };

    if (externalManager) {
      return runner(externalManager);
    }
    return this.dataSource.transaction(runner);
  }

  async findOrderByAuctionId(
    auctionId: string,
  ): Promise<{ orderId: string; orderNumber: string; status: string } | null> {
    const order = await this.orderRepository.findOne({
      where: { auctionId },
      select: { id: true, orderNumber: true, status: true },
    });
    if (!order) return null;
    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
    };
  }
}
