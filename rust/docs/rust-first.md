# Rust-first: all geometry in the Rust core

The Rust crate is to be usable on its own, also from Python. Today much behaviour sits above the core:

- **The 3D curve model exists only in the wasm binding.** `Curve3DJs` (`src/wasm/curve_js.rs`, about 2,500 lines)
  holds its own state (`Frame`, `Geom`, `world_pts`) and nearly all curve logic. `hcurve.rs` is 2D only.
- **About 10,000 lines of geometry exist only in TypeScript**: every Polygon operation, the oriented bounding box,
  the selector language, extrude/loft/revolve of curves, the cut and split rules, mesh edges and loose parts,
  patterns, and the steps around projection.
- **There is no straight skeleton to call.** `hypercurve/src/straight_skeleton.rs` is exact, but has no weights per
  edge, no holes and no faces per edge, and does not finish on real data (see S0).

Decisions of the owner (2026-11-25): geometry and selector move to Rust; scene, style and glTF stay TypeScript; the
route for the skeleton is chosen after a measurement; the order is foundation, skeleton with Python, then the rest.

## Layers

| Layer | Holds | Rule |
|---|---|---|
| `meshup` core (Rust) | All geometry, selector, patterns, projection, skeleton, exchange formats | No `JsValue`, no PyO3; f64 and own types |
| `rust/src/wasm` | wasm-bindgen classes | Per method: convert arguments, one call into the core, convert the result |
| `rust/py` (new, crate `meshup-py`) | PyO3 module, batches on Arrow/WKB | Same rule; rayon over rows, GIL released |
| `src/*.ts` | Scene graph, Style/Color, decorators, glTF builder, loader, overloads | No geometry; a method is one call |

- The TypeScript API stays as it is. The vitest suite is the parity check and stays green after every step.
- Every ported function first gets Rust tests (`cargo test`), taken from the existing TypeScript test cases.
- Porting is literal: tolerances and fallbacks stay as they are. Redesign is a separate step.
- `tests/binding_rule.rs` guards the binding rule: the size of each binding file and of each binding function over
  12 lines is recorded in `tests/binding_rule.txt` and may only go down.

## Steps

| Step | What | State |
|---|---|---|
| F0 | Native build and tests as a full target | done |
| S0 | Measure the existing skeleton on real polygons | done, see below |
| F1 | `Curve3` into the core | waits for approval |
| S1–S3 | Skeleton in `meshup::skeleton`: one loop, holes, weight per edge | waits for approval |
| PY | Python binding `rust/py` | waits for approval |
| P2–P6 | The TypeScript logic, per class | waits for approval |
| P7 | Wrap-up | waits for approval |

### F0. Foundation (done)

- `pnpm rust:test` runs `cargo test --features serde,svg-io`: 190 unit tests, 13 doc tests, the fillet tests and
  the binding rule. `src/tests.rs` (92 tests, written against the old API) is back in the build.
- `--features parallel` builds and passes the same tests. It did not compile before.
- `serde` is a named feature, so `io::dxf_entities` can be built and tested natively.
- The tessellation quality is one value for the process (`hcurve::quality`), no longer one per thread: a worker
  thread now sees what the caller set.
- Feature sets: `default`, `wasm`, and the kernel `f64,delaunay,bmesh,mesh,sketch` with any file format or text
  feature added, all build. A set without one of those five kernel features does not build, and is not a goal.

Found on the way, not changed:

- `[profile.release]` in `rust/Cargo.toml` is ignored, because the workspace root is one directory up. The wasm
  module is therefore built without `lto`. Moving the profile to the root changes the shipped binary.
- Boolean operations keep metadata per polygon only on the BSP path (`Mesh::with_bsp`). The default, boolmesh,
  keeps the metadata of the whole shape. Three revived tests are pinned to BSP for that reason.
- `Sketch::from_svg` returns a ring that may start at another vertex than the one in the file.
- `pnpm lint` reports type errors in five test files (`tests/unit/{Curve,flatten,loft,Mesh,Sketch}.test.ts`).
- `rust/readme.md` and `rust/examples/README.md` describe the library this crate was forked from.

### S0. The existing skeleton on real polygons (done)

`examples/skeleton_probe.rs` runs `Contour2::from_finite_ring` and `Contour2::straight_skeleton` on the exterior
of each polygon, under three policies (`CurveContext::STRICT`, `APPROXIMATE_512`, and the lossy preview mode of
`CurvePreviewOptions`) and in four coordinate forms: as delivered (national grid, metres), moved to a local origin,
in whole millimetres, and in whole millimetres without collinear vertices. Each run is a child process with a time
limit.

