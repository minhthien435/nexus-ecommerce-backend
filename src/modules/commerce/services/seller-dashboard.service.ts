import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { QuerySellerDashboardDto } from '../dtos/query-seller-dashboard.dto.js';

export const SUCCESSFUL_ORDER_STATUSES = [
  'PAID',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
  'COMPLETED',
] as const;

export const GROSS_REVENUE_ORDER_STATUSES = [
  'PAID',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
  'COMPLETED',
  'REFUND_REQUESTED',
  'REFUNDED',
] as const;

export interface DailyRevenuePoint {
  date: string;
  revenue: number;
  orderCount: number;
}

export interface TopSkuItem {
  skuId: string;
  productId: string;
  productName: string;
  skuAttributes: Record<string, unknown> | null;
  unitsSold: number;
  revenue: number;
}

export interface SellerDashboardStats {
  period: {
    days: number;
    startDate: string;
    endDate: string;
  };
  summary: {
    grossRevenue: number;
    refundedAmount: number;
    netRevenue: number;
    totalOrders: number;
    successfulOrders: number;
    cancelledOrders: number;
    refundedOrders: number;
    flashDealSoldUnits: number;
    successfulAuctionSessions: number;
  };
  orderStatusCounts: Record<string, number>;
  dailyRevenue: DailyRevenuePoint[];
  topSkus: TopSkuItem[];
}

