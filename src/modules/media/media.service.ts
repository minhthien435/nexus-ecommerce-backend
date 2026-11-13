import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type {
  UploadedMediaDto,
  UploadMultipleMediaDto,
} from './dtos/upload-media-response.dto.js';

export const ALLOWED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
] as const;

export const MAX_IMAGE_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export const ALLOWED_MODEL_3D_MIME_TYPES = [
  'model/gltf-binary',
  'application/octet-stream',
] as const;

export const MAX_MODEL_3D_FILE_SIZE = 15 * 1024 * 1024; // 15MB
const GLB_MAGIC_HEADER = 'glTF';

const MIME_EXTENSION_MAP: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);
  private readonly supabaseUrl: string;
  private readonly supabaseKey: string;
  private readonly bucket: string;

  constructor(private readonly configService: ConfigService) {
    this.supabaseUrl = (
      this.configService.get<string>('SUPABASE_URL') || ''
    ).replace(/\/+$/, '');
    this.supabaseKey =
      this.configService.get<string>('SUPABASE_SERVICE_ROLE_KEY') ||
      this.configService.get<string>('SUPABASE_ANON_KEY') ||
      '';
    this.bucket =
      (
        this.configService.get<string>('SUPABASE_STORAGE_BUCKET') ?? ''
      ).trim() || 'nexus-media';
  }

  /**
   * Tải 1 file hình ảnh lên Supabase Storage và trả về URL công khai.
   */
  async uploadImage(
    file: Express.Multer.File,
    folder = 'products',
  ): Promise<UploadedMediaDto> {
    if (!file || !file.buffer) {
      throw new BadRequestException('Vui lòng cung cấp file hình ảnh');
    }

    if (file.size > MAX_IMAGE_FILE_SIZE) {
      throw new BadRequestException('Kích thước file không được vượt quá 5MB');
    }

    if (
      !ALLOWED_IMAGE_MIME_TYPES.includes(
        file.mimetype as (typeof ALLOWED_IMAGE_MIME_TYPES)[number],
      )
    ) {
      throw new BadRequestException(
        'Định dạng ảnh không hợp lệ. Chỉ chấp nhận JPG, PNG, WEBP, GIF',
      );
    }

    const safeFolder =
      (folder || 'products').toLowerCase().replace(/[^a-z0-9_-]/g, '') ||
      'products';
    const ext = MIME_EXTENSION_MAP[file.mimetype] || 'png';

    return this.uploadBufferToSupabase(file, safeFolder, ext, file.mimetype);
  }

  /**
   * Tải 1 file mô hình 3D (.glb) lên Supabase Storage và trả về URL công khai.
   */
  async uploadModel3d(
    file: Express.Multer.File,
    folder = 'models-3d',
  ): Promise<UploadedMediaDto> {
    if (!file || !file.buffer) {
      throw new BadRequestException('Vui lòng cung cấp file mô hình 3D (.glb)');
    }

    if (file.size > MAX_MODEL_3D_FILE_SIZE) {
      throw new BadRequestException(
        'Kích thước file 3D không được vượt quá 15MB',
      );
    }

    const hasGlbExtension = Boolean(
      file.originalname?.toLowerCase().endsWith('.glb'),
    );
    const hasAllowedMime = ALLOWED_MODEL_3D_MIME_TYPES.includes(
      file.mimetype as (typeof ALLOWED_MODEL_3D_MIME_TYPES)[number],
    );
    const hasGlbMagic =
      file.buffer.length >= 4 &&
      file.buffer.subarray(0, 4).toString('ascii') === GLB_MAGIC_HEADER;

    if (
      !hasAllowedMime ||
      !hasGlbMagic ||
      (!hasGlbExtension && file.mimetype === 'application/octet-stream')
    ) {
      throw new BadRequestException(
        'Định dạng mô hình 3D không hợp lệ. Chỉ chấp nhận file .glb (glTF Binary)',
      );
    }

    const safeFolder =
      (folder || 'models-3d').toLowerCase().replace(/[^a-z0-9_-]/g, '') ||
      'models-3d';

    return this.uploadBufferToSupabase(
      file,
      safeFolder,
      'glb',
      'model/gltf-binary',
    );
  }

  private async uploadBufferToSupabase(
    file: Express.Multer.File,
    safeFolder: string,
    ext: string,
    contentType: string,
  ): Promise<UploadedMediaDto> {
    if (!this.supabaseUrl || !this.supabaseKey) {
      this.logger.error('Supabase URL hoặc API key chưa được cấu hình');
      throw new InternalServerErrorException(
        'Dịch vụ lưu trữ chưa được cấu hình đầy đủ',
      );
    }

    const uniqueFileName = `${Date.now()}-${randomUUID()}.${ext}`;
    const storagePath = `${safeFolder}/${uniqueFileName}`;
    const uploadUrl = `${this.supabaseUrl}/storage/v1/object/${this.bucket}/${storagePath}`;

    try {
      const response = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          apikey: this.supabaseKey,
          Authorization: `Bearer ${this.supabaseKey}`,
          'Content-Type': contentType,
          'x-upsert': 'false',
        },
        body: file.buffer as unknown as BodyInit,
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(
          `Supabase storage upload failed [${response.status}]: ${errorText}`,
        );
        throw new BadRequestException(
          'Không thể tải ảnh lên kho lưu trữ đám mây',
        );
      }

      const publicUrl = `${this.supabaseUrl}/storage/v1/object/public/${this.bucket}/${storagePath}`;

      return {
        url: publicUrl,
        key: storagePath,
        size: file.size,
        mimetype: contentType,
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }
      this.logger.error(`Network or upload error: ${(error as Error).message}`);
      throw new InternalServerErrorException(
        'Lỗi kết nối khi tải ảnh lên kho lưu trữ',
      );
    }
  }

  /**
   * Tải danh sách nhiều ảnh cùng lúc (tối đa 10 ảnh).
   */
  async uploadMultipleImages(
    files: Express.Multer.File[],
    folder = 'products',
  ): Promise<UploadMultipleMediaDto> {
    if (!files || files.length === 0) {
      throw new BadRequestException('Vui lòng chọn ít nhất 1 file hình ảnh');
    }

    if (files.length > 10) {
      throw new BadRequestException('Chỉ được tải lên tối đa 10 ảnh cùng lúc');
    }

    const uploadedFiles = await Promise.all(
      files.map((file) => this.uploadImage(file, folder)),
    );

    return {
      urls: uploadedFiles.map((item) => item.url),
      files: uploadedFiles,
    };
  }
}
