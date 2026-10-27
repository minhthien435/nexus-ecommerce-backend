import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { describe, expect, it } from 'vitest';
import { CategoryEntity } from './category.entity.js';
import { ProductSkuEntity } from './product-sku.entity.js';
import { ProductEntity } from './product.entity.js';
import { ProductImageEntity } from './product-image.entity.js';

class MetadataDataSource extends DataSource {
  buildEntityMetadatas() {
    return this.buildMetadatas();
  }
}

describe('ProductSkuEntity', () => {
  it('maps the existing catalog.product_skus table metadata', async () => {
    const dataSource = new MetadataDataSource({
      type: 'postgres',
      entities: [
        CategoryEntity,
        ProductEntity,
        ProductSkuEntity,
        ProductImageEntity,
      ],
    });

    await dataSource.buildEntityMetadatas();
    const metadata = dataSource.getMetadata(ProductSkuEntity);

    expect(metadata.schema).toBe('catalog');
    expect(metadata.tableName).toBe('product_skus');
    expect(metadata.findColumnWithPropertyName('skuCode')?.databaseName).toBe(
      'sku_code',
    );
    expect(
      metadata.uniques.some((unique) =>
        unique.columns.some((column) => column.propertyName === 'skuCode'),
      ),
    ).toBe(true);
    expect(metadata.findColumnWithPropertyName('attributes')).toMatchObject({
      databaseName: 'variant_attributes',
      type: 'jsonb',
      isNullable: false,
    });
    expect(
      metadata.columns.filter(
        (column) => column.databaseName === 'variant_attributes',
      ),
    ).toHaveLength(1);
    expect(
      metadata.findColumnWithPropertyName('variantAttributes'),
    ).toBeUndefined();
    expect(metadata.findColumnWithPropertyName('price')).toMatchObject({
      type: 'numeric',
      precision: 18,
      scale: 2,
      isNullable: false,
    });
    expect(metadata.findColumnWithPropertyName('originalPrice')).toMatchObject({
      databaseName: 'original_price',
      type: 'numeric',
      precision: 18,
      scale: 2,
      isNullable: true,
    });
    expect(metadata.findColumnWithPropertyName('currency')).toMatchObject({
      type: 'varchar',
      length: '3',
    });
    expect(
      metadata.findColumnWithPropertyName('weightGrams')?.databaseName,
    ).toBe('weight_grams');
    expect(
      metadata.findColumnWithPropertyName('weightGrams')?.default,
    ).toBeUndefined();
    for (const property of ['lengthCm', 'widthCm', 'heightCm']) {
      expect(metadata.findColumnWithPropertyName(property)).toMatchObject({
        type: 'numeric',
        precision: 8,
        scale: 2,
        isNullable: false,
      });
    }
    const relation = metadata.findRelationWithPropertyPath('product');
    expect(relation?.inverseEntityMetadata.target).toBe(ProductEntity);
    expect(relation?.joinColumns.map((column) => column.databaseName)).toEqual([
      'product_id',
    ]);
    expect(
      metadata.columns.filter((column) => column.databaseName === 'product_id'),
    ).toHaveLength(1);
    expect(metadata.findRelationWithPropertyPath('product')?.onDelete).toBe(
      undefined,
    );
  });
});
