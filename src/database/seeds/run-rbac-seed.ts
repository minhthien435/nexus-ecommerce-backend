import dataSource from '../data-source.js';
import { seedRbac } from './rbac.seed.js';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main(): Promise<void> {
  const admin = {
    email: required('SEED_ADMIN_EMAIL').toLowerCase(),
    password: required('SEED_ADMIN_PASSWORD'),
    fullName: process.env.SEED_ADMIN_FULL_NAME?.trim() || 'Nexus Administrator',
  };

  await dataSource.initialize();
  try {
    await dataSource.transaction((manager) => seedRbac(manager, admin));
    console.log('RBAC seed completed successfully');
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(
    'RBAC seed failed:',
    error instanceof Error ? error.message : 'Unknown error',
  );
  process.exitCode = 1;
});
