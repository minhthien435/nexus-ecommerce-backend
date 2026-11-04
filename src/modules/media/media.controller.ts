import {
  BadRequestException,
  Body,
  Controller,
  HttpStatus,
  Post,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { AccessTokenGuard } from '../identity/auth/guards/access-token.guard.js';
import { MediaService } from './media.service.js';

@Controller('api/v1/media')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  /**
   * Tải lên 1 ảnh đơn (dùng cho ảnh đại diện, logo shop, ảnh chính sản phẩm)
   * Multipart field: 'file'
   */
  @Post('upload')
  @UseGuards(AccessTokenGuard)
  @UseInterceptors(FileInterceptor('file'))
  async uploadSingle(
    @UploadedFile() file: Express.Multer.File,
    @Body('folder') folder?: string,
  ) {
    if (!file) {
      throw new BadRequestException(
        'Vui lòng chọn file hình ảnh (field: file)',
      );
    }

    const data = await this.mediaService.uploadImage(file, folder);

    return {
      success: true,
      statusCode: HttpStatus.CREATED,
      message: 'Tải ảnh lên thành công',
      data,
    };
  }

  /**
   * Tải lên nhiều ảnh cùng lúc (tối đa 10 ảnh, dùng cho bộ sưu tập/gallery sản phẩm)
   * Multipart field: 'files'
   */
  @Post('upload-multiple')
  @UseGuards(AccessTokenGuard)
  @UseInterceptors(FilesInterceptor('files', 10))
  async uploadMultiple(
    @UploadedFiles() files: Express.Multer.File[],
    @Body('folder') folder?: string,
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException(
        'Vui lòng chọn ít nhất một file hình ảnh (field: files)',
      );
    }

    const data = await this.mediaService.uploadMultipleImages(files, folder);

    return {
      success: true,
      statusCode: HttpStatus.CREATED,
      message: 'Tải danh sách ảnh lên thành công',
      data,
    };
  }
}
