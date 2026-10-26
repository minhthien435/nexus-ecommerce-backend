import { Controller, Get, UseGuards } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { Roles } from '../rbac/decorators/roles.decorator.js';
import { RolesGuard } from '../rbac/guards/roles.guard.js';

@Roles('ADMIN')
@UseGuards(AccessTokenGuard, RolesGuard)
@Controller('api/v1/admin/dashboard')
export class AdminDashboardController {
  constructor(private readonly dataSource: DataSource) {}

  @Get('stats')
  async getStats() {
    const [
      usersResult,
      productsResult,
      skusResult,
      categoriesResult,
      inventoryResult,
      categoryBreakdown,
      recentUsers,
      recentProducts,
    ] = await Promise.all([
      // Users counts
      this.dataSource.query<
        { total: number; active: number; suspended: number }[]
      >(
        `SELECT 
          count(*)::int as total, 
          count(*) FILTER (WHERE status = 'ACTIVE')::int as active, 
          count(*) FILTER (WHERE status = 'SUSPENDED')::int as suspended 
         FROM identity.users 
         WHERE deleted_at IS NULL`,
      ),

      // Products counts
      this.dataSource.query<
        { total: number; active: number; inactive: number }[]
      >(
        `SELECT 
          count(*)::int as total, 
          count(*) FILTER (WHERE status = 'ACTIVE')::int as active, 
          count(*) FILTER (WHERE status != 'ACTIVE')::int as inactive 
         FROM catalog.products 
         WHERE deleted_at IS NULL`,
      ),

      // SKUs counts
      this.dataSource.query<{ total: number }[]>(
        `SELECT count(*)::int as total 
         FROM catalog.product_skus 
         WHERE is_active = true`,
      ),

      // Categories counts
      this.dataSource.query<{ total: number }[]>(
        `SELECT count(*)::int as total 
         FROM catalog.categories 
         WHERE deleted_at IS NULL`,
      ),

      // Inventory metrics
      this.dataSource.query<
        { total: number; out_of_stock: number; low_stock: number }[]
      >(
        `SELECT 
          count(*)::int as total, 
          count(*) FILTER (WHERE available_qty <= 0)::int as out_of_stock, 
          count(*) FILTER (WHERE available_qty > 0 AND available_qty <= 10)::int as low_stock 
         FROM fulfillment.inventory_items`,
      ),

      // Category breakdown
      this.dataSource.query<{ id: string; name: string; count: number }[]>(
        `SELECT c.id, c.name, count(p.id)::int as count 
         FROM catalog.categories c 
         LEFT JOIN catalog.products p ON p.category_id = c.id AND p.deleted_at IS NULL 
         WHERE c.deleted_at IS NULL 
         GROUP BY c.id, c.name 
         ORDER BY count DESC 
         LIMIT 6`,
      ),

      // Recent users
      this.dataSource.query<
        {
          id: string;
          email: string;
          full_name: string;
          status: string;
          created_at: string;
          roles: string[];
        }[]
      >(
        `SELECT 
          u.id, 
          u.email, 
          u.full_name, 
          u.status, 
          u.created_at, 
          COALESCE(array_remove(array_agg(r.code), NULL), ARRAY[]::varchar[]) as roles 
         FROM identity.users u 
         LEFT JOIN identity.user_roles ur ON ur.user_id = u.id 
         LEFT JOIN identity.roles r ON r.id = ur.role_id 
         WHERE u.deleted_at IS NULL 
         GROUP BY u.id, u.email, u.full_name, u.status, u.created_at 
         ORDER BY u.created_at DESC 
         LIMIT 5`,
      ),

      // Recent products
      this.dataSource.query<
        {
          id: string;
          name: string;
          status: string;
          brand: string | null;
          created_at: string;
        }[]
      >(
        `SELECT 
          id, 
          name, 
          status, 
          brand, 
          created_at 
         FROM catalog.products 
         WHERE deleted_at IS NULL 
         ORDER BY created_at DESC 
         LIMIT 5`,
      ),
    ]);

    const users = usersResult[0] || { total: 0, active: 0, suspended: 0 };
    const products = productsResult[0] || { total: 0, active: 0, inactive: 0 };
    const skus = skusResult[0] || { total: 0 };
    const categories = categoriesResult[0] || { total: 0 };
    const inventory = inventoryResult[0] || {
      total: 0,
      out_of_stock: 0,
      low_stock: 0,
    };

    return {
      overview: {
        totalProducts: products.total,
        activeProducts: products.active,
        inactiveProducts: products.inactive,
        totalSkus: skus.total,
        totalCategories: categories.total,
        totalUsers: users.total,
        activeUsers: users.active,
        suspendedUsers: users.suspended,
        totalInventoryItems: inventory.total,
        outOfStockCount: inventory.out_of_stock,
        lowStockCount: inventory.low_stock,
      },
      categoryBreakdown,
      recentUsers: recentUsers.map((u) => ({
        id: u.id,
        email: u.email,
        fullName: u.full_name,
        status: u.status,
        createdAt: u.created_at,
        roles: u.roles,
      })),
      recentProducts: recentProducts.map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        brand: p.brand,
        createdAt: p.created_at,
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
