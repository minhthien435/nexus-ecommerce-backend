import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataSource } from 'typeorm';
import { AdminDashboardController } from './admin-dashboard.controller.js';
import { UserEntity } from '../domain/user.entity.js';
import { UserRoleEntity } from '../rbac/entities/user-role.entity.js';
import { ProductEntity } from '../../catalog/domain/entities/product.entity.js';
import { ProductSkuEntity } from '../../catalog/domain/entities/product-sku.entity.js';
import { CategoryEntity } from '../../catalog/domain/entities/category.entity.js';
import { InventoryItemEntity } from '../../fulfillment/domain/entities/inventory-item.entity.js';
import { OrderEntity } from '../../commerce/domain/entities/order.entity.js';
import { OrderRefundEntity } from '../../commerce/domain/entities/order-refund.entity.js';

describe('AdminDashboardController (TypeORM)', () => {
  let controller: AdminDashboardController;
  let dataSource: DataSource;

  let mockUserRepo: Record<string, any>;
  let mockProductRepo: Record<string, any>;
  let mockSkuRepo: Record<string, any>;
  let mockCategoryRepo: Record<string, any>;
  let mockInventoryRepo: Record<string, any>;
  let mockOrderRepo: Record<string, any>;
  let mockRefundRepo: Record<string, any>;
  let mockUserRoleRepo: Record<string, any>;

  beforeEach(() => {
    mockUserRepo = {
      count: vi.fn(),
      find: vi.fn(),
    };
    mockProductRepo = {
      count: vi.fn(),
      find: vi.fn(),
    };
    mockSkuRepo = {
      count: vi.fn(),
    };
    mockCategoryRepo = {
      count: vi.fn(),
      createQueryBuilder: vi.fn(),
    };
    mockInventoryRepo = {
      count: vi.fn(),
      createQueryBuilder: vi.fn(),
    };
    mockOrderRepo = {
      count: vi.fn(),
      createQueryBuilder: vi.fn(),
    };
    mockRefundRepo = {
      createQueryBuilder: vi.fn(),
    };
    mockUserRoleRepo = {
      createQueryBuilder: vi.fn(),
    };

    dataSource = {
      getRepository: vi.fn((entity: any) => {
        if (entity === UserEntity) return mockUserRepo;
        if (entity === ProductEntity) return mockProductRepo;
        if (entity === ProductSkuEntity) return mockSkuRepo;
        if (entity === CategoryEntity) return mockCategoryRepo;
        if (entity === InventoryItemEntity) return mockInventoryRepo;
        if (entity === OrderEntity) return mockOrderRepo;
        if (entity === OrderRefundEntity) return mockRefundRepo;
        if (entity === UserRoleEntity) return mockUserRoleRepo;
        return {};
      }),
    } as unknown as DataSource;

    controller = new AdminDashboardController(dataSource);
  });

  it('aggregates statistics using TypeORM repositories and QueryBuilders', async () => {
    // 1. UserRepo mocks
    mockUserRepo.count
      .mockResolvedValueOnce(100) // total
      .mockResolvedValueOnce(90) // active
      .mockResolvedValueOnce(10); // suspended
    mockUserRepo.find.mockResolvedValueOnce([
      {
        id: 'u-1',
        email: 'user1@example.com',
        fullName: 'User One',
        status: 'ACTIVE',
        createdAt: new Date('2026-10-27T00:00:00Z'),
      },
    ]);

    // 2. ProductRepo mocks
    mockProductRepo.count
      .mockResolvedValueOnce(50) // total
      .mockResolvedValueOnce(45) // active
      .mockResolvedValueOnce(5); // inactive
    mockProductRepo.find.mockResolvedValueOnce([
      {
        id: 'p-1',
        name: 'Product One',
        status: 'ACTIVE',
        brand: 'NexusBrand',
        createdAt: new Date('2026-10-27T00:00:00Z'),
      },
    ]);

    // 3. SkuRepo mock
    mockSkuRepo.count.mockResolvedValueOnce(120);

    // 4. CategoryRepo mocks
    mockCategoryRepo.count.mockResolvedValueOnce(15);
    const categoryQb = {
      leftJoin: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      addSelect: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      groupBy: vi.fn().mockReturnThis(),
      addGroupBy: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      getRawMany: vi
        .fn()
        .mockResolvedValueOnce([
          { id: 'cat-1', name: 'Electronics', count: 30 },
        ]),
    };
    mockCategoryRepo.createQueryBuilder.mockReturnValue(categoryQb);

    // 5. InventoryRepo mocks
    mockInventoryRepo.count.mockResolvedValueOnce(120);
    const inventoryOutOfStockQb = {
      where: vi.fn().mockReturnThis(),
      getCount: vi.fn().mockResolvedValueOnce(5),
    };
    const inventoryLowStockQb = {
      where: vi.fn().mockReturnThis(),
      getCount: vi.fn().mockResolvedValueOnce(12),
    };
    mockInventoryRepo.createQueryBuilder
      .mockReturnValueOnce(inventoryOutOfStockQb)
      .mockReturnValueOnce(inventoryLowStockQb);

    // 6. OrderRepo mocks
    mockOrderRepo.count
      .mockResolvedValueOnce(40) // total
      .mockResolvedValueOnce(25) // successful
      .mockResolvedValueOnce(5) // pending
      .mockResolvedValueOnce(10) // cancelled
      .mockResolvedValueOnce(3); // refunded

    const orderRevenueQb = {
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      getRawOne: vi.fn().mockResolvedValueOnce({ totalRevenue: '15000000.00' }),
    };
    const orderPaymentBreakdownQb = {
      leftJoin: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      addSelect: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      groupBy: vi.fn().mockReturnThis(),
      getRawMany: vi.fn().mockResolvedValueOnce([
        { method: 'COD', count: 15, totalAmount: '8000000.00' },
        { method: 'STRIPE', count: 10, totalAmount: '7000000.00' },
      ]),
    };
    const refundSummaryQb = {
      select: vi.fn().mockReturnThis(),
      addSelect: vi.fn().mockReturnThis(),
      getRawOne: vi.fn().mockResolvedValueOnce({
        refundedAmount: '1200000.00',
        pendingRefundAmount: '350000.00',
      }),
    };
    mockRefundRepo.createQueryBuilder.mockReturnValue(refundSummaryQb);
    const orderRecentOrdersQb = {
      leftJoin: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      addSelect: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      getRawMany: vi.fn().mockResolvedValueOnce([
        {
          id: 'o-1',
          orderNumber: 'ORD-123456-ABCD',
          status: 'PAID',
          total: '550000.00',
          currency: 'VND',
          createdAt: '2026-10-27T00:00:00Z',
          paymentMethod: 'STRIPE',
          buyerName: 'User One',
          buyerEmail: 'user1@example.com',
        },
      ]),
    };
    mockOrderRepo.createQueryBuilder
      .mockReturnValueOnce(orderRevenueQb)
      .mockReturnValueOnce(orderPaymentBreakdownQb)
      .mockReturnValueOnce(orderRecentOrdersQb);

    // 7. UserRoleRepo mock
    const userRoleQb = {
      innerJoin: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      addSelect: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      getRawMany: vi
        .fn()
        .mockResolvedValueOnce([{ userId: 'u-1', roleCode: 'BUYER' }]),
    };
    mockUserRoleRepo.createQueryBuilder.mockReturnValue(userRoleQb);

    const stats = await controller.getStats();

    expect(stats.overview.totalUsers).toBe(100);
    expect(stats.overview.activeUsers).toBe(90);
    expect(stats.overview.totalProducts).toBe(50);
    expect(stats.overview.totalOrders).toBe(40);
    expect(stats.overview.successfulOrders).toBe(25);
    expect(stats.overview.totalRevenue).toBe('15000000.00');
    expect(stats.overview.refundedAmount).toBe('1200000.00');
    expect(stats.overview.pendingRefundAmount).toBe('350000.00');
    expect(stats.overview.refundedOrders).toBe(3);

    expect(stats.paymentBreakdown).toHaveLength(2);
    expect(stats.paymentBreakdown[0]).toEqual({
      method: 'COD',
      count: 15,
      totalAmount: '8000000.00',
    });

    expect(stats.categoryBreakdown).toEqual([
      { id: 'cat-1', name: 'Electronics', count: 30 },
    ]);
    expect(stats.recentUsers[0].roles).toEqual(['BUYER']);
    expect(stats.recentProducts[0].name).toBe('Product One');
    expect(stats.recentOrders[0].orderNumber).toBe('ORD-123456-ABCD');
    expect(stats.systemHealth.status).toBe('HEALTHY');
  });

  it('provides safe fallback zeros when tables are empty', async () => {
    mockUserRepo.count.mockResolvedValue(0);
    mockUserRepo.find.mockResolvedValue([]);
    mockProductRepo.count.mockResolvedValue(0);
    mockProductRepo.find.mockResolvedValue([]);
    mockSkuRepo.count.mockResolvedValue(0);
    mockCategoryRepo.count.mockResolvedValue(0);
    mockInventoryRepo.count.mockResolvedValue(0);
    mockOrderRepo.count.mockResolvedValue(0);
    mockRefundRepo.createQueryBuilder.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      addSelect: vi.fn().mockReturnThis(),
      getRawOne: vi.fn().mockResolvedValue(null),
    });

    const emptyQb = {
      leftJoin: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      addSelect: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      groupBy: vi.fn().mockReturnThis(),
      addGroupBy: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      getCount: vi.fn().mockResolvedValue(0),
      getRawOne: vi.fn().mockResolvedValue(null),
      getRawMany: vi.fn().mockResolvedValue([]),
    };

    mockCategoryRepo.createQueryBuilder.mockReturnValue(emptyQb);
    mockInventoryRepo.createQueryBuilder.mockReturnValue(emptyQb);
    mockOrderRepo.createQueryBuilder.mockReturnValue(emptyQb);
    mockUserRoleRepo.createQueryBuilder.mockReturnValue(emptyQb);

    const stats = await controller.getStats();

    expect(stats.overview.totalUsers).toBe(0);
    expect(stats.overview.totalProducts).toBe(0);
    expect(stats.overview.totalOrders).toBe(0);
    expect(stats.overview.totalRevenue).toBe('0.00');
    expect(stats.overview.refundedAmount).toBe('0.00');
    expect(stats.overview.pendingRefundAmount).toBe('0.00');
    expect(stats.overview.refundedOrders).toBe(0);
    expect(stats.paymentBreakdown).toEqual([]);
    expect(stats.recentUsers).toEqual([]);
    expect(stats.recentProducts).toEqual([]);
    expect(stats.recentOrders).toEqual([]);
  });
});
