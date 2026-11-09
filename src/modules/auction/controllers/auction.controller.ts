import { Controller, Get, HttpStatus, Param, Query } from '@nestjs/common';
import { AuctionService } from '../auction.service.js';
import { QueryAuctionsDto } from '../dtos/query-auctions.dto.js';

@Controller(['api/v1/auctions', 'auctions'])
export class AuctionController {
  constructor(private readonly auctionService: AuctionService) {}

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
