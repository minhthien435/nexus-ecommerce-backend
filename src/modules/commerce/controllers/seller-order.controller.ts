import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUserId } from '../../../common/auth/current-user-id.decorator.js';
import { AccessTokenGuard } from '../../identity/auth/guards/access-token.guard.js';
import { Permissions } from '../../identity/rbac/decorators/permissions.decorator.js';
import { Roles } from '../../identity/rbac/decorators/roles.decorator.js';
import { PermissionsGuard } from '../../identity/rbac/guards/permissions.guard.js';
import { RolesGuard } from '../../identity/rbac/guards/roles.guard.js';
import { ConfirmSellerOrderDto } from '../dtos/confirm-seller-order.dto.js';
import { QuerySellerOrdersDto } from '../dtos/query-seller-orders.dto.js';
import { ShipSellerOrderDto } from '../dtos/ship-seller-order.dto.js';
import { OrderService } from '../services/order.service.js';

@Roles('ADMIN', 'SELLER')
@UseGuards(AccessTokenGuard, RolesGuard, PermissionsGuard)
@Controller('api/v1/commerce/seller/orders')
export class SellerOrderController {
  constructor(private readonly orderService: OrderService) {}

  @Get()
  @Permissions('ORDER.LIST')
  async getSellerOrders(
    @CurrentUserId() sellerId: string,
    @Query() query: QuerySellerOrdersDto,
  ) {
    const result = await this.orderService.getSellerOrders(sellerId, query);
    return {
      success: true as const,
      statusCode: HttpStatus.OK,
      message: 'Lấy danh sách đơn hàng của người bán thành công',
      data: result.data,
      meta: result.meta,
    };
  }

  @Get(':id')
  @Permissions('ORDER.VIEW')
  async getSellerOrderById(
    @CurrentUserId() sellerId: string,
    @Param('id') orderReference: string,
  ) {
    const result = await this.orderService.getSellerOrderById(
      sellerId,
      orderReference,
    );
    return {
      success: true as const,
      statusCode: HttpStatus.OK,
      message: 'Lấy chi tiết đơn hàng của người bán thành công',
      data: result,
    };
  }

  @Patch(':id/confirm')
  @Permissions('ORDER.VIEW')
  async confirmOrder(
    @CurrentUserId() sellerId: string,
    @Param('id', new ParseUUIDPipe()) orderId: string,
    @Body() dto: ConfirmSellerOrderDto,
  ) {
    const result = await this.orderService.confirmSellerOrder(
      sellerId,
      orderId,
      dto,
    );
    return {
      success: true as const,
      statusCode: HttpStatus.OK,
      message:
        'Xác nhận đơn hàng thành công, chuyển sang trạng thái đang xử lý',
      data: result,
    };
  }

  @Patch(':id/ship')
  @Permissions('ORDER.VIEW')
  async shipOrder(
    @CurrentUserId() sellerId: string,
    @Param('id', new ParseUUIDPipe()) orderId: string,
    @Body() dto: ShipSellerOrderDto,
  ) {
    const result = await this.orderService.shipSellerOrder(
      sellerId,
      orderId,
      dto,
    );
    return {
      success: true as const,
      statusCode: HttpStatus.OK,
      message: 'Bàn giao vận chuyển thành công, đơn hàng đang trên đường giao',
      data: result,
    };
  }
}
