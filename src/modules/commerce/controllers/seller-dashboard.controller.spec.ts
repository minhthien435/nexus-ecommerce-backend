import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SellerDashboardController } from './seller-dashboard.controller.js';
import type {
  SellerDashboardService,
  SellerDashboardStats,
} from '../services/seller-dashboard.service.js';
import type { QuerySellerDashboardDto } from '../dtos/query-seller-dashboard.dto.js';

describe('SellerDashboardController', () => {
  let controller: SellerDashboardController;
  let sellerDashboardService: SellerDashboardService;

  const sellerId = 'seller-123';

  beforeEach(() => {
    sellerDashboardService = {
      getStats: vi.fn(),
    } as unknown as SellerDashboardService;

    controller = new SellerDashboardController(sellerDashboardService);
  });

  describe('getStats', () => {
    it('returns envelope format with seller dashboard stats', async () => {
      const query: QuerySellerDashboardDto = { days: 7 };
      const mockStats: SellerDashboardStats = {
        period: {
          days: 7,
          startDate: '2026-11-19',
          endDate: '2026-11-25',
        },
        summary: {
          grossRevenue: 1000000,
          refundedAmount: 100000,
          netRevenue: 900000,
          totalOrders: 10,
          successfulOrders: 8,
          cancelledOrders: 1,
          refundedOrders: 1,
          flashDealSoldUnits: 5,
          successfulAuctionSessions: 2,
        },
        orderStatusCounts: {
          PAID: 5,
          COMPLETED: 3,
          CANCELLED: 1,
          REFUNDED: 1,
        },
        dailyRevenue: [
          { date: '2026-11-19', revenue: 200000, orderCount: 2 },
          { date: '2026-11-20', revenue: 0, orderCount: 0 },
        ],
        topSkus: [
          {
            skuId: 'sku-1',
            productId: 'prod-1',
            productName: 'Áo thun',
            skuAttributes: { color: 'Black' },
            unitsSold: 10,
            revenue: 500000,
          },
        ],
      };

      vi.mocked(sellerDashboardService.getStats).mockResolvedValue(mockStats);

      const response = await controller.getStats(sellerId, query);

      expect(sellerDashboardService.getStats).toHaveBeenCalledWith(
        sellerId,
        query,
      );
      expect(response).toEqual({
        success: true,
        statusCode: 200,
        message: 'Lấy thống kê bảng điều khiển người bán thành công',
        data: mockStats,
      });
    });
  });
});
