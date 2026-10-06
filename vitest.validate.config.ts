import { defineConfig } from 'vitest/config';

/** `npm run validate`: slower validation runs whose numbers are recorded in the README. */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['validate/**/*.validate.ts'],
    testTimeout: 1_800_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