Input: 10,000 buildings (`bag.pand`) and 10,000 parcels (`brk.perceel`), a regular sample of what lies in
`150500,463500,156500,468500` (EPSG:28992, the north of Amersfoort).

| | buildings | parcels |
|---|---|---|
| Polygons | 10,000 | 10,000 |
| Vertices: median, p90, p99, max | 4, 11, 24, 184 | 7, 21, 142, 1,598 |
| With holes (in the whole area) | 0.04 % | 1.9 % |
| **Completed** | **0.10 % to 0.17 %** | **0.01 %** |
| Blocked: `UncertainWavefrontRelation` | 99.83 % to 99.90 % | 99.97 % |
| Blocked: `DegenerateSimultaneousEvents` | 0 | 0.02 % |
| Time limit (5 s) reached, crash, panic | 0 | 0 |
| Time until the blocker, median | 0.08 to 0.12 ms | 0.12 to 0.20 ms |

The policy makes no difference at all, the coordinate form hardly (17 instead of 10 buildings complete in whole
millimetres). The 18 skeletons that complete are all of four-sided shapes, take about 0.1 ms and are sound: a
tree, every node inside the polygon, no crossing arcs.

**Where it blocks.** Before the first event, in `edge_event_candidate` (`hypercurve/src/straight_skeleton.rs`).
The meeting time of two neighbouring vertices is solved from x, and the kernel then asks whether the y residual is
zero *as an expression* (`Real::zero_status`), outside any policy. Every edge brings in the square root of its own
squared length; with one root in play the expression simplifies, with two it does not. So a square, a rectangle at
any slope, an L and the triangle with sides 1, 2 and `sqrt 5` complete, and the triangle `(0,0) (2,1) (0,3)`, with
sides `sqrt 5`, `2 sqrt 2` and 3, is blocked. A surveyed rectangle is not exactly a rectangle, so nearly all real
input is of the second kind.

**What a first repair gives.** As an experiment (not kept) that one test was handed to the policy, so that
`APPROXIMATE_512` and preview may decide it:

| | buildings | parcels |
|---|---|---|
| Completed | 51.9 % | 67.4 % |
| of which a tree | 9.4 % of all | 0.5 % of all |
| Blocked at the next event: `UncertainWavefrontRelation` | 46.9 % | 27.2 % |
| Blocked: `DegenerateSimultaneousEvents`, `InvalidSplitTopology` | 1.2 % | 1.0 % |
| Over the time limit | 0.07 % (5 s) | 4.4 % (1 s) |
| Time for 4 to 40 vertices: median, p99 | 1.2 ms, 143 ms | 7.7 ms, 701 ms |

Shapes of three and four vertices then complete least (18 %), because the second event blocks them in the same
way. Most graphs that do complete are no tree: events that fall together are not joined, so a six-sided building
gives 12 to 14 nodes where a skeleton has at most 10. `STRICT` is unchanged by the experiment.

**Choice.** The rule set beforehand was route A (extend the exact kernel) at no more than 0.5 % blocked, a median
of 0.5 ms and a p99 of 20 ms for 4 to 40 vertices. The kernel as it is fails the first by a factor of 200, and
after a first repair it fails all three. So **route B**: the skeleton is written in f64 in `meshup::skeleton`. The
exact one stays useful as a check in tests on the shapes it completes (rectilinear plans and rectangles, which is
what the L, T, U and cross cases are). Other polygons are checked by invariants (the faces fill the polygon, each
face holds its edge, the graph is a tree, the roof mesh is closed, the offset shrinks) and, through the Python
binding, against the mitred buffer of Shapely.

To repeat it:

```text
cargo run --release --example skeleton_probe -- <rings> <out.tsv> [workers] [timeout ms]
```

with `<rings>` one polygon per line as `id;x y,x y,...|x y,...` (exterior first, rings not closed).

### F1. `Curve3` into the core

- `wasm/curve_js.rs` → `src/curve3/` (`frame`, `geom`, `curve`, `boolean`, `extend`, `measure`, `spans`).
  `BooleanRegion3DJs` becomes `Region3`; `SpanParamsJs` and `EllipseParamsJs` become serde structs in the core;
  `Curve3DJs` becomes `{ inner: Curve3 }`.
- Also the smaller logic in bindings: `mesh_js.rs` (`toArrays`, `fromPointsWithHoles`, `splitByPlane`,
  `vertexCount`), `sketch_js.rs` (`toArrays`, `rings`), `vector_js.rs` (`rotationBetween`), `plane_js.rs`,
  `polygon_js.rs`.
