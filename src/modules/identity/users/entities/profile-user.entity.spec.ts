import { DataSource } from 'typeorm';
import { ProfileUserEntity } from './profile-user.entity.js';

class MetadataDataSource extends DataSource {
  build() {
    return this.buildMetadatas();
  }
}

describe('ProfileUserEntity', () => {
  it('maps profile columns but never maps password_hash', async () => {
    const dataSource = new MetadataDataSource({
      type: 'postgres',
      entities: [ProfileUserEntity],
    });
    await dataSource.build();
    const columns = dataSource.getMetadata(ProfileUserEntity).columns;
    expect(
      columns.find(({ databaseName }) => databaseName === 'avatar_url')?.length,
    ).toBe('2048');
    expect(columns.map(({ databaseName }) => databaseName)).not.toContain(
      'password_hash',
    );
  });
});
