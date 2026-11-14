// A small safety net, not a style guide: it only looks for mistakes that the
// rules tests cannot see because they live in browser code - a name used
// without being imported or declared, and things declared but never used.
import globals from 'globals';

export default [
  { ignores: ['dist/**', 'dist-web/**', 'node_modules/**'] },
  {
    files: ['client/**/*.js', 'shared/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, __NET__: 'readonly', __BUILD__: 'readonly' },
    },
    rules: { 'no-undef': 'error', 'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }] },
  },
  {
    files: ['scripts/**/*.js', 'tests/**/*.js', '*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: globals.node },
    rules: { 'no-undef': 'error', 'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }] },
  },
];
