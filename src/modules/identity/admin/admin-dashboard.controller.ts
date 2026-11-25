import { Controller, Get, UseGuards } from '@nestjs/common';
import { DataSource, In, IsNull, Not } from 'typeorm';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { Roles } from '../rbac/decorators/roles.decorator.js';
import { RolesGuard } from '../rbac/guards/roles.guard.js';
import { UserEntity } from '../domain/user.entity.js';
import { ShopEntity } from '../domain/shop.entity.js';
import { RoleEntity } from '../rbac/entities/role.entity.js';
import { UserRoleEntity } from '../rbac/entities/user-role.entity.js';
import {
  ProductEntity,
  ProductStatus,
} from '../../catalog/domain/entities/product.entity.js';
import { ProductSkuEntity } from '../../catalog/domain/entities/product-sku.entity.js';
import { CategoryEntity } from '../../catalog/domain/entities/category.entity.js';
import { InventoryItemEntity } from '../../fulfillment/domain/entities/inventory-item.entity.js';
import { OrderEntity } from '../../commerce/domain/entities/order.entity.js';
import { CheckoutSessionEntity } from '../../commerce/domain/entities/checkout-session.entity.js';
import { OrderRefundEntity } from '../../commerce/domain/entities/order-refund.entity.js';

@Roles('ADMIN')
@UseGuards(AccessTokenGuard, RolesGuard)
@Controller('api/v1/admin/dashboard')
export class AdminDashboardController {
  constructor(private readonly dataSource: DataSource) {}

