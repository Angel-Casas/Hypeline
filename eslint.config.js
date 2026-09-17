import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import pluginVue from 'eslint-plugin-vue';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist/**', 'dev-dist/**', 'node_modules/**', 'spikes/**', 'coverage/**', 'public/**', 'e2e/fixtures/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['**/*.vue', 'src/**/*.ts'],
    languageOptions: { parserOptions: { parser: tseslint.parser }, globals: { ...globals.browser } },
  },
  {
    files: ['scripts/**/*.mjs', 'e2e/**/*.mjs', 'shim/**/*.js', 'shim/**/*.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ['src/**/*.ts', '**/*.vue'],
    rules: { 'no-undef': 'off' }, // TypeScript checks this; ESLint's no-undef misfires on DOM types
  },
  {
    rules: {
      'vue/multi-word-component-names': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  prettier,
);
