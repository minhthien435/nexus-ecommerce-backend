import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentUserId } from '../../../common/auth/current-user-id.decorator.js';
import { AccessTokenGuard } from '../../identity/auth/guards/access-token.guard.js';
import { Permissions } from '../../identity/rbac/decorators/permissions.decorator.js';
import { PermissionsGuard } from '../../identity/rbac/guards/permissions.guard.js';
import { CartService } from '../services/cart.service.js';
import { CartWriteService } from '../services/cart-write.service.js';
import { AddCartItemDto } from '../dtos/add-cart-item.dto.js';
import { UpdateCartItemDto } from '../dtos/update-cart-item.dto.js';

@Controller('api/v1/commerce/cart')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class CartController {
  constructor(
    private readonly cart: CartService,
    private readonly writer: CartWriteService,
  ) {}

  @Get()
  @Permissions('CART.VIEW')
  get(@CurrentUserId() userId: string) {
    return this.cart.getCart(userId);
  }

  @Post('items')
  @Permissions('CART.CREATE')
  add(@CurrentUserId() userId: string, @Body() input: AddCartItemDto) {
    return this.writer.addItem(userId, input);
  }

  @Patch('items')
  @Permissions('CART.UPDATE')
  update(@CurrentUserId() userId: string, @Body() input: UpdateCartItemDto) {
    return this.writer.updateItem(userId, input.skuId, input);
  }
}
