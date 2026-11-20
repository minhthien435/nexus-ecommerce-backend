import { randomUUID } from 'node:crypto';
import { DataSource, type DataSourceOptions } from 'typeorm';

// Set TEST_POSTGRES_URL to a local PostgreSQL role with CREATEDB.
const serverUrl = process.env.TEST_POSTGRES_URL;
export const hasTestPostgres = Boolean(serverUrl);

export async function createTestPostgres(
  options: Pick<DataSourceOptions, 'entities'> = {},
) {
  const url = new URL(serverUrl ?? '');
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.search
  ) {
    throw new Error('Integration tests require a loopback PostgreSQL URL');
  }
  const database = 'nexus_test_' + randomUUID().replaceAll('-', '');
  const admin = await new DataSource({
    type: 'postgres',
    url: url.href,
  }).initialize();
  url.pathname = '/' + database;
  const db = new DataSource({ type: 'postgres', url: url.href, ...options });
  let created = false;
  async function close() {
    try {
      if (db.isInitialized) await db.destroy();
      if (created) await admin.query('DROP DATABASE ' + database);
    } finally {
      await admin.destroy();
    }
  }
  try {
    await admin.query('CREATE DATABASE ' + database);
    created = true;
    await db.initialize();
    return { db, close };
  } catch (error) {
    await close();
    throw error;
  }
}
