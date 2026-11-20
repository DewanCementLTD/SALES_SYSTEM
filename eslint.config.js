// ESLint 9 flat config. ESLint 10 is not used yet: eslint-plugin-react and jsx-a11y do not support it (Nov 2026).
import js from '@eslint/js';
import globals from 'globals';
import nodePlugin from 'eslint-plugin-n';
import importX from 'eslint-plugin-import-x';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      'db/**',
      'storage/**',
    ],
  },
  js.configs.recommended,
  importX.flatConfigs.recommended,
  {
    files: ['**/*.{js,mjs,cjs,jsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
      'import-x/no-unresolved': 'off',
      'import-x/no-named-as-default-member': 'off',
      'import-x/no-named-as-default': 'off',
      'import-x/order': ['error', { 'newlines-between': 'never' }],
    },
  },
  {
    files: [
      'apps/api/**/*.js',
      'apps/worker/**/*.js',
      'apps/weighbridge-agent/**/*.js',
      'tools/**/*.js',
    ],
    plugins: { n: nodePlugin },
    rules: {
      'n/no-process-exit': 'off',
      'n/prefer-node-protocol': 'error',
    },
  },
  {
    files: ['**/cli/**/*.js', 'tools/**/*.js'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['apps/web/**/*.{js,jsx}'],
    plugins: { react, 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node },
    },
    settings: { react: { version: '19.0' } },
    rules: {
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      'react/prop-types': 'off',
    },
  },
  {
    files: ['**/*.test.js', '**/*.spec.js', '**/test/**/*.js', '**/e2e/**/*.js'],
    rules: { 'no-console': 'off' },
  },
];
