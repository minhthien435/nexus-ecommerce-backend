import {
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AccessTokenGuard } from '../../identity/auth/guards/access-token.guard.js';
import { Permissions } from '../../identity/rbac/decorators/permissions.decorator.js';
import { Roles } from '../../identity/rbac/decorators/roles.decorator.js';
import { PermissionsGuard } from '../../identity/rbac/guards/permissions.guard.js';
import { RolesGuard } from '../../identity/rbac/guards/roles.guard.js';
import { QuerySupportOrdersDto } from '../dtos/query-support-orders.dto.js';
import { SupportOrderService } from '../services/support-order.service.js';

@Roles('ADMIN', 'STAFF')
@UseGuards(AccessTokenGuard, RolesGuard, PermissionsGuard)
@Controller('api/v1/commerce/support/orders')
export class SupportOrderController {
  constructor(private readonly supportOrders: SupportOrderService) {}

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
}
