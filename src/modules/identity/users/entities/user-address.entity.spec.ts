import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { UserAddressEntity } from './user-address.entity.js';

class MetadataDataSource extends DataSource {
  buildEntityMetadatas() {
    return this.buildMetadatas();
  }
}

describe('UserAddressEntity', () => {
  it('maps the existing identity.user_addresses table metadata', async () => {
    const dataSource = new MetadataDataSource({
      type: 'postgres',
      entities: [UserAddressEntity],
    });

    await dataSource.buildEntityMetadatas();
    const metadata = dataSource.getMetadata(UserAddressEntity);

    expect(metadata.schema).toBe('identity');
    expect(metadata.tableName).toBe('user_addresses');

    const expectedColumns = {
      id: { databaseName: 'id', type: 'uuid', isNullable: false },
      userId: { databaseName: 'user_id', type: 'uuid', isNullable: false },
      recipientName: {
        databaseName: 'recipient_name',
        type: 'varchar',
        length: '150',
        isNullable: false,
      },
      recipientPhone: {
        databaseName: 'phone',
        type: 'varchar',
        length: '30',
        isNullable: false,
      },
      addressLine: {
        databaseName: 'address_line',
        type: 'text',
        isNullable: false,
      },
      provinceCode: {
        databaseName: 'province_code',
        type: 'varchar',
        length: '50',
        isNullable: true,
      },
      districtCode: {
        databaseName: 'district_code',
        type: 'varchar',
        length: '50',
        isNullable: true,
      },
      wardCode: {
        databaseName: 'ward_code',
        type: 'varchar',
        length: '50',
        isNullable: true,
      },
      isDefault: {
        databaseName: 'is_default',
        type: 'boolean',
        isNullable: false,
      },
      createdAt: {
        databaseName: 'created_at',
        type: 'timestamptz',
        isNullable: false,
      },
      updatedAt: {
        databaseName: 'updated_at',
        type: 'timestamptz',
        isNullable: false,
      },
    };

    for (const [propertyName, expected] of Object.entries(expectedColumns)) {
      const column = metadata.findColumnWithPropertyName(propertyName);
      expect(column).toBeDefined();
      expect(column).toMatchObject(expected);
    }

    expect(metadata.findColumnWithPropertyName('isDefault')?.default).toBe(
      false,
    );
  });
});
