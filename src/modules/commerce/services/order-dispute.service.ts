import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, Repository } from 'typeorm';
import { IdentitySupportLookupApi } from '../../identity/identity-support-lookup.api.js';
import { OrderEntity } from '../domain/entities/order.entity.js';
import {
  OrderDisputeEntity,
  type OrderDisputeStatus,
} from '../domain/entities/order-dispute.entity.js';
import { OrderStatusHistoryEntity } from '../domain/entities/order-status-history.entity.js';
import { PaymentEntity } from '../domain/entities/payment.entity.js';
import { CreateOrderDisputeDto } from '../dtos/create-order-dispute.dto.js';
import type { QuerySupportDisputesDto } from '../dtos/query-support-disputes.dto.js';
import type { ResolveOrderDisputeDto } from '../dtos/resolve-order-dispute.dto.js';
import { OrderRefundService } from './order-refund.service.js';
import { OrderStateMachineService } from './order-state-machine.service.js';

export interface CreatedDisputeResponse {
  id: string;
  orderId: string;
  orderNumber: string;
  buyerId: string;
  sellerId: string;
  reasonCategory: string;
  evidenceDescription: string;
  evidenceImages: string[];
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ResolveDisputeResponse {
  id: string;
  orderId: string;
  orderNumber: string;
  status: OrderDisputeStatus;
  staffDecisionNote: string;
  resolvedBy: string;
  resolvedAt: Date;
  refundId?: string;
  refundStatus?: string;
}

export interface SupportDisputeBuyerInfo {
  fullName: string;
  email: string;
  phone: string | null;
  status: string;
}

export interface SupportDisputeShopInfo {
  name: string;
  status: string;
  logoUrl: string | null;
}

export interface SupportDisputeOrderInfo {
  status: string;
  total: string;
  currency: string;
}

export interface SupportDisputeItem {
  id: string;
  orderId: string;
  orderNumber: string | null;
  buyerId: string;
  buyer: SupportDisputeBuyerInfo | null;
  sellerId: string;
  sellerShop: SupportDisputeShopInfo | null;
  order: SupportDisputeOrderInfo | null;
  reasonCategory: string;
  evidenceDescription: string;
  evidenceImages: string[];
  status: string;
  staffDecisionNote: string | null;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SupportDisputeListResult {
  data: SupportDisputeItem[];
  meta: {
    page: number;
    limit: number;
    totalItems: number;
    totalPages: number;
  };
}

@Injectable()
export class OrderDisputeService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(OrderDisputeEntity)
    private readonly disputeRepo: Repository<OrderDisputeEntity>,
    @InjectRepository(OrderEntity)
    private readonly orderRepo: Repository<OrderEntity>,
    @InjectRepository(OrderStatusHistoryEntity)
    private readonly historyRepo: Repository<OrderStatusHistoryEntity>,
    private readonly identityLookup: IdentitySupportLookupApi,
    private readonly orderStateMachine: OrderStateMachineService,
    private readonly orderRefundService: OrderRefundService,
  ) {}

