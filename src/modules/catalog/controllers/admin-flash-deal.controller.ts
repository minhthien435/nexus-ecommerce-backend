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
  AddFlashDealItemDto,
  CreateFlashDealCampaignDto,
  QueryAdminFlashDealsDto,
  UpdateFlashDealCampaignDto,
  UpdateFlashDealItemDto,
} from '../dtos/admin-flash-deal.dto.js';
import { FlashDealAdminService } from '../services/flash-deal-admin.service.js';

@Roles('ADMIN')
@UseGuards(AccessTokenGuard, RolesGuard, PermissionsGuard)
@Controller('api/v1/admin/flash-deals')
export class AdminFlashDealController {
  constructor(private readonly flashDealAdmin: FlashDealAdminService) {}

  @Permissions('FLASH_DEAL.LIST')
  @Get()
  list(@Query() query: QueryAdminFlashDealsDto) {
    return this.flashDealAdmin.listCampaigns(query);
  }

  @Permissions('FLASH_DEAL.LIST')
  @Get(':id')
  detail(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.flashDealAdmin.getCampaignDetail(id);
  }

  @Permissions('FLASH_DEAL.MANAGE')
  @Post()
  create(
    @CurrentUserId() actorId: string,
    @Body() dto: CreateFlashDealCampaignDto,
  ) {
    return this.flashDealAdmin.createCampaign(actorId, dto);
  }

  @Permissions('FLASH_DEAL.MANAGE')
  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateFlashDealCampaignDto,
  ) {
    if (Object.values(dto).every((value) => value === undefined)) {
      throw new BadRequestException({
        errorCode: 'EMPTY_UPDATE_PAYLOAD',
        message: 'At least one update field is required',
      });
    }
    return this.flashDealAdmin.updateCampaign(id, dto);
  }

  @Permissions('FLASH_DEAL.MANAGE')
  @Post(':id/items')
  addItem(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AddFlashDealItemDto,
  ) {
    return this.flashDealAdmin.addItem(id, dto);
  }

  @Permissions('FLASH_DEAL.MANAGE')
  @Patch(':id/items/:itemId')
  updateItem(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('itemId', new ParseUUIDPipe()) itemId: string,
    @Body() dto: UpdateFlashDealItemDto,
  ) {
    if (Object.values(dto).every((value) => value === undefined)) {
      throw new BadRequestException({
        errorCode: 'EMPTY_UPDATE_PAYLOAD',
        message: 'At least one update field is required',
      });
    }
    return this.flashDealAdmin.updateItem(id, itemId, dto);
  }

  @Permissions('FLASH_DEAL.MANAGE')
  @Delete(':id/items/:itemId')
  @HttpCode(HttpStatus.OK)
  removeItem(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('itemId', new ParseUUIDPipe()) itemId: string,
  ) {
    return this.flashDealAdmin.removeItem(id, itemId);
  }

  @Permissions('FLASH_DEAL.CANCEL')
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.flashDealAdmin.cancelCampaign(id);
  }
}