@Injectable()
export class SellerDashboardService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async getStats(
    sellerId: string,
    query?: QuerySellerDashboardDto,
  ): Promise<SellerDashboardStats> {
    const days = query?.days === 30 ? 30 : 7;
    const now = new Date();

    // Generate consecutive dates in Asia/Ho_Chi_Minh (UTC+7)
    const dateKeys: string[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dateStr = d.toLocaleDateString('en-CA', {
        timeZone: 'Asia/Ho_Chi_Minh',
      });
      dateKeys.push(dateStr);
    }

    const startDateStr = dateKeys[0];
    const endDateStr = dateKeys[dateKeys.length - 1];
    const startDateObj = new Date(`${startDateStr}T00:00:00+07:00`);

    // Execute queries in parallel
    const [
      statusRows,
      grossRevenueRows,
      refundRows,
      dailyRows,
      topSkuRows,
      flashDealRows,
      auctionRows,
    ] = await Promise.all([
      // 1. Order status counts
      this.dataSource.query<Array<{ status: string; count: string | number }>>(
        `SELECT status, COUNT(*)::int AS count
           FROM commerce.orders
          WHERE seller_id = $1
            AND created_at >= $2
          GROUP BY status`,
        [sellerId, startDateObj],
      ),

      // 2. Gross revenue
      this.dataSource.query<Array<{ gross_revenue: string | number }>>(
        `SELECT COALESCE(SUM(total), 0)::numeric AS gross_revenue
           FROM commerce.orders
          WHERE seller_id = $1
            AND status = ANY($3::varchar[])
            AND created_at >= $2`,
        [sellerId, startDateObj, GROSS_REVENUE_ORDER_STATUSES],
      ),

      // 3. Refunded amount
      this.dataSource.query<Array<{ refunded_amount: string | number }>>(
        `SELECT COALESCE(SUM(r.amount), 0)::numeric AS refunded_amount
           FROM commerce.order_refunds r
           JOIN commerce.orders o ON o.id = r.order_id
          WHERE o.seller_id = $1
            AND r.status = 'COMPLETED'
            AND o.created_at >= $2`,
        [sellerId, startDateObj],
      ),

      // 4. Daily revenue breakdown
      this.dataSource.query<
        Array<{
          date: string;
          revenue: string | number;
          order_count: string | number;
        }>
      >(
        `SELECT TO_CHAR(o.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD') AS date,
                COALESCE(SUM(o.total), 0)::numeric AS revenue,
                COUNT(o.id)::int AS order_count
           FROM commerce.orders o
          WHERE o.seller_id = $1
            AND o.status = ANY($3::varchar[])
            AND o.created_at >= $2
          GROUP BY TO_CHAR(o.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD')
          ORDER BY date ASC`,
        [sellerId, startDateObj, SUCCESSFUL_ORDER_STATUSES],
      ),

      // 5. Top 5 SKUs
      this.dataSource.query<
        Array<{
          skuId: string;
          productId: string;
          productName: string;
          skuAttributes: Record<string, unknown> | null;
          unitsSold: string | number;
          revenue: string | number;
        }>
      >(
        `SELECT oi.sku_id AS "skuId",
                oi.product_id AS "productId",
                MAX(oi.product_name_snapshot) AS "productName",
                MAX(oi.sku_attributes_snapshot::text)::jsonb AS "skuAttributes",
                COALESCE(SUM(oi.quantity), 0)::int AS "unitsSold",
                COALESCE(SUM(oi.line_total), 0)::numeric AS "revenue"
           FROM commerce.order_items oi
           JOIN commerce.orders o ON o.id = oi.order_id
          WHERE o.seller_id = $1
            AND o.status = ANY($3::varchar[])
            AND o.created_at >= $2
          GROUP BY oi.sku_id, oi.product_id
          ORDER BY "unitsSold" DESC, "revenue" DESC
          LIMIT 5`,
        [sellerId, startDateObj, SUCCESSFUL_ORDER_STATUSES],
      ),

      // 6. Flash deal sold units
      this.dataSource.query<Array<{ flashDealSoldUnits: string | number }>>(
        `SELECT COALESCE(SUM(r.quantity), 0)::int AS "flashDealSoldUnits"
           FROM catalog.flash_deal_reservations r
           JOIN catalog.flash_deal_items fdi ON fdi.id = r.flash_deal_item_id
           JOIN commerce.orders o ON o.id = r.order_id
          WHERE fdi.seller_id = $1
            AND o.status = ANY($3::varchar[])
            AND r.status = 'COMMITTED'
            AND o.created_at >= $2`,
        [sellerId, startDateObj, SUCCESSFUL_ORDER_STATUSES],
      ),

      // 7. Successful auction sessions
      this.dataSource.query<
        Array<{ successfulAuctionSessions: string | number }>
      >(
        `SELECT COUNT(DISTINCT a.id)::int AS "successfulAuctionSessions"
           FROM auction.auctions a
           JOIN auction.auction_settlements s ON s.auction_id = a.id
          WHERE a.seller_id = $1
            AND a.status = 'SETTLED'
            AND s.status IN ('PAID', 'COMPLETED')
            AND s.settled_at >= $2`,
        [sellerId, startDateObj],
      ),
    ]);

    // Parse status counts
    const orderStatusCounts: Record<string, number> = {};
    let totalOrders = 0;
    let successfulOrders = 0;
    let cancelledOrders = 0;
    let refundedOrders = 0;

    for (const row of statusRows) {
      const count = Number(row.count) || 0;
      orderStatusCounts[row.status] = count;
      totalOrders += count;

      if (
        (SUCCESSFUL_ORDER_STATUSES as readonly string[]).includes(row.status)
      ) {
        successfulOrders += count;
      }
      if (row.status === 'CANCELLED') {
        cancelledOrders += count;
      }
      if (row.status === 'REFUNDED') {
        refundedOrders += count;
      }
    }

    const grossRevenue = Number(
      Number(grossRevenueRows[0]?.gross_revenue ?? 0).toFixed(2),
    );
    const refundedAmount = Number(
      Number(refundRows[0]?.refunded_amount ?? 0).toFixed(2),
    );
    const netRevenue = Number(
      Math.max(0, grossRevenue - refundedAmount).toFixed(2),
    );

    // Map daily revenue with zero-fill for all consecutive dates
    const dailyMap = new Map<string, { revenue: number; orderCount: number }>();
    for (const row of dailyRows) {
      dailyMap.set(row.date, {
        revenue: Number(Number(row.revenue).toFixed(2)),
        orderCount: Number(row.order_count) || 0,
      });
    }

    const dailyRevenue: DailyRevenuePoint[] = dateKeys.map((date) => {
      const point = dailyMap.get(date);
      return {
        date,
        revenue: point?.revenue ?? 0,
        orderCount: point?.orderCount ?? 0,
      };
    });

    const topSkus: TopSkuItem[] = topSkuRows.map((row) => ({
      skuId: row.skuId,
      productId: row.productId,
      productName: row.productName,
      skuAttributes: row.skuAttributes,
      unitsSold: Number(row.unitsSold) || 0,
      revenue: Number(Number(row.revenue).toFixed(2)),
    }));

    const flashDealSoldUnits =
      Number(flashDealRows[0]?.flashDealSoldUnits) || 0;
    const successfulAuctionSessions =
      Number(auctionRows[0]?.successfulAuctionSessions) || 0;

    return {
      period: {
        days,
        startDate: startDateStr,
        endDate: endDateStr,
      },
      summary: {
        grossRevenue,
        refundedAmount,
        netRevenue,
        totalOrders,
        successfulOrders,
        cancelledOrders,
        refundedOrders,
        flashDealSoldUnits,
        successfulAuctionSessions,
      },
      orderStatusCounts,
      dailyRevenue,
      topSkus,
    };
  }
}
