import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/** GitHub Pages serves this project from https://mustafaobaidd1.github.io/fixture-league-scheduler/ */
export const REPO = 'fixture-league-scheduler';

export default defineConfig({
  // Same base path in dev, preview and production, so path bugs show up locally.
  base: `/${REPO}/`,
  plugins: [react()],
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  // The solver runs in a module worker; emit it as an ES module chunk under the same base path.
  worker: { format: 'es' },
  server: { port: 5305, strictPort: true },
  preview: { port: 5405, strictPort: true },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
  },
});
