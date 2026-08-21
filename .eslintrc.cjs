/* eslint-env node */
module.exports = {
  root: true,
  env: { browser: true, node: true, es2022: true },
  extends: ['eslint:recommended', 'plugin:react/recommended', 'plugin:react-hooks/recommended', 'prettier'],
  parserOptions: { ecmaVersion: 2022, sourceType: 'module', ecmaFeatures: { jsx: true } },
  settings: { react: { version: 'detect' } },
  rules: {
    // React 18 + Vite use the automatic JSX runtime; the classic "import React"
    // requirement and per-prop validation are not applicable to this codebase.
    'react/react-in-jsx-scope': 'off',
    'react/prop-types': 'off'
  },
  ignorePatterns: ['node_modules', 'dist', 'coverage', 'build'],
  overrides: [
    {
      files: ['**/*.jsx', '**/*.js'],
      rules: {
        'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }]
      }
    },
    {
      files: ['**/*.test.js', '**/tests/**', 'shared/src/**'],
      env: { node: true }
    }
  ]
};
