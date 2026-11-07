import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, Repository } from 'typeorm';
import { IdentitySupportLookupApi } from '../../identity/identity-support-lookup.api.js';
import { OrderEntity } from '../domain/entities/order.entity.js';
import { OrderStatusHistoryEntity } from '../domain/entities/order-status-history.entity.js';
import { PaymentEntity } from '../domain/entities/payment.entity.js';
import type { QuerySupportOrdersDto } from '../dtos/query-support-orders.dto.js';

@Injectable()
export class SupportOrderService {
  constructor(
    @InjectRepository(OrderEntity)
    private readonly orders: Repository<OrderEntity>,
    @InjectRepository(PaymentEntity)
    private readonly payments: Repository<PaymentEntity>,
    @InjectRepository(OrderStatusHistoryEntity)
    private readonly history: Repository<OrderStatusHistoryEntity>,
    private readonly identity: IdentitySupportLookupApi,
  ) {}

  async list(query: QuerySupportOrdersDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    let buyerIds: string[] | undefined;
    if (query.buyerEmail) {
      buyerIds = await this.identity.findBuyerIdsByEmail(query.buyerEmail);
      if (buyerIds.length === 0) return this.emptyResult(page, limit);
    }

    const qb = this.orders
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.items', 'items')
      .leftJoinAndSelect('order.checkoutSession', 'checkoutSession');

    if (buyerIds) qb.andWhere('order.buyerId IN (:...buyerIds)', { buyerIds });
    if (query.sellerId) {
      qb.andWhere('order.sellerId = :sellerId', {
        sellerId: query.sellerId.toLowerCase(),
      });
    }
    if (query.status)
      qb.andWhere('order.status = :status', { status: query.status });
    if (query.fromDate)
      qb.andWhere('order.createdAt >= :fromDate', {
        fromDate: this.startOfRange(query.fromDate),
      });
    if (query.toDate)
      qb.andWhere('order.createdAt <= :toDate', {
        toDate: this.endOfRange(query.toDate),
      });
    if (query.q) {
      qb.andWhere(
        new Brackets((search) => {
          search
            .where('order.orderNumber ILIKE :q', { q: `%${query.q}%` })
            .orWhere(
              "order.shippingAddressSnapshot ->> 'recipientPhone' ILIKE :q",
              {
                q: `%${query.q}%`,
              },
            )
            .orWhere('order.trackingCode ILIKE :q', { q: `%${query.q}%` });
        }),
      );
    }

    qb.orderBy('order.createdAt', 'DESC')
      .addOrderBy('order.id', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [orders, totalItems] = await qb.getManyAndCount();
    const context = await this.loadContext(orders);
    return {
      data: orders.map((order) => this.toSummary(order, context)),
      meta: {
        page,
        limit,
        totalItems,
        totalPages: Math.max(1, Math.ceil(totalItems / limit)),
      },
    };
  }

  async detail(orderId: string) {
    const order = await this.orders.findOne({
      where: { id: orderId },
      relations: { items: true, checkoutSession: true },
    });
    if (!order) {
      throw new NotFoundException({
        errorCode: 'ORDER_NOT_FOUND',
        message: 'Order was not found',
      });
    }
    const [context, history] = await Promise.all([
      this.loadContext([order]),
      this.history.find({
        where: { orderId },
        order: { createdAt: 'ASC', id: 'ASC' },
      }),
    ]);
    return {
      ...this.toSummary(order, context),
      subtotal: order.subtotal,
      discountAmount: order.discountAmount,
      shippingFee: order.shippingFee,
      tax: order.tax,
      paymentMethod: order.checkoutSession?.paymentMethod ?? null,
      shippingAddress: order.shippingAddressSnapshot,
      items: (order.items ?? []).map((item) => ({
        id: item.id,
        productId: item.productId,
        skuId: item.skuId,
        productName: item.productNameSnapshot,
        skuAttributes: item.skuAttributesSnapshot,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        discountAmount: item.discountAmount,
        lineTotal: item.lineTotal,
      })),
      statusHistory: history.map((entry) => ({
        fromStatus: entry.fromStatus,
        toStatus: entry.toStatus,
        reason: entry.reason,
        changedBy: entry.changedBy,
        createdAt: entry.createdAt,
      })),
      updatedAt: order.updatedAt,
    };
  }

  private async loadContext(orders: OrderEntity[]) {
    const orderIds = orders.map((order) => order.id);
    const [users, shops, payments] = await Promise.all([
      this.identity.getUsersByIds(orders.map((order) => order.buyerId)),
      this.identity.getShopsBySellerIds(orders.map((order) => order.sellerId)),
      orderIds.length === 0
        ? []
        : this.payments.find({
            where: { orderId: In(orderIds) },
            order: { createdAt: 'DESC' },
          }),
    ]);
    const paymentByOrder = new Map<string, PaymentEntity>();
    for (const payment of payments) {
      if (payment.orderId && !paymentByOrder.has(payment.orderId)) {
        paymentByOrder.set(payment.orderId, payment);
      }
    }
    return {
      users: new Map(users.map((user) => [user.id, user])),
      shops: new Map(shops.map((shop) => [shop.sellerId, shop])),
      payments: paymentByOrder,
    };
  }

  private toSummary(
    order: OrderEntity,
    context: Awaited<ReturnType<SupportOrderService['loadContext']>>,
  ) {
    const buyer = context.users.get(order.buyerId);
    const shop = context.shops.get(order.sellerId);
    const payment = context.payments.get(order.id);
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      buyerId: order.buyerId,
      buyer: buyer
        ? {
            fullName: buyer.fullName,
            email: buyer.email,
            phone: buyer.phone,
            status: buyer.status,
          }
        : null,
      sellerId: order.sellerId,
      sellerShop: shop
        ? { name: shop.name, status: shop.status, logoUrl: shop.logoUrl }
        : null,
      status: order.status,
      total: order.total,
      currency: order.currency,
      payment: payment
        ? {
            provider: payment.provider,
            status: payment.status,
            amount: payment.amount,
            currency: payment.currency,
            updatedAt: payment.updatedAt,
          }
        : null,
      trackingCode: order.trackingCode,
      carrierName: order.carrierName,
      recipientName: this.snapshotString(order, 'recipientName'),
      recipientPhone: this.snapshotString(order, 'recipientPhone'),
      createdAt: order.createdAt,
    };
  }

  private snapshotString(order: OrderEntity, key: string): string | null {
    const value = order.shippingAddressSnapshot?.[key];
    return typeof value === 'string' ? value : null;
  }

  private startOfRange(value: string): string {
    return value.length === 10 ? `${value}T00:00:00.000Z` : value;
  }

  private endOfRange(value: string): string {
    return value.length === 10 ? `${value}T23:59:59.999Z` : value;
  }

  private emptyResult(page: number, limit: number) {
    return {
      data: [],
      meta: { page, limit, totalItems: 0, totalPages: 1 },
    };
  }
}
