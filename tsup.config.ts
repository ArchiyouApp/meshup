import { defineConfig } from 'tsup';
import { copyFile, mkdir } from 'node:fs/promises';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'], // ESM only: the base64-inlined WASM costs ~9.3 MB per extra format
  dts: true, // Generate declaration file (.d.ts)
  // MUST stay true. src/loader.ts reaches the base64 kernel through a dynamic
  // import so it lands in its own lazy chunk, only fetched when the .wasm file
  // could not be used. With splitting off esbuild inlines that import straight
  // back into index.js behind a lazy __esm initializer — the evaluation is
  // deferred but the 7.8 MB of bytes are not, and the file path saves published
  // consumers nothing.
  splitting: true,
  sourcemap: false, // each map embedded the 9.25 MB base64 blob twice over
  clean: true,
  // dist/index.js resolves `new URL('./wasm/meshup_bg.wasm', import.meta.url)`
  // relative to dist/, so the binary has to sit there too. esbuild does not
  // rewrite that expression, and consumer bundlers resolve it at BUILD time —
  // a missing file is their build error, not a runtime fallback.
  onSuccess: async () =>
  {
    await mkdir('dist/wasm', { recursive: true });
    await copyFile('src/wasm/meshup_bg.wasm', 'dist/wasm/meshup_bg.wasm');
  },
});
