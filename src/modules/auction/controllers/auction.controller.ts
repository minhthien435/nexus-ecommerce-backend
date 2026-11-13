import {
  Body,
  BadRequestException,
  ConflictException,
  Controller,
  Get,
  HttpStatus,
  Headers,
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
