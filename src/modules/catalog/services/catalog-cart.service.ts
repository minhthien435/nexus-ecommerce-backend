import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { CatalogCartApi } from '../catalog-cart.api.js';
import type { CartSku } from '../catalog-cart.api.js';
import { ProductEntity } from '../domain/entities/product.entity.js';
import { ProductSkuEntity } from '../domain/entities/product-sku.entity.js';

@Injectable()
export class CatalogCartService extends CatalogCartApi {
  constructor(
    @InjectRepository(ProductEntity)
    private readonly products: Repository<ProductEntity>,
  ) {
    super();
  }

  async getCartSkus(
    skuIds: string[],
    manager?: EntityManager,
  ): Promise<CartSku[]> {
    if (skuIds.length === 0) return [];
    // Include deleted products so Commerce can display discontinued cart lines.
    return (manager ? manager.getRepository(ProductEntity) : this.products)
      .createQueryBuilder('product')
      .withDeleted()
      .innerJoin(ProductSkuEntity, 'sku', 'sku.product_id = product.id')
      .select('sku.id', 'id')
      .addSelect('sku.product_id', 'productId')
      .addSelect('product.seller_id', 'sellerId')
      .addSelect('sku.sku_code', 'skuCode')
      .addSelect('sku.variant_attributes', 'variantAttributes')
      .addSelect('sku.price::text', 'price')
      .addSelect('sku.weight_grams', 'weightGrams')
      .addSelect('sku.currency', 'currency')
      .addSelect('sku.is_active', 'isActive')
      .addSelect('product.name', 'productName')
      .addSelect('product.slug', 'productSlug')
      .addSelect('product.status', 'productStatus')
      .addSelect('product.deletedAt', 'productDeletedAt')
      .addSelect(
        '(SELECT pi.url FROM catalog.product_images pi WHERE pi.product_id = product.id ORDER BY pi.is_primary DESC, pi.sort_order ASC, pi.id ASC LIMIT 1)',
        'primaryImageUrl',
      )
      .where('sku.id IN (:...skuIds)', { skuIds })
      .getRawMany<CartSku>();
  }
}
