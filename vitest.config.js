import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    include: [
      'shared/tests/**/*.test.js',
      'server/tests/**/*.test.js',
      'frontend/tests/**/*.test.js',
      'frontend/tests/**/*.test.jsx'
    ],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['shared/src/**/*.js']
    }
  }
});
