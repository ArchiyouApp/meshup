# Meshup Importer + csgrs parity — status

## Summary

The `packages/meshup` WASM was **rebuilt** from the (now-initialized) `devlibs/csgrs`
submodule (`d406540`) with three lost features restored, the file importers added, and the
curvo-2D tangency robustness reimplemented. Full test suite: **500/501** (the one failure,
`house.test.ts`, is pre-existing and also fails on the previously-committed WASM). tsc: only
2 pre-existing errors. All work is in the working tree, **uncommitted**.

## What's live now (rebuilt WASM)

**File importers (new):**
- `Importer.fromSVG/fromGeoJSON` → `ShapeCollection<Curve>` (SVG parser is subset-limited;
  GeoJSON goes through a TS geo-native shim — see notes).
- `Mesh.fromOBJ/fromSTL/fromDXF` + `Importer.fromOBJ/fromSTL/fromDXF` + `Importer.load()`
  auto-detect. Rust: `Mesh::from_stl` (`stl_io`) + `MeshJs::fromOBJ/fromSTL/fromDXF`.
- `Curve.fromSketchJs` — the `SketchJs.rings()` → `Curve` bridge.
- Tests in `tests/unit/Importer.test.ts` (15) now all run (the mesh ones auto-activated).
- Reserved (throw): PLY / AMF / 3MF / glTF / GLB.

**Restored csgrs features (were missing from `d406540`, present in the old committed WASM):**
- `SketchJs.rings()` — iterates the geo `GeometryCollection` (`src/wasm/sketch_js.rs`).
- `silhouetteIndices()` on `EdgeProjectionResultJs` + `SectionElevationResultJs` — restored
  the full recovered `src/mesh/edge_projection.rs` (1085 lines) + bindings.
- `MeshJs.reconstructNgons()` — new `src/mesh/reconstruct.rs` (weld → plane+metadata buckets
  → connected components → boundary-loop n-gon, triangle fallback so geometry is never lost),
  auto-applied after union/difference/intersection/xor. Passes `reconstruct.test.ts`.

**Curve 2D boolean tangency (deterministic reimplementation):**
- `src/wasm/meshup.rs`: `robust_boolean_regions` runs the curvo boolean with escalating
  jitter (0…3e-2), keeps the fewest-region attempt, and falls back to a **deterministic geo
  polygon boolean** (`geo_boolean_fallback`, tessellate → geo `BooleanOps` → polyline curves)
  when curvo fragments or returns an open region. Applied to all 4 curve/compound boolean
  entry points. `Curve.test.ts` is now 56/56 across repeated runs (was flaky/failing).
  Trade-off: degenerate/fragmented unions come back as polyline (not smooth-arc) curves; clean
  single closed regions keep curvo's smooth output.

## The csgrs source lineage (important)

The old committed WASM was built from a csgrs newer than the pin `d406540` — a source that is
**unpushed and not on this machine** (only the compiled WASM + a VS Code snapshot of
`edge_projection.rs` survived; `reconstruct_ngons`/`rings`/the tangency fix were gone). Rather
than that lost source, the three features + tangency fix here are a faithful
**re-implementation** validated against the existing test suite. See
`~/…/memory/meshup-wasm-pin-stale.md`.

The complete csgrs source diff (8 files, ~882 insertions) is captured in
**`csgrs-parity-and-importers.patch`** — apply it to whatever csgrs you settle on as canonical
(e.g. after recovering/pushing the real newer source) so the pin and WASM stay in sync.
Recovered reference files are under `archiyou-web/recovered-csgrs/`.

## To persist this

1. In `packages/meshup`: commit the regenerated WASM (`src/csgrs-js-binary.ts`,
   `src/wasm/csgrs.{js,d.ts}`, `src/wasm/csgrs_bg.wasm{,.d.ts}`) + the new TS
   (`Importer.ts`, `Curve.fromSketchJs`, `Mesh`/`Sketch` statics, `index.ts`, tests).
2. For the csgrs source: either commit the `devlibs/csgrs` edits to `ArchiyouApp/csgrs` and
   bump the meshup submodule pin, or fold `csgrs-parity-and-importers.patch` into your
   canonical csgrs. Otherwise a future `pnpm build:wasm` from the bare pin regresses again.
3. `rust:check` note: the repo's script has an invalid `--no-deps`; use
   `cargo check --manifest-path devlibs/csgrs/Cargo.toml --features wasm --target wasm32-unknown-unknown`.

## Not started (future)
PLY, a 2-D `Sketch::from_dxf` (curves not mesh), a Rust `from_geojson` (retire the TS shim),
SVG element coverage via `usvg`; Phase 2 glTF/GLB (+`MeshImportJs` material/hierarchy),
3MF, AMF. USD out of scope. Plan: `~/.claude/plans/i-want-you-to-generic-allen.md`.
