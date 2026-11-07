import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../../identity/auth/guards/access-token.guard.js';
import {
  CalculateShippingFeeDto,
  DistrictsQueryDto,
  WardsQueryDto,
} from '../dtos/calculate-shipping-fee.dto.js';
import { ShippingLocationsService } from '../services/shipping-locations.service.js';
import { ShippingQuoteService } from '../services/shipping-quote.service.js';

@UseGuards(AccessTokenGuard)
@Controller('api/v1/fulfillment/shipping')
export class ShippingController {
  constructor(
    private readonly locations: ShippingLocationsService,
    private readonly quotes: ShippingQuoteService,
  ) {}

  @Get('locations/provinces')
  provinces() {
    return this.locations.provinces();
  }

  @Get('locations/districts')
  districts(@Query() query: DistrictsQueryDto) {
    return this.locations.districts(query.provinceId);
  }

  @Get('locations/wards')
  wards(@Query() query: WardsQueryDto) {
    return this.locations.wards(query.districtId);
  }

  @Post('calculate-fee')
  quote(@Body() input: CalculateShippingFeeDto) {
    return this.quotes.quote({
      districtId: input.toDistrictId,
      wardCode: input.toWardCode,
      weightGrams: input.weightInGrams,
    });
  }
}
