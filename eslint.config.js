import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      // Catch common bugs
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'error',          // use process.stderr.write, not console.log
      'no-debugger': 'error',

      // Prevent accidental hardcoded secrets (basic patterns)
      'no-restricted-syntax': [
        'error',
        {
          // Flag any string that looks like a private IP hardcoded directly
          selector: "Literal[value=/^(192\\.168\\.|10\\.|172\\.(1[6-9]|2[0-9]|3[01])\\.)\\d+\\.\\d+$/]",
          message: 'Do not hardcode private IP addresses. Use environment variables instead.',
        },
        {
          // Flag password-like string assignments
          selector: "Property[key.name=/^(password|passwd|secret|apiKey|api_key|token)$/] > Literal",
          message: 'Do not hardcode secrets. Use environment variables instead.',
        },
      ],
    },
  },
];
