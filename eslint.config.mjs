import js from '@eslint/js';
import globals from 'globals';
import eslintReact from '@eslint-react/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';

export default [
  { ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', '**/build/**'] },

  js.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node }
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }]
    }
  },

  // React rules only apply to the frontend.
  {
    files: ['frontend/**/*.{js,jsx}'],
    ...eslintReact.configs.recommended
  },
  {
    files: ['frontend/**/*.{js,jsx}'],
    ...reactHooks.configs.flat['recommended-latest']
  },
  // Let eslint-plugin-react-hooks own the hook rules (no duplicate reports).
  {
    files: ['frontend/**/*.{js,jsx}'],
    ...eslintReact.configs['disable-conflict-eslint-plugin-react-hooks']
  },
  {
    files: ['frontend/**/*.{js,jsx}'],
    rules: {
      // Index keys are fine for the fixed, never-reordered decorative lists
      // here (chip piles, card rows); lists that do reorder use real ids.
      '@eslint-react/no-array-index-key': 'off'
    }
  },

  prettier
];
