import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUserId } from '../../../common/auth/current-user-id.decorator.js';
import { AccessTokenGuard } from '../../identity/auth/guards/access-token.guard.js';
import { Permissions } from '../../identity/rbac/decorators/permissions.decorator.js';
import { Roles } from '../../identity/rbac/decorators/roles.decorator.js';
import { PermissionsGuard } from '../../identity/rbac/guards/permissions.guard.js';
import { RolesGuard } from '../../identity/rbac/guards/roles.guard.js';
import { CreateSkuDto } from '../dtos/create-sku.dto.js';
import { UpdateSkuDto } from '../dtos/update-sku.dto.js';
import { ProductSkuService } from '../services/product-sku.service.js';

@Roles('ADMIN', 'SELLER')
@UseGuards(AccessTokenGuard, RolesGuard, PermissionsGuard)
@Controller('api/v1/catalog')
export class ProductSkuController {
  constructor(private readonly skuService: ProductSkuService) {}

  @Permissions('PRODUCT.CREATE')
  @Post('products/:productId/skus')
  create(
    @Param('productId', new ParseUUIDPipe()) productId: string,
    @Body() dto: CreateSkuDto,
    @CurrentUserId() actorId: string,
  ) {
    return this.skuService.create(productId, dto, actorId);
  }

  @Permissions('PRODUCT.LIST')
  @Get('products/:productId/skus')
  list(
    @Param('productId', new ParseUUIDPipe()) productId: string,
    @CurrentUserId() actorId: string,
  ) {
    return this.skuService.listByProduct(productId, actorId);
  }

  @Permissions('PRODUCT.VIEW')
  @Get('skus/:id')
  get(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUserId() actorId: string,
  ) {
    return this.skuService.getById(id, actorId);
  }

  @Permissions('PRODUCT.UPDATE')
  @Patch('skus/:id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateSkuDto,
    @CurrentUserId() actorId: string,
  ) {
    return this.skuService.update(id, dto, actorId);
  }

  @Permissions('PRODUCT.DELETE')
  @Delete('skus/:id')
  deactivate(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUserId() actorId: string,
  ) {
    return this.skuService.deactivate(id, actorId);
  }
}
