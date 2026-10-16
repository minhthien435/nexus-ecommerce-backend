import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ProductController } from '../src/modules/catalog/controllers/product.controller.js';
import { ProductSearchService } from '../src/modules/catalog/services/product-search.service.js';

describe('Catalog products API (e2e)', () => {
  let app: INestApplication;
  const products = {
    search: vi.fn(),
    getBySlug: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [ProductController],
      providers: [{ provide: ProductSearchService, useValue: products }],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });

  afterEach(async () => app.close());

  it('GET /api/v1/catalog/products returns data and pagination meta', async () => {
    products.search.mockResolvedValue({
      items: [{ id: 'product-1', name: 'Phone' }],
      meta: { page: 1, limit: 10, totalItems: 1, totalPages: 1 },
    });

    await request(app.getHttpServer())
      .get('/api/v1/catalog/products?keyword=phone&page=1&limit=10')
      .expect(200)
      .expect({
        success: true,
        statusCode: 200,
        message: 'Lấy danh sách sản phẩm thành công',
        data: [{ id: 'product-1', name: 'Phone' }],
        meta: { page: 1, limit: 10, totalItems: 1, totalPages: 1 },
      });
    expect(products.search).toHaveBeenCalledWith(
      expect.objectContaining({ keyword: 'phone', page: 1, limit: 10 }),
    );
  });

  it('GET /api/v1/catalog/products rejects invalid query values', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/catalog/products?page=0&sort=popular')
      .expect(400);
    expect(products.search).not.toHaveBeenCalled();
  });

  it('GET /api/v1/catalog/products/:slug returns product details', async () => {
    products.getBySlug.mockResolvedValue({
      id: 'product-1',
      slug: 'phone',
      images: [],
      skus: [],
    });
    await request(app.getHttpServer())
      .get('/api/v1/catalog/products/phone')
      .expect(200)
      .expect((response) => {
        expect(response.body.data).toMatchObject({
          id: 'product-1',
          slug: 'phone',
        });
      });
  });
});
