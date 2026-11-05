import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUserId } from '../../../common/auth/current-user-id.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { Permissions } from '../rbac/decorators/permissions.decorator.js';
import { Roles } from '../rbac/decorators/roles.decorator.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { RolesGuard } from '../rbac/guards/roles.guard.js';
import { AdminShopService } from './admin-shop.service.js';
import {
  ListShopsQueryDto,
  UpdateShopStatusDto,
} from './dtos/admin-shop.dto.js';

@Roles('ADMIN')
@UseGuards(AccessTokenGuard, RolesGuard, PermissionsGuard)
@Controller('api/v1/admin/shops')
export class AdminShopController {
  constructor(private readonly shops: AdminShopService) {}

  @Permissions('SHOP.LIST')
  @Get()
  list(@Query() query: ListShopsQueryDto) {
    return this.shops.list(query);
  }

  @Permissions('SHOP.VIEW')
  @Get(':id')
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.shops.getById(id);
  }

  @Permissions('SHOP.UPDATE')
  @Patch(':id/status')
  updateStatus(
    @CurrentUserId() actorId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: UpdateShopStatusDto,
  ) {
    return this.shops.updateStatus(actorId, id, input.status, input.reason);
  }
}
