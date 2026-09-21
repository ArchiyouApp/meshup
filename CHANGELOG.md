# Changelog

All notable changes to `@archiyou/meshup` are documented here.
This project follows [semantic versioning](https://semver.org/); while on 0.x, minor
versions may contain breaking changes.

## 0.4.0 — 2026-09-21

### Added

- **Quality presets — one dial for how finely curved geometry is discretised.** `setQuality()`
  takes a preset name (`'draft'`, `'preview'`, `'normal'`, `'fine'`, `'precise'`) or a partial
  override, and `getQuality()` / `resetQuality()` read and clear it. It bundles what used to be
  four unrelated numbers across two languages: the curve chord tolerance, the facets a loft and
  a revolve lay per turn, and the segment counts of `Mesh.Sphere()` / `Mesh.Cylinder()`.

  ```ts
  setQuality('draft');                       // a whole preset
  setQuality({ curveSegmentsPerTurn: 24 });  // one dial, rest unchanged
  ```

  It is a global default, not a parameter to thread: every method keeps its explicit
  `tolerance` / `segments` argument and an explicit argument still wins, so
  `curve.tessellate()` follows the profile while `curve.tessellate(1e-5)` does what it says at
  any quality. A `setQuality()` written above the `await init()` is not lost — `init()` flushes
  the profile into the kernel once the WASM is up.

  `'normal'` is the default and reproduces the loft, revolve and mesh-primitive counts meshup
  has always used, so only the curve tessellation route moves.

  The BREP side of Archiyou has its own `MeshingQualitySettings` for OpenCascade's tessellator.
  The two are the natural pair for a later single quality dial across the whole engine;
  `Modeler._exportScene(quality)` is where they would meet.

- **`Curve.revolve()`, `Polygon.revolve()` and `Sketch.revolve()` — the lathe.** A closed profile sweeps into a
  solid (a full turn closes on itself, a partial one is shut with a flat cap at either end);
  an open one sweeps into a surface, and still closes into a solid when it begins and ends on
  the axis, so a half circle revolves into a sphere. Interior holes are revolved along with
  the boundary into a matching cavity. The profile is sampled the way a loft samples its
  own — a straight segment stays one face, a curved one subdivides by how far it turns — and
  the sweep gets `REVOLVE_SEGMENTS_PER_TURN` facets per full turn unless a count is passed.

  The signature follows the BREP kernel's `Shape.revolve()`: `revolve(angle, axisStart,
  axisEnd)`, degrees, 360 by default, negative to sweep the other way. A single point is read
  as a direction through the world origin, so `revolve(90, 'z')` means what it looks like.
  `Sketch.revolve()` reads its axis in sketch coordinates and places the result on the
  workplane, exactly as `Sketch.extrude()` does. `Polygon.revolve()` sweeps the face's
  boundary the way `Polygon.loft()` lofts it — and carries the face's holes along into a
  cavity, which `Polygon.extrude()` still drops.

  Left out entirely, the axis is **detected from the curve**, which the BREP kernel never got
  round to doing: a lathe axis has to lie in the profile's plane, so the world origin is
  projected onto that plane (a profile drawn on `y = 10` turns about a centre line of its
  own, not about a line its plane never meets), and of the world axes Z, Y then X the first
  one lying in that plane — and that the profile does not straddle — is taken. Sweeping
  across the axis folds the result through itself, so an axis the profile straddles is passed
  over; when every candidate straddles, one is used anyway with a warning.

  The mesh kernel could already revolve, but only in Rust: `Sketch::revolve()` turns around
  the local Y axis alone, ignores open profiles, and leaves holes out of its caps. Nothing on
  the TypeScript side reached it.

- **`Curve.tangent()` — the tangent of a straight Curve, asked without a point.** A straight
  Curve has one tangent along its whole length, so `tangentAt(somePointOnIt)` was ceremony
  around an answer the curve already knew:

  ```ts
  Curve.Line([0,0,0],[100,0,0]).tangent();  // <Vector { x: 1, y: 0, z: 0 }>
  Curve.Circle(50).tangent();               // null + a warning naming tangentAt()
  ```

  Anything that curves has a different tangent at every point of it, so there it warns and
  returns null rather than handing back the start→end chord — a direction that is the curve's
  tangent nowhere on an arc except by accident, and the zero vector on a closed curve.
  `tangentAt(point)` stays the method for those. Straightness is read from the native geometry
  (`isStraight()`), so a Polyline whose vertices are collinear answers as well as a Line does.

- **`Point`, `Vertex` and `Vector` now have `moveTo()` / `moveToX()` / `moveToY()` / `moveToZ()`**,
  so the call reads the same on a point as it does on a `Mesh`, a `Curve` or a `ShapeCollection`.
  `Vector` gains the relative `move()` / `moveX()` / `moveY()` / `moveZ()` along with them —
  `move()` is `add()` under the name the rest of the library uses.

  ```ts
  Curve.Line([0,0,0],[100,0,0]).start().moveToZ(50); // a Vertex, positioned like any shape
  Point.from(1,2,3).moveTo(200, 475, 0);
  Vector.from(1,0,0).moveToZ(1);
  ```

  All three are dimensionless, so where a shape re-centres its bbox on the target these simply
  set the position — a `Vertex` carrying its normal along untouched, and a `Vector` being a
  direction rooted at the origin. `Point` had `move()`/`moveX/Y/Z()` but no absolute counterpart
  at all and `Vector` had neither; `Vertex` inherited the `Shape` versions, which took the round
  trip through a degenerate bbox to reach the same answer.

- **`continuous()` — the counterpart of `dashed()`, on `Curve`, `ShapeCollection` and
  `SceneNode`.** There was no way back from a dash: once a layer was `.dashed()`, every line
  under it was, and a shape could only rejoin the solid ones by the layer changing. It sets the
  EMPTY dash pattern explicitly, which is what "no dashes" already means everywhere downstream
  (SVG omits `stroke-dasharray`, glTF gets the all-ones `0xFFFF` pattern) — and being explicit
  is the point: it wins in the style cascade over a dashed ancestor, while colour and width keep
  cascading as before.

  ```js
  layer('diagram').color('blue').dashed();
  centerline = line(a, b);                 // dashed, like the layer
  outline = line(c, d).continuous();       // solid, still blue
  ```

  The name is the DXF/CAD linetype it exports as — `DXFExporter` has always written
  `dashed ? 'DASHED' : 'CONTINUOUS'`. The brep kernel's `Shape` and `ShapeCollection` (in
  `@archiyou/core`) gained the same method, so a script does not have to know its kernel.

- **`Shape.first()` — a single Shape answers with itself.** `cutoffBy()`, `difference()` and
  `intersections()` hand back one Shape or a ShapeCollection depending on how the geometry falls,
  and a script cannot know which in advance, so `post.cutoffBy(diagonal).first()` now reads either
  way. brep's `Shape` has carried the method for this reason all along — as an empty stub that
  returned `undefined`, which is fixed in `@archiyou/core` in the same change.

- **`Curve.containsPoint()` — whether a point lies inside a closed Curve.** Inside the outline
  and outside every hole in it, so a point in the hole of a `difference()` result is *out*. An
  open or non-planar Curve encloses nothing and answers `false` (with a warning), as does a
  point off the Curve's plane. It is decided by a crossing count over the Curve's tessellation
  in its own plane, so a point sitting exactly ON the boundary is not answered reliably — this
  is a test for points that are clearly in or out. `intersection()` uses it to decide which
  pieces of a crossing curve are inside the region.

- **`Curve.cutoff(at, coord, smallest)` — the Curve twin of `Mesh.cutoff()` and
  `Polygon.cutoff()`.** The plane `{ <at> = coord }` meets the Curve's own plane in a line, and
  the Curve is cut by that line the way `cutoffBy()` cuts it: the biggest piece is kept (by
  length for an open Curve, by area for a closed one), the smallest with `smallest=true`. A
  straight Curve is cut in the plane that also holds the axis; a non-planar Curve is left
  unchanged with a warning.

- **`trim()` on every shape: another shape, an axis, or (on a Curve) two positions.** `Mesh`,
  `Polygon` and `Curve` all answer `trim(other, keepSmallest?)` as `cutoffBy()` and
  `trim(at, coord?, smallest?)` as `cutoff()`, the same as brep's `Shape.trim()` in Archiyou.
  A Curve also takes `trim(t0, t1)`, see below.

  ```js
  post.trim(roofLine);        // cutoffBy()
  post.trim('z', 2400);       // cutoff()
  beam.trim(0.1, 0.9);        // Curve only: keep 10%..90% of the length
  ```

### Changed

- **`Curve.trim(t0, t1)` trims in place and returns the Curve.** It used to return a NEW Curve
  in an array (always one) and leave the Curve as it was, unlike `cutoff()` and `cutoffBy()`,
  which it now sits beside as a third form of `trim()`. The positions are fractions of the
  length in [0, 1], as they always were (the old doc comment said knot domain, which was wrong),
  and are now checked: anything outside [0, 1] throws. Equal positions leave the Curve
  unchanged with a warning.

- **`ShapeCollection.rotate()` / `rotateX/Y/Z()` / `rotateAround()` turn the collection as a
  GROUP, about its own centre — the same default `scale()` has always used.** With no pivot given
  they called each member's own `rotate()`, which turns about the WORLD ORIGIN, so a group could
  not be turned about itself at all: `parts.rotateZ(90)` swung a group standing at x = 1000 a
  quarter turn round the origin, while `parts.scale(2)` grew it where it stood. The pivot is now
  resolved ONCE for the whole collection (the collection's `center()`, or the world origin when
  the collection is empty) and handed to every member — which is exactly what makes it a group
  transform rather than every shape spinning on the spot.

  ```js
  parts.rotateZ(90);              // the group turns about its own centre
  parts.rotateZ(90, [0, 0, 0]);   // ... about the world origin, as before
  ```

  `rotate()` is now an alias of `rotateAround()` on a collection (it always forwarded to it once
  an origin was given), and it takes an arbitrary axis vector as well as 'x'/'y'/'z'.
  `rotateQuaternion()` is unchanged: it has no pivot to resolve, and each kernel class keeps its
  own centring behaviour there.

- **BREAKING: `intersect()` now REPLACES the shape with the intersection, on Curves as well as
  Meshes — it is no longer a getter for intersection points.** `intersect()` meant two unrelated
  things depending on which kernel and which shape you had it on: on brep it replaces the shape
  with the intersection (`subtract()`/`union()` semantics), while meshup's `Curve.intersect()`
  returned an `Array<Point>` of crossings and left the curve alone. One name, two results, and
  `Mesh` had no `intersect()` at all.

  The mesh kernel now follows brep, and the three spellings mean one thing each on both kernels:

  | call | does |
  |---|---|
  | `a.intersect(b)` | replaces `a` with what it shares with `b` (like `union()`, `subtract()`) |
  | `a.intersection(b)` | leaves `a` alone; the shared shape is a NEW shape on the active layer |
  | `a.intersections(b)` | the same, for all of the shared shapes |
  | `a.intersects(b)` | boolean predicate, unchanged |

  `Mesh.intersect()` is new (it delegates to the mutating `_intersection()` that `cutoffBy()` and
  `overlapPerc()` already used). For a Curve, a single shared piece updates the Curve in place;
  Vertices, or several pieces, take its place in the scene the way `difference()` does.

  **There is no replacement point-getter, and none is needed**: the crossing points are the
  `vertices()` of the intersection, because an intersection now answers with Vertices wherever
  the two shapes only cross. What used to be `line.intersect(other)[0]` is
  `line.intersection(other)` — a Vertex, which is a PointLike, so it can be handed straight to
  `line()`, `polyline()`, `move()` and friends. Being a real shape it lands on the active layer:
  add `.hide()` when it is only scaffolding for the next step.

- **`Curve.difference()` / `Curve.subtract()` take collections, and refuse to subtract a Curve
  from itself.** They used to take exactly one `Curve`. Handing them a `ShapeCollection` —
  `band.subtract(layer('rafters').shapes())`, the way `Mesh` and `Polygon` have always worked —
  called `other.inner()` on the collection, and `_booleanOp`'s catch swallowed the `TypeError`
  and surfaced it as a bare `null` with "Boolean operation failed". Both now accept any mix of
  Curves, ShapeCollections and varargs.

  Cutters are applied in order, each to every piece produced so far, so a cutter that splits the
  region in two is still followed correctly by the next one, and a cutter whose boolean fails is
  skipped with a warning instead of costing the whole result. Two kinds of cutter are skipped on
  purpose: collection members that are not Curves, and a cutter that *is* the receiver. That
  last one is the other half of the same trap: a layer's collection also holds the shape you
  built while that layer was active, so `band.subtract(layer('rafters').shapes())` was quietly
  subtracting the band from itself — an empty region, i.e. `null` again. `Mesh.difference()`
  now skips a self-cutter the same way.

  The result contract is unchanged: `this` when a single region is left, a
  `ShapeCollection<Curve>` when the cut split it into several, `null` when the cutters removed
  everything or when a single cutter's boolean failed outright.

- **Curve tessellation no longer depends on the curve's size or the model's unit.** The kernel
  had two disagreeing samplers: `tessellate_path` (ellipses, splines) read its chord error as a
  fraction of the span, while `tessellate_open` / `tessellate_closed` — every circle, arc,
  fillet, offset and boolean result — ran hypercurve's *certified* projection, which reads it as
  an absolute distance. So a circle's point count grew with its radius and again with the choice
  of millimetres over metres:

  | | before | after |
  |---|---|---|
  | `Curve.Circle(10).tessellate()` | 226 pts | 65 pts |
  | `Curve.Circle(100).tessellate()` | 706 pts | 65 pts |
  | `Curve.Circle(1000).tessellate()` | 2224 pts | 65 pts |
  | `Curve.Circle(5000).tessellate()` | 3144 pts | 65 pts |
  | `Curve.Rect(1000,500).fillet(50)` | 505 pts | 69 pts |
  | `Curve.Circle(100).extrude(50)` | 708 polys | 67 polys |
  | `Curve.Rect(1000,500).fillet(50).extrude(100)` | 507 polys | 71 polys |

  Both extrudes also run about ten times faster (~220 ms → ~20 ms in Node, cold).

  Every mesh built from a curve — `extrude`, `loft`, `toPolygon`, `toMesh`, `sweep` — inherited
  that density, which is what made models heavy. Both routes now go through one sampler that
  sizes an arc by how far it **turns**: `segmentsPerTurn × |sweep| / 2π`, from the sweep the arc
  already knows exactly. What is given up is the chord-error *certificate* on the closed/open
  route; what is bought is a count that is the same at r = 10 and at r = 10 000. For comparison,
  `Mesh.Cylinder(100, 50)` — the same solid — has always been 96 polygons.

  Ellipses and splines are unchanged: they have no exact turn to read and keep the relative
  chord heuristic they already used.

- **Metric queries no longer follow the display quality.** `length()`, `area()`, `bbox()`,
  `intersection()` and the parameter-inversion table behind `pointAt` / `distance` /
  `closestPoints` / `perpendicularPointTo` answer *where something is*, not *what it looks
  like*. They now sample at a fixed fine tolerance of their own, so asking for a draft preview
  does not move a `split()` point or shorten a measured length. Their polylines are transient —
  nothing downstream carries the vertex count — so the density costs only time, and it is
  capped where it always was (512 samples per span), so no metric query got slower either. The
  error bound hypercurve certifies when offsetting a spline is likewise held at its own
  absolute value rather than borrowed from the display dial.

- **A tessellation tolerance is now read relatively.** `tessellate(1e-4)`, and every other
  explicit `tolerance` argument, means "within 0.01% of the span's own size", not "within 0.1
  model units". Roughly, `1e-2` → 22 facets per full turn, `1e-3` → 70, `1e-4` → 222, `1e-5` →
  702 — at any radius. Callers asking for accuracy get the same answer as before; callers who
  had tuned a number against a particular model scale will want to re-read it as a fraction.

- **`Curve.Circle` and other contour geometry no longer tessellate to their chords in the
  kernel's path sampler.** `Curve2::point_at` evaluates a span in its rational-quadratic Bezier
  form, which cannot represent a half turn — every interior parameter of a 180° arc collapses
  onto its end point. Harmless while that sampler only saw ellipses (pre-split into quarter
  turns); circles reach it now, so arcs are sampled through `point_at_sweep_fraction` instead.

- **`elevation()` and `section()` take a method and an options object, the way `isometry()`
  does**, on `Mesh` and on `ShapeCollection`. The options are the same `ProjectionOptions` for
  all three projections, with their defaults in `PROJECTION_DEFAULTS`.

  ```js
  model.elevation('front', 'exact', { hiddenLines: true });
  model.section([0, 0, 1200], [0, 0, 1], 'raycast', { samples: 64 });
  model.elevation('left', undefined, { featureAngle: 20 });   // default method
  ```

  The positional forms keep working, trailing `{ strategy, fallback }` object included: saved
  scripts call them. They are marked deprecated in the type signatures.

- **`ShapeCollection._iso(cam, options)` and `_elevation(from, options)` take the method and
  settings as one object** — `{ method, hiddenLines, includeHiddenShapes, samples,
  featureAngle, fallback }` — instead of positional arguments and a trailing `view` object. A
  setting left out or given as `undefined` takes its default.

- **One set of projection defaults.** `EDGE_PROJECTION_DEFAULTS` asked for 32 samples while
  every projection entry point used 16, and its default plane normal `[1,1,1]` was not even
  parallel to its default view direction `[-1,-1,1]`. It now holds the defaults the entry points
  use (16 samples, 10°, a plane facing away from the default camera), and they read them from
  there instead of repeating the numbers. Only a direct `Mesh._projectEdges()` or
  `_projectEdgesSection()` call that leaves settings out sees a difference.

### Fixed

- **The piece of a curve inside a closed one is cut at the boundary, not near it.**
  `intersection(rect)` trimmed the curve at the arc-length PARAMETER nearest each crossing rather
  than at the crossing itself, so the piece's ends sat a few 1e-15 off the outline they were cut
  at — and that is exactly the geometry a script reads back as `intersection(rect).vertices()` to
  place a bolt on. It now cuts through hypercurve's `trim_between_points`, at the crossings, and
  does so for every boundary of the region: a hole is a place the curve leaves it just as the
  outline is.

  Doing that needed one more thing from the kernel. A straight line lies in infinitely many
  planes and is fitted to one of them — a line along X is fitted to XY, its z being constant —
  so it could not take an XZ elevation as a cutter even though it lies squarely in it. The exact
  split and the exact extension now put both curves in ONE frame, this curve's when the partner
  maps into it and the partner's when it does not. The answer is the same geometry either way,
  carried in a frame both are exact in.

- **Intersection points are no longer rounded to a 1e-5 grid.** Every hit came back through
  `Point.round()` at `POINT_TOLERANCE`, on the theory that a tidy number is a safer one to carry
  forward. The opposite was true: hypercurve computes the crossing exactly, and the snap threw
  away up to **5e-6** of it — so `intersection()` reported a point that was not on either curve,
  and a bolt placed there sat beside the joint rather than in it. A crossing at x = 137.70011 on
  a line of slope 1/3 now answers z = 45.900036666666665, which is the crossing; it used to
  answer 45.90004.

  Nothing has to be tidied for it: a crossing that lands on a round number still reads as one
  (two lines meeting at 50 answer 50, not 49.999999999999996). It is the crossings that do not
  that were being moved. This was also the source of `extendTo()`'s old 1e-6 miss, since the
  reach was measured to the rounded point — that route is exact now for other reasons, but the
  rounding is gone from every caller.

- **Coplanar curves now share one canonical frame, so what hypercurve computes exactly stays
  exact on the way out.** Each curve carried a frame derived from its own points — origin at its
  first vertex, x along its first edge — and hypercurve's exactness is exactness *within* a
  frame. Two coplanar curves therefore had two different frames, and every operation that put
  them together (`extendToCurve`, `splitAtCurve`, every boolean) had to map one into the other
  through an f64 similarity first. That mapping rounds by about one ULP of the coordinates, and
  in an exact kernel a ULP on the wrong side is a gap: a curve extended onto another landed
  1e-13 past it or 1e-13 short of it, and the cut that followed either separated cleanly or came
  back as one pinched region, on a coin toss.

  When a curve's plane normal IS a world axis — plan, elevation and section work — its frame is
  now the canonical frame of that plane: exact unit axes, the origin at the plane's foot from the
  world origin. `to_local`/`to_world` become coordinate selection plus an exact offset, two
  coplanar curves carry the same frame bit for bit, and the map between them is the identity.
  `extendTo()` across such a plane now lands with a miss of **exactly zero** (it was 2.8e-14 to
  9.2e-14 with the exact extension alone, and 5.5e-7 before that). A tilted plane keeps its
  fitted frame: its normal cannot be snapped to an axis without inventing geometry.

  A straight line is planar-ambiguous — it lies in infinitely many planes, and a line held at
  both x = 0 and y = 200 fits itself to the y-plane while the curve being extended onto it sits
  in the x-plane. Those two frames are not related by a planar similarity at all, so the exact
  route used to decline and fall back to the measured extension. Such a target is now expressed
  in the other curve's frame through world coordinates, which asks the question that matters —
  are its points in THIS plane? — and keeps the extension exact.

- **`cutoffBy()` re-cuts across a gap the coordinates cannot express.** Even with an exact
  extension and canonical frames, geometry that arrives by another route — an offset, a
  projection, a tilted plane, an imported outline — can still miss a shared edge by a ULP. To an
  exact boolean the width is irrelevant and only the side matters: a residue inside the shape
  leaves the two halves joined by a bridge 1e-13 wide, and one crossing the edge leaves a
  zero-width tab, so a cut quad reports five corners. Neither is a cut.

  A closed-vs-closed cut is now also tried with the cutter grown by a few ULP of the shape's own
  size (`UNREPRESENTABLE_GAP_RATIO`), and the nudged answer is taken only on evidence: it must
  find MORE pieces than the exact cut (it separated what was joined), or the same pieces
  enclosing the same area with FEWER corners (it removed a phantom tab). A cutter that genuinely
  bites a corner, or genuinely falls short, is left exactly as the exact boolean answered it.
  Nothing real can be closed at that width — two boundaries a ULP apart are not close, they are
  indistinguishable in f64.

  Measured on the shape this came from: cutting the URBENT post by its brace over seven beam
  widths and two brace rules, 14 of 14 now answer with the 4-vertex, 4-edge quad. Before the
  exact extension, 1 of 14 did.

- **A three-point arc through a mid point diametrically opposite its own chord no longer bulges
  the wrong way.** For an exact semicircle the sweep's sign carries no information —
  `atan2(0, negative)` answers +pi whichever way the arc runs — and `arc_3pt` took that +pi
  without consulting the mid point, so `makeArc((0,0), (5,5), (10,0))` came back through
  (5, −5). It went unseen because a curve's frame used to be derived from its own points, and in
  that frame the +pi choice happened to be the right one; canonical frames removed the
  coincidence. The direction now comes from the side the mid point is on, which is the only thing
  that distinguishes the two halves of a circle.

- **`extendTo()` now lands ON its target, through hypercurve, instead of extending by a measured
  length that always fell a little short.** It measured the reach to the crossing and called
  `extend(length)`, which places the tip at `anchor + direction x length` — never exactly the
  crossing. Worse, the crossing it measured to had been rounded to `POINT_TOLERANCE` (1e-5)
  first, so for any crossing that did not happen to fall on that grid the endpoint missed the
  target by up to **1e-6**. An axis-aligned target rounded to itself and looked perfect, which
  is why only some extensions were off.

  A residue that size is not cosmetic here: every boolean in this kernel is exact, so a curve
  that stops short of the shape it was extended to does not meet it at all. Cutting the two
  against each other left them joined by a wedge that thin — one 8-vertex region where there
  should have been two 4-vertex ones — and no amount of extra accuracy in the measurement fixed
  it: gaps of 1e-7, 1e-9 and 1e-12 all pinch identically. Only landing exactly on the point does.

  The extension now happens inside hypercurve's exact arithmetic (new `Curve3DJs::extendToCurve`):
  the crossing is found exactly, kept as a `Point2` with `Real` coordinates and handed to
  `extend_endpoint_to_point`, which rebuilds the end segment with that point verbatim as its
  endpoint. TypeScript still decides *which* end moves and to *which* target; only the extension
  itself moved into the kernel. Measured on the shapes it was found on:

  | | before | after |
  |---|---|---|
  | axis-aligned target | 2.8e-14 | 2.8e-14 |
  | oblique target | 5.5e-7 | 2.8e-14 |
  | brace onto a wall line (URBENT) | 1.3e-6 | 9.2e-14 |
  | target crossing off the 1e-5 grid | 1.0e-6 | **0** |

  What that left was the f64 round trip through the curve's own 3D frame — about one ULP of the
  coordinates — which the canonical plane frames above then removed for any curve on a world-axis
  plane, taking the miss to exactly zero.

  Unchanged: an end that is an ARC has no straight continuation to intersect, and a target that
  never crosses (converging curves) has no crossing to land on. Both keep the measured
  extension, as does anything the exact route declines — a spline, a non-coplanar target.

- **`cutoffBy()` cuts an open Curve exactly at the cutter.** The open branch mapped each crossing
  to an arc-length parameter and trimmed there, so the piece ended wherever that parameter landed
  — the mapping runs on the tessellation. The pieces are now trimmed at the crossing POINTS
  themselves, by hypercurve's `trim_between_points` (new `Curve3DJs::splitAtCurve`), so a piece
  ends precisely on the cutter. `trim(t0, t1)` is unchanged and still arc-length based: the arc
  length of an arc is transcendental, so there is no exact fraction to trim at — which is why
  the exact route is point-based.

- **`cutoffBy()` keeps the biggest PIECE, not the bigger side.** With a cutter that genuinely
  separates a closed Curve, the outside is two pieces and the inside one; comparing the two
  *sides* by total area returned the whole outside side as a collection, whose first member was
  whichever piece the boolean happened to emit first — so `post.cutoffBy(brace).first()` handed
  back the small offcut. Every piece from both sides is now measured and the biggest single one
  wins, as brep's `Shape.cutoffBy()` and the two branches beside it already did.

- **A boolean no longer hands back the no-area sliver it leaves along an edge the two shapes
  share.** Where a post's top edge IS the roof line its diagonal is built on, hypercurve's region
  engine emits, alongside the real result, a region that runs out along that shared edge and back:
  length 376, bbox 150 x 114, **area 0.00008**. It survived into the result as an extra piece —
  and as the FIRST one, so `post.cutoffBy(diagonal).first()` handed back a curve enclosing
  nothing, which then offset and extruded into rubbish.

  Every region a boolean produces is now checked for enclosing anything at all, by its own
  isoperimetric ratio — area over the square of a quarter of its perimeter. That is 1 for a
  square, 0.79 for a circle, 1e-5 for a hair-thin but REAL sliver (0.001 across 400), and 1e-9
  for this noise; regions below 1e-6 are dropped. Being a ratio it is scale-free, so it means the
  same whether the model is in millimetres or metres — which no absolute area threshold does.

  When *every* region is degenerate, the shapes genuinely share no area: two rects touching along
  one edge now answer `intersection()` with null and a warning that says so, rather than with a
  sliver standing in for the shared line.

- **`Curve.cutoffBy()` keeps the BIGGEST part when both curves are closed — it used to hand back
  whichever part happened to be inside the cutter.** The closed-vs-closed branch never compared
  the two pieces: it returned the intersection (the part inside the cutter) by default and the
  difference for `keepSmallest`, so the pair was inverted whenever the cutter covered less than
  half the shape — the normal case. A post outline cut by the diagonal crossing its top corner
  came back as the small corner overlap instead of the post below it:

  ```js
  post.copy().cutoffBy(diagonal);        // the post minus the knee, not the knee
  post.copy().cutoffBy(diagonal, true);  // ... and now the knee
  ```

  The two parts (inside the cutter, outside it) are now measured by area and the bigger one wins,
  which is what `Mesh.cutoffBy()`, `Polygon.cutoffBy()` and brep's `Shape.cutoffBy()` have always
  done, and what the open-curve and closed-cut-by-line branches next to it already did. A cutter
  that misses the Curve, or swallows it whole, leaves it unchanged with a warning rather than
  returning null.

- **A hole no longer stays behind when its Curve is moved, keeps its old size when the Curve is
  scaled, or vanishes when the Curve is mirrored.** The interior holes a `difference()` leaves on
  a Curve are Curves of their own hanging off the boundary, and only some of the transforms
  carried them: `rotate*()`, `mirror()` and `projectOnto()` did, `translate()` and `scale()` did
  not. So `rect(100,100).difference(rect(20,20)).move(500, 0, 0)` moved the outline to x = 500 and
  left its hole at the origin, and `scale(2)` doubled the outline around a hole that stayed 20 wide
  (`area()`, which subtracts the holes, went wrong with it).

  `mirror()` was worse than it looked: it mapped over `this._holes` *after* an `update()` that
  had already replaced that array with the (empty) holes of the new boundary curve, so the hole
  was not left behind but lost outright. The resampling branches of `scale()` and `projectOnto()`
  went through the same `update()`. Every transform now holds the holes aside first, and passes
  each one the RESOLVED pivot / plane / origin so it follows its boundary instead of turning about
  its own centre.

  The pivot shuffle inside `rotateAround()`, `scale()` and `projectOnto()` — shift to the pivot,
  transform, shift back — now runs on the boundary alone (`_translateBoundary()`), so a hole is
  never transformed twice, once by the shuffle and once by its own call.

  Still not carried, and unchanged here: `offset()`, `fillet()`, `chamfer()`, `mergeCollinear()`
  and `closePath()` drop the holes of the curve they rebuild. Offsetting or filleting a region
  *with* its holes is a feature rather than a fix — the hole would have to offset inward by the
  same amount.

- **`Curve.rotateX()` / `rotateY()` / `rotateZ()` / `rotateAround()` turn about the curve's own
  centre when no pivot is given, not about the world origin.**
  `circle(20).move(100, 100, 10).rotateX(90)` stood the circle up *and* swung it around the world
  origin, landing it at y = −10, z = 100 — while the box modelled next to it turned where it
  stood, because `Mesh.rotateAround()` and `Polygon.rotateAround()` have always defaulted their
  pivot to `this.center()`. The same script line meant one thing for a solid and another for the
  outline beside it, and the mesh kernel disagreed with brep (whose `rotateX/Y/Z` default to the
  shape centre too). It was pinned as divergence #3 in `@archiyou/core`'s
  `kernel-divergences.test.ts`, now deleted.

  ```js
  circle(20).move(100, 100, 10).rotateX(90);            // turns where it stands
  circle(20).move(100, 100, 10).rotateX(90, [0, 0, 0]); // ... about the world origin
  circle(20).move(100, 100, 10).rotate(90, 'x');        // rotate() IS the origin-based turn
  ```

  `rotate()` is unchanged and stays the explicitly origin-based turn on Curve, Mesh and Polygon
  alike; pass a pivot to any of the others to say where the axis goes. A hole now turns about its
  boundary's pivot rather than about its own centre — the recursive call passed the *unresolved*
  pivot, so a `difference()` hole would have spun away from its boundary the moment the default
  was used.

  Scripts that leaned on the old default — turning a group of curves about the origin by rotating
  each one — need the pivot spelled out: `shape.rotateX(90, [0, 0, 0])`.

- **`intersection()` of an open Curve with a closed one now gives the piece of curve inside it,
  instead of always `null`.** `line.intersection(rect)` — a line crossing a closed rect — is the
  plainest case there is, and it answered nothing at all: `_intersectionCurve()` ran hypercurve's
  region boolean for *every* curve pair, and the guard meant to stop that was `if(!this.isClosed)`
  — the **method**, always truthy, so it never fired. hypercurve then refused the open operand
  (*"'this' is not a closed region"*) and the whole call came back null.

  The pair is now dispatched on what the two curves are:

  - closed + closed: the region boolean, exactly as before.
  - open + closed: the part(s) of the open curve **inside** the closed one — the same answer a
    brep `Edge` ∩ `Face` gives. The curve is split at every crossing of the region boundary,
    *including the boundary of any hole*, and the pieces whose midpoint is inside are kept, so a
    line through a holed rect comes back as two pieces with the hole left out. A curve entirely
    inside comes back whole; one entirely outside is `null`. Symmetric: `rect.intersection(line)`
    gives the same piece of line.
  - open + open: two open curves share no length, only the **Vertices** where they cross — which
    is what a brep `Edge` ∩ `Edge` answers with too. A curve that merely touches a closed one
    answers with the touch Vertices for the same reason.

  ```js
  r = rect(10, 20);
  l = line([-100, 0, 0], [100, 10, 0]);
  l.intersection(r);              // Curve — the ~10 long piece of the line inside the rect (was null)
  l.intersection(r).vertices();   // the two crossing points, [-5, 4.75] and [5, 5.25]
  l.intersection(otherLine);      // Vertex — two open curves have nothing but their crossing
  ```

- **`segments()` no longer throws on a curve that `connect()` has joined.** Joining two curves
  glues them with connector lines and combines the lot; every joint comes back as a separate,
  zero-length span. `segments()` fed each control-point pair to `Curve.Line()`, which refuses a
  zero-length line — so `edges()`, `select('E…')` and everything built on them died with
  *"Cannot create a zero-length line"* on any connected curve. Zero-length pairs are now skipped
  (they are no edges), matching what `vertices()` and the collinear merge already did.

- **`extendTo()` now lands exactly on its target instead of stopping short.** It measured the
  gap with the sampled `closestPoints()`, whose accuracy is set by 30 seed samples spread over
  a probe deliberately far longer than the gap itself (`length*10 + target*2 + 1000`), refined
  by an alternating-closest-point loop capped at 15 iterations that converges slowly wherever
  the crossing angle is shallow. The error therefore grew with the *probe* rather than shrinking
  with the extension: a brace extended to a wall line at ~28° stopped **4mm** short of it, and
  a longer curve would have missed by more.

  It now asks hypercurve's exact native `intersect()` for the true crossing and takes the
  nearest hit ahead of the endpoint, falling back to the sampled closest approach only when
  nothing actually crosses — which is what makes `extendTo()` work for converging-but-not-
  meeting curves and is still supported. The same brace now lands within **2e-6**.

  A real crossing also beats a closest-approach guess now, whichever end it is on: the whole
  ray is searched for true intersections first. Before, a curve that genuinely crossed a target
  300 away could lose to its *other* end drifting within 4 of it, and the wrong end moved.

- **Curve crossings are no longer reported as "no intersection" for a pair that can actually be
  solved.** (In the hit finder behind `intersection()`, `cutoffBy()` and `extendTo()`.)
  hypercurve plane-fits THIS curve to project the other into it, and that fit is ill-defined
  for a straight line: an axis-aligned line comes back empty one way round and *throws*
  (`open polyline failed (EmptyCurveString)`) the other. The finder has always retried with
  the operands swapped for exactly this reason, but a single `try/catch` wrapped **both**
  attempts, so a throw on the first order swallowed the swap that would have found the hit.
  `Curve.Line([0,0,0],[-3200,0,0]).intersection(verticalLineAtX)` logged an error and returned
  null instead of the crossing at x = -300. Each order is now attempted on its own; null is
  returned only when neither can answer.

- **`grid()` no longer returns nothing when a count is zero.** `Mesh.grid()`, `Curve.grid()`
  and `ShapeCollection.grid()` floor their per-axis counts and clamp them to at least 1, so
  `grid(4, 3, 0, [100, 100, 0])` — the natural way to write a flat grid in XY — lays out the
  12 copies it reads as instead of an empty collection. Nothing was ever added to the scene
  before, since there was nothing to add. Counts that are not finite numbers still throw, and
  `Mesh.array()` shares the same rule.

- **`grid()` and `array()` no longer leave a duplicate on top of the source shape.** The cell
  at `[0, 0, 0]` is now the source shape itself, the way `row()` has always done it, rather
  than a copy laid over a source that stays in the scene. A 4×3 grid puts 12 shapes in the
  scene, not 13.

## 0.3.0 — 2026-08-19

Makes `@archiyou/meshup` usable as a published package rather than only as a workspace
sibling. Nothing in the geometry changed.

### Added

- **The root export is now complete.** `Color`, `Style`, `TOLERANCE`,
  `SHAPE_DEFAULT_STYLE`, `isPointLike`, the `SpanParams`/`SpanPoint` types, `rad`, `deg`,
  `nodeToString`, `GLTFJsonDocumentToString` and the twelve scene-membership decorators
  (`sceneAdd`, `sceneCarry`, `sceneReplace`, `sceneUpdate`, `activeLayerOf`,
  `addResultToScene`, `replaceInScene`, `sceneLayer`, `sceneReplaceOrKeep`, `colSceneAdd`,
  `colSceneLayer`, `colSceneReplace`) are exported from the package root. They were
  reachable only through `@archiyou/meshup/src/*` before, which is a subpath that maps onto
  TypeScript — fine inside a monorepo, impossible for anyone installing from npm, since
  Node refuses to strip types under `node_modules` and most bundlers will not compile
  `.ts` found there.

  The decorators are a deliberate part of the public surface: a method that produces a shape
  has to declare what becomes of it, so anyone building shape-producing methods on meshup
  needs them.

### Changed

- **The published package exposes only its root.** `exports` in the tarball is `.` plus
  `./package.json`; the `./src/*` subpath is gone from it, so no consumer can accidentally
  import raw TypeScript. Inside this repository nothing changes: the workspace manifest
  points `.` at `src/index.ts` and keeps `./src/*`, so an edit here is still live for the
  monorepo with no build step. The swap happens through `publishConfig`.

  If you were deep-importing from `@archiyou/meshup/src/…` as an outside consumer — which
  could not have worked at runtime — import from the package root instead.

## 0.1.0 — 2026-08-18

First published release. Previously the package was private to the Archiyou monorepo and
was never installable from npm.

### Changed

- **`isometry()` solves hidden lines exactly by default.** The default strategy moved from
  `'raycast'`, which probes visibility at a finite number of points along each edge, to
  `'exact'`, which solves occlusion as parametric intervals. Output is markedly cleaner: a
  straight edge comes back as a plain two-point segment instead of a polyline carrying every
  probe position, and an occluder narrower than the probe spacing can no longer be missed.
  `samples` is a raycast-only knob and has no meaning for the exact solver — pass
  `'raycast'` explicitly to keep the old behaviour. The other strategies (`'clip'`,
  `'painter'`) are unchanged.

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

- **Exact hidden-line removal left the endpoints of fully hidden edges detached.** Because
  `DEPTH_BIAS_REL` finds an occlusion crossing a hair *inside* a shared vertex rather than
  exactly at it, each hidden edge of a solid began at the biased crossing instead of at the
  corner — `4.71e-8` of the scene extent short, scaling with the model. The runt visible
  fragment beside it was already discarded as an artefact, but nothing pulled the surviving
  hidden piece back out to the vertex, so those endpoints coincided with nothing and
  exported as open paths in SVG and DXF. A cube produced three such orphans. Retained
  pieces are now snapped to the edge ends, over the same `min_span` reach that decides a
  piece is not real line work, so the correction can never move an endpoint by a distance a
  drawing could show.

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
