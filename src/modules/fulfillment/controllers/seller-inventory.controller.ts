import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUserId } from '../../../common/auth/current-user-id.decorator.js';
import { AccessTokenGuard } from '../../identity/auth/guards/access-token.guard.js';
import { Permissions } from '../../identity/rbac/decorators/permissions.decorator.js';
import { Roles } from '../../identity/rbac/decorators/roles.decorator.js';
import { PermissionsGuard } from '../../identity/rbac/guards/permissions.guard.js';
import { RolesGuard } from '../../identity/rbac/guards/roles.guard.js';
import {
  DecreaseSellerInventoryDto,
  RestockSellerInventoryDto,
  SellerInventoryHistoryQueryDto,
  SellerInventoryQueryDto,
} from '../dtos/seller-inventory.dto.js';
import { SellerInventoryService } from '../services/seller-inventory.service.js';

@Roles('ADMIN', 'SELLER')
@UseGuards(AccessTokenGuard, RolesGuard, PermissionsGuard)
@Controller('api/v1/fulfillment/seller/inventory')
export class SellerInventoryController {
  constructor(private readonly inventory: SellerInventoryService) {}

  @Permissions('PRODUCT.LIST')
  @Get()
  list(
    @Query() query: SellerInventoryQueryDto,
    @CurrentUserId() actorId: string,
  ) {
    return this.inventory.list(actorId, query);
  }

  @Permissions('PRODUCT.LIST')
  @Get('summary')
  summary(@CurrentUserId() actorId: string) {
    return this.inventory.summary(actorId);
  }

  @Permissions('PRODUCT.LIST')
  @Get('history')
  history(
    @Query() query: SellerInventoryHistoryQueryDto,
    @CurrentUserId() actorId: string,
  ) {
    return this.inventory.history(actorId, query);
  }

  @Permissions('PRODUCT.UPDATE')
  @Post('adjust')
  restock(
    @Body() dto: RestockSellerInventoryDto,
    @CurrentUserId() actorId: string,
  ) {
    return this.inventory.restock(actorId, dto);
  }

  @Permissions('PRODUCT.UPDATE')
  @Post('adjust/decrease')
  decrease(
    @Body() dto: DecreaseSellerInventoryDto,
    @CurrentUserId() actorId: string,
  ) {
    return this.inventory.decrease(actorId, dto);
  }
}
