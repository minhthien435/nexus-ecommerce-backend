import 'reflect-metadata';
import { config } from 'dotenv';
import { DataSource } from 'typeorm';

config();

export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  ssl: ['1', 'true', 'yes'].includes(process.env.DB_SSL?.toLowerCase() ?? '')
    ? { rejectUnauthorized: false }
    : false,
  extra: {
    max: Number(process.env.DB_POOL_MAX || 10),
    idleTimeoutMillis: Number(process.env.DB_POOL_IDLE_TIMEOUT || 30000),
    connectionTimeoutMillis: Number(process.env.DB_POOL_CONN_TIMEOUT || 5000),
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
  },
  synchronize: false,
  migrationsRun: false,
  migrations: ['dist/database/migrations/*.js'],
});
