import {
  Body,
  Controller,
  Get,
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
   * Lấy thông tin khiếu nại của đơn hàng cho Người mua (Buyer)
   */
  @Get(':id/dispute')
  async getOrderDispute(
    @CurrentUserId() buyerId: string,
    @Param('id') orderReference: string,
  ) {
    const result = await this.disputeService.getOrderDisputeByBuyer(
      buyerId,
      orderReference,
    );
    return {
      success: true as const,
      statusCode: HttpStatus.OK,
      message: result
        ? 'Lấy thông tin khiếu nại của đơn hàng thành công'
        : 'Đơn hàng chưa có khiếu nại nào',
      data: result,
    };
  }

  /**
   * Endpoint chuẩn hóa số ít: tạo hồ sơ khiếu nại cho đơn hàng
   */
  @Post(':id/dispute')
  @HttpCode(HttpStatus.CREATED)
  async createDispute(
    @CurrentUserId() buyerId: string,
    @Param('id', new ParseUUIDPipe()) orderId: string,
    @Body() dto: CreateOrderDisputeDto,
  ) {
    return this.handleCreateDispute(buyerId, orderId, dto);
  }

  /**
   * Giữ route `/disputes` cũ tạm thời để FE chuyển đổi dần sang `/dispute`
   */
  @Post(':id/disputes')
  @HttpCode(HttpStatus.CREATED)
  async createDisputeLegacyAlias(
    @CurrentUserId() buyerId: string,
    @Param('id', new ParseUUIDPipe()) orderId: string,
    @Body() dto: CreateOrderDisputeDto,
  ) {
    return this.handleCreateDispute(buyerId, orderId, dto);
  }

  private async handleCreateDispute(
    buyerId: string,
    orderId: string,
    dto: CreateOrderDisputeDto,
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
