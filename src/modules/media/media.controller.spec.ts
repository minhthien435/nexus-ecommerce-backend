import { BadRequestException, HttpStatus } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessTokenGuard } from '../identity/auth/guards/access-token.guard.js';
import { MediaController } from './media.controller.js';
import type { MediaService } from './media.service.js';

describe('MediaController', () => {
  let controller: MediaController;
  let mediaService: MediaService;

  const mockFile = (
    overrides?: Partial<Express.Multer.File>,
  ): Express.Multer.File => ({
    fieldname: 'file',
    originalname: 'product-cover.png',
    encoding: '7bit',
    mimetype: 'image/png',
    size: 2048,
    buffer: Buffer.from('img-bytes'),
    stream: null as never,
    destination: '',
    filename: '',
    path: '',
    ...overrides,
  });

  beforeEach(() => {
    mediaService = {
      uploadImage: vi.fn().mockResolvedValue({
        url: 'https://test-project.supabase.co/storage/v1/object/public/nexus-media/products/img-1.png',
        key: 'products/img-1.png',
        size: 2048,
        mimetype: 'image/png',
      }),
      uploadMultipleImages: vi.fn().mockResolvedValue({
        urls: [
          'https://test-project.supabase.co/storage/v1/object/public/nexus-media/products/img-1.png',
          'https://test-project.supabase.co/storage/v1/object/public/nexus-media/products/img-2.png',
        ],
        files: [
          {
            url: 'https://test-project.supabase.co/storage/v1/object/public/nexus-media/products/img-1.png',
            key: 'products/img-1.png',
            size: 2048,
            mimetype: 'image/png',
          },
          {
            url: 'https://test-project.supabase.co/storage/v1/object/public/nexus-media/products/img-2.png',
            key: 'products/img-2.png',
            size: 4096,
            mimetype: 'image/png',
          },
        ],
      }),
    } as unknown as MediaService;

    controller = new MediaController(mediaService);
  });

  describe('uploadSingle', () => {
    it('throws BadRequestException if no file is provided', async () => {
      await expect(
        controller.uploadSingle(null as unknown as Express.Multer.File),
      ).rejects.toThrow(BadRequestException);
    });

    it('returns formatted 201 response with uploaded file data', async () => {
      const file = mockFile();
      const result = await controller.uploadSingle(file, 'products');

      expect(mediaService.uploadImage).toHaveBeenCalledWith(file, 'products');
      expect(result).toEqual({
        success: true,
        statusCode: HttpStatus.CREATED,
        message: 'Tải ảnh lên thành công',
        data: {
          url: 'https://test-project.supabase.co/storage/v1/object/public/nexus-media/products/img-1.png',
          key: 'products/img-1.png',
          size: 2048,
          mimetype: 'image/png',
        },
      });
    });
  });

  describe('uploadMultiple', () => {
    it('throws BadRequestException if files array is empty', async () => {
      await expect(controller.uploadMultiple([])).rejects.toThrow(
        BadRequestException,
      );
    });

    it('returns formatted 201 response with multiple uploaded files', async () => {
      const files = [mockFile(), mockFile()];
      const result = await controller.uploadMultiple(files, 'products');

      expect(mediaService.uploadMultipleImages).toHaveBeenCalledWith(
        files,
        'products',
      );
      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(HttpStatus.CREATED);
      expect(result.data.urls).toHaveLength(2);
    });
  });

  describe('Guards', () => {
    it('has AccessTokenGuard applied', () => {
      const uploadSingleGuards = Reflect.getMetadata(
        '__guards__',
        controller.uploadSingle,
      );
      expect(uploadSingleGuards).toContain(AccessTokenGuard);

      const uploadMultipleGuards = Reflect.getMetadata(
        '__guards__',
        controller.uploadMultiple,
      );
      expect(uploadMultipleGuards).toContain(AccessTokenGuard);
    });
  });
});
