import { Controller, Get, HttpStatus, Query, UseGuards } from '@nestjs/common';
import { CurrentUserId } from '../../../common/auth/current-user-id.decorator.js';
import { AccessTokenGuard } from '../../identity/auth/guards/access-token.guard.js';
import { Roles } from '../../identity/rbac/decorators/roles.decorator.js';
import { RolesGuard } from '../../identity/rbac/guards/roles.guard.js';
import { QuerySellerDashboardDto } from '../dtos/query-seller-dashboard.dto.js';
import { SellerDashboardService } from '../services/seller-dashboard.service.js';

@Roles('SELLER', 'ADMIN')
@UseGuards(AccessTokenGuard, RolesGuard)
@Controller('api/v1/commerce/seller/dashboard')
export class SellerDashboardController {
  constructor(
    private readonly sellerDashboardService: SellerDashboardService,
  ) {}

  @Get('stats')
  async getStats(
    @CurrentUserId() sellerId: string,
    @Query() query: QuerySellerDashboardDto,
  ) {
    const data = await this.sellerDashboardService.getStats(sellerId, query);
    return {
      success: true as const,
      statusCode: HttpStatus.OK,
      message: 'Lấy thống kê bảng điều khiển người bán thành công',
      data,
    };
  }
}
