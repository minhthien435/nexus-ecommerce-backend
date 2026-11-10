import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuctionService } from '../auction.service.js';
import { QueryAuctionsDto } from '../dtos/query-auctions.dto.js';
import { CurrentUserId } from '../../../common/auth/current-user-id.decorator.js';
import { AccessTokenGuard } from '../../identity/auth/guards/access-token.guard.js';
import { Roles } from '../../identity/rbac/decorators/roles.decorator.js';
import { Permissions } from '../../identity/rbac/decorators/permissions.decorator.js';
import { PermissionsGuard } from '../../identity/rbac/guards/permissions.guard.js';
import { RolesGuard } from '../../identity/rbac/guards/roles.guard.js';
import { CreateAuctionDto } from '../dtos/create-auction.dto.js';
import { PlaceBidDto } from '../dtos/place-bid.dto.js';

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

  @Post(':idOrCode/bids')
  @Roles('BUYER')
  @Permissions('AUCTION.BID')
  @UseGuards(AccessTokenGuard, RolesGuard, PermissionsGuard)
  async placeBid(
    @Param('idOrCode') idOrCode: string,
    @Body() dto: PlaceBidDto,
    @CurrentUserId() bidderId: string,
  ) {
    const result = await this.auctionService.placeBid(
      idOrCode,
      bidderId,
      dto.amount,
    );
    return {
      success: true as const,
      statusCode: HttpStatus.CREATED,
      message: 'Đặt giá thành công',
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
