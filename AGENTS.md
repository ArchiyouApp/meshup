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
against the base64 blob drifting from the .wasm, and against the tarball losing files or
gaining the 6.9 MB binary. 