  /**
   * Khởi tạo khiếu nại đơn hàng cho Người mua (Buyer)
   * Yêu cầu: Đơn hàng thuộc về Buyer, trạng thái DELIVERED, trong thời hạn 72h, chưa từng khiếu nại.
   */
  async createDispute(
    buyerId: string,
    orderId: string,
    dto: CreateOrderDisputeDto,
  ): Promise<CreatedDisputeResponse> {
    return this.dataSource.transaction('READ COMMITTED', async (manager) => {
      // 1. Khóa bi quan bản ghi đơn hàng để kiểm tra tính sở hữu và ngăn chặn xung đột đồng thời
      const order = await manager
        .getRepository(OrderEntity)
        .createQueryBuilder('order')
        .setLock('pessimistic_write')
        .where('order.id = :orderId', { orderId })
        .getOne();

      // 2. Kiểm tra tính sở hữu: Đơn hàng phải tồn tại và thuộc về đúng Buyer đang đăng nhập
      if (!order || order.buyerId !== buyerId) {
        throw new NotFoundException({
          errorCode: 'ORDER_NOT_FOUND',
          message: 'Không tìm thấy đơn hàng yêu cầu khiếu nại',
        });
      }

      // 3. Kiểm tra trạng thái đơn: Chỉ cho phép khiếu nại đơn đã giao hàng (DELIVERED)
      if (order.status !== 'DELIVERED') {
        throw new ConflictException({
          errorCode: 'ORDER_STATUS_INVALID',
          message: `Chỉ có thể khiếu nại đơn hàng ở trạng thái đã giao (DELIVERED). Trạng thái hiện tại: ${order.status}`,
        });
      }

      // 4. Kiểm tra xem đơn hàng đã từng mở khiếu nại chưa (Chính sách 1 đơn 1 khiếu nại)
      const existingDispute = await manager
        .getRepository(OrderDisputeEntity)
        .findOne({ where: { orderId } });

      if (existingDispute) {
        throw new ConflictException({
          errorCode: 'DISPUTE_ALREADY_EXISTS',
          message: 'Đơn hàng này đã có hồ sơ khiếu nại đang được xử lý',
        });
      }

      // 5. Kiểm tra thời hạn 72 giờ: Truy vấn thời điểm giao hàng từ bảng OrderStatusHistoryEntity
      const deliveryRecord = await manager
        .getRepository(OrderStatusHistoryEntity)
        .findOne({
          where: { orderId, toStatus: 'DELIVERED' },
          order: { createdAt: 'DESC' },
        });

      if (!deliveryRecord) {
        throw new ConflictException({
          errorCode: 'ORDER_STATUS_INVALID',
          message: 'Đơn hàng chưa có lịch sử xác nhận đã giao hàng thành công',
        });
      }

      const deliveredAt = deliveryRecord.createdAt.getTime();
      const now = Date.now();
      const seventyTwoHoursMs = 72 * 60 * 60 * 1000;

      if (now - deliveredAt > seventyTwoHoursMs) {
        throw new BadRequestException({
          errorCode: 'DISPUTE_WINDOW_EXPIRED',
          message: 'Thời hạn khiếu nại 72 giờ kể từ khi nhận hàng đã kết thúc',
        });
      }

      // 6. Khởi tạo và lưu hồ sơ khiếu nại
      const disputeRepository = manager.getRepository(OrderDisputeEntity);
      const dispute = disputeRepository.create({
        orderId: order.id,
        buyerId: order.buyerId,
        sellerId: order.sellerId,
        reasonCategory: dto.reasonCategory,
        evidenceDescription: dto.evidenceDescription.trim(),
        evidenceImages: dto.evidenceImages ?? [],
        status: 'PENDING_STAFF_REVIEW',
        staffDecisionNote: null,
        resolvedBy: null,
        resolvedAt: null,
      });

      try {
        const saved = await disputeRepository.save(dispute);
        return {
          id: saved.id,
          orderId: saved.orderId,
          orderNumber: order.orderNumber,
          buyerId: saved.buyerId,
          sellerId: saved.sellerId,
          reasonCategory: saved.reasonCategory,
          evidenceDescription: saved.evidenceDescription,
          evidenceImages: saved.evidenceImages,
          status: saved.status,
          createdAt: saved.createdAt,
          updatedAt: saved.updatedAt,
        };
      } catch (err) {
        // Bắt lỗi vi phạm Unique constraint từ CSDL phòng trường hợp race condition lọt qua
        if ((err as { code?: string }).code === '23505') {
          throw new ConflictException({
            errorCode: 'DISPUTE_ALREADY_EXISTS',
            message: 'Đơn hàng này đã có hồ sơ khiếu nại đang được xử lý',
          });
        }
        throw err;
      }
    });
  }

  /**
   * Truy vấn danh sách khiếu nại cho Support / Staff / Admin
   * Hỗ trợ tìm kiếm, lọc theo trạng thái, lý do, email người mua, shop bán, khoảng ngày
   * Kèm phân trang và tải dữ liệu Buyer / Seller theo cơ chế Anti N+1
   */
  async listSupportDisputes(
    query: QuerySupportDisputesDto,
  ): Promise<SupportDisputeListResult> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    let buyerIds: string[] | undefined;
    if (query.buyerEmail) {
      buyerIds = await this.identityLookup.findBuyerIdsByEmail(
        query.buyerEmail,
      );
      if (buyerIds.length === 0) {
        return {
          data: [],
          meta: {
            page,
            limit,
            totalItems: 0,
            totalPages: 1,
          },
        };
      }
    }

    const qb = this.disputeRepo
      .createQueryBuilder('dispute')
      .leftJoinAndSelect('dispute.order', 'order');

    // Điều kiện nghiệp vụ: Chỉ hiển thị hồ sơ PENDING_STAFF_REVIEW khi đơn hàng ở trạng thái DELIVERED
    qb.andWhere(
      '(dispute.status != :pendingDisputeStatus OR order.status = :validOrderPendingStatus)',
      {
        pendingDisputeStatus: 'PENDING_STAFF_REVIEW',
        validOrderPendingStatus: 'DELIVERED',
      },
    );

