import type {
  CanActivate,
  ExecutionContext,
  INestApplication,
} from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessTokenGuard } from '../../identity/auth/guards/access-token.guard.js';
import { PermissionsGuard } from '../../identity/rbac/guards/permissions.guard.js';
import { RolesGuard } from '../../identity/rbac/guards/roles.guard.js';
import { SellerBulkImportService } from '../services/seller-bulk-import.service.js';
import { SellerProductService } from '../services/seller-product.service.js';
import { SellerProductController } from './seller-product.controller.js';

const sellerId = '11111111-1111-4111-8111-111111111111';

@Injectable()
class TestAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    context.switchToHttp().getRequest().user = { id: sellerId };
    return true;
  }
}

describe('SellerProductController bulk HTTP contract', () => {
  let app: INestApplication;
  const bulk = { template: vi.fn(), import: vi.fn() };

  beforeEach(async () => {
    bulk.template.mockReturnValue(Buffer.from('\uFEFFname'));
    bulk.import.mockResolvedValue({ importedCount: 1, errors: [] });
    const module = await Test.createTestingModule({
      controllers: [SellerProductController],
      providers: [
        { provide: SellerProductService, useValue: {} },
        { provide: SellerBulkImportService, useValue: bulk },
      ],
    })
      .overrideGuard(AccessTokenGuard)
      .useClass(TestAuthGuard)
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    vi.clearAllMocks();
  });

  it('serves the template with download headers', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/catalog/seller/products/bulk/template')
      .expect(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain(
      'product-import-template.csv',
    );
  });

  it('accepts POST bulk and delegates the in-memory CSV buffer', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/catalog/seller/products/bulk')
      .attach('file', Buffer.from('a,b'), {
        filename: 'products.csv',
        contentType: 'text/csv',
      })
      .expect(201);
    expect(bulk.import).toHaveBeenCalledWith(sellerId, expect.any(Buffer));
    await request(app.getHttpServer())
      .post('/api/v1/catalog/seller/products/bulk/import')
      .attach('file', Buffer.from('a,b'), {
        filename: 'products.csv',
        contentType: 'text/csv',
      })
      .expect(404);
  });

  it('rejects missing, non-CSV, and oversized uploads', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/catalog/seller/products/bulk')
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/catalog/seller/products/bulk')
      .attach('file', Buffer.from('text'), {
        filename: 'products.txt',
        contentType: 'text/plain',
      })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/catalog/seller/products/bulk')
      .attach('file', Buffer.alloc(5 * 1024 * 1024 + 1), {
        filename: 'products.csv',
        contentType: 'text/csv',
      })
      .expect(413);
    expect(bulk.import).not.toHaveBeenCalled();
  });
});
