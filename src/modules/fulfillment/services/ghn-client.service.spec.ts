import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { GhnClientService } from './ghn-client.service.js';
import type { GhnCreateOrderPayload } from '../dtos/ghn-shipping.dto.js';

describe('GhnClientService', () => {
  it('does not silently create mock tracking when fallback is unset', async () => {
    const client = new GhnClientService(
      new ConfigService({ NODE_ENV: 'development' }),
    );
    await expect(
      client.createShippingOrder({
        to_name: 'Buyer',
        to_phone: '0901234567',
        to_address: 'Street',
        to_ward_code: '123',
        to_district_id: 1,
        weight: 100,
      }),
    ).rejects.toMatchObject({ status: 503 });
  });
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

    it('does not fabricate a tracking code when configuration is missing', async () => {
      await expect(service.createShippingOrder(mockPayload)).rejects.toThrow();
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

  it('previews a two-level address with a configured sender and never creates an order', async () => {
    const values: Record<string, string> = {
      GHN_API_TOKEN: 'token',
      GHN_SHOP_ID: '1',
      GHN_FROM_NAME: 'Sender',
      GHN_FROM_PHONE: '0901234567',
      GHN_FROM_ADDRESS: 'Street',
      GHN_FROM_PROVINCE_NAME: 'Hà Nội',
      GHN_FROM_WARD_NAME: 'Ward A',
    };
    const client = new GhnClientService({
      get: (key: string) => values[key],
    } as ConfigService);
    const request = vi
      .spyOn(client, 'request')
      .mockResolvedValue({ total_fee: 20900 });
    await expect(
      client.previewNewAddress({
        recipientName: 'Buyer',
        recipientPhone: '0901234567',
        addressLine: 'Street 2',
        provinceName: 'Hà Nội',
        wardName: 'Ward B',
        weightGrams: 500,
        content: 'Áo khoác',
      }),
    ).resolves.toMatchObject({ fee: 20900 });
    expect(request).toHaveBeenCalledWith(
      'v2/shipping-order/preview',
      expect.objectContaining({
        from_province_name: 'Hà Nội',
        from_ward_name: 'Ward A',
        to_province_name: 'Hà Nội',
        to_ward_name: 'Ward B',
        is_new_to_address: true,
        is_new_from_address: true,
        content: 'Áo khoác',
        weight: 500,
      }),
    );
    request.mockResolvedValueOnce({ order_code: 'GHN123', total_fee: 20900 });
    vi.spyOn(client, 'getPrintOrderUrl').mockResolvedValue('print-url');
    await client.createNewAddressOrder({
      recipientName: 'Buyer',
      recipientPhone: '0901234567',
      addressLine: 'Street 2',
      provinceName: 'Hà Nội',
      wardName: 'Ward B',
      weightGrams: 500,
      content: 'Áo khoác',
      clientOrderCode: 'order-1',
    });
    expect(request).toHaveBeenLastCalledWith(
      'v2/shipping-order/create',
      expect.objectContaining({
        is_new_from_address: true,
        is_new_to_address: true,
        content: 'Áo khoác',
        client_order_code: 'order-1',
      }),
    );
    request.mockRejectedValueOnce(new Error('GHN unavailable'));
    await expect(
      client.previewNewAddress({
        recipientName: 'Buyer',
        recipientPhone: '0901234567',
        addressLine: 'Street 2',
        provinceName: 'Hà Nội',
        wardName: 'Ward B',
        weightGrams: 500,
        content: 'Áo khoác',
      }),
    ).rejects.toThrow('GHN unavailable');
  });

  it('fails before preview when the pickup origin is incomplete', async () => {
    const client = new GhnClientService({
      get: () => undefined,
    } as unknown as ConfigService);
    const request = vi.spyOn(client, 'request');
    await expect(
      client.previewNewAddress({
        recipientName: 'Buyer',
        recipientPhone: '0901234567',
        addressLine: 'Street',
        provinceName: 'Hà Nội',
        wardName: 'Ward',
        weightGrams: 500,
        content: 'Áo khoác',
      }),
    ).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects heavy parcels before requesting a fee or shipment', async () => {
    const values: Record<string, string> = {
      GHN_FROM_NAME: 'Sender',
      GHN_FROM_PHONE: '0901234567',
      GHN_FROM_ADDRESS: 'Street',
      GHN_FROM_PROVINCE_NAME: 'Hà Nội',
      GHN_FROM_WARD_NAME: 'Ward',
    };
    const client = new GhnClientService({
      get: (key: string) => values[key],
    } as ConfigService);
    const request = vi.spyOn(client, 'request');
    const input = {
      recipientName: 'Buyer',
      recipientPhone: '0901234567',
      addressLine: 'Street',
      provinceName: 'Hà Nội',
      wardName: 'Ward',
      weightGrams: 20000,
      content: 'Áo khoác',
    };
    await expect(client.previewNewAddress(input)).rejects.toThrow(
      'requires item details',
    );
    await expect(
      client.createNewAddressOrder({ ...input, clientOrderCode: 'order-1' }),
    ).rejects.toThrow('requires item details');
    expect(request).not.toHaveBeenCalled();
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
      vi.spyOn(service, 'getShopOrigin').mockResolvedValue({
        districtId: 1442,
        wardCode: '20101',
        shopId: 195000,
      });
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

    it('ném BadRequestException GHN_ADDRESS_INVALID khi GHN request trả 400 To address conflict', async () => {
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: vi.fn().mockResolvedValue({
          code: 400,
          code_message_value: 'To address conflict',
          message: 'To address conflict',
          data: null,
        }),
      } as unknown as Response);

      try {
        await expect(
          service.request('v2/shipping-order/preview', {}),
        ).rejects.toMatchObject({
          status: 400,
          response: {
            errorCode: 'GHN_ADDRESS_INVALID',
            message: 'To address conflict',
          },
        });
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('ném BadRequestException GHN_ADDRESS_INVALID trong createShippingOrder khi GHN báo lỗi địa chỉ', async () => {
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: vi.fn().mockResolvedValue({
          code: 400,
          message: 'To address conflict',
          data: null,
        }),
      } as unknown as Response);

      try {
        await expect(
          service.createShippingOrder(mockPayload),
        ).rejects.toMatchObject({
          status: 400,
          response: {
            errorCode: 'GHN_ADDRESS_INVALID',
            message: 'To address conflict',
          },
        });
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('ném ServiceUnavailableException GHN_REQUEST_FAILED khi GHN sập hoặc lỗi kết nối mạng', async () => {
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      try {
        await expect(
          service.request('v2/shipping-order/preview', {}),
        ).rejects.toMatchObject({
          status: 503,
          response: {
            errorCode: 'GHN_REQUEST_FAILED',
          },
        });
      } finally {
        global.fetch = originalFetch;
      }
    });
  });
});
