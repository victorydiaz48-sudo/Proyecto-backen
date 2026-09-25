import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// En desarrollo, /api se reenvía a la API (npm run dev -w apps/api). En producción, la misma API sirve
// este build desde / (un solo despliegue, mismo origen: la cookie de sesión funciona sin CORS).
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:3000' } },
  build: { outDir: 'dist', sourcemap: false },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
    // Las pantallas se prueban además en Chromium (apps/api/test/panel-e2e.test.ts).
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/main.tsx'],
      reporter: ['text-summary', 'html'],
      thresholds: { statements: 60, branches: 50, functions: 50, lines: 60 },
    },
  },
});