    if (buyerIds) {
      qb.andWhere('dispute.buyerId IN (:...buyerIds)', { buyerIds });
    }
    if (query.sellerId) {
      qb.andWhere('dispute.sellerId = :sellerId', {
        sellerId: query.sellerId.toLowerCase(),
      });
    }
    if (query.status) {
      qb.andWhere('dispute.status = :status', { status: query.status });
    }
    if (query.reasonCategory) {
      qb.andWhere('dispute.reasonCategory = :reasonCategory', {
        reasonCategory: query.reasonCategory,
      });
    }
    if (query.fromDate) {
      qb.andWhere('dispute.createdAt >= :fromDate', {
        fromDate: this.startOfRange(query.fromDate),
      });
    }
    if (query.toDate) {
      qb.andWhere('dispute.createdAt <= :toDate', {
        toDate: this.endOfRange(query.toDate),
      });
    }
    if (query.q) {
      qb.andWhere(
        new Brackets((search) => {
          search
            .where('order.orderNumber ILIKE :q', { q: `%${query.q}%` })
            .orWhere('dispute.evidenceDescription ILIKE :q', {
              q: `%${query.q}%`,
            });
        }),
      );
    }

    qb.orderBy('dispute.createdAt', 'DESC')
      .addOrderBy('dispute.id', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [disputes, totalItems] = await qb.getManyAndCount();

    // Anti N+1: Tải thông tin người mua và shop bán theo batch đồng thời
    const uniqueBuyerIds = Array.from(new Set(disputes.map((d) => d.buyerId)));
    const uniqueSellerIds = Array.from(
      new Set(disputes.map((d) => d.sellerId)),
    );

    const [buyers, shops] = await Promise.all([
      uniqueBuyerIds.length === 0
        ? []
        : this.identityLookup.getUsersByIds(uniqueBuyerIds),
      uniqueSellerIds.length === 0
        ? []
        : this.identityLookup.getShopsBySellerIds(uniqueSellerIds),
    ]);

    const buyerMap = new Map(buyers.map((b) => [b.id, b]));
    const shopMap = new Map(shops.map((s) => [s.sellerId, s]));

    const items: SupportDisputeItem[] = disputes.map((dispute) => {
      const buyer = buyerMap.get(dispute.buyerId);
      const shop = shopMap.get(dispute.sellerId);
      return {
        id: dispute.id,
        orderId: dispute.orderId,
        orderNumber: dispute.order?.orderNumber ?? null,
        buyerId: dispute.buyerId,
        buyer: buyer
          ? {
              fullName: buyer.fullName,
              email: buyer.email,
              phone: buyer.phone,
              status: buyer.status,
            }
          : null,
        sellerId: dispute.sellerId,
        sellerShop: shop
          ? {
              name: shop.name,
              status: shop.status,
              logoUrl: shop.logoUrl,
            }
          : null,
        order: dispute.order
          ? {
              status: dispute.order.status,
              total: dispute.order.total,
              currency: dispute.order.currency,
            }
          : null,
        reasonCategory: dispute.reasonCategory,
        evidenceDescription: dispute.evidenceDescription,
        evidenceImages: dispute.evidenceImages ?? [],
        status: dispute.status,
        staffDecisionNote: dispute.staffDecisionNote,
        resolvedBy: dispute.resolvedBy,
        resolvedAt: dispute.resolvedAt,
        createdAt: dispute.createdAt,
        updatedAt: dispute.updatedAt,
      };
    });

    return {
      data: items,
      meta: {
        page,
        limit,
        totalItems,
        totalPages: Math.max(1, Math.ceil(totalItems / limit)),
      },
    };
  }

  private startOfRange(value: string): string {
    return value.length === 10 ? `${value}T00:00:00.000Z` : value;
  }

  private endOfRange(value: string): string {
    return value.length === 10 ? `${value}T23:59:59.999Z` : value;
  }

