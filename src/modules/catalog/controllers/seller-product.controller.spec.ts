import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductStatus } from '../domain/entities/product.entity.js';
import { SellerProductController } from './seller-product.controller.js';

describe('SellerProductController', () => {
  let controller: SellerProductController;
  let service: any;
  let bulkImport: any;

  beforeEach(() => {
    service = {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      setStatus: vi.fn(),
      remove: vi.fn(),
    };
    bulkImport = { template: vi.fn(), import: vi.fn() };
    controller = new SellerProductController(service, bulkImport);
  });

  it('always passes the token-derived actor to seller operations', async () => {
    const query = { page: 1, limit: 20 };
    await controller.list(query, 'seller-1');
    await controller.get('product-1', 'seller-1');
    await controller.setStatus(
      'product-1',
      { status: ProductStatus.ACTIVE },
      'seller-1',
    );
    expect(service.list).toHaveBeenCalledWith('seller-1', query);
    expect(service.get).toHaveBeenCalledWith('product-1', 'seller-1');
    expect(service.setStatus).toHaveBeenCalledWith(
      'product-1',
      ProductStatus.ACTIVE,
      'seller-1',
    );
  });

  it('uses soft-delete service flow', async () => {
    await controller.remove('product-1', 'seller-1');
    expect(service.remove).toHaveBeenCalledWith('product-1', 'seller-1');
  });

  it('declares static GET bulk/template and POST bulk routes before :id handlers', () => {
    expect(Reflect.getMetadata(PATH_METADATA, controller.template)).toBe(
      'bulk/template',
    );
    expect(Reflect.getMetadata(METHOD_METADATA, controller.template)).toBe(
      RequestMethod.GET,
    );
    expect(Reflect.getMetadata(PATH_METADATA, controller.importCsv)).toBe(
      'bulk',
    );
    expect(Reflect.getMetadata(METHOD_METADATA, controller.importCsv)).toBe(
      RequestMethod.POST,
    );
  });

  it('sets CSV download headers and delegates uploads with actor identity', async () => {
    const buffer = Buffer.from('template');
    bulkImport.template.mockReturnValue(buffer);
    bulkImport.import.mockResolvedValue({ importedCount: 1, errors: [] });
    const response = { setHeader: vi.fn(), send: vi.fn() };
    controller.template(response as never);
    expect(response.send).toHaveBeenCalledWith(buffer);
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'text/csv; charset=utf-8',
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="product-import-template.csv"',
    );
    const upload = { buffer: Buffer.from('csv') } as Express.Multer.File;
    await controller.importCsv(upload, 'seller-1');
    expect(bulkImport.import).toHaveBeenCalledWith('seller-1', upload.buffer);
  });
});
