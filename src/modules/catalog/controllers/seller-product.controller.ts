import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
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
import {
  CreateSellerProductDto,
  SellerProductQueryDto,
  UpdateSellerProductDto,
  UpdateSellerProductStatusDto,
} from '../dtos/seller-product.dto.js';
import { SellerProductService } from '../services/seller-product.service.js';

@Roles('ADMIN', 'SELLER')
@UseGuards(AccessTokenGuard, RolesGuard, PermissionsGuard)
@Controller('api/v1/catalog/seller/products')
export class SellerProductController {
  constructor(private readonly products: SellerProductService) {}

  @Permissions('PRODUCT.LIST')
  @Get()
  list(
    @Query() query: SellerProductQueryDto,
    @CurrentUserId() actorId: string,
  ) {
    return this.products.list(actorId, query);
  }

  @Permissions('PRODUCT.VIEW')
  @Get(':id')
  get(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUserId() actorId: string,
  ) {
    return this.products.get(id, actorId);
  }

  @Permissions('PRODUCT.CREATE')
  @Post()
  create(
    @Body() dto: CreateSellerProductDto,
    @CurrentUserId() actorId: string,
  ) {
    return this.products.create(dto, actorId);
  }

  @Permissions('PRODUCT.UPDATE')
  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateSellerProductDto,
    @CurrentUserId() actorId: string,
  ) {
    return this.products.update(id, dto, actorId);
  }

  @Permissions('PRODUCT.UPDATE')
  @Patch(':id/status')
  setStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateSellerProductStatusDto,
    @CurrentUserId() actorId: string,
  ) {
    return this.products.setStatus(id, dto.status, actorId);
  }

  @Permissions('PRODUCT.DELETE')
  @Delete(':id')
  @HttpCode(204)
  remove(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUserId() actorId: string,
  ) {
    return this.products.remove(id, actorId);
  }
}
