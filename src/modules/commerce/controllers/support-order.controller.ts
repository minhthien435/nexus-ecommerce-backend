import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUserId } from '../../../common/auth/current-user-id.decorator.js';
import { AccessTokenGuard } from '../../identity/auth/guards/access-token.guard.js';
import { Permissions } from '../../identity/rbac/decorators/permissions.decorator.js';
import { Roles } from '../../identity/rbac/decorators/roles.decorator.js';
import { PermissionsGuard } from '../../identity/rbac/guards/permissions.guard.js';
import { RolesGuard } from '../../identity/rbac/guards/roles.guard.js';
import { MarkOrderDeliveredDto } from '../dtos/mark-order-delivered.dto.js';
import { QuerySupportOrdersDto } from '../dtos/query-support-orders.dto.js';
import { OrderService } from '../services/order.service.js';
import { SupportOrderService } from '../services/support-order.service.js';

@Roles('ADMIN', 'STAFF')
@UseGuards(AccessTokenGuard, RolesGuard, PermissionsGuard)
@Controller('api/v1/commerce/support/orders')
export class SupportOrderController {
  constructor(
    private readonly supportOrders: SupportOrderService,
    private readonly orderService: OrderService,
  ) {}

  @Get()
  @Permissions('ORDER.LIST')
  async list(@Query() query: QuerySupportOrdersDto) {
    const result = await this.supportOrders.list(query);
    return {
      success: true as const,
      statusCode: HttpStatus.OK,
      message: 'Lấy danh sách đơn hàng hỗ trợ thành công',
      data: result.data,
      meta: result.meta,
    };
  }

  @Get(':id')
  @Permissions('ORDER.VIEW')
  async detail(@Param('id', new ParseUUIDPipe()) orderId: string) {
    const result = await this.supportOrders.detail(orderId);
    return {
      success: true as const,
      statusCode: HttpStatus.OK,
      message: 'Lấy chi tiết đơn hàng hỗ trợ thành công',
      data: result,
    };
  }

  @Post(':id/mark-delivered')
  @HttpCode(HttpStatus.OK)
  @Permissions('ORDER.VIEW')
  async markDelivered(
    @CurrentUserId() staffId: string,
    @Param('id', new ParseUUIDPipe()) orderId: string,
    @Body() dto: MarkOrderDeliveredDto,
  ) {
    const result = await this.orderService.markOrderAsDelivered({
      orderId,
      actorId: staffId,
      reason: dto.reason,
      source: 'SUPPORT_MANUAL',
    });
    return {
      success: true as const,
      statusCode: HttpStatus.OK,
      message: 'Xác nhận đơn hàng đã giao thành công',
      data: {
        orderId: result.orderId,
        orderNumber: result.orderNumber,
        status: result.status,
        deliveredAt: result.deliveredAt,
        updatedAt: result.updatedAt,
      },
    };
  }
}
