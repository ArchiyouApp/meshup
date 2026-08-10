# Agent guide lines

## General coding style

* We prefer Allman style symmetrical braces. Please in this way always
* Please avoid for(..) and while(...) loops if you can also use a .map/reduce() loop.

## WASM libraries

We use Rust libraries compiled to WASM in this Typescript module

The Rust crate lives in ./rust/ and pulls in five git submodules: rust/hypercurve,
rust/hyperreal, rust/hypersolve, rust/hyperlattice and rust/hyperlimit (wired up through
[patch.crates-io] in the root Cargo.toml). There is no ./devlibs/ any more.

Please always use `pnpm build:wasm` to build the WASM. Don't try your own compilation
commands: that script also removes wasm-pack scaffolding and patches the generated glue,
both of which the published package depends on.

## Publishing

The generated artifacts src/wasm/* and src/meshup-js-binary.ts are committed on purpose.
Before publishing, `pnpm check:wasm-integrity` and `pnpm check:pack` must pass — they guard
against the base64 blob drifting from the .wasm, and against the tarball losing files.

`meshup_bg.wasm` must ship, in **both** `src/wasm/` (for deep-src importers) and `dist/wasm/`
(copied by tsup's `onSuccess`; that is where `dist/index.js` resolves it). This used to be the
opposite rule. src/loader.ts prefers the file over the inlined base64, and bundlers resolve
its `new URL('./wasm/meshup_bg.wasm', import.meta.url)` at **build** time — a missing binary
is a "Module not found" error in the consumer's build that no runtime fallback can rescue.
Do not "optimise" the tarball by dropping it, and do not rewrite that URL expression: only
the literal form is statically recognised, anything else silently becomes a 404.

Equally load-bearing: `tsup.config.ts` must keep `splitting: true`, or esbuild inlines the
loader's dynamic base64 import back into `dist/index.js` and the file path buys nothing. 
