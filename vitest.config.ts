import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      exclude: ['src/renderware/**/*.test.ts', 'src/renderware/test-utils.ts', 'src/renderware/index.ts'],
      include: ['src/renderware/**/*.ts'],
      provider: 'v8',
    },
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts'],
  },
});
