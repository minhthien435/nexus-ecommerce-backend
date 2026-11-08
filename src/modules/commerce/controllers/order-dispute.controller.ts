import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUserId } from '../../../common/auth/current-user-id.decorator.js';
import { AccessTokenGuard } from '../../identity/auth/guards/access-token.guard.js';
import { Roles } from '../../identity/rbac/decorators/roles.decorator.js';
import { RolesGuard } from '../../identity/rbac/guards/roles.guard.js';
import { CreateOrderDisputeDto } from '../dtos/create-order-dispute.dto.js';
import { OrderDisputeService } from '../services/order-dispute.service.js';

@Roles('BUYER')
@UseGuards(AccessTokenGuard, RolesGuard)
@Controller('api/v1/commerce/orders')
export class OrderDisputeController {
  constructor(private readonly disputeService: OrderDisputeService) {}

  /**
   * Endpoint cho Người mua (Buyer) tạo hồ sơ khiếu nại cho đơn hàng đã nhận
   */
  @Post(':id/disputes')
  @HttpCode(HttpStatus.CREATED)
  async createDispute(
    @CurrentUserId() buyerId: string,
    @Param('id', new ParseUUIDPipe()) orderId: string,
    @Body() dto: CreateOrderDisputeDto,
  ) {
    const result = await this.disputeService.createDispute(
      buyerId,
      orderId,
      dto,
    );
    return {
      success: true as const,
      statusCode: HttpStatus.CREATED,
      message: 'Tạo hồ sơ khiếu nại đơn hàng thành công',
      data: result,
    };
  }
}
