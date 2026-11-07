import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { GhnClientService } from './ghn-client.service.js';
import type { GhnCreateOrderPayload } from '../dtos/ghn-shipping.dto.js';

describe('GhnClientService', () => {
  let service: GhnClientService;
  let configService: ConfigService;

  const mockPayload: GhnCreateOrderPayload = {
    to_name: 'Nguyễn Văn A',
    to_phone: '0901234567',
    to_address: '123 Đường Lê Lợi, Phường Bến Nghé',
    to_ward_code: '20101',
    to_district_id: 1442,
    weight: 500,
    items: [
      {
        name: 'Áo thun cotton',
        quantity: 2,
        price: 150000,
        weight: 250,
      },
    ],
  };

  describe('Mock Fallback Mode', () => {
    beforeEach(() => {
      configService = {
        get: vi.fn((key: string) => {
          if (key === 'GHN_MOCK_FALLBACK') return 'true';
          if (key === 'GHN_API_URL')
            return 'https://dev-online-gateway.ghn.vn/shiip/public-api';
          return undefined;
        }),
      } as unknown as ConfigService;

      service = new GhnClientService(configService);
    });

    it('tạo mã vận đơn mock an toàn khi thiếu token', async () => {
      const result = await service.createShippingOrder(mockPayload);
      expect(result).toBeDefined();
      expect(result.order_code).toMatch(/^GHN/);
      expect(result.total_fee).toBe(32000);
      expect(result.print_url).toContain(result.order_code);
    });

    it('tạo đúng đường dẫn print URL chứa order code hoặc token', () => {
      const url = service.generatePrintUrl('GHN123456');
      expect(url).toContain('GHN123456');
      expect(url).toContain('/a5/public-api/printA5');
    });

    it('chấp nhận webhook khi chưa cấu hình secret key trong dev', () => {
      expect(service.verifyWebhook({})).toBe(true);
    });
  });

  describe('Sandbox API Mode', () => {
    beforeEach(() => {
      configService = {
        get: vi.fn((key: string) => {
          if (key === 'GHN_API_URL')
            return 'https://dev-online-gateway.ghn.vn/shiip/public-api';
          if (key === 'GHN_API_TOKEN') return 'valid-token';
          if (key === 'GHN_SHOP_ID') return '195000';
          if (key === 'GHN_MOCK_FALLBACK') return 'false';
          if (key === 'GHN_WEBHOOK_SECRET_KEY') return 'secret-123';
          return undefined;
        }),
      } as unknown as ConfigService;

      service = new GhnClientService(configService);
    });

    it('gọi đúng API GHN và trả về order_code khi GHN phản hồi thành công', async () => {
      const mockGhnResponse = {
        code: 200,
        message: 'Success',
        data: {
          order_code: 'GHN888999',
          total_fee: 28000,
          expected_delivery_time: '2026-11-09T10:00:00Z',
          trans_type: 'truck',
        },
      };

      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(mockGhnResponse),
      } as unknown as Response);

      try {
        const result = await service.createShippingOrder(mockPayload);
        expect(result.order_code).toBe('GHN888999');
        expect(result.total_fee).toBe(28000);
        expect(global.fetch).toHaveBeenCalledWith(
          'https://dev-online-gateway.ghn.vn/shiip/public-api/v2/shipping-order/create',
          expect.objectContaining({
            method: 'POST',
            headers: expect.objectContaining({
              Token: 'valid-token',
              ShopId: '195000',
            }),
          }),
        );
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('xác thực webhook header x-ghn-token chính xác', () => {
      expect(service.verifyWebhook({ 'x-ghn-token': 'secret-123' })).toBe(true);
      expect(service.verifyWebhook({ 'x-ghn-token': 'wrong-secret' })).toBe(
        false,
      );
      expect(service.verifyWebhook({})).toBe(false);
    });
  });
});
