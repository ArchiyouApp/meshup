# Meshup

General purpose 3D mesh library with various modeling techniques (CSG, SDF, quasi-CAD) and target applications (3D printing, craft, CNC) in Typescript and powered by Rust (CSGRS). It's top API is specialized for Script CAD

## WORK IN PROGRESS 

This is very much a work in progress. Please don't yet consider in anything serious!
Please check out CSGRS or its WASMs bindings for a more robust layer. 

## Development 

This repo offers (a fork of) csgrs as submodule for development in Rust and TS/JS. See lib/csgrs.

sh```
# get from github
git clone --recursive https://github.com/ArchiyouApp/meshup

# install TS/JS dependencies
pnpm
# run an example
pnpm dev:examples:mesh
pnpm dev:examples:curve

# Rust setup
# Make sure you have cargo
cd /lib/csgrs
cargo
# Test rust
pnpm rust:check
# Building of wasm file - see ./buildscripts
pnpm build:wasm 
# ==> Will create/update wasm files (and base64) automatically

```


## Licence

Apache2 





