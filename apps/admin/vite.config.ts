import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// En desarrollo, /api se reenvía a la API (npm run dev -w apps/api). En producción, la misma API sirve
// este build desde / (un solo despliegue, mismo origen: la cookie de sesión funciona sin CORS).
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:3000' } },
  build: { outDir: 'dist', sourcemap: false },
  test: { environment: 'jsdom', include: ['test/**/*.test.{ts,tsx}'] },
});
