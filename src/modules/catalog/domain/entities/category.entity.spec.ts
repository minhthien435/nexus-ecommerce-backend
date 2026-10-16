import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { describe, expect, it } from 'vitest';
import { CategoryEntity } from './category.entity.js';

class MetadataDataSource extends DataSource {
  buildEntityMetadatas() {
    return this.buildMetadatas();
  }
}

describe('CategoryEntity', () => {
  it('maps the existing catalog.categories table metadata', async () => {
    const dataSource = new MetadataDataSource({
      type: 'postgres',
      entities: [CategoryEntity],
    });

    await dataSource.buildEntityMetadatas();
    const metadata = dataSource.getMetadata(CategoryEntity);

    expect(metadata.schema).toBe('catalog');
    expect(metadata.tableName).toBe('categories');

    const idCol = metadata.findColumnWithPropertyName('id');
    expect(idCol?.databaseName).toBe('id');
    expect(idCol?.isPrimary).toBe(true);

    const parentIdCol = metadata.findColumnWithPropertyName('parentId');
    expect(parentIdCol?.databaseName).toBe('parent_id');
    expect(parentIdCol?.isNullable).toBe(true);

    const nameCol = metadata.findColumnWithPropertyName('name');
    expect(nameCol?.databaseName).toBe('name');

    const slugCol = metadata.findColumnWithPropertyName('slug');
    expect(slugCol?.databaseName).toBe('slug');

    const levelCol = metadata.findColumnWithPropertyName('level');
    expect(levelCol?.databaseName).toBe('level');

    const sortOrderCol = metadata.findColumnWithPropertyName('sortOrder');
    expect(sortOrderCol?.databaseName).toBe('sort_order');

    const isActiveCol = metadata.findColumnWithPropertyName('isActive');
    expect(isActiveCol?.databaseName).toBe('is_active');
  });
});
