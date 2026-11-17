import {
  Body,
  BadRequestException,
  ConflictException,
  Controller,
  Get,
  HttpStatus,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuctionService } from '../auction.service.js';
import { CancelAuctionDto } from '../dtos/cancel-auction.dto.js';
import { QueryAdminAuctionsDto } from '../dtos/query-admin-auctions.dto.js';
import { QueryAuctionBidsDto } from '../dtos/query-auction-bids.dto.js';
import { QueryAuctionsDto } from '../dtos/query-auctions.dto.js';
import { QueryParticipationsDto } from '../dtos/query-participations.dto.js';
import { CurrentUserId } from '../../../common/auth/current-user-id.decorator.js';
import { AccessTokenGuard } from '../../identity/auth/guards/access-token.guard.js';
import { Roles } from '../../identity/rbac/decorators/roles.decorator.js';
import { Permissions } from '../../identity/rbac/decorators/permissions.decorator.js';
import { PermissionsGuard } from '../../identity/rbac/guards/permissions.guard.js';
import { RolesGuard } from '../../identity/rbac/guards/roles.guard.js';
import { CreateAuctionDto } from '../dtos/create-auction.dto.js';
import { PlaceBidDto } from '../dtos/place-bid.dto.js';
import { UpdateAuctionDto } from '../dtos/update-auction.dto.js';

@Controller(['api/v1/auctions', 'auctions'])
export class AuctionController {
  constructor(private readonly auctionService: AuctionService) {}

  @Post()
  @Roles('SELLER')
  @Permissions('AUCTION.CREATE')
  @UseGuards(AccessTokenGuard, RolesGuard, PermissionsGuard)
  async create(
    @Body() dto: CreateAuctionDto,
    @CurrentUserId() sellerId: string,
  ) {
    const result = await this.auctionService.create(dto, sellerId);
    return {
      success: true as const,
      statusCode: HttpStatus.CREATED,
      message: 'Tạo phiên đấu giá thành công',
      data: result,
    };
  }

  @Get('me/participations')
  @Roles('BUYER')
  @UseGuards(AccessTokenGuard, RolesGuard)
  async getMyParticipations(
    @CurrentUserId() buyerId: string,
    @Query() query: QueryParticipationsDto,
  ) {
    const result = await this.auctionService.getMyParticipations(
      buyerId,
      query,
    );
    return {
      success: true as const,
      statusCode: HttpStatus.OK,
      message: 'Lấy danh sách đấu giá của bạn thành công',
      data: result.items,
      meta: {
        page: result.page,
        limit: result.limit,
        totalItems: result.total,
        totalPages: result.totalPages,
        hasNextPage: result.page < result.totalPages,
        hasPrevPage: result.page > 1,
      },
    };
  }

  @Post(':idOrCode/bids')
  @Roles('BUYER')
  @Permissions('AUCTION.BID')
  @UseGuards(AccessTokenGuard, RolesGuard, PermissionsGuard)
  async placeBid(
    @Param('idOrCode') idOrCode: string,
    @Body() dto: PlaceBidDto,
    @CurrentUserId() bidderId: string,
    @Headers('idempotency-key') headerIdempotencyKey?: string,
  ) {
    const headerKey = headerIdempotencyKey?.trim();
    const bodyKey = dto.idempotencyKey?.trim();
    if (
      headerIdempotencyKey !== undefined &&
      (!headerKey || headerKey.length > 200)
    ) {
      throw new BadRequestException({
        errorCode: 'INVALID_IDEMPOTENCY_KEY',
        message: 'Idempotency-Key phải có từ 1 đến 200 ký tự',
      });
    }
    if (headerKey && bodyKey && headerKey !== bodyKey) {
      throw new ConflictException({
        errorCode: 'IDEMPOTENCY_KEY_REUSED',
        message: 'Idempotency key trong header và body không khớp',
      });
    }
    const result = await this.auctionService.placeBid(
      idOrCode,
      bidderId,
      dto.amount,
      headerKey || bodyKey,
    );
    return {
      success: true as const,
      statusCode: HttpStatus.CREATED,
      message: 'Đặt giá thành công',
      data: result,
    };
  }

  @Patch(':idOrCode')
  @Roles('SELLER')
  @Permissions('AUCTION.UPDATE')
  @UseGuards(AccessTokenGuard, RolesGuard, PermissionsGuard)
  async update(
    @Param('idOrCode') idOrCode: string,
    @Body() dto: UpdateAuctionDto,
    @CurrentUserId() sellerId: string,
  ) {
    return {
      success: true as const,
      statusCode: HttpStatus.OK,
      message: 'Cập nhật phiên đấu giá thành công',
      data: await this.auctionService.update(idOrCode, sellerId, dto),
    };
  }

  @Post(':idOrCode/end')
  @Roles('SELLER')
  @Permissions('AUCTION.UPDATE')
  @UseGuards(AccessTokenGuard, RolesGuard, PermissionsGuard)
  async endEarly(
    @Param('idOrCode') idOrCode: string,
    @CurrentUserId() sellerId: string,
  ) {
    const result = await this.auctionService.endEarly(idOrCode, sellerId);
    return {
      success: true as const,
      statusCode: HttpStatus.OK,
      message: 'Kết thúc phiên đấu giá thành công',
      data: result,
    };
  }