  @Get('stats')
  async getStats() {
    const userRepo = this.dataSource.getRepository(UserEntity);
    const productRepo = this.dataSource.getRepository(ProductEntity);
    const skuRepo = this.dataSource.getRepository(ProductSkuEntity);
    const categoryRepo = this.dataSource.getRepository(CategoryEntity);
    const inventoryRepo = this.dataSource.getRepository(InventoryItemEntity);
    const orderRepo = this.dataSource.getRepository(OrderEntity);
    const refundRepo = this.dataSource.getRepository(OrderRefundEntity);
    const userRoleRepo = this.dataSource.getRepository(UserRoleEntity);

    const successfulStatuses = [
      'PAID',
      'PROCESSING',
      'SHIPPED',
      'DELIVERED',
      'COMPLETED',
    ];

    const [
      // 1. Users metrics
      totalUsers,
      activeUsers,
      suspendedUsers,

      // 2. Products metrics
      totalProducts,
      activeProducts,
      inactiveProducts,

      // 3. SKUs metrics
      totalSkus,

      // 4. Categories metrics
      totalCategories,

      // 5. Inventory metrics
      totalInventoryItems,
      outOfStockCount,
      lowStockCount,

      // 6. Orders & Revenue metrics
      totalOrders,
      successfulOrders,
      pendingOrders,
      cancelledOrders,
      revenueResult,
      refundSummaryResult,
      refundedOrders,

      // 7. Payment method breakdown
      paymentBreakdownRaw,

      // 8. Category distribution breakdown
      categoryBreakdown,

      // 9. Recent users
      recentUsersList,

      // 10. Recent products
      recentProductsList,

      // 11. Recent orders
      recentOrdersRaw,
    ] = await Promise.all([
      // Users
      userRepo.count({ where: { deletedAt: IsNull() } }),
      userRepo.count({ where: { status: 'ACTIVE', deletedAt: IsNull() } }),
      userRepo.count({ where: { status: 'SUSPENDED', deletedAt: IsNull() } }),

      // Products
      productRepo.count({ where: { deletedAt: IsNull() } }),
      productRepo.count({
        where: { status: ProductStatus.ACTIVE, deletedAt: IsNull() },
      }),
      productRepo.count({
        where: { status: Not(ProductStatus.ACTIVE), deletedAt: IsNull() },
      }),

      // SKUs
      skuRepo.count({ where: { isActive: true } }),

      // Categories
      categoryRepo.count({ where: { deletedAt: IsNull() } }),

      // Inventory
      inventoryRepo.count(),
      inventoryRepo
        .createQueryBuilder('item')
        .where('item.availableQuantity <= :zero', { zero: 0 })
        .getCount(),
      inventoryRepo
        .createQueryBuilder('item')
        .where(
          'item.availableQuantity > :zero AND item.availableQuantity <= :threshold',
          {
            zero: 0,
            threshold: 10,
          },
        )
        .getCount(),

      // Orders & Revenue
      orderRepo.count(),
      orderRepo.count({ where: { status: In(successfulStatuses) } }),
      orderRepo.count({ where: { status: 'PENDING_PAYMENT' } }),
      orderRepo.count({ where: { status: 'CANCELLED' } }),
      orderRepo
        .createQueryBuilder('order')
        .select('COALESCE(SUM(order.total), 0)', 'totalRevenue')
        .where('order.status IN (:...statuses)', {
          statuses: successfulStatuses,
        })
        .getRawOne<{ totalRevenue: string }>(),
      refundRepo
        .createQueryBuilder('refund')
        .select(
          "COALESCE(SUM(refund.amount) FILTER (WHERE refund.status = 'COMPLETED'), 0)",
          'refundedAmount',
        )
        .addSelect(
          "COALESCE(SUM(refund.amount) FILTER (WHERE refund.status IN ('REQUESTED', 'PROCESSING')), 0)",
          'pendingRefundAmount',
        )
        .getRawOne<{
          refundedAmount: string;
          pendingRefundAmount: string;
        }>(),
      orderRepo.count({ where: { status: 'REFUNDED' } }),

      // Payment Breakdown
      orderRepo
        .createQueryBuilder('order')
        .leftJoin(
          CheckoutSessionEntity,
          'cs',
          'cs.id = order.checkoutSessionId',
        )
        .select("COALESCE(cs.paymentMethod, 'COD')", 'method')
        .addSelect('COUNT(order.id)::int', 'count')
        .addSelect('COALESCE(SUM(order.total), 0)::text', 'totalAmount')
        .where('order.status IN (:...statuses)', {
          statuses: successfulStatuses,
        })
        .groupBy('cs.paymentMethod')
        .getRawMany<{ method: string; count: number; totalAmount: string }>(),

      // Category breakdown with product counts
      categoryRepo
        .createQueryBuilder('category')
        .leftJoin(
          ProductEntity,
          'product',
          'product.categoryId = category.id AND product.deletedAt IS NULL',
        )
        .select('category.id', 'id')
        .addSelect('category.name', 'name')
        .addSelect('COUNT(product.id)::int', 'count')
        .where('category.deletedAt IS NULL')
        .groupBy('category.id')
        .addGroupBy('category.name')
        .orderBy('count', 'DESC')
        .limit(6)
        .getRawMany<{ id: string; name: string; count: number }>(),

      // Recent users
      userRepo.find({
        where: { deletedAt: IsNull() },
        select: {
          id: true,
          email: true,
          fullName: true,
          status: true,
          createdAt: true,
        },
        order: { createdAt: 'DESC' },
        take: 5,
      }),

      // Recent products with primary image and shop name
      productRepo
        .createQueryBuilder('product')
        .leftJoin(
          ShopEntity,
          'shop',
          '(shop.id = product.shopId OR (product.shopId IS NULL AND shop.sellerId = product.sellerId)) AND shop.deletedAt IS NULL',
        )
        .select([
          'product.id AS id',
          'product.name AS name',
          'product.slug AS slug',
          'product.status AS status',
          'product.brand AS brand',
          'product.createdAt AS "createdAt"',
        ])
        .addSelect('shop.name', 'shopName')
        .addSelect(
          '(SELECT pi.url FROM catalog.product_images pi WHERE pi.product_id = product.id ORDER BY pi.is_primary DESC, pi.sort_order ASC, pi.id ASC LIMIT 1)',
          'imageUrl',
        )
        .where('product.deletedAt IS NULL')
        .orderBy('product.createdAt', 'DESC')
        .limit(5)
        .getRawMany<{
          id: string;
          name: string;
          slug: string | null;
          status: string;
          brand: string | null;
          createdAt: Date | string;
          imageUrl: string | null;
          shopName: string | null;
        }>(),

      // Recent orders with buyer details
      orderRepo
        .createQueryBuilder('order')
        .leftJoin(
          CheckoutSessionEntity,
          'cs',
          'cs.id = order.checkoutSessionId',
        )
        .leftJoin(UserEntity, 'buyer', 'buyer.id = order.buyerId')
        .select([
          'order.id AS id',
          'order.orderNumber AS "orderNumber"',
          'order.status AS status',
          'order.total AS total',
          'order.currency AS currency',
          'order.createdAt AS "createdAt"',
        ])
        .addSelect("COALESCE(cs.paymentMethod, 'COD')", 'paymentMethod')
        .addSelect('buyer.fullName', 'buyerName')
        .addSelect('buyer.email', 'buyerEmail')
        .orderBy('order.createdAt', 'DESC')
        .limit(5)
        .getRawMany<{
          id: string;
          orderNumber: string;
          status: string;
          total: string;
          currency: string;
          createdAt: string;
          paymentMethod: string;
          buyerName: string | null;
          buyerEmail: string | null;
        }>(),
    ]);

    // Batch load roles for recent users using TypeORM
    const recentUserIds = recentUsersList.map((u) => u.id);
    const roleRows =
      recentUserIds.length > 0
        ? await userRoleRepo
            .createQueryBuilder('ur')
            .innerJoin(
              RoleEntity,
              'r',
              'r.id = ur.roleId AND r.deletedAt IS NULL',
            )
            .select('ur.userId', 'userId')
            .addSelect('r.code', 'roleCode')
            .where('ur.userId IN (:...ids)', { ids: recentUserIds })
            .getRawMany<{ userId: string; roleCode: string }>()
        : [];

    const rolesMap = new Map<string, string[]>();
    for (const row of roleRows) {
      const current = rolesMap.get(row.userId) ?? [];
      current.push(row.roleCode);
      rolesMap.set(row.userId, current);
    }

    return {
      overview: {
        totalRevenue: revenueResult?.totalRevenue ?? '0.00',
        refundedAmount: refundSummaryResult?.refundedAmount ?? '0.00',
        pendingRefundAmount: refundSummaryResult?.pendingRefundAmount ?? '0.00',
        refundedOrders,
        totalOrders,
        successfulOrders,
        pendingOrders,
        cancelledOrders,
        totalProducts,
        activeProducts,
        inactiveProducts,
        totalSkus,
        totalCategories,
        totalUsers,
        activeUsers,
        suspendedUsers,
        totalInventoryItems,
        outOfStockCount,
        lowStockCount,
      },
      paymentBreakdown: paymentBreakdownRaw.map((p) => ({
        method: p.method,
        count: Number(p.count),
        totalAmount: p.totalAmount,
      })),
      categoryBreakdown: categoryBreakdown.map((c) => ({
        id: c.id,
        name: c.name,
        count: Number(c.count),
      })),
      recentUsers: recentUsersList.map((u) => ({
        id: u.id,
        email: u.email,
        fullName: u.fullName,
        status: u.status,
        createdAt: u.createdAt,
        roles: rolesMap.get(u.id) ?? [],
      })),
      recentProducts: recentProductsList.map((p) => ({
        id: p.id,
        name: p.name,
        slug: p.slug ?? null,
        status: p.status,
        brand: p.brand ?? null,
        imageUrl: p.imageUrl ?? null,
        shopName: p.shopName ?? null,
        createdAt: p.createdAt,
      })),
      recentOrders: recentOrdersRaw.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        total: o.total,
        currency: o.currency,
        paymentMethod: o.paymentMethod || 'COD',
        buyerName: o.buyerName,
        buyerEmail: o.buyerEmail,
        createdAt: o.createdAt,
      })),
      systemHealth: {
        status: 'HEALTHY',
        database: 'ONLINE',
        serverUptime: Math.floor(process.uptime()),
        nodeVersion: process.version,
        timestamp: new Date().toISOString(),
      },
    };
  }
}
