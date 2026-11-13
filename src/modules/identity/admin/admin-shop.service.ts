import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import { AuditLogEntity } from '../domain/audit-log.entity.js';
import { IdentityOutboxEntity } from '../domain/identity-outbox.entity.js';
import { ShopEntity, type ShopStatus } from '../domain/shop.entity.js';
import { UserEntity } from '../domain/user.entity.js';
import { ListShopsQueryDto } from './dtos/admin-shop.dto.js';
import type { SellerShopView } from '../services/seller-shop.service.js';
import { EmailService } from '../../../common/email/email.service.js';
import { NotificationDispatchApi } from '../../notification/notification-dispatch.api.js';

export type AdminShopDetail = SellerShopView & {
  seller: Pick<UserEntity, 'id' | 'fullName' | 'email' | 'phone' | 'status'>;
};

@Injectable()
export class AdminShopService {
  private readonly logger = new Logger(AdminShopService.name);

  constructor(
    @InjectRepository(ShopEntity)
    private readonly shops: Repository<ShopEntity>,
    private readonly dataSource: DataSource,
    private readonly emailService: EmailService,
    @Optional()
    private readonly notifications?: NotificationDispatchApi,
  ) {}

  async list(query: ListShopsQueryDto) {
    const qb = this.shops
      .createQueryBuilder('shop')
      .where('shop.deleted_at IS NULL');
    if (query.search) {
      qb.andWhere(
        '(shop.name ILIKE :search OR shop.slug ILIKE :search OR shop.email ILIKE :search OR shop.phone ILIKE :search)',
        { search: `%${query.search}%` },
      );
    }
    if (query.status)
      qb.andWhere('shop.status = :status', { status: query.status });
    qb.orderBy('shop.created_at', 'DESC')
      .addOrderBy('shop.id', 'ASC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit);
    const [records, total] = await qb.getManyAndCount();
    return {
      items: records.map((shop) => this.toView(shop)),
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  async getById(shopId: string): Promise<AdminShopDetail> {
    const shop = await this.shops.findOne({
      where: { id: shopId, deletedAt: IsNull() },
      relations: { seller: true },
    });
    if (!shop) throw new NotFoundException('Shop not found');
    return this.toDetail(shop);
  }

  async updateStatus(
    actorId: string,
    shopId: string,
    status: ShopStatus,
    reason: string,
  ) {
    const notification = await this.dataSource.transaction(async (manager) => {
      const shop = await manager
        .getRepository(ShopEntity)
        .createQueryBuilder('shop')
        .innerJoinAndSelect('shop.seller', 'seller')
        .setLock('pessimistic_write')
        .where('shop.id = :shopId', { shopId })
        .andWhere('shop.deleted_at IS NULL')
        .getOne();
      if (!shop) throw new NotFoundException('Shop not found');
      if (shop.status === status)
        throw new ConflictException('Shop already has this status');
      const previousStatus = shop.status;
      const statusChangedAt = new Date();
      shop.status = status;
      shop.statusReason = reason;
      shop.statusChangedAt = statusChangedAt;
      await manager.getRepository(ShopEntity).save(shop);
      await this.recordChange(
        manager,
        actorId,
        shopId,
        previousStatus,
        status,
        reason,
      );
      return {
        sellerId: shop.sellerId,
        recipient: shop.seller.email,
        shopName: shop.name,
        status,
        reason,
        statusChangedAt,
      };
    });
    const type =
      notification.status === 'ACTIVE'
        ? 'SHOP_APPROVED'
        : notification.status === 'SUSPENDED'
          ? 'SHOP_SUSPENDED'
          : notification.status === 'CLOSED'
            ? 'SHOP_REJECTED'
            : null;
    try {
      const emailEnabled =
        !type ||
        ((await this.notifications?.isEnabled(
          notification.sellerId,
          type,
          'EMAIL',
        )) ??
          true);
      if (emailEnabled) {
        await this.emailService.sendShopStatusChanged(notification);
      }
    } catch (error) {
      this.logger.error(
        `Shop ${shopId} status changed, but seller notification failed`,
        error instanceof Error ? error.stack : undefined,
      );
    }
    if (type) {
      try {
        await this.notifications?.notify({
          userId: notification.sellerId,
          type,
          title: 'Trạng thái cửa hàng đã thay đổi',
          content: `Cửa hàng ${notification.shopName} hiện có trạng thái ${notification.status}.`,
          actionUrl: '/seller/dashboard',
          metadata: { shopId, status: notification.status, reason },
        });
      } catch (error) {
        this.logger.error(
          `Shop ${shopId} status changed, but in-app notification failed`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }
    return this.getById(shopId);
  }

  private async recordChange(
    manager: EntityManager,
    actorId: string,
    shopId: string,
    previousStatus: ShopStatus,
    status: ShopStatus,
    reason: string,
  ) {
    const changes = { previousStatus, status, reason };
    const action = 'SHOP_STATUS_CHANGED';
    const audit = manager.getRepository(AuditLogEntity);
    await audit.save(
      audit.create({
        actorId,
        actorType: 'ADMIN',
        action,
        entityType: 'SHOP',
        entityId: shopId,
        changes,
      }),
    );
    const outbox = manager.getRepository(IdentityOutboxEntity);
    await outbox.save(
      outbox.create({
        eventType: action,
        aggregateType: 'SHOP',
        aggregateId: shopId,
        payload: { actorId, shopId, ...changes },
      }),
    );
  }

  private toDetail(shop: ShopEntity): AdminShopDetail {
    return {
      ...this.toView(shop),
      seller: {
        id: shop.seller.id,
        fullName: shop.seller.fullName,
        email: shop.seller.email,
        phone: shop.seller.phone,
        status: shop.seller.status,
      },
    };
  }

  private toView(shop: ShopEntity): SellerShopView {
    return {
      id: shop.id,
      sellerId: shop.sellerId,
      name: shop.name,
      slug: shop.slug,
      headline: shop.headline,
      description: shop.description,
      logoUrl: shop.logoUrl,
      bannerUrl: shop.bannerUrl,
      phone: shop.phone,
      email: shop.email,
      warehouseAddress: shop.warehouseAddress,
      status: shop.status,
      statusReason: shop.statusReason,
      statusChangedAt: shop.statusChangedAt,
      ratingAvg: Number(shop.ratingAvg),
      reviewCount: shop.reviewCount,
      followerCount: shop.followerCount,
      reputationScore: shop.reputationScore,
      createdAt: shop.createdAt,
      updatedAt: shop.updatedAt,
    };
  }
}
