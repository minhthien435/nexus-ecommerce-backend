import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { describe, expect, it } from 'vitest';
import { CategoryEntity } from './category.entity.js';
import { ProductSkuEntity } from './product-sku.entity.js';
import { ProductEntity } from './product.entity.js';

class MetadataDataSource extends DataSource {
  buildEntityMetadatas() {
    return this.buildMetadatas();
  }
}

describe('ProductSkuEntity', () => {
  it('maps the existing catalog.product_skus table metadata', async () => {
    const dataSource = new MetadataDataSource({
      type: 'postgres',
      entities: [CategoryEntity, ProductEntity, ProductSkuEntity],
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
    expect(metadata.findColumnWithPropertyName('currency')).toMatchObject({
      type: 'varchar',
      length: '3',
    });
    expect(
      metadata.findColumnWithPropertyName('weightGrams')?.databaseName,
    ).toBe('weight_grams');
    expect(metadata.findRelationWithPropertyPath('product')?.onDelete).toBe(
      undefined,
    );
  });
});
