import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    reporters: ['verbose'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.js'],
      exclude: [
        'node_modules/',
        'src/__tests__/**',
        '*.config.js',
      ],
      lines: 70,
      functions: 70,
      branches: 60,
      statements: 70,
    },
    setupFiles: [],
  },
});