  @Post(':idOrCode/cancel')
  @Roles('SELLER')
  @Permissions('AUCTION.CANCEL')
  @UseGuards(AccessTokenGuard, RolesGuard, PermissionsGuard)
  async cancelBySeller(
    @Param('idOrCode') idOrCode: string,
    @CurrentUserId() sellerId: string,
    @Body() dto: CancelAuctionDto,
  ) {
    const result = await this.auctionService.cancelAuction(
      idOrCode,
      sellerId,
      'SELLER',
      dto?.reason,
    );
    return {
      success: true as const,
      statusCode: HttpStatus.OK,
      message: 'Hủy phiên đấu giá thành công',
      data: result,
    };
  }

  @Get()
  async list(@Query() query: QueryAuctionsDto) {
    const result = await this.auctionService.list(query);
    return {
      success: true as const,
      statusCode: HttpStatus.OK,
      message: 'Lấy danh sách phiên đấu giá thành công',
      data: {
        items: result.items,
        page: result.page,
        limit: result.limit,
        total: result.total,
        totalPages: result.totalPages,
      },
      meta: {
        page: result.page,
        limit: result.limit,
        totalItems: result.total,
        totalPages: result.totalPages,
        hasNextPage: result.page < result.totalPages,
        hasPrevPage: result.page > 1,
      },
    };
  }

  @Get(':idOrCode/bids')
  async listBids(
    @Param('idOrCode') idOrCode: string,
    @Query() query: QueryAuctionBidsDto,
  ) {
    const result = await this.auctionService.listBids(
      idOrCode,
      query.page,
      query.limit,
    );
    return {
      success: true as const,
      statusCode: HttpStatus.OK,
      message: 'Lấy lịch sử đặt giá thành công',
      data: {
        auctionId: result.auctionId,
        items: result.items,
        page: result.page,
        limit: result.limit,
        total: result.total,
        totalPages: result.totalPages,
      },
      meta: {
        page: result.page,
        limit: result.limit,
        totalItems: result.total,
        totalPages: result.totalPages,
        hasNextPage: result.page < result.totalPages,
        hasPrevPage: result.page > 1,
      },
    };
  }

  @Get(':idOrCode')
  async findByIdOrCode(@Param('idOrCode') idOrCode: string) {
    const result = await this.auctionService.findByIdOrCode(idOrCode);
    return {
      success: true as const,
      statusCode: HttpStatus.OK,
      message: 'Lấy chi tiết phiên đấu giá thành công',
      data: result,
    };
  }
}

@Controller(['api/v1/admin/auctions', 'admin/auctions'])
export class AdminAuctionController {
  constructor(private readonly auctionService: AuctionService) {}

  @Get()
  @Roles('ADMIN')
  @Permissions('AUCTION.ADMIN_LIST')
  @UseGuards(AccessTokenGuard, RolesGuard, PermissionsGuard)
  async list(@Query() query: QueryAdminAuctionsDto) {
    const result = await this.auctionService.listForAdmin(query);
    return {
      success: true as const,
      statusCode: HttpStatus.OK,
      message: 'Lấy danh sách giám sát đấu giá thành công',
      data: {
        items: result.items,
        summary: result.summary,
        page: result.page,
        limit: result.limit,
        total: result.total,
        totalPages: result.totalPages,
      },
      meta: {
        page: result.page,
        limit: result.limit,
        totalItems: result.total,
        totalPages: result.totalPages,
        hasNextPage: result.page < result.totalPages,
        hasPrevPage: result.page > 1,
      },
    };
  }

  @Get(':idOrCode')
  @Roles('ADMIN')
  @Permissions('AUCTION.ADMIN_LIST')
  @UseGuards(AccessTokenGuard, RolesGuard, PermissionsGuard)
  async findDetail(@Param('idOrCode') idOrCode: string) {
    const result =
      await this.auctionService.findAdminDetailByIdOrCode(idOrCode);
    return {
      success: true as const,
      statusCode: HttpStatus.OK,
      message: 'Lấy chi tiết giám sát phiên đấu giá thành công',
      data: result,
    };
  }

  @Post(':idOrCode/cancel')
  @Roles('ADMIN')
  @Permissions('AUCTION.ADMIN_CANCEL')
  @UseGuards(AccessTokenGuard, RolesGuard, PermissionsGuard)
  async forceCancel(
    @Param('idOrCode') idOrCode: string,
    @CurrentUserId() adminId: string,
    @Body() dto: CancelAuctionDto,
  ) {
    const result = await this.auctionService.cancelAuction(
      idOrCode,
      adminId,
      'ADMIN',
      dto?.reason,
    );
    return {
      success: true as const,
      statusCode: HttpStatus.OK,
      message: 'Hủy phiên đấu giá (Admin) thành công',
      data: result,
    };
  }
}
