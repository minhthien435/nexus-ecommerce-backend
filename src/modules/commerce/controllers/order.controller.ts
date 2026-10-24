import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUserId } from '../../../common/auth/current-user-id.decorator.js';
import { AccessTokenGuard } from '../../identity/auth/guards/access-token.guard.js';
import { Permissions } from '../../identity/rbac/decorators/permissions.decorator.js';
import { PermissionsGuard } from '../../identity/rbac/guards/permissions.guard.js';
import { CreateCheckoutDto } from '../dtos/create-checkout.dto.js';
import { QueryOrdersDto } from '../dtos/query-orders.dto.js';
import { OrderService } from '../services/order.service.js';

@Controller('api/v1/commerce/orders')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  @Post('checkout')
  @Permissions('CHECKOUT.START')
  checkout(@CurrentUserId() userId: string, @Body() dto: CreateCheckoutDto) {
    return this.orderService.checkout(userId, dto);
  }

  @Get()
  @Permissions('ORDER.VIEW')
  getOrders(@CurrentUserId() userId: string, @Query() query: QueryOrdersDto) {
    return this.orderService.getBuyerOrders(userId, query);
  }

  @Get(':id')
  @Permissions('ORDER.VIEW')
  getOrderById(
    @CurrentUserId() userId: string,
    @Param('id', new ParseUUIDPipe()) orderId: string,
  ) {
    return this.orderService.getOrderById(userId, orderId);
  }
}
