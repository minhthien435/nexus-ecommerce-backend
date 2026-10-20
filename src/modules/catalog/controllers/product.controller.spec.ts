import { ProductController } from './product.controller.js';
import type { ProductSearchService } from '../services/product-search.service.js';
import { SearchProductsQueryDto } from '../dtos/search-products-query.dto.js';

describe('ProductController', () => {
  const products = { search: vi.fn(), getBySlug: vi.fn() };
  const controller = new ProductController(
    products as unknown as ProductSearchService,
  );

  beforeEach(() => vi.clearAllMocks());

  it('returns the documented paginated envelope', async () => {
    products.search.mockResolvedValue({
      items: [{ id: 'product-1' }],
      meta: { page: 1, limit: 20, totalItems: 1, totalPages: 1 },
      facets: { categories: [] },
    });

    await expect(
      controller.search(new SearchProductsQueryDto()),
    ).resolves.toEqual({
      success: true,
      statusCode: 200,
      message: 'Lấy danh sách sản phẩm thành công',
      data: [{ id: 'product-1' }],
      meta: { page: 1, limit: 20, totalItems: 1, totalPages: 1 },
      facets: { categories: [] },
    });
  });

  it('returns the documented detail envelope', async () => {
    products.getBySlug.mockResolvedValue({ id: 'product-1' });
    await expect(controller.getBySlug('phone')).resolves.toMatchObject({
      success: true,
      statusCode: 200,
      data: { id: 'product-1' },
    });
  });
});
