import { defineConfig } from 'tsup';

// One self-contained ESM file (app + workspace packages + npm deps, including
// the Prisma client and its WASM query compiler), so the runtime image needs
// no node_modules for the app itself.
export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  outExtension: () => ({ js: '.mjs' }),
  clean: true,
  splitting: false,
  sourcemap: true,
  noExternal: [/.*/],
  // grammY's fetch shim checks constructor names (AbortSignal); don't let esbuild rename them.
  keepNames: true,
  // Bundled CommonJS dependencies still call require() for Node built-ins.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
