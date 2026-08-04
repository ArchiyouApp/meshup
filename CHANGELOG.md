# Changelog

All notable changes to `@archiyou/meshup` are documented here.
This project follows [semantic versioning](https://semver.org/); while on 0.x, minor
versions may contain breaking changes.

## Unreleased

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
