import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Launch Node directly for portability across npm on Windows, Linux and macOS.
// Force required mode even if the caller exported an optional value.
const result = spawnSync(
  process.execPath,
  [
    fileURLToPath(
      new URL('../node_modules/vitest/vitest.mjs', import.meta.url),
    ),
    'run',
    fileURLToPath(
      new URL(
        '../src/modules/identity/services/reputation-postgres.spec.ts',
        import.meta.url,
      ),
    ),
    ...process.argv.slice(2),
  ],
  {
    stdio: 'inherit',
    env: { ...process.env, REPUTATION_TEST_DATABASE_REQUIRED: '1' },
  },
);
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
