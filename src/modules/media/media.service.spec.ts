import {
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MediaService } from './media.service.js';

describe('MediaService', () => {
  let service: MediaService;
  let configService: ConfigService;

  const mockFile = (
    overrides?: Partial<Express.Multer.File>,
  ): Express.Multer.File => ({
    fieldname: 'file',
    originalname: 'test-product.png',
    encoding: '7bit',
    mimetype: 'image/png',
    size: 1024,
    buffer: Buffer.from('fake-image-bytes'),
    stream: null as never,
    destination: '',
    filename: '',
    path: '',
    ...overrides,
  });

  beforeEach(() => {
    vi.restoreAllMocks();

    configService = {
      get: vi.fn((key: string) => {
        if (key === 'SUPABASE_URL') return 'https://test-project.supabase.co';
        if (key === 'SUPABASE_ANON_KEY') return 'test-anon-key';
        if (key === 'SUPABASE_STORAGE_BUCKET') return 'test-bucket';
        return null;
      }),
    } as unknown as ConfigService;

    service = new MediaService(configService);
  });

  describe('uploadImage', () => {
    it('throws BadRequestException when file is missing or buffer is empty', async () => {
      await expect(
        service.uploadImage(null as unknown as Express.Multer.File),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.uploadImage({
          ...mockFile(),
          buffer: null as unknown as Buffer,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when file size exceeds 5MB', async () => {
      const largeFile = mockFile({ size: 6 * 1024 * 1024 });
      await expect(service.uploadImage(largeFile)).rejects.toThrow(
        'Kích thước file không được vượt quá 5MB',
      );
    });

    it('throws BadRequestException when file mimetype is not allowed', async () => {
      const pdfFile = mockFile({ mimetype: 'application/pdf' });
      await expect(service.uploadImage(pdfFile)).rejects.toThrow(
        'Định dạng ảnh không hợp lệ',
      );
    });

    it('throws InternalServerErrorException when Supabase configuration is missing', async () => {
      const badConfigService = {
        get: vi.fn().mockReturnValue(null),
      } as unknown as ConfigService;
      const unconfiguredService = new MediaService(badConfigService);

      await expect(unconfiguredService.uploadImage(mockFile())).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('successfully uploads an image and returns public URL', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ Key: 'products/file.png' }),
      } as Response);

      const result = await service.uploadImage(mockFile(), 'products');

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [calledUrl, calledOptions] = fetchSpy.mock.calls[0];
      expect(calledUrl).toContain(
        'https://test-project.supabase.co/storage/v1/object/test-bucket/products/',
      );
      expect(calledOptions?.method).toBe('POST');
      expect(calledOptions?.headers).toMatchObject({
        apikey: 'test-anon-key',
        Authorization: 'Bearer test-anon-key',
        'Content-Type': 'image/png',
      });

      expect(result.url).toContain(
        'https://test-project.supabase.co/storage/v1/object/public/test-bucket/products/',
      );
      expect(result.mimetype).toBe('image/png');
      expect(result.size).toBe(1024);
    });

    it('sanitizes malicious folder parameter', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
      } as Response);

      const result = await service.uploadImage(
        mockFile(),
        '../../malicious-folder/@!#$',
      );

      expect(result.key).toMatch(/^malicious-folder\//);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('throws BadRequestException when Supabase returns an error status', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => 'Bucket not found',
      } as Response);

      await expect(service.uploadImage(mockFile())).rejects.toThrow(
        'Không thể tải ảnh lên kho lưu trữ đám mây',
      );
    });

    it('throws InternalServerErrorException when fetch throws a network error', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(
        new Error('Connection refused'),
      );

      await expect(service.uploadImage(mockFile())).rejects.toThrow(
        'Lỗi kết nối khi tải ảnh lên kho lưu trữ',
      );
    });
  });

  describe('uploadMultipleImages', () => {
    it('throws BadRequestException when files array is empty', async () => {
      await expect(service.uploadMultipleImages([])).rejects.toThrow(
        'Vui lòng chọn ít nhất 1 file hình ảnh',
      );
    });

    it('throws BadRequestException when files count exceeds 10', async () => {
      const files = Array.from({ length: 11 }, () => mockFile());
      await expect(service.uploadMultipleImages(files)).rejects.toThrow(
        'Chỉ được tải lên tối đa 10 ảnh cùng lúc',
      );
    });

    it('successfully uploads multiple files and returns all URLs', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
      } as Response);

      const files = [mockFile(), mockFile({ mimetype: 'image/jpeg' })];
      const result = await service.uploadMultipleImages(files, 'products');

      expect(result.urls).toHaveLength(2);
      expect(result.files).toHaveLength(2);
      expect(result.urls[0]).toContain(
        '/storage/v1/object/public/test-bucket/products/',
      );
    });
  });
});
