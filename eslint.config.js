import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/dist-host/**',
      '**/node_modules/**',
      'packages/client/src/generated/**',
      'packages/client/scripts/**/*.mjs',
      'eslint.config.js',
      'scripts/**/*.mjs',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
      '@typescript-eslint/no-confusing-void-expression': 'off',
    },
  },
  {
    files: ['**/*.d.ts'],
    rules: {
      '@typescript-eslint/consistent-type-definitions': 'off',
    },
  },
  {
    files: ['apps/*/src/**/*.{ts,tsx}', 'packages/*/src/**/*.{ts,tsx}'],
    rules: {
      'max-lines': [
        'error',
        { max: 1250, skipBlankLines: false, skipComments: false },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^\\.{1,2}/(?!.*\\.(?:ts|tsx|json)$).*$',
              message:
                'Relative source imports must name a .ts, .tsx, or .json extension; compilation rewrites TypeScript extensions to JavaScript.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/*/test/**/*.{ts,tsx}', 'packages/*/test/**/*.{ts,tsx}'],
    rules: {
      'max-lines': [
        'error',
        { max: 2500, skipBlankLines: false, skipComments: false },
      ],
    },
  },
);
