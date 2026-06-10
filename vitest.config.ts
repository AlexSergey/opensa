import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      // Project-wide logic coverage (.ts). The .tsx UI is R3F/DOM glue, integration-tested in-browser, not here.
      exclude: [
        'src/**/*.test.ts',
        'src/**/index.ts',
        'src/**/*.interface.ts',
        'src/renderware/test-utils.ts',
        'src/standalone/**', // dev-only viewer entry scripts
      ],
      include: ['src/**/*.ts'],
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html'],
    },
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts'],
  },
});
