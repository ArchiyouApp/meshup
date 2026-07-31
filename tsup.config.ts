import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'], // ESM only: the base64-inlined WASM costs ~9.3 MB per extra format
  // Declarations come from `pnpm build:dts` (plain tsc --emitDeclarationOnly), not from tsup:
  // tsup's dts build fails on this source, and tsc handles it without complaint.
  dts: false,
  splitting: false,
  sourcemap: false, // each map embedded the 9.25 MB base64 blob twice over
  clean: true,
});
