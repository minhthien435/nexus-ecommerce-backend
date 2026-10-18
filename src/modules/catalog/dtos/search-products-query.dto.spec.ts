import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SearchProductsQueryDto } from './search-products-query.dto.js';

describe('SearchProductsQueryDto', () => {
  it('normalizes valid query parameters', async () => {
    const dto = plainToInstance(SearchProductsQueryDto, {
      keyword: '  điện thoại  ',
      minPrice: '1000',
      maxPrice: '2000.50',
      sort: 'price_asc',
      page: '2',
      limit: '10',
    });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto).toMatchObject({
      keyword: 'điện thoại',
      minPrice: 1000,
      maxPrice: 2000.5,
      sort: 'price_asc',
      page: 2,
      limit: 10,
    });
  });

  it('rejects invalid pagination, UUID, price and sort values', async () => {
    const dto = plainToInstance(SearchProductsQueryDto, {
      categoryId: 'not-a-uuid',
      minPrice: '-1',
      sort: 'popular',
      page: '0',
      limit: '101',
    });

    const fields = (await validate(dto)).map(({ property }) => property);
    expect(fields).toEqual(
      expect.arrayContaining([
        'categoryId',
        'minPrice',
        'sort',
        'page',
        'limit',
      ]),
    );
  });
});
