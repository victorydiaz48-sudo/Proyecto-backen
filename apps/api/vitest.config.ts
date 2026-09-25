import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/helpers/global-setup.ts'],
    // Los tests de integración comparten una única BD de test: se ejecutan de uno en uno.
    fileParallelism: false,
    testTimeout: 20_000,
    // Umbral mínimo (npm run test:coverage, en CI): si la cobertura baja, CI falla.
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      // Código generado por Prisma; los puntos de entrada se prueban como procesos (test/entrypoints.test.ts).
      exclude: ['src/generated/**', 'src/server.ts', 'src/cli/**'],
      reporter: ['text-summary', 'html'],
      thresholds: { statements: 90, branches: 83, functions: 95, lines: 90 },
    },
    hookTimeout: 60_000,
  },
});
