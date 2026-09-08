import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

export default [
  { ignores: ['.next/**', 'node_modules/**', 'dist-worker/**', 'src/generated/**'] },
  js.configs.recommended,
  {
    // Node scripts and config files run outside the browser.
    files: ['**/*.mjs', 'scripts/**/*.{js,mjs}', '*.config.{js,mjs,ts}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { process: 'readonly', console: 'readonly', Buffer: 'readonly', crypto: 'readonly' },
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsparser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
      globals: {
        console: 'readonly', process: 'readonly', fetch: 'readonly', URL: 'readonly',
        Buffer: 'readonly', crypto: 'readonly', Response: 'readonly', Request: 'readonly',
      },
    },
    plugins: { '@typescript-eslint': tseslint },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-undef': 'off',
    },
  },
  {
    // The raw Prisma client must only be reachable through src/server/db,
    // so no query can accidentally bypass withTenant().
    files: ['src/**/*.ts', 'app/**/*.ts', 'app/**/*.tsx'],
    ignores: ['src/server/db/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@prisma/client',
              importNames: ['PrismaClient'],
              message: 'Import from @/server/db instead — every query must go through withTenant().',
            },
          ],
        },
      ],
    },
  },
];
