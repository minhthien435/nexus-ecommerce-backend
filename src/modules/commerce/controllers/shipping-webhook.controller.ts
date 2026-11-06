import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { GhnClientService } from '../../fulfillment/services/ghn-client.service.js';
import { GhnWebhookDto } from '../../fulfillment/dtos/ghn-shipping.dto.js';
import { OrderService } from '../services/order.service.js';

@Controller('api/v1/fulfillment/shipping')
export class ShippingWebhookController {
  constructor(
    private readonly ghnClient: GhnClientService,
    private readonly orderService: OrderService,
  ) {}

  /**
   * Tiếp nhận Webhook cập nhật tiến độ bưu kiện từ bưu cục GHN Express Sandbox
   */
  @Post('ghn-webhook')
  @HttpCode(HttpStatus.OK)
  async handleGhnWebhook(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() body: GhnWebhookDto,
  ) {
    const isValid = this.ghnClient.verifyWebhook(headers);
    if (!isValid) {
      throw new UnauthorizedException(
        'Chữ ký xác thực Webhook GHN không hợp lệ',
      );
    }

    const status = (body.Status || '').toLowerCase();
    let result: unknown = null;

    if (status === 'delivered') {
      result = await this.orderService.markOrderAsDeliveredViaCarrier(
        body.OrderCode,
      );
    }

    return {
      success: true,
      statusCode: HttpStatus.OK,
      message: 'Xử lý webhook bưu cục GHN thành công',
      data: result ?? {
        orderCode: body.OrderCode,
        status: body.Status,
      },
    };
  }
}
