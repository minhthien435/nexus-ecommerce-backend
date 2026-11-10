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
    this.webhookSecret =
      this.config.get<string>('GHN_WEBHOOK_TOKEN') ||
      this.config.get<string>('GHN_WEBHOOK_SECRET_KEY');

    // Mock shipments must be explicitly enabled; never silently mask GHN errors.
    this.mockFallbackEnabled = false;
  }

  private newAddressBody(input: {
    recipientName: string;
    recipientPhone: string;
    addressLine: string;
    provinceName: string;
    wardName: string;
    weightGrams: number;
    content: string;
    clientOrderCode?: string;
  }) {
    const fromName = this.config.get<string>('GHN_FROM_NAME')?.trim();
    const fromPhone = this.config.get<string>('GHN_FROM_PHONE')?.trim();
    const fromAddress = this.config.get<string>('GHN_FROM_ADDRESS')?.trim();
    const fromProvince = this.config
      .get<string>('GHN_FROM_PROVINCE_NAME')
      ?.trim();
    const fromWard = this.config.get<string>('GHN_FROM_WARD_NAME')?.trim();
    if (!fromName || !fromPhone || !fromAddress || !fromProvince || !fromWard) {
      throw new ServiceUnavailableException({
        errorCode: 'GHN_ORIGIN_UNAVAILABLE',
        message: 'GHN two-level pickup origin is required',
      });
    }
    if (
      !input.recipientName?.trim() ||
      !input.recipientPhone?.trim() ||
      !input.addressLine?.trim() ||
      !input.provinceName?.trim() ||
      !input.wardName?.trim() ||
      !input.content?.trim() ||
      !Number.isSafeInteger(input.weightGrams) ||
      input.weightGrams < 1 ||
      input.weightGrams > 5000000
    ) {
      throw new BadRequestException('Invalid GHN two-level shipping input');
    }
    if (input.weightGrams >= 20000) {
      throw new BadRequestException('GHN heavy service requires item details');
    }
    return {
      payment_type_id: 1,
      required_note: 'CHOXEMHANGKHONGTHU',
      from_name: fromName,
      from_phone: fromPhone,
      from_address: fromAddress,
      from_province_name: fromProvince,
      from_ward_name: fromWard,
      is_new_from_address: true,
      to_name: input.recipientName,
      to_phone: input.recipientPhone,
      to_address: input.addressLine,
      to_province_name: input.provinceName,
      to_ward_name: input.wardName,
      is_new_to_address: true,
      content: input.content,
      weight: input.weightGrams,
      length: 15,
      width: 15,
      height: 10,
      service_type_id: input.weightGrams < 20000 ? 2 : 5,
      ...(input.clientOrderCode
        ? { client_order_code: input.clientOrderCode }
        : {}),
    };
  }

  async previewNewAddress(
    input: Parameters<GhnClientService['newAddressBody']>[0],
  ) {
    const data = await this.request<{
      total_fee: number;
      expected_delivery_time?: string;
    }>('v2/shipping-order/preview', this.newAddressBody(input));
    if (!Number.isSafeInteger(data.total_fee) || data.total_fee < 0)
      throw new ServiceUnavailableException(
        'GHN returned an invalid shipping fee',
      );
    return {
      fee: data.total_fee,
      expectedDeliveryTime: data.expected_delivery_time ?? null,
    };
  }

  async createNewAddressOrder(
    input: Parameters<GhnClientService['newAddressBody']>[0],
  ) {
    if (!input.clientOrderCode)
      throw new BadRequestException('Client order code is required');
    const data = await this.request<{
      order_code: string;
      total_fee: number;
      expected_delivery_time?: string;
    }>('v2/shipping-order/create', this.newAddressBody(input));
    if (
      !data.order_code ||
      !Number.isSafeInteger(data.total_fee) ||
      data.total_fee < 0
    )
      throw new ServiceUnavailableException(
        'GHN returned an invalid shipping order',
      );
    return { ...data, print_url: await this.getPrintOrderUrl(data.order_code) };
  }

  /** Read-only GHN calls never use the shipment demo fallback. */
  async request<T>(path: string, body?: Record<string, unknown>): Promise<T> {
    if (
      !this.apiToken ||
      !this.shopId ||
      !/^\d+$/.test(this.shopId) ||
      !Number.isSafeInteger(Number(this.shopId)) ||
      Number(this.shopId) <= 0
    ) {
      throw new ServiceUnavailableException({
        errorCode: 'GHN_CONFIG_MISSING',
        message: 'GHN token and shop ID are required',
      });
    }
    const base = this.apiUrl.replace(/\/+$/, '').replace(/\/v2$/, '');
    try {
      const response = await fetch(`${base}/${path}`, {
        method: body ? 'POST' : 'GET',
        headers: {
          'Content-Type': 'application/json',
          Token: this.apiToken,
          ShopId: this.shopId,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(5000),
      });

      let result: {
        code?: number;
        code_message_value?: string;
        message?: string;
        message_display?: string;
        data?: T;
      } | null = null;
      try {
        result = (await response.json()) as {
          code?: number;
          code_message_value?: string;
          message?: string;
          message_display?: string;
          data?: T;
        };
      } catch {
        result = null;
      }

      if (
        !response.ok ||
        !result ||
        result.code !== 200 ||
        result.data == null
      ) {
        const ghnMessage =
          result?.code_message_value ||
          result?.message_display ||
          result?.message ||
          '';

        const isAddressConflict =
          /address|location|ward|district|province|phường|xã|quận|huyện|tỉnh|địa chỉ/i.test(
            ghnMessage,
          );

        if (isAddressConflict) {
          throw new BadRequestException({
            errorCode: 'GHN_ADDRESS_INVALID',
            message: ghnMessage || 'To address conflict',
          });
        }

        if (response.status === 400 && path.includes('shipping-order')) {
          throw new BadRequestException({
            errorCode: 'GHN_CREATE_ORDER_FAILED',
            message:
              ghnMessage || 'Không thể tạo đơn vận chuyển với GHN Express',
          });
        }

        throw new Error(ghnMessage || 'Invalid GHN response');
      }

      return result.data;
    } catch (err: unknown) {
      if (
        err instanceof BadRequestException ||
        err instanceof ServiceUnavailableException
      ) {
        throw err;
      }

      throw new ServiceUnavailableException({
        errorCode: 'GHN_REQUEST_FAILED',
        message: 'GHN is unavailable or rejected the request; please retry',
      });
    }
  }

  async getShopOrigin(): Promise<{
    districtId: number;
    wardCode: string;
    shopId: number;
  }> {
    const district = this.config.get<string>('GHN_FROM_DISTRICT_ID');
    const ward = this.config.get<string>('GHN_FROM_WARD_CODE');
    if (district || ward) {
      if (
        !district ||
        !/^[1-9]\d*$/.test(district) ||
        !Number.isSafeInteger(Number(district)) ||
        !ward ||
        !/^\d{1,20}$/.test(ward) ||
        !this.shopId ||
        !/^[1-9]\d*$/.test(this.shopId) ||
        !Number.isSafeInteger(Number(this.shopId))
      ) {
        throw new ServiceUnavailableException({
          errorCode: 'GHN_ORIGIN_UNAVAILABLE',
          message: 'Invalid configured GHN origin',
        });
      }
      return {
        districtId: Number(district),
        wardCode: ward,
        shopId: Number(this.shopId),
      };
    }
    // GHN returns a cursor, not a page number. Bound traversal even on malformed cursors.
    let offset = 0;
    for (let page = 0; page < 20; page++) {
      const data = await this.request<{
        shops: Array<{ _id: number; district_id: number; ward_code: string }>;
        last_offset: number;
      }>(`v2/shop/all?offset=${offset}&limit=100`);
      if (!Array.isArray(data.shops)) break;
      const shop = data.shops.find(
        (entry) => entry?._id === Number(this.shopId),
      );
      if (
        shop &&
        Number.isSafeInteger(shop.district_id) &&
        shop.district_id > 0 &&
        typeof shop.ward_code === 'string' &&
        /^\d{1,20}$/.test(shop.ward_code)
      ) {
        return {
          districtId: shop.district_id,
          wardCode: shop.ward_code,
          shopId: shop._id,
        };
      }
      if (
        !data.shops.length ||
        !Number.isSafeInteger(data.last_offset) ||
        data.last_offset <= offset
      )
        break;
      offset = data.last_offset;
    }
    throw new ServiceUnavailableException({
      errorCode: 'GHN_ORIGIN_UNAVAILABLE',
      message: 'Configured GHN shop has no valid registered origin',
    });
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
    const origin = await this.getShopOrigin();
    const ghnBody = {
      payment_type_id: payload.payment_type_id ?? 1, // 1: Người bán/Người gửi trả cước
      required_note: payload.required_note ?? 'CHOXEMHANGKHONGTHU',
      ...(payload.from_name ? { from_name: payload.from_name } : {}),
      ...(payload.from_phone ? { from_phone: payload.from_phone } : {}),
      ...(payload.from_address ? { from_address: payload.from_address } : {}),
      from_ward_code: origin.wardCode,
      from_district_id: origin.districtId,
      to_name: payload.to_name,
      to_phone: payload.to_phone,
      to_address: payload.to_address,
      to_ward_code: payload.to_ward_code,
      to_district_id: Number(payload.to_district_id),
      weight: Math.round(payload.weight),
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
      const base = this.apiUrl.replace(/\/$/, '');
      const endpoint = base.endsWith('/v2')
        ? `${base}/shipping-order/create`
        : `${base}/v2/shipping-order/create`;

      const response = await fetch(endpoint, {
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

        const ghnMessage =
          (
            data as {
              code_message_value?: string;
              message_display?: string;
              message?: string;
            }
          ).code_message_value ||
          (data as { message_display?: string; message?: string })
            .message_display ||
          data.message ||
          '';

        if (
          /address|location|ward|district|province|phường|xã|quận|huyện|tỉnh|địa chỉ/i.test(
            ghnMessage,
          )
        ) {
          throw new BadRequestException({
            errorCode: 'GHN_ADDRESS_INVALID',
            message: ghnMessage || 'To address conflict',
          });
        }

        throw new BadRequestException({
          errorCode: 'GHN_CREATE_ORDER_FAILED',
          message: ghnMessage || 'Không thể tạo đơn vận chuyển với GHN Express',
        });
      }

      const orderCode = data.data.order_code;
      const printUrl = await this.getPrintOrderUrl(orderCode);
      return {
        order_code: orderCode,
        total_fee: data.data.total_fee ?? 30000,
        expected_delivery_time: data.data.expected_delivery_time,
        trans_type: data.data.trans_type || 'standard',
        print_url: printUrl,
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
   * Gọi GHN API để sinh token in phiếu gửi hàng A5/tem nhãn
   */
  async getPrintToken(orderCode: string): Promise<string | null> {
    if (!this.apiToken) {
      return null;
    }
    try {
      const base = this.apiUrl.replace(/\/$/, '');
      const endpoint = base.endsWith('/v2')
        ? `${base}/a5/gen-token`
        : `${base}/v2/a5/gen-token`;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Token: this.apiToken,
        },
        body: JSON.stringify({ order_codes: [orderCode] }),
        signal: AbortSignal.timeout(5000),
      });

      const data = (await response.json()) as {
        code?: number;
        data?: { token?: string };
      };

      if (response.ok && data.code === 200 && data.data?.token) {
        return data.data.token;
      }
      return null;
    } catch (err: unknown) {
      this.logger.warn(
        `Không thể lấy print token từ GHN cho vận đơn ${orderCode}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Tạo URL in phiếu gửi hàng A5 mở trực tiếp trên trình duyệt
   */
  async getPrintOrderUrl(orderCode: string): Promise<string> {
    const printToken = await this.getPrintToken(orderCode);
    return this.generatePrintUrl(orderCode, printToken ?? undefined);
  }

  /**
   * Tạo URL in phiếu gửi hàng A5 mở trực tiếp trên trình duyệt
   */
  generatePrintUrl(orderCode: string, printToken?: string): string {
    const domain = this.apiUrl.includes('dev-online-gateway.ghn.vn')
      ? 'https://dev-online-gateway.ghn.vn'
      : 'https://online-gateway.ghn.vn';

    const token = printToken || orderCode;
    return `${domain}/a5/public-api/printA5?token=${token}`;
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
      print_url: this.generatePrintUrl(mockOrderCode, `mock_${mockOrderCode}`),
    };
  }
}
