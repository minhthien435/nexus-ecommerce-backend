import {
  Body,
  Controller,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUserId } from '../../../common/auth/current-user-id.decorator.js';
import { AccessTokenGuard } from '../../identity/auth/guards/access-token.guard.js';
import { Permissions } from '../../identity/rbac/decorators/permissions.decorator.js';
import { Roles } from '../../identity/rbac/decorators/roles.decorator.js';
import { PermissionsGuard } from '../../identity/rbac/guards/permissions.guard.js';
import { RolesGuard } from '../../identity/rbac/guards/roles.guard.js';
import { ForceCancelOrderDto } from '../dtos/force-cancel-order.dto.js';
import { OrderCancelService } from '../services/order-cancel.service.js';

@Roles('ADMIN', 'STAFF')
@UseGuards(AccessTokenGuard, RolesGuard, PermissionsGuard)
@Controller('api/v1/commerce/support/orders')
export class SupportOrderCancelController {
  constructor(private readonly service: OrderCancelService) {}

  @Post(':id/cancel')
  @Permissions('ORDER.CANCEL')
  async cancel(
    @CurrentUserId() actorId: string,
    @Param('id', new ParseUUIDPipe()) orderId: string,
    @Body() dto: ForceCancelOrderDto,
  ) {
    return {
      success: true as const,
      statusCode: HttpStatus.OK,
      message: 'Order cancelled successfully',
      data: await this.service.cancel(actorId, orderId, dto),
    };
  }
}
