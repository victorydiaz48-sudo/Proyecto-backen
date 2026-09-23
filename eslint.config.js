import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // El generador HTML es un archivo autocontenido con su propio estilo; no se toca hasta la Fase 13.
    ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', 'apps/api/src/generated/**', '*.html'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: globals.node,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      // Fastify usa funciones async para plugins y hooks aunque no esperen nada (así señalan que no usan done()).
      '@typescript-eslint/require-await': 'off',
      'no-restricted-syntax': [
        'error',
        {
          // Consultas SQL crudas sin parametrizar: usar $queryRaw/$executeRaw con template tag.
          selector: "CallExpression[callee.property.name=/^\\$(queryRawUnsafe|executeRawUnsafe)$/]",
          message: 'Prohibido SQL sin parametrizar. Usa $queryRaw`...` / $executeRaw`...`.',
        },
      ],
    },
  },
  {
    // En los tests, res.json() devuelve `any` a propósito: se comprueba la forma con expect().
    files: ['**/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },
  {
    files: ['eslint.config.js'],
    ...tseslint.configs.disableTypeChecked,
  },
);
