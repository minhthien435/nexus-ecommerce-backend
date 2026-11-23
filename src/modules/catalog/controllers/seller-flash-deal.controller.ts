import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
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
  CreateFlashDealRegistrationDto,
  QueryEligibleFlashDealSkusDto,
  QuerySellerFlashDealCampaignsDto,
  QuerySellerFlashDealRegistrationsDto,
  UpdateFlashDealRegistrationDto,
} from '../dtos/seller-flash-deal.dto.js';
import { SellerFlashDealService } from '../services/seller-flash-deal.service.js';

@Roles('SELLER')
@UseGuards(AccessTokenGuard, RolesGuard, PermissionsGuard)
@Permissions('FLASH_DEAL.REGISTER')
@Controller('api/v1/catalog/seller/flash-deals')
export class SellerFlashDealController {
  constructor(private readonly sellerFlashDeals: SellerFlashDealService) {}

  @Get('campaigns')
  listCampaigns(
    @CurrentUserId() sellerId: string,
    @Query() query: QuerySellerFlashDealCampaignsDto,
  ) {
    return this.sellerFlashDeals.listCampaigns(sellerId, query);
  }

  @Get('campaigns/:id')
  campaignDetail(
    @CurrentUserId() sellerId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.sellerFlashDeals.getCampaignDetail(sellerId, id);
  }

  @Get('campaigns/:id/eligible-skus')
  eligibleSkus(
    @CurrentUserId() sellerId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: QueryEligibleFlashDealSkusDto,
  ) {
    return this.sellerFlashDeals.listEligibleSkus(sellerId, id, query);
  }

  @Post('campaigns/:id/registrations')
  createRegistration(
    @CurrentUserId() sellerId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CreateFlashDealRegistrationDto,
  ) {
    return this.sellerFlashDeals.createRegistration(sellerId, id, dto);
  }

  @Get('registrations')
  listRegistrations(
    @CurrentUserId() sellerId: string,
    @Query() query: QuerySellerFlashDealRegistrationsDto,
  ) {
    return this.sellerFlashDeals.listRegistrations(sellerId, query);
  }

  @Patch('registrations/:registrationId')
  updateRegistration(
    @CurrentUserId() sellerId: string,
    @Param('registrationId', new ParseUUIDPipe()) registrationId: string,
    @Body() dto: UpdateFlashDealRegistrationDto,
  ) {
    if (Object.values(dto).every((value) => value === undefined)) {
      throw new BadRequestException({
        errorCode: 'EMPTY_UPDATE_PAYLOAD',
        message: 'At least one update field is required',
      });
    }
    return this.sellerFlashDeals.updateRegistration(
      sellerId,
      registrationId,
      dto,
    );
  }

  @Delete('registrations/:registrationId')
  @HttpCode(HttpStatus.OK)
  withdrawRegistration(
    @CurrentUserId() sellerId: string,
    @Param('registrationId', new ParseUUIDPipe()) registrationId: string,
  ) {
    return this.sellerFlashDeals.withdrawRegistration(sellerId, registrationId);
  }
}
