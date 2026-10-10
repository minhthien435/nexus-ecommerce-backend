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
  synchronize: false,
  migrationsRun: false,
  migrations: ['dist/database/migrations/*.js'],
});
