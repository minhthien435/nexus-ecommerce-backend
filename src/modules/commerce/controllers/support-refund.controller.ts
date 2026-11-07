import {
  Body,
  Controller,
  Get,
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
import {
  ConfirmRefundTransferredDto,
  QueryOrderRefundsDto,
  RejectOrderRefundDto,
} from '../dtos/order-refund.dto.js';
import { OrderRefundService } from '../services/order-refund.service.js';

@Roles('ADMIN', 'STAFF')
@Permissions('ORDER.REFUND')
@UseGuards(AccessTokenGuard, RolesGuard, PermissionsGuard)
@Controller('api/v1/commerce/support/refunds')
export class SupportRefundController {
  constructor(private readonly refundService: OrderRefundService) {}

  @Get()
  async list(@Query() query: QueryOrderRefundsDto) {
    const result = await this.refundService.list(query);
    return {
      success: true as const,
      statusCode: HttpStatus.OK,
      message: 'Lấy danh sách yêu cầu hoàn tiền thành công',
      data: result.items,
      meta: result.meta,
    };
  }

  @Post(':id/process')
  async process(
    @Param('id', new ParseUUIDPipe()) refundId: string,
    @CurrentUserId() actorId: string,
  ) {
    const data = await this.refundService.process(refundId, actorId);
    return {
      success: true as const,
      statusCode: HttpStatus.OK,
      message: 'Đã bắt đầu xử lý hoàn tiền',
      data,
    };
  }

  @Post(':id/confirm-transferred')
  async confirmTransferred(
    @Param('id', new ParseUUIDPipe()) refundId: string,
    @CurrentUserId() actorId: string,
    @Body() dto: ConfirmRefundTransferredDto,
  ) {
    const data = await this.refundService.confirmTransferred(
      refundId,
      actorId,
      dto.bankReferenceCode,
      dto.notes,
    );
    return {
      success: true as const,
      statusCode: HttpStatus.OK,
      message: 'Xác nhận hoàn tiền thành công',
      data,
    };
  }

  @Post(':id/reject')
  async reject(
    @Param('id', new ParseUUIDPipe()) refundId: string,
    @CurrentUserId() actorId: string,
    @Body() dto: RejectOrderRefundDto,
  ) {
    const data = await this.refundService.reject(refundId, actorId, dto.reason);
    return {
      success: true as const,
      statusCode: HttpStatus.OK,
      message: 'Đã từ chối yêu cầu hoàn tiền',
      data,
    };
  }
}
