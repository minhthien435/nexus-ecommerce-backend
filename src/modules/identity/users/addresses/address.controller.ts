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
  UseGuards,
} from '@nestjs/common';
import { CurrentUserId } from '../../../../common/auth/current-user-id.decorator.js';
import { AccessTokenGuard } from '../../auth/guards/access-token.guard.js';
import { CreateAddressDto } from '../dtos/create-address.dto.js';
import { UpdateAddressDto } from '../dtos/update-address.dto.js';
import { AddressService } from './address.service.js';

@UseGuards(AccessTokenGuard)
@Controller('api/v1/users/addresses')
export class AddressController {
  constructor(private readonly addresses: AddressService) {}

  private sanitizeAddress(address: Record<string, unknown>) {
    if (!address) return address;
    const { userId: _, ...rest } = address;
    return rest;
  }

  @Get()
  async list(@CurrentUserId() userId: string) {
    const list = await this.addresses.list(userId);
    return list.map((addr) =>
      this.sanitizeAddress(addr as unknown as Record<string, unknown>),
    );
  }

  @Post()
  async create(
    @CurrentUserId() userId: string,
    @Body() input: CreateAddressDto,
  ) {
    const addr = await this.addresses.create(userId, input);
    return this.sanitizeAddress(addr as unknown as Record<string, unknown>);
  }

  @Patch(':id')
  async update(
    @CurrentUserId() userId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: UpdateAddressDto,
  ) {
    if (Object.values(input).every((value) => value === undefined)) {
      throw new BadRequestException('At least one update field is required');
    }
    const addr = await this.addresses.update(userId, id, input);
    return this.sanitizeAddress(addr as unknown as Record<string, unknown>);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUserId() userId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.addresses.remove(userId, id);
  }
}
