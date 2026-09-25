import { defineConfig } from 'tsup';

// Bundle the app together with workspace packages and npm deps into one file,
// so the runtime image needs no node_modules.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  noExternal: [/.*/],
  // grammY's fetch shim checks constructor names (AbortSignal); don't let esbuild rename them.
  keepNames: true,
});
