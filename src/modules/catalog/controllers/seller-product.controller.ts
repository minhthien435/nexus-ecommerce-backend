import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseFilePipeBuilder,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CurrentUserId } from '../../../common/auth/current-user-id.decorator.js';
import { AccessTokenGuard } from '../../identity/auth/guards/access-token.guard.js';
import { Permissions } from '../../identity/rbac/decorators/permissions.decorator.js';
import { Roles } from '../../identity/rbac/decorators/roles.decorator.js';
import { PermissionsGuard } from '../../identity/rbac/guards/permissions.guard.js';
import { RolesGuard } from '../../identity/rbac/guards/roles.guard.js';
import {
  CreateSellerProductDto,
  SellerProductQueryDto,
  UpdateSellerProductDto,
  UpdateSellerProductStatusDto,
} from '../dtos/seller-product.dto.js';
import { SellerProductService } from '../services/seller-product.service.js';
import { SellerBulkImportService } from '../services/seller-bulk-import.service.js';

@Roles('ADMIN', 'SELLER')
@UseGuards(AccessTokenGuard, RolesGuard, PermissionsGuard)
@Controller('api/v1/catalog/seller/products')
export class SellerProductController {
  constructor(
    private readonly products: SellerProductService,
    private readonly bulkImport: SellerBulkImportService,
  ) {}

  @Permissions('PRODUCT.CREATE')
  @Get('bulk/template')
  template(@Res() response: Response) {
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      'attachment; filename="product-import-template.csv"',
    );
    response.send(this.bulkImport.template());
  }

  @Permissions('PRODUCT.CREATE')
  @Post('bulk')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024, files: 1 },
      fileFilter: (_request, file, callback) => {
        if (
          file.mimetype !== 'text/csv' &&
          !file.originalname.toLowerCase().endsWith('.csv')
        ) {
          callback(
            new BadRequestException({
              errorCode: 'INVALID_FILE_TYPE',
              message: 'Only CSV files are accepted',
            }),
            false,
          );
          return;
        }
        callback(null, true);
      },
    }),
  )
  importCsv(
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addMaxSizeValidator({ maxSize: 5 * 1024 * 1024 })
        .build({ fileIsRequired: true }),
    )
    file: Express.Multer.File,
    @CurrentUserId() actorId: string,
  ) {
    return this.bulkImport.import(actorId, file.buffer);
  }

  @Permissions('PRODUCT.LIST')
  @Get()
  list(
    @Query() query: SellerProductQueryDto,
    @CurrentUserId() actorId: string,
  ) {
    return this.products.list(actorId, query);
  }

  @Permissions('PRODUCT.VIEW')
  @Get(':id')
  get(@Param('id') id: string, @CurrentUserId() actorId: string) {
    return this.products.get(id, actorId);
  }

  @Permissions('PRODUCT.CREATE')
  @Post()
  create(
    @Body() dto: CreateSellerProductDto,
    @CurrentUserId() actorId: string,
  ) {
    return this.products.create(dto, actorId);
  }

  @Permissions('PRODUCT.UPDATE')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSellerProductDto,
    @CurrentUserId() actorId: string,
  ) {
    return this.products.update(id, dto, actorId);
  }

  @Permissions('PRODUCT.UPDATE')
  @Patch(':id/status')
  setStatus(
    @Param('id') id: string,
    @Body() dto: UpdateSellerProductStatusDto,
    @CurrentUserId() actorId: string,
  ) {
    return this.products.setStatus(id, dto.status, actorId);
  }

  @Permissions('PRODUCT.DELETE')
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string, @CurrentUserId() actorId: string) {
    return this.products.remove(id, actorId);
  }
}
