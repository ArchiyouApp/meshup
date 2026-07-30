# Meshup (`@archiyou/meshup`)

A general-purpose 3D mesh/curve modeling library for TypeScript, powered by a Rust/WASM
kernel (currently a fork of [csgrs](https://github.com/timschmidt/csgrs), but rebasing soon). It combines CSG
(constructive solid geometry), quasi-CAD curve/sketch tooling, and mesh utilities behind a
fluent, chainable JS API — built as the modeling kernel for
[Archiyou](https://archiyou.com) Script CAD, but usable standalone in Node or the browser.

> **Status: 0.1.0, early.** This is the first published release. It is used in production by
> Archiyou, but the API is still evolving and breaking changes will land in 0.x minors.
> Read [Known limitations](#known-limitations) before adopting it, and pin an exact version.

## Features

- **Shapes**: `Mesh` (solids: cube, sphere, cylinder, custom polygons/points, SDF) and
  `Curve` (2D/3D: lines, polylines, arcs, circles, ellipses/elliptical arcs, rectangles,
  interpolated splines, compounds) as first-class, chainable objects.
- **CSG booleans**: `union`, `difference`/`subtract`, `intersection` on meshes; robust 2D
  boolean ops on curves (with automatic fallback for degenerate/self-intersecting input).
- **Corner operations**: `fillet`/`chamfer` on every corner or only selected ones
  (`curve.fillet(5, 0)`, `curve.fillet(5, [10, 10, 0])`, `curve.fillet(5, 'vertex<<->[0,0,0]')`).
- **Edges & selection**: `mesh.edges()` returns deduplicated model edges grouped into
  `boundary` / `crease` / `flat`, and the `Selector` can query them (`'edge|z'`,
  `'edge<<->[0,0,0]'`).
- **Transforms & alignment**: move/rotate/mirror/scale, `alignByPoints`, `rotateSwing`,
  bounding boxes (`Bbox`, oriented `OBbox`), replication (`replicate`, `row`, grids).
- **Sketch & text**: 2D sketch primitives, TrueType and Hershey stroke-font text
  (`Sketch.textOutline/textSolid/textStroke`).
- **Styling**: per-shape `Style` (color, opacity, stroke width/dash/cap/join, point
  markers, PBR materials) that flows through to exported geometry.
- **Scene graph**: `SceneNode` hierarchy with layers, named lookup (`find`/`findAll`),
  active-layer tracking, and cascading style.
- **glTF/GLB export**: `GLTFBuilder`/`SceneNode.toGLTF()`/`toGLB()`, including custom
  extensions for line style, point style, and edge visibility.
- **Import**: `Importer`/static `from*` factories for SVG, GeoJSON, DXF (2D curves), and
  OBJ, STL, glTF/GLB, AMF, 3MF (meshes) — auto-detected via `Importer.load()`.
- **n-gon reconstruction**: boolean results are rebuilt into clean n-gon faces rather than
  raw triangle soup.

## Installation

```bash
pnpm add @archiyou/meshup
# or: npm install @archiyou/meshup / yarn add @archiyou/meshup
```

This package bundles its WASM binary as a base64 string in the JS output, so it has **no
separate `.wasm` file to fetch or configure** — it works the same way in Node, browsers,
and bundlers (Vite/webpack/esbuild) without special asset config.

**ESM only.** There is no CommonJS build: `require('@archiyou/meshup')` will not work on
Node versions without `require(esm)`. Requires **Node >= 20.19**.

**Size.** Embedding the kernel makes the bundle large: `dist/index.js` is ~9.4 MB
(a ~6.9 MB WASM binary, +33% for base64). That is the trade-off for zero-config loading in
every environment. It is one module with no code splitting, so expect the full cost on
first load; serve it compressed and load it lazily (e.g. in a Web Worker) in browser apps.

## Usage

Meshup loads its WASM kernel asynchronously. Call `init()` once before using any shape
classes:

```ts
import { init, Mesh, Curve, Point } from '@archiyou/meshup';

await init();

const box = Mesh.Cube(10).moveTo([0, 0, 5]).color('blue');
const hole = Mesh.Cylinder(3, 20).moveTo([0, 0, 5]);

const result = box.difference(hole);

const glb = await result.toGLB(); // Uint8Array, ready to save or stream
```

### Node.js

```ts
import { init, Mesh } from '@archiyou/meshup';
import { writeFileSync } from 'node:fs';

await init();
const mesh = Mesh.Sphere(10);
writeFileSync('sphere.glb', await mesh.toGLB());
```

### Browser

```html
<script type="module">
  import { init, Mesh } from 'https://esm.sh/@archiyou/meshup';

  await init();
  const mesh = Mesh.Cylinder(5, 10).color('red');
  const glb = await mesh.toGLB(); // feed into three.js / Babylon.js GLTFLoader
</script>
```

Because the WASM is embedded as base64, this works directly from a `<script type="module">`
or any bundler without configuring `.wasm` MIME types or asset copying.

### Curves and sketches

```ts
import { init, Curve } from '@archiyou/meshup';

await init();

const outline = Curve.Rect(100, 50).color('green');
const ellipse = Curve.EllipticalArc(40, 20, 0, 270);
```

### Scenes and hierarchy

```ts
import { init, Mesh, SceneNode } from '@archiyou/meshup';

await init();

const scene = SceneNode.root();
scene.addLayer('walls', Mesh.Cube(100));
scene.addLayer('roof', Mesh.Cylinder(50, 20).moveToZ(100));

const glb = await scene.toGLB();
```

### Importing files

```ts
import { init, Importer } from '@archiyou/meshup';

await init();

const curves = Importer.fromSVG(svgString);
const shapes = Importer.load(fileBytes, { format: 'stl' }); // or auto-detect
```

## Examples

Check tests/examples.

## Known limitations

Honest list as of 0.1.0 — these are real and not yet fixed:

- `Polygon.offset()` does not offset interior holes (`src/Polygon.ts`).
- `ShapeCollection.offset()` only offsets `Curve` members and warns about the rest.
- Large boolean workloads can panic inside WASM (reproducible around a 10×10×10 grid of
  boolean ops). A panic poisons the module: subsequent kernel calls in the same process
  fail, so the process must be restarted.
- `Sketch.loft()` throws — only `Curve.loft()` is implemented.
- PLY is the one import format that is declared but not implemented.
- `Mesh.edges()` classifies an edge by the angle between adjacent face normals, so a
  smooth-shaded curved surface (sphere, cylinder wall) yields many near-coplanar edges.
  Raise `featureAngle` to thin them out.
- The library writes diagnostics to `console.warn`/`console.error` unconditionally; there is
  no verbosity switch yet.

## Development

The Rust kernel lives in `rust/` (a fork of csgrs). It pulls in five git submodules —
`rust/hypercurve`, `rust/hyperreal`, `rust/hypersolve`, `rust/hyperlattice`,
`rust/hyperlimit` — which the root `Cargo.toml` wires up via `[patch.crates-io]`, so a
non-recursive clone cannot build the WASM.

Both generated artifacts (`src/wasm/` and the base64 blob `src/meshup-js-binary.ts`) are
committed, so **you only need the Rust toolchain if you change Rust code**.

```bash
# clone including the Rust submodules
git clone --recursive https://github.com/ArchiyouApp/meshup
# (already cloned? git submodule update --init --recursive)

# install JS/TS dependencies
pnpm install

# Rust toolchain, for building the WASM kernel:
# https://rustup.rs/
cargo install wasm-pack

# quick Rust sanity check (no wasm build)
pnpm rust:check

# build the WASM kernel + regenerate the embedded base64 binary
pnpm build:wasm

# build the TS package
pnpm build

# run tests
pnpm test        # watch mode
pnpm test:run    # single run

# type-check
pnpm lint

# release gates (also run in CI)
pnpm check:wasm-integrity   # base64 blob matches src/wasm/meshup_bg.wasm
pnpm check:pack             # the tarball contains exactly what it should
```

Never hand-roll `wasm-pack`/`cargo build` invocations for the WASM output — always use
`pnpm build:wasm` (see `AGENTS.md`), so the generated bindings and embedded binary stay in
sync with the TS side. That script also strips wasm-pack scaffolding that would otherwise
break the published package, so bypassing it will produce a broken tarball.

## License

Apache-2.0 — see [LICENSE](./LICENSE).

The Rust kernel this package compiles to WebAssembly is a fork of
[csgrs](https://github.com/timschmidt/csgrs) (MIT, © Timothy Schmidt, deriving from csg.js
© Evan Wallace). That MIT-licensed code is part of the published bundle, so its notice
travels with this package: see [NOTICE](./NOTICE) and
[THIRD-PARTY-NOTICES.txt](./THIRD-PARTY-NOTICES.txt).
