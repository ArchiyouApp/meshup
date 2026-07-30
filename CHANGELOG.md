# Changelog

All notable changes to `@archiyou/meshup` are documented here.
This project follows [semantic versioning](https://semver.org/); while on 0.x, minor
versions may contain breaking changes.

## 0.1.0

First published release. Previously the package was private to the Archiyou monorepo and
was never installable from npm.

### Packaging

- **Renamed to `@archiyou/meshup`** (was the unscoped, unpublished `meshup`), published with
  `publishConfig.access: public`.
- **Fixed the export map**, which could not resolve at all:
  - `module`/`exports.import` pointed at `dist/index.mjs`, a file the build never emitted,
    so `import 'meshup'` failed with `ERR_MODULE_NOT_FOUND`.
  - `exports.require` pointed at the ESM bundle.
  - The `types` condition was listed last, so it never matched.
- **ESM only.** Dropped the CommonJS output and sourcemaps. Because the WASM kernel is
  base64-inlined, every extra format cost ~9.3 MB: the tarball went from 14.4 MB packed /
  39 MB unpacked to **7.2 MB packed / 19.4 MB unpacked**.
- **The `src/*` subpath now actually resolves in the tarball.** `files` excluded `src/`
  while `exports` advertised `./src/*`, so the subpath was dead on npm. The sources now
  ship, and the export patterns are explicit (`./src/*.ts`, `./src/*.js`, `./src/*`) — an
  array fallback would have resolved in bundlers but not in Node. Treat `src/*` as internal.
- `src/wasm/meshup_bg.wasm` (6.9 MB) and the nested wasm-pack `package.json` (a second
  manifest claiming the name `meshup` under MIT) are no longer published. The kernel bytes
  travel as base64 inside `dist/index.js`.
- Added `repository`, `homepage`, `bugs`, `engines` (`node >= 20.19`), `keywords`.

### Licensing

- Added `NOTICE` and `THIRD-PARTY-NOTICES.txt`, and the package now ships
  `src/wasm/LICENSE`. The published bundle contains a WebAssembly binary compiled from
  MIT-licensed csgrs code (© Timothy Schmidt, deriving from csg.js © Evan Wallace), and no
  MIT notice was being redistributed with it. The package itself remains Apache-2.0.

### Build correctness

- `pnpm build:wasm` now removes the wasm-pack scaffolding it generates. The
  `src/wasm/.gitignore` it wrote contained `*`; npm honours ignore files nested inside
  directories that `files` admits, so its presence silently dropped all of `src/wasm/`
  (including the required glue `meshup.js`) from the tarball on developer machines while
  packing correctly in CI — a publish that could not be reproduced.
- `pnpm build:wasm` now patches the `new URL('meshup_bg.wasm', import.meta.url)` fallback
  out of the generated glue. The branch was unreachable (the loader always passes bytes) but
  webpack 5 resolved it statically and failed with `Module not found`. The patch step throws
  if wasm-bindgen's output shape changes rather than silently shipping the old form.
- Removed `export type Meshup = typeof import('./index')`. This self-referential module type
  made the dts rollup emit a namespace object that tsup could not parse, which broke
  `dist/index.d.ts` generation entirely — the published package would have had no types.
  Spell it yourself if you need it: `type Meshup = typeof import('@archiyou/meshup')`.

### Tooling

- New `pnpm check:wasm-integrity`: asserts the base64 blob in `src/meshup-js-binary.ts`
  decodes to exactly `src/wasm/meshup_bg.wasm`. Both are committed and could drift apart
  invisibly; this needs no Rust toolchain, so CI can run it on every push.
- New `pnpm check:pack`: asserts the tarball's file list and a 20 MB size ceiling. Nothing
  in the monorepo imports the built entry point, so without this the published artifact had
  no coverage at all.
- Added CI (test, lint, build, both checks) and a tag-triggered release workflow. The Rust
  rebuild is a separate manual workflow — it needs five submodules, wasm-pack and wasm-opt.

### Repo hygiene

- Removed a committed `pnpm-lock copy.yaml` and a stale internal handoff note.
- A test wrote a `.gltf` into the package root; all test output now goes to
  `tests/outputs/`. `.gitignore` no longer blanket-ignores `*.gltf`/`*.svg`.
