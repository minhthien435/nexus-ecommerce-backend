import { Controller, Get, Query } from '@nestjs/common';
import { ActiveFlashDealQueryDto } from '../dtos/flash-deal-query.dto.js';
import { FlashDealService } from '../services/flash-deal.service.js';

@Controller('api/v1/flash-deals')
export class FlashDealController {
  constructor(private readonly flashDeals: FlashDealService) {}
  @Get('active') active(@Query() query: ActiveFlashDealQueryDto) {
    return this.flashDeals.active(query);
  }
  @Get('campaigns') campaigns() {
    return this.flashDeals.campaigns();
  }
}