- Rust tests from `tests/unit/curve3d.test.ts`. No change in TypeScript.

### S1–S3. Skeleton in `meshup::skeleton`

```rust
pub fn straight_skeleton(exterior: &[[f64; 2]], holes: &[Vec<[f64; 2]>], weights: Option<&[f64]>)
    -> Result<Skeleton, SkeletonError>;
// Skeleton: nodes (point, time, kind), arcs (start, end, left_edge, right_edge), faces (edge, ring)
impl Skeleton { fn faces(&self); fn offset(&self, t: f64); fn roof(&self, eave: f64, slope: f64) -> Mesh<S>; }
```

- **S1**: one loop, unweighted. Faces per edge, mitred offset at time t, hipped roof with one slope.
- **S2**: holes.
- **S3**: weight per edge (slope per edge, 0 for a gable, margin per edge for an offset).
- Tests: square, rectangle, L, T, U, cross, with a hole, random polygons; the invariants named under S0.
- TypeScript: `Curve.skeleton()` and `Polygon.roof()` as thin methods.

### PY. Python binding `rust/py`

- PyO3 and maturin, abi3 wheel. In the core an `interop` module: WKB and GeoJSON (replaces the shim in
  `Importer.ts`).
- Batch functions on Arrow arrays of WKB: `skeleton_faces`, `skeleton_lines`, `offset_mitre`, `roof`.
- Checked against Shapely (`buffer(-d, join_style="mitre")` for the unweighted cases) in `rust/py/tests`.

### P2–P6. The TypeScript logic, per class

Each step: core and Rust tests, thin binding, the TypeScript method becomes one call, vitest green, wasm rebuilt.

| Step | Into the core | Source (TypeScript) | Reuse in Rust |
|---|---|---|---|
| P2 Polygon, boxes | transforms, area with holes, centroid, split, booleans, cutoff, extrude; oriented box (PCA, rotating calipers); box sides | `Polygon.ts`, `OBbox.ts`, `Bbox.ts`, `Vertex.ts` | nalgebra `SymmetricEigen` instead of `jacobi3` |
| P3 Curve | plane fit, `alignByPoints`, `projectOnto`, flatten; `vertices`/`segments`; `closestPoints`, foot point, `containsPoint`; `extendTo`; offset side; `connect`; the cutoff, intersection and difference rules; extrude/loft/revolve; layflat; SVG path writer, `exportSpans` | `Curve.ts` | `polygon.rs` `point_in_ring_2d`; `sketch/extrudes.rs` loft, revolve, sweep (one implementation) |
| P4 Mesh | feature edges, loose parts and cavities, cutoff/split, extrude, align, flatten, distance to a curve, overlap, joining polylines, section rings | `Mesh.ts` | `mesh/reconstruct.rs` `connected_components` |
| P5 Selector, patterns | selector parser and evaluation (returns indices); array/grid/row/rowFill; `moveUntilTouching`; align; the sketch coordinate language and work plane | `Selector.ts`, `utils.ts`, `Point.ts`, `Sketch.ts`, `Shape.ts` | `nom` (already an optional dependency) |
| P6 Collection, projection | a `Shape` enum and the collection operations (union, subtract, intersections, chains, nearest, hits); the projection strategy (returns polylines per class) | `ShapeCollection.ts` | `mesh/edge_projection.rs`, `mesh/hlr/` |

Stays TypeScript: `SceneNode`, `sceneDecorators`, `Style`, `Color`, `GLTFBuilder`, `loader`, `index`, `types`,
overloads, the array-like keys, the link to the foreign brep kernel, the SVG document frame and annotations.

### P7. Wrap-up

- Quality settings (loft, revolve, primitives, `quality.ts`) and constants get one source, in Rust.
- Rewrite `rust/readme.md`, the header of `hcurve.rs`, a new `docs/architecture.md`, the changelog.

## Risks

- **Behaviour drifts while porting**: many tolerance choices live in TypeScript. Port literally, per method, with
  vitest as the check.
- **The wasm module grows** as logic moves in: measure `meshup_bg.wasm` per step and write it down.
- **An f64 skeleton meets degenerate input**: parallel edges, events at one time, collinear vertices. These are the
  normal case in buildings, so they are test cases from the first step, not a later repair.

## Checks per step

In `packages/meshup`: `pnpm rust:test`, `pnpm rust:check`, `pnpm build:wasm`, `pnpm test:run`, `pnpm lint`,
`pnpm check:wasm-integrity`.
