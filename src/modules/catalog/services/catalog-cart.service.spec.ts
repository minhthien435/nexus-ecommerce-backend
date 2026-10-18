import { CatalogCartService } from './catalog-cart.service.js';
import { ProductSkuEntity } from '../domain/entities/product-sku.entity.js';
import { ProductEntity } from '../domain/entities/product.entity.js';

describe('CatalogCartService', () => {
  function setup() {
    const query = {
      withDeleted: vi.fn(),
      innerJoin: vi.fn(),
      select: vi.fn(),
      addSelect: vi.fn(),
      where: vi.fn(),
      getRawMany: vi.fn(),
    };
    for (const method of [
      'withDeleted',
      'innerJoin',
      'select',
      'addSelect',
      'where',
    ] as const)
      query[method].mockReturnValue(query);
    const repository = { createQueryBuilder: vi.fn().mockReturnValue(query) };
    return {
      query,
      repository,
      service: new CatalogCartService(repository as never),
    };
  }
  it('returns decimal strings and includes unavailable products for cart warnings', async () => {
    const s = setup();
    const rows = [{ id: 'sku', price: '12.34', productStatus: 'DRAFT' }];
    s.query.getRawMany.mockResolvedValue(rows);
    expect(await s.service.getCartSkus(['sku'])).toEqual(rows);
    expect(s.query.withDeleted).toHaveBeenCalled();
    expect(s.query.innerJoin).toHaveBeenCalledWith(
      ProductSkuEntity,
      'sku',
      'sku.product_id = product.id',
    );
    expect(s.query.addSelect).toHaveBeenCalledWith('sku.price::text', 'price');
    expect(s.query.addSelect).toHaveBeenCalledWith(
      'product.seller_id',
      'sellerId',
    );
    expect(s.query.where).toHaveBeenCalledWith('sku.id IN (:...skuIds)', {
      skuIds: ['sku'],
    });
  });
  it('does not query when the cart is empty', async () => {
    const s = setup();
    expect(await s.service.getCartSkus([])).toEqual([]);
    expect(s.repository.createQueryBuilder).not.toHaveBeenCalled();
  });
  it('uses only the supplied manager repository, propagating its failures', async () => {
    const s = setup();
    const manager = { getRepository: vi.fn().mockReturnValue(s.repository) };
    const service = new CatalogCartService({
      createQueryBuilder: () => {
        throw new Error('default repository reached');
      },
    } as never);
    s.query.getRawMany.mockResolvedValue([{ id: 'sku', sellerId: 'seller' }]);
    expect(await service.getCartSkus(['sku'], manager as never)).toEqual([
      { id: 'sku', sellerId: 'seller' },
    ]);
    expect(manager.getRepository).toHaveBeenCalledWith(ProductEntity);
    s.query.getRawMany.mockRejectedValue(new Error('context failure'));
    await expect(
      service.getCartSkus(['sku'], manager as never),
    ).rejects.toThrow('context failure');
  });
});
