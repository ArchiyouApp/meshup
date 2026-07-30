import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'], // ESM only: the base64-inlined WASM costs ~9.3 MB per extra format
  dts: true, // Generate declaration file (.d.ts)
  splitting: false,
  sourcemap: false, // each map embedded the 9.25 MB base64 blob twice over
  clean: true,
});
