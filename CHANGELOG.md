# Changelog

All notable changes to `@archiyou/meshup` are documented here.
This project follows [semantic versioning](https://semver.org/); while on 0.x, minor
versions may contain breaking changes.

## Unreleased

### Changed

- **The WASM kernel is loaded from a file when it can be, base64 only as a fallback.**
  `init()` now tries `./wasm/meshup_bg.wasm` next to the module first — browsers stream and
  compile it while it downloads — and falls back to the inlined base64 when that is not
  fetchable (Node, `file://`, offline, CORS/CSP, hosts that don't serve the asset). The
  fallback is behind a dynamic import, so it now lives in its own lazy chunk: `dist/index.js`
  drops from ~8.5 MB to ~0.7 MB and the 7.8 MB blob is only downloaded when it is actually
  needed. `meshup_bg.wasm` therefore ships in the tarball now (in `src/wasm/` and
  `dist/wasm/`), where it previously did not.

  Node behaviour is unchanged: `import.meta.url` is a `file:` URL there and `fetch()` cannot
  read those, so the loader's protocol guard goes straight to base64.

- **`init()` / `initAsync()` accept an options object.** `init({ wasm })` takes a URL, a
  `Response`, raw bytes or a compiled `WebAssembly.Module`. Supplying one disables the
  fallback — a wrong source fails loudly instead of silently costing a 7.8 MB download. Node
  callers can use it to skip the base64 decode entirely:
  `init({ wasm: await readFile(wasmPath) })`. Calling `init()` bare is unchanged.

- **`Curve.mirror()` costs nothing and keeps the geometry.** A reflection is affine, so for
  a planar curve `R(o + x*u + y*v) = R(o) + R(x)*u + R(y)*v` — the local coordinates are
  unchanged and only the frame moves. A mirrored circle stays two arc spans. This used to
  reflect the tessellated boundary and rebuild a ~500-segment polyline, destroying the
  geometry in order to apply an isometry.

- **A per-axis scale of a closed curve is exact.** It is not a similarity, so
  `transform_similarity` cannot express it, but the map it induces *within* the curve's
  plane is a plain 2D affine and `CurveRegion2::transform_affine` accepts one. Scaling a
  circle by `[2, 1, 1]` now produces a real **ellipse** of rational conic spans with area
  exactly `pi*100*50`, rather than resampled line work. Open curves keep the resampling
  fallback: `transform_affine` exists only on `CurveRegion2`, so there is nothing to lift
  an open curve into.

- **`Curve.projectOnto()` a parallel plane is a rigid translation.** The in-plane geometry
  is untouched, so a circle stays a circle — including the degenerate case of projecting an
  XY curve onto XY, which previously resampled the entire curve to achieve nothing. An
  oblique projection compresses one in-plane direction, so it is not a similarity and still
  resamples.

- **`pointAt()` / `pointAtPerc()` land on the curve, and `paramClosestToPoint()` is
  analytic**, for native line/arc geometry. Both walked a cumulative table of *chord*
  lengths over a tessellation and then interpolated between two samples, so the returned
  point was not on the curve at all and the error grew along it (1.0e-7 rising to 3.1e-7
  across a circle). Arc length is closed-form for a line and a circular arc (`|b-a|`,
  `r*theta`), so the containing segment and the position within it are now found exactly and
  evaluated with `LineSeg2::point_at` / `CircularArc2::point_at_sweep_fraction`.
  `paramClosestToPoint()` projects per segment — perpendicular foot on a line, radial
  projection on an arc — instead of projecting onto tessellation chords.

  A conic/spline path keeps the sampled walk: hypercurve has no point-inversion API, and
  inverting arc length on a rational conic has no closed form. A non-coplanar polyline also
  keeps it, since its true 3D path is not the planar geometry.

- **Booleans and intersection accept exact operands.** `boolean_native` takes only
  `Contour2` (line/arc topology), so a closed conic path was tessellated into a fine line
  contour before every boolean — which is why `Curve3DJs::boolean`'s "arcs preserved,
  nothing tessellated" guarantee held for circles but not for ellipses. Conic/spline
  operands now go through `CurveRegion2`, hypercurve's exact mixed-family region type, and
  `CurvePath2::retain_intersection`. Line/arc geometry keeps the existing decided fast path.

  Note `intersect()` declines rather than silently under-reporting: when hypercurve retains
  a contact as an exact *algebraic image* instead of `Real` coordinates, the exact query
  returns nothing and the caller falls back to the sampled path, which finds the point
  approximately rather than dropping it.

- **Joining curves preserves arcs.** `Curve.Compound()`, `Curve.close()`, `Curve.extend()`
  and the internal `_closedRegionFromArc()` all rebuilt geometry by running a polyline
  through `controlPoints()` — and since that yields span *endpoints*, every arc was replaced
  by its chord. A semicircle of length 22.2 came back as a 40-long chord pair. They now use
  native `concat` / `closePath` / `extend` bindings that carry each span across exactly and
  bridge gaps with straight connectors.

  This is what made `Sketch().lineTo().arcTo().close()` lose its arcs: every `Sketch.end()`
  funnels through `Compound()`. It also mattered for correctness beyond fidelity —
  `cutoffBy()` picks which side of a cut to keep by comparing enclosed areas, and with the
  boundary arcs collapsed to chords, halving a circle produced a zero-area region, so that
  comparison was decided on degenerate input.

- **Display tessellation is no longer certified, and is ~10-30x faster.** Sampling an exact
  path went through `CurvePath2::project_to_finite_polyline`, which proves its chord bound by
  exact-arithmetic adaptive subdivision. Measured, that cost 1178 ms for one spline and
  491 ms for one ellipse (against 5 ms for a native circle) — on the path that `toPolygon`,
  `toMesh`, glTF export and `OBbox` all sit on. It now samples spans by parameter with exact
  `Curve2::point_at`, at 41 ms and 53 ms respectively.

  The sample count scales with each span's own size, so this does *not* reintroduce the
  original defect it replaced (a tolerance-only heuristic clamped at 128 samples, which
  silently under-sampled large or eccentric spans). Geometry and point evaluation stay
  exact; only the subdivision proof is dropped. Booleans and region work still use the
  certified path, where a proven bound buys correctness rather than pixels.

- **`Curve.Interpolated()` is an exact spline.** It computed a real NURBS and then
  immediately discarded it for a 1e-5-chord polyline, so a spline arrived as ~2400 degree-1
  segments: `degree()` reported 1, `subtype()` reported `Polyline`, and every downstream
  operation ran on line work. It now stores the exact NURBS carrier — `degree()` is the real
  degree, `subtype()` is `Spline`, and `controlPoints()`, `knots()` and `weights()` return
  the solved control net, knot vector and weights instead of `[0, 1]` and `[]`. That is what
  lets a DXF exporter emit a real SPLINE entity.

  The interpolation itself is now hypercurve's `NurbsCurve2::interpolate_global`, replacing
  ~165 lines of hand-rolled f64 Piegl & Tiller (knot-span search, basis functions, and a
  Gaussian solve with a hard `1e-12` singularity cutoff). The solve, the residual replay and
  the curve-point replay are all exact, so a near-singular configuration is reported rather
  than quietly producing a curve that misses its own data points.

  Note `interpolate_chord_length` is deliberately **not** used: it derives each parameter as
  an exact `sqrt(dx^2 + dy^2)`, i.e. a symbolic radical, and the exact solve over basis
  functions evaluated at nested radicals is intractable — a 5-point cubic took over 200
  seconds. Interpolation parameters are a modelling choice, so chord lengths are computed in
  f64 and lifted to exact `Real` (dyadic rationals). That keeps the solve exact *and* cheap,
  and reproduces the parameterization the previous implementation produced, so spline shape
  is unchanged.

- **`controlPoints()` returns a spline's control net.** It returned span endpoints, which is
  correct for line/arc geometry — a polyline's vertices *are* its control points — but gives
  only two points for a single-span NURBS.

- **`Curve.offset()` preserves arcs.** `hcurve::offset_open`/`offset_closed` called
  hypercurve's native `offset_left_with_line_joins` — which miters line-line corners and
  joins the rest with real circular arcs — and then threw that result away by tessellating
  it. So `Curve.Circle(50).offset(10)` returned a **128-gon**. They now return the native
  `CurveString2`/`Contour2`: an offset circle is a circle (two arc spans, length exactly
  `2*pi*60`), and an offset arc keeps its arcs.

  Two workarounds this made unnecessary are gone. `Curve.offset()` no longer special-cases
  circles by rebuilding one at `radius + distance`, and `_offsetGrowSign()` no longer runs
  **two extra probe offsets** to work out which way hypercurve's fixed-side offset grows —
  for a closed curve that is just the sign of the enclosed signed area, so an `offset()`
  costs one offset instead of three.

  Curved (conic/Bezier/spline) paths use hypercurve's *certified* Blend2D parallel, so the
  result stays a curve with a proven error bound rather than collapsing to a polyline; when
  hypercurve declines (typically an authored corner) they fall back to offsetting the line
  projection.

- **An exact curve is no longer shadowed by a line approximation.** `Curve3DJs`'s internal
  `PathGeom` carried a cached `Vec<Segment2>` built by tessellating the exact path, and
  every segment-oriented operation — `controlPoints()`, `spans()`, `segmentCount()`,
  `degree()`, `hasArcs()`, `subtype()` — silently read *that* instead of the geometry. So a
  `Curve.Ellipse(50, 25)` reported 200 degree-1 segments and `hasArcs() === false`, when it
  is four exact rational-conic spans. The cache is gone; each of those now answers from
  `CurvePath2::curves()`. An ellipse reports 4 spans and degree 2, and `subtype()`
  distinguishes a conic path (`Ellipse`) from a spline one (`Spline`) rather than labelling
  every exact path `Ellipse`.

  Results are also renormalised: when an operation yields spans that are all lines/arcs, the
  curve drops back to a native `Contour2`/`CurveString2`, so `subtype()` keeps reporting
  `Circle`/`Rect` rather than decaying to a generic path.

- **`Curve.area()` on an ellipse is now exact** — an exact Green integral over the native
  conic boundary via `CurveRegion2`, instead of a shoelace over sampled points.
  `Curve.Ellipse(50, 25).area()` is `pi*50*25` to full precision (it was off by ~1.7e-4).

- **`Curve.length()` is tiered by span family.** Line and circular-arc spans are exact
  (`r*theta`); conic/Bezier/spline spans are summed from certified adaptive chords, because
  their arc length has no closed form. Previously the whole path was chord-summed, including
  the spans with exact answers.

- **`Curve.bbox()` is solved exactly for line and circular-arc geometry**, as a support
  query per world axis rather than min/max over samples — so an arc's bulge is computed, not
  sampled, and a semicircle's box reaches its apex exactly. Conic paths keep a projection
  fallback (see Known limitations), but that projection is itself much tighter now: a
  30-degree-rotated 50x25 ellipse was under-reporting its extent by ~4.4e-3 and is now within
  ~1.3e-5.

- **Tessellation honours the chord tolerance it is given.** `tessellate_path` delegates to
  hypercurve's `CurvePath2::project_to_finite_polyline`, which subdivides each span in its
  native representation. It replaced a loop that sampled a fixed number of uniform `t`
  values chosen by a heuristic and clamped to 128 — uniform parameter spacing is not uniform
  arc length on a conic, so the old sampling did not bound the error it was asked for, and
  the clamp silently capped accuracy on large or eccentric curves. Likewise
  `tessellate_nurbs` now flattens every span family through
  `BezierSubcurve2::flatten_certified` instead of sampling rational spans at a fixed 24
  points; parameter sampling remains only as a fallback when weight signs cannot be
  certified.

### Known limitations (unchanged behaviour, now documented)

- **An arc whose centre came from a boolean cannot be offset natively.** hypercurve
  certifies exact equidistance when offsetting an arc, and a centre derived in `f64` does
  not satisfy it, so `offset()` on e.g. `circleA.union(circleB)` is declined with
  `RadiusMismatch` for every sign and distance. Lowering to line work first would run the
  exact offset over thousands of segments (seconds per call), so this reports instead.
  Offset `toDegree1()` explicitly to opt into that cost.

  Note this previously appeared to work only by accident: `subtype()` classified a
  two-circle union as `Circle`, so the circle fast path rebuilt it as a *single* circle of
  `radius + distance` — a different shape, which no assertion caught.

- **No exact bounding box for conic/spline paths.** `CurvePath2::bounds()` is conservative —
  it returns the control-polygon hull, which for a 30-degree-rotated 50x25 ellipse claims a
  half-extent of 55.80 against a true 45.07 — and on some inputs declines outright with
  `Blocked(NativeTopology, RationalQuadraticBezier, Ordering)`. A conservative box is worse
  than a certified projection, so those curves use the projection.
- **`trim()` on a conic path** still goes through a line approximation: it cuts at
  *arc-length* fractions, and inverting arc length on a rational conic has no closed form
  (hypercurve offers `inverse_length_parameter_region` for polynomial Bezier spans only).
  `Curve2::subcurve` takes a curve parameter, so it is not the missing piece.
- **`fillet()` / `chamfer()` on a conic path** likewise: `fillet_vertex_by_parameters`
  certifies radius and tangency in exact `Real`, which an f64-authored corner generally
  cannot satisfy — the same `RadiusMismatch` that made `fillet_segments` build arcs by bulge.

### Removed

- **The `hc*` flat-array WASM exports** — `hcTessellatePolyline`, `hcCircle`, `hcArc3pt`,
  `hcSignedArea`, `hcBoolean`, `hcOffset`, `hcIntersect` and `hcNurbsTessellate`, along with
  the `rust/src/wasm/hcurve_js.rs` module behind them. They took polylines in and returned
  polylines out, so they could only ever express tessellated answers, and nothing in `src/`
  called them — every curve operation goes through `Curve3DJs`. `tests/unit/hcurve.test.ts`
  now drives the same behaviour through `Curve3DJs`, asserting *native* quantities where
  hypercurve has them (a circle's area is exactly `pi*r^2`, checked to 9 decimals instead of
  a shoelace over a sampled ring to 1).

- **`SketchJs.offset()`, `SketchJs.offsetRounded()` and `SketchJs.straightSkeleton()`**, the
  `geo-buf` dependency, the vendored `rust/geo-buf` crate and the `offset` Cargo feature.
  These offset already-tessellated `geo` polygons; they had no TypeScript callers, because
  `Sketch.offset()`, `Polygon.offset()` and `ShapeCollection.offset()` all route through
  `Curve.offset()` → hypercurve, which offsets native line/arc geometry. `SketchJs.hilbertCurve()`
  was sitting behind the same feature gate by accident and is now unconditionally available.

- **`Curve.offsetFallback()`** — a pure alias for `Curve.offset()` since the geo-buf fallback
  was retired. Call `offset()` directly.

### Added

- **`Mesh.rotateToOrtho()` and `Curve.rotateToOrtho()`** — rotate a shape to align it with
  the world axes as much as possible, matching the brep kernel's `Shape.rotateToOrtho()`.
  `'vertical'` (default) puts the dominant edge direction on the Y axis, `'horizontal'` on X.
  `autoRotate()` is an alias, as in brep. Supporting methods added alongside:
  `rotateVecToVec(from, to, pivot?)` (shortest-arc rotation, on both `Mesh` and `Curve`),
  `rotateToAxesOBbox()` (OBB thin axis → +Z, long axis → +X, on both) and
  `Mesh.rotateToAlignLargestFaceToZ()`. Two deliberate differences from brep: the dominant
  face is found by summing area per normal *direction* rather than taking the single largest
  polygon (a tessellated mesh has no single dominant triangle), and the final alignment turn
  is constrained to Z by at most a quarter turn, so it can never tilt the shape back out of
  the XY plane.

- **`OBbox.shape()`** (with `toShape()` alias, and the `box()` / `rect()` / `line()` accessors
  it dispatches to) — the real geometry of an oriented bounding box, reachable from
  `Mesh.obbox()` and `Curve.obbox()` and mirroring the brep kernel's `OBbox.shape()`.
  A 3D box gives a box `Mesh` built from its 8 corners, a 2D box a closed rectangle `Curve`
  in its own plane, a 1D box a line `Curve`, and a zero-size box `null`. Unlike the `Bbox`
  equivalents the result follows the box's own principal axes, so it is a genuinely oriented
  box. The PCA frame is made right-handed first — the Jacobi solver can return a mirrored
  frame, which would build the box inside-out.

- **Every `Shape.toString()` now shows scene membership**, in both kernels: `node={ name:
  'myShape', id: '…' }` for a Shape that is in the scene, `node=<not in scene>` for one that
  is not — the usual question when something does not turn up in the viewer. Backed by
  `Shape.nodeString()`, the `nodeToString()` helper in `utils`, and a new `SceneNode.id()`
  (names repeat across layers, ids do not; the id is generated on first use so building a
  large scene pays nothing for it).

### Changed

- **`OBbox.is1D()` / `is2D()` / `is3D()` are tolerance-aware**, using the same absolute +
  relative convention as `Bbox` instead of testing extents against exactly 0. A flat shape
  that has been rotated measures a thickness of ~1e-15, not 0, and so used to be reported as
  3D. `is2D()` now also means *exactly* two axes have size (it used to be true for 1D and
  point boxes as well); `isPoint()` is new.

- **`select()` no longer adds its result to the scene.** `Mesh.select()` and `Curve.select()`
  were `@sceneAdd`, so every selection dropped a shape into the active layer — but selecting
  hands back a reference to geometry that is already in the scene, it does not make anything
  new. They are `@sceneCarry` now: no scene mutation, while the result still carries the
  source's scene root, so `select(…).copy()` puts the copy in the active layer as before.

### Fixed

- **`OBbox.fromCurve()` counted coincident tessellation points twice, tilting the box.**
  A closed curve tessellates with its start point repeated at the end (and a compound curve
  repeats every shared segment endpoint); weighting those points double skews the covariance
  the principal axes come from. A plain 200×100 `Curve.Rect()` measured as a 210×121 box
  rotated by 6°. Coincident points are now dropped before the PCA, as `fromMesh()` already
  did. This tightens every `Curve.obbox()` result, and with it `layflat()` and
  `rotateToOrtho()` on curves.

- **Side selectors (`F||front`, `E||top`, `V||leftfrontbottom`, …) returned bounding-box
  geometry instead of the target's own subshapes.** `Selector._side()` handed back freshly
  built `Bbox.getSidesShapes()` planes/lines/vertices, so `box(10,10,100).rotateX(-10)
  .rotateY(10).select('F||front')` gave the front plane of the bounding box rather than the
  polygon facing front. The selector now picks from the target's own faces/edges/vertices in
  two passes: subshapes lying flush on the requested bbox side plane(s), and — when a shape
  is rotated and nothing is flush — the subshapes facing that side most (faces ranked by
  normal, edges/vertices by how far they reach along the side direction, ties all returned).
  A side selector therefore always returns at least one subshape when the target has
  subshapes of that type. Two consequences: `face||…` on a `Curve` now returns nothing (a
  curve has no faces), and a multi-side selector like `edge||left-front` on a flat rect
  returns the two edges meeting at that corner instead of nothing.

- **`Mesh.fromPolygons()` (and `Mesh.fromPoints()`, which delegates to it) produced
  zero-length vertex normals.** The vertices are built from bare positions and
  `Point.toVertexJs()` defaults its normal to `(0,0,0)`, which was handed to `PolygonJs`
  unchanged. A zero-normal surface takes no light, so such meshes rendered flat grey in
  any PBR viewer whatever colour they carried, and exported a useless `NORMAL` buffer to
  glTF. Each polygon now gets its own plane normal (flat shading). Callers holding real
  per-vertex normals should keep building `PolygonJs` themselves via
  `Point.toVertexJs(normal)`.
- **`Polygon` had the same zero-normal defect** on every path that builds it from
  positions — the constructor, `Polygon.from(points)` and `offset()` — so `Polygon` shapes
  rendered flat grey too. They now carry the plane normal as well. `_applyVertexTransform()`
  (translate/rotate/scale/mirror) already mapped normals itself and is unchanged.

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
