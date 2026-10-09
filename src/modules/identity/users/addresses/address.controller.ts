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
} from '@nestjs/common';
import { CurrentUserId } from '../../../../common/auth/current-user-id.decorator.js';
import { CreateAddressDto } from '../dtos/create-address.dto.js';
import { UpdateAddressDto } from '../dtos/update-address.dto.js';
import { AddressService } from './address.service.js';

@Controller('users/addresses')
export class AddressController {
  constructor(private readonly addresses: AddressService) {}

  @Get()
  list(@CurrentUserId() userId: string) {
    return this.addresses.list(userId);
  }

  @Post()
  create(@CurrentUserId() userId: string, @Body() input: CreateAddressDto) {
    return this.addresses.create(userId, input);
  }

  @Patch(':id')
  update(
    @CurrentUserId() userId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: UpdateAddressDto,
  ) {
    if (Object.values(input).every((value) => value === undefined)) {
      throw new BadRequestException('At least one update field is required');
    }
    return this.addresses.update(userId, id, input);
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
