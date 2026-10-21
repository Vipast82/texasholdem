import { defineConfig } from 'vitest/config';

// Vite 8 compiles JSX natively (automatic runtime), so no React plugin is needed
// for tests. The frontend's own vite.config.js still uses @vitejs/plugin-react
// for dev-server Fast Refresh.
export default defineConfig({
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
