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
import { QuerySupportDisputesDto } from '../dtos/query-support-disputes.dto.js';
import { ResolveOrderDisputeDto } from '../dtos/resolve-order-dispute.dto.js';
import { OrderDisputeService } from '../services/order-dispute.service.js';

@Roles('ADMIN', 'STAFF', 'SUPPORT_STAFF')
@UseGuards(AccessTokenGuard, RolesGuard, PermissionsGuard)
@Controller('api/v1/commerce/support/disputes')
export class SupportDisputeController {
  constructor(private readonly disputeService: OrderDisputeService) {}

  /**
   * Truy vấn danh sách khiếu nại đơn hàng cho Support desk / Admin
   * Yêu cầu quyền DISPUTE.MANAGE
   */
  @Get()
  @Permissions('DISPUTE.MANAGE')
  async list(@Query() query: QuerySupportDisputesDto) {
    const result = await this.disputeService.listSupportDisputes(query);
    return {
      success: true as const,
      statusCode: HttpStatus.OK,
      message: 'Lấy danh sách khiếu nại đơn hàng hỗ trợ thành công',
      data: result.data,
      meta: result.meta,
    };
  }

  /**
   * Giải quyết khiếu nại đơn hàng bởi Support Desk / Admin
   * Hỗ trợ ACCEPTED_REFUND (hoàn tiền) và REJECTED_PAY_SELLER (bác bỏ khiếu nại)
   * Yêu cầu quyền DISPUTE.MANAGE
   */
  @Patch(':id/resolve')
  @Permissions('DISPUTE.MANAGE')
  async resolve(
    @Param('id', new ParseUUIDPipe()) disputeId: string,
    @CurrentUserId() actorId: string,
    @Body() dto: ResolveOrderDisputeDto,
  ) {
    const result = await this.disputeService.resolveDispute(
      disputeId,
      actorId,
      dto,
    );
    return {
      success: true as const,
      statusCode: HttpStatus.OK,
      message: 'Giải quyết khiếu nại đơn hàng thành công',
      data: result,
    };
  }
}
