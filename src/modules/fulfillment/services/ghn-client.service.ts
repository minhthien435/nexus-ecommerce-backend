import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  GhnCreateOrderPayload,
  GhnCreateOrderResponse,
} from '../dtos/ghn-shipping.dto.js';

@Injectable()
export class GhnClientService {
  private readonly logger = new Logger(GhnClientService.name);
  private readonly apiUrl: string;
  private readonly apiToken: string | undefined;
  private readonly shopId: string | undefined;
  private readonly mockFallbackEnabled: boolean;
  private readonly webhookSecret: string | undefined;

  constructor(private readonly config: ConfigService) {
    this.apiUrl =
      this.config.get<string>('GHN_API_URL') ||
      'https://dev-online-gateway.ghn.vn/shiip/public-api';
    this.apiToken = this.config.get<string>('GHN_API_TOKEN');
    this.shopId = this.config.get<string>('GHN_SHOP_ID');
    this.webhookSecret = this.config.get<string>('GHN_WEBHOOK_SECRET_KEY');

    // Default mock fallback to true in development/test or if no token provided
    const mockEnv = this.config.get<string>('GHN_MOCK_FALLBACK');
    this.mockFallbackEnabled =
      mockEnv !== undefined
        ? mockEnv === 'true'
        : !this.apiToken ||
          this.config.get<string>('NODE_ENV') !== 'production';
  }

  /**
   * Tạo đơn giao hàng mới qua GHN Express Sandbox API
   */
  async createShippingOrder(
    payload: GhnCreateOrderPayload,
  ): Promise<GhnCreateOrderResponse> {
    // 1. Kiểm tra nếu không có token hoặc mock mode được bật cố ý khi thiếu cấu hình
    if (!this.apiToken || !this.shopId) {
      if (this.mockFallbackEnabled) {
        this.logger.warn(
          'GHN_API_TOKEN hoặc GHN_SHOP_ID chưa cấu hình. Kích hoạt Mock GHN Sandbox fallback cho môi trường Dev/Demo.',
        );
        return this.generateMockOrder(payload);
      }
      throw new ServiceUnavailableException({
        errorCode: 'GHN_CONFIG_MISSING',
        message:
          'Dịch vụ giao hàng GHN chưa được cấu hình đầy đủ API Token hoặc Shop ID',
      });
    }

    // 2. Chuẩn bị request gửi sang GHN Sandbox
    const ghnBody = {
      payment_type_id: payload.payment_type_id ?? 1, // 1: Người bán/Người gửi trả cước
      required_note: payload.required_note ?? 'KHONGCHOXEMHANG',
      to_name: payload.to_name,
      to_phone: payload.to_phone,
      to_address: payload.to_address,
      to_ward_code: payload.to_ward_code,
      to_district_id: Number(payload.to_district_id),
      weight: Math.max(100, Math.round(payload.weight)),
      length: payload.length ?? 15,
      width: payload.width ?? 15,
      height: payload.height ?? 10,
      service_type_id: payload.service_type_id ?? 2, // 2: Chuẩn E-Commerce
      items:
        payload.items && payload.items.length > 0
          ? payload.items.map((i) => ({
              name: i.name,
              code: i.code || 'ITEM',
              quantity: i.quantity,
              price: i.price ?? 0,
              weight: i.weight ?? 100,
            }))
          : [
              {
                name: 'Sản phẩm Nexus E-Commerce',
                quantity: 1,
                weight: payload.weight,
              },
            ],
      client_order_code: payload.client_order_code,
      note: payload.note,
    };

    try {
      const response = await fetch(`${this.apiUrl}/v2/shipping-order/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Token: this.apiToken,
          ShopId: this.shopId,
        },
        body: JSON.stringify(ghnBody),
      });

      const data = (await response.json()) as {
        code?: number;
        message?: string;
        data?: {
          order_code?: string;
          total_fee?: number;
          expected_delivery_time?: string;
          trans_type?: string;
        };
      };

      if (!response.ok || data.code !== 200 || !data.data?.order_code) {
        this.logger.error(
          `GHN API Create Order trả về lỗi (Status ${response.status}): ${JSON.stringify(data)}`,
        );

        if (this.mockFallbackEnabled) {
          this.logger.warn(
            'GHN API Sandbox từ chối request hoặc lỗi mạng. Kích hoạt Mock fallback an toàn cho phiên demo.',
          );
          return this.generateMockOrder(payload);
        }

        throw new BadRequestException({
          errorCode: 'GHN_CREATE_ORDER_FAILED',
          message:
            data.message || 'Không thể tạo đơn vận chuyển với GHN Express',
        });
      }

      const orderCode = data.data.order_code;
      return {
        order_code: orderCode,
        total_fee: data.data.total_fee ?? 30000,
        expected_delivery_time: data.data.expected_delivery_time,
        trans_type: data.data.trans_type || 'standard',
        print_url: this.generatePrintUrl(orderCode),
      };
    } catch (err: unknown) {
      if (
        err instanceof BadRequestException ||
        err instanceof ServiceUnavailableException
      ) {
        throw err;
      }

      this.logger.error(
        `Lỗi kết nối tới bưu cục GHN Sandbox: ${(err as Error).message}`,
      );

      if (this.mockFallbackEnabled) {
        this.logger.warn(
          'Mất kết nối tới GHN Sandbox Gateway. Kích hoạt Mock Sandbox fallback cho demo.',
        );
        return this.generateMockOrder(payload);
      }

      throw new ServiceUnavailableException({
        errorCode: 'GHN_GATEWAY_TIMEOUT',
        message: 'Cổng giao vận bưu cục GHN tạm thời không phản hồi',
      });
    }
  }

  /**
   * Tạo URL in phiếu gửi hàng A5/A4 chứa barcode vận đơn GHN
   */
  generatePrintUrl(orderCode: string): string {
    return `${this.apiUrl}/a5/gen-token?order_codes=${orderCode}`;
  }

  /**
   * Xác thực Webhook gửi từ GHN qua Secret Key hoặc Custom Header
   */
  verifyWebhook(
    headers: Record<string, string | string[] | undefined>,
  ): boolean {
    if (!this.webhookSecret) {
      // Trong môi trường dev nếu chưa cấu hình secret thì chấp nhận để test
      return true;
    }

    const tokenHeader =
      headers['x-ghn-token'] ||
      headers['authorization'] ||
      headers['x-secret-token'];
    const token = Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader;

    if (!token) {
      return false;
    }

    const cleanToken = token.replace(/^Bearer\s+/i, '').trim();
    return cleanToken === this.webhookSecret.trim();
  }

  /**
   * Sinh mã vận đơn mock an toàn cho môi trường test/demo
   */
  private generateMockOrder(
    _payload: GhnCreateOrderPayload,
  ): GhnCreateOrderResponse {
    const timestamp = Date.now().toString(36).toUpperCase();
    const randomHex = Math.floor(1000 + Math.random() * 9000);
    const mockOrderCode = `GHN${timestamp}${randomHex}`;
    const expectedTime = new Date(
      Date.now() + 3 * 24 * 60 * 60 * 1000,
    ).toISOString();

    return {
      order_code: mockOrderCode,
      total_fee: 32000,
      expected_delivery_time: expectedTime,
      trans_type: 'truck',
      print_url: `https://dev-online-gateway.ghn.vn/print/a5?order_codes=${mockOrderCode}`,
    };
  }
}
