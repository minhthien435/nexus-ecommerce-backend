import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`.
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    // Only this checkout's test roots; ignored nested worktrees are independent suites.
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
  },
});
