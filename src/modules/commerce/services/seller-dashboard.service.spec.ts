import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataSource } from 'typeorm';
import {
  SellerDashboardService,
  SUCCESSFUL_ORDER_STATUSES,
} from './seller-dashboard.service.js';

describe('SellerDashboardService', () => {
  let service: SellerDashboardService;
  let dataSource: DataSource;
  let queryMock: ReturnType<typeof vi.fn>;

  const sellerId = 'seller-uuid-1';

  beforeEach(() => {
    queryMock = vi.fn();
    dataSource = {
      query: queryMock,
    } as unknown as DataSource;

    service = new SellerDashboardService(dataSource);
  });

  describe('getStats', () => {
    it('returns 7-day stats by default with zero-filled daily data and calculated net revenue', async () => {
      // Mock 7 queries
      queryMock
        // 1. Order status counts
        .mockResolvedValueOnce([
          { status: 'PAID', count: 4 },
          { status: 'COMPLETED', count: 3 },
          { status: 'CANCELLED', count: 2 },
          { status: 'REFUNDED', count: 1 },
          { status: 'PENDING_PAYMENT', count: 1 },
        ])
        // 2. Gross revenue
        .mockResolvedValueOnce([{ gross_revenue: '2500000.50' }])
        // 3. Refunded amount
        .mockResolvedValueOnce([{ refunded_amount: '300000.00' }])
        // 4. Daily revenue breakdown
        .mockResolvedValueOnce([
          { date: '2026-11-20', revenue: '500000.00', order_count: 2 },
          { date: '2026-11-25', revenue: '2000000.50', order_count: 5 },
        ])
        // 5. Top 5 SKUs
        .mockResolvedValueOnce([
          {
            skuId: 'sku-1',
            productId: 'prod-1',
            productName: 'Áo Polo Nam',
            skuAttributes: { color: 'Blue', size: 'L' },
            unitsSold: 12,
            revenue: '1800000.00',
          },
          {
            skuId: 'sku-2',
            productId: 'prod-2',
            productName: 'Quần Jean',
            skuAttributes: { size: '32' },
            unitsSold: 5,
            revenue: '700000.50',
          },
        ])
        // 6. Flash deal sold units
        .mockResolvedValueOnce([{ flashDealSoldUnits: 8 }])
        // 7. Successful auction sessions
        .mockResolvedValueOnce([{ successfulAuctionSessions: 3 }]);

      const result = await service.getStats(sellerId);

      expect(result.period.days).toBe(7);
      expect(result.dailyRevenue).toHaveLength(7);

      // Summary checks
      expect(result.summary.grossRevenue).toBe(2500000.5);
      expect(result.summary.refundedAmount).toBe(300000);
      expect(result.summary.netRevenue).toBe(2200000.5);
      expect(result.summary.totalOrders).toBe(11);
      expect(result.summary.successfulOrders).toBe(7); // PAID (4) + COMPLETED (3)
      expect(result.summary.cancelledOrders).toBe(2);
      expect(result.summary.refundedOrders).toBe(1);
      expect(result.summary.flashDealSoldUnits).toBe(8);
      expect(result.summary.successfulAuctionSessions).toBe(3);

      // Status counts
      expect(result.orderStatusCounts).toEqual({
        PAID: 4,
        COMPLETED: 3,
        CANCELLED: 2,
        REFUNDED: 1,
        PENDING_PAYMENT: 1,
      });

      // Top SKUs
      expect(result.topSkus).toHaveLength(2);
      expect(result.topSkus[0]).toEqual({
        skuId: 'sku-1',
        productId: 'prod-1',
        productName: 'Áo Polo Nam',
        skuAttributes: { color: 'Blue', size: 'L' },
        unitsSold: 12,
        revenue: 1800000,
      });

      // Verify queries called with sellerId, date param, and SUCCESSFUL_ORDER_STATUSES
      expect(queryMock).toHaveBeenCalledTimes(7);
      expect(queryMock.mock.calls[0][1][0]).toBe(sellerId);
      expect(queryMock.mock.calls[1][1][2]).toBe(SUCCESSFUL_ORDER_STATUSES);
    });

    it('returns 30-day stats when days=30 is specified', async () => {
      queryMock
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ gross_revenue: 0 }])
        .mockResolvedValueOnce([{ refunded_amount: 0 }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ flashDealSoldUnits: 0 }])
        .mockResolvedValueOnce([{ successfulAuctionSessions: 0 }]);

      const result = await service.getStats(sellerId, { days: 30 });

      expect(result.period.days).toBe(30);
      expect(result.dailyRevenue).toHaveLength(30);
      expect(result.summary.grossRevenue).toBe(0);
      expect(result.summary.refundedAmount).toBe(0);
      expect(result.summary.netRevenue).toBe(0);
      expect(result.summary.totalOrders).toBe(0);
      expect(result.summary.successfulOrders).toBe(0);
      expect(result.topSkus).toEqual([]);
    });

    it('clamps net revenue to 0 if refundedAmount exceeds grossRevenue', async () => {
      queryMock
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ gross_revenue: '100000' }])
        .mockResolvedValueOnce([{ refunded_amount: '150000' }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ flashDealSoldUnits: 0 }])
        .mockResolvedValueOnce([{ successfulAuctionSessions: 0 }]);

      const result = await service.getStats(sellerId, { days: 7 });

      expect(result.summary.grossRevenue).toBe(100000);
      expect(result.summary.refundedAmount).toBe(150000);
      expect(result.summary.netRevenue).toBe(0);
    });

    it('handles empty database results gracefully', async () => {
      queryMock
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await service.getStats(sellerId);

      expect(result.summary.grossRevenue).toBe(0);
      expect(result.summary.refundedAmount).toBe(0);
      expect(result.summary.netRevenue).toBe(0);
      expect(result.summary.totalOrders).toBe(0);
      expect(result.summary.successfulOrders).toBe(0);
      expect(result.summary.flashDealSoldUnits).toBe(0);
      expect(result.summary.successfulAuctionSessions).toBe(0);
      expect(result.orderStatusCounts).toEqual({});
      expect(result.topSkus).toEqual([]);
      expect(result.dailyRevenue).toHaveLength(7);
      for (const day of result.dailyRevenue) {
        expect(day.revenue).toBe(0);
        expect(day.orderCount).toBe(0);
      }
    });
  });
});
