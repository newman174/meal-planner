import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'public/**/*.js'],
      exclude: ['src/types/**'],
    },
    pool: 'forks', // Sequential execution for database tests
    environmentMatchGlobs: [
      ['tests/frontend/**', 'jsdom'],
    ],
  },
});