  /**
   * Giải quyết khiếu nại đơn hàng bởi Support Desk / Admin
   * Hỗ trợ 2 quyết định: ACCEPTED_REFUND (chấp thuận hoàn tiền) hoặc REJECTED_PAY_SELLER (bác bỏ, trả tiền người bán)
   */
  async resolveDispute(
    disputeId: string,
    actorId: string,
    dto: ResolveOrderDisputeDto,
  ): Promise<ResolveDisputeResponse> {
    return this.dataSource.transaction('READ COMMITTED', async (manager) => {
      // 1. Khóa bi quan và kiểm tra hồ sơ khiếu nại
      const dispute = await manager
        .getRepository(OrderDisputeEntity)
        .createQueryBuilder('dispute')
        .setLock('pessimistic_write')
        .where('dispute.id = :disputeId', { disputeId })
        .getOne();

      if (!dispute) {
        throw new NotFoundException({
          errorCode: 'DISPUTE_NOT_FOUND',
          message: 'Không tìm thấy hồ sơ khiếu nại',
        });
      }

      if (dispute.status !== 'PENDING_STAFF_REVIEW') {
        throw new ConflictException({
          errorCode: 'DISPUTE_ALREADY_RESOLVED',
          message: 'Hồ sơ khiếu nại này đã được xử lý trước đó',
        });
      }

      // 2. Khóa bi quan và kiểm tra đơn hàng tương ứng
      const order = await manager
        .getRepository(OrderEntity)
        .createQueryBuilder('order')
        .setLock('pessimistic_write')
        .where('order.id = :orderId', { orderId: dispute.orderId })
        .getOne();

      if (!order) {
        throw new NotFoundException({
          errorCode: 'ORDER_NOT_FOUND',
          message: 'Không tìm thấy đơn hàng tương ứng với khiếu nại',
        });
      }

      if (order.status !== 'DELIVERED') {
        throw new ConflictException({
          errorCode: 'ORDER_STATUS_INVALID',
          message: `Chỉ có thể giải quyết khiếu nại cho đơn hàng ở trạng thái DELIVERED. Trạng thái hiện tại: ${order.status}`,
        });
      }

      const now = new Date();
      const note = dto.staffDecisionNote.trim();

      if (dto.decision === 'ACCEPTED_REFUND') {
        // Kiểm tra giao dịch thanh toán thành công trước khi chuyển trạng thái đơn hàng
        const payment = await manager
          .getRepository(PaymentEntity)
          .createQueryBuilder('payment')
          .setLock('pessimistic_write')
          .where('payment.order_id = :orderId', { orderId: order.id })
          .andWhere('payment.status = :status', { status: 'SUCCEEDED' })
          .orderBy('payment.updated_at', 'DESC')
          .getOne();

        if (!payment) {
          throw new ConflictException({
            errorCode: 'REFUND_PAYMENT_NOT_FOUND',
            message:
              'Không tìm thấy giao dịch thanh toán thành công của đơn hàng',
          });
        }

        // Chuyển trạng thái đơn hàng sang REFUND_REQUESTED qua State Machine
        await this.orderStateMachine.transition(manager, {
          orderId: order.id,
          toStatus: 'REFUND_REQUESTED',
          actorId,
          reason: `DISPUTE_ACCEPTED:${dispute.id}`,
        });

        // Tạo yêu cầu hoàn tiền (status: 'REQUESTED') qua OrderRefundService
        const refund = await this.orderRefundService.requestFullRefund(
          order.id,
          actorId,
          note,
          manager,
        );

        // Cập nhật trạng thái khiếu nại thành ACCEPTED_REFUND
        dispute.status = 'ACCEPTED_REFUND';
        dispute.staffDecisionNote = note;
        dispute.resolvedBy = actorId;
        dispute.resolvedAt = now;

        const saved = await manager
          .getRepository(OrderDisputeEntity)
          .save(dispute);

        return {
          id: saved.id,
          orderId: saved.orderId,
          orderNumber: order.orderNumber,
          status: saved.status,
          staffDecisionNote: saved.staffDecisionNote!,
          resolvedBy: saved.resolvedBy!,
          resolvedAt: saved.resolvedAt!,
          refundId: refund.refundId,
          refundStatus: refund.status,
        };
      } else {
        // Quyết định REJECTED_PAY_SELLER: Bác bỏ khiếu nại, hoàn tất đơn hàng
        await this.orderStateMachine.transition(manager, {
          orderId: order.id,
          toStatus: 'COMPLETED',
          actorId,
          reason: `DISPUTE_REJECTED:${dispute.id}`,
        });

        // Cập nhật trạng thái khiếu nại thành REJECTED_PAY_SELLER
        dispute.status = 'REJECTED_PAY_SELLER';
        dispute.staffDecisionNote = note;
        dispute.resolvedBy = actorId;
        dispute.resolvedAt = now;

        const saved = await manager
          .getRepository(OrderDisputeEntity)
          .save(dispute);

        return {
          id: saved.id,
          orderId: saved.orderId,
          orderNumber: order.orderNumber,
          status: saved.status,
          staffDecisionNote: saved.staffDecisionNote!,
          resolvedBy: saved.resolvedBy!,
          resolvedAt: saved.resolvedAt!,
        };
      }
    });
  }
}
