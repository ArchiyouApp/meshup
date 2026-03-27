# Meshup

General purpose 3D mesh library with various modeling techniques (CSG, SDF, quasi-CAD) and target applications (3D printing, craft, CNC) in Typescript and powered by Rust (CSGRS). It's top API is specialized for Script CAD

## WORK IN PROGRESS 

This is very much a work in progress. Please don't yet consider in anything serious!
Please check out CSGRS or its WASMs bindings for a more robust layer. 

## Development 

This repo offers (a fork of) csgrs as submodule for development in Rust and TS/JS. See lib/csgrs.

```bash
# get from github (including csgrs submodule in devlibs/)
git clone --recursive https://github.com/ArchiyouApp/meshup

# install TS/JS dependencies
pnpm

# for development of csgrs:
# Make sure you have rust/cargo/wasm-pack. See: https://rustup.rs/
cargo install wasm-pack

# Rust build
cd /devlibs/csgrs
cargo
# Test rust
pnpm rust:check
# Building of wasm file - see ./buildscripts
pnpm build:wasm 
# ==> Will create/update wasm files (and base64) automatically

```


## Licence

Apache2 





