/* tslint:disable */
/* eslint-disable */

export class BooleanRegion3DJs {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Number of holes.
   */
  holeCount(): number;
  /**
   * The interior hole curves.
   */
  holes(): Curve3DJs[];
  /**
   * The exterior boundary curve.
   */
  readonly exterior: Curve3DJs;
}

export class ClosestPointResultJs {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  readonly pointX: number;
  readonly pointY: number;
  readonly pointZ: number;
  readonly distance: number;
  readonly normalX: number;
  readonly normalY: number;
  readonly normalZ: number;
  readonly isInside: boolean;
}

export class Curve3DJs {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Close the curve by appending a straight segment from its end back to its start,
   * preserving every existing span. Returns an equivalent curve when already closed.
   */
  closePath(): Curve3DJs;
  /**
   * Unit tangent at normalised arc-length parameter `t` in `[0, 1]`.
   */
  tangentAt(t: number): Vector3Js;
  /**
   * Tessellate to 3D points.
   */
  tessellate(tol?: number | null): Point3Js[];
  /**
   * Construct a circle of `radius` centred at `center`, in the plane whose
   * normal is `normal`.
   */
  static makeCircle(radius: number, center: Point3Js, normal: Vector3Js): Curve3DJs;
  /**
   * Rotate the curve by `angle` radians about a world axis through the origin.
   * A planar curve rotates rigidly, so only its frame changes.
   */
  rotateAxis(angle: number, ax: number, ay: number, az: number): Curve3DJs;
  /**
   * Every exact span, described by the parameters a file format needs to write it.
   *
   * One entry per span, in order, matching [`Self::segment_count`]. Each is a plain JS
   * object tagged by `kind`, carrying world-space 3D points and — for arcs and conics —
   * the centre, radius, sweep and axes that define the underlying circle or ellipse.
   *
   * This exists because the other accessors answer questions a *writer* cannot use.
   * `subtype()` names the whole curve, not a span, and has no name for "lines and arcs
   * mixed"; `controlPoints()` returns span endpoints, which is an arc's chord; `knots()`
   * and `weights()` are empty unless the curve is one single NURBS span. Given only
   * those, an exporter has to guess — and both of meshup's exporters guessed wrong, one
   * re-deriving an arc's circle from three tessellated samples and the other writing a
   * malformed SPLINE for any curve with a fillet in it.
   *
   * Deliberately plain data rather than a list of exported objects: a `Vec` of
   * `#[wasm_bindgen]` structs would hand back N handles for the caller to `free()` on
   * every export, and this crate has already been bitten by wasm-bindgen ownership
   * (see `Curve3DJs::concat`, which must take its operand by reference, and
   * `tests/unit/wasmOwnership.test.ts`). Plain objects own nothing.
   */
  spanParams(): any;
  /**
   * The curve's plane as three vectors `[normal, localX, localY]`.
   */
  getOnPlane(): Vector3Js[];
  /**
   * Parameter domain. Curves are re-parameterised by normalised arc length,
   * so the domain is always `[0, 1]`.
   */
  knotsDomain(): Float64Array;
  /**
   * Construct a full **ellipse** (closed) with semi-axes `radius_x`/`radius_y`,
   * its major axis rotated `rotation` radians in-plane, centred at `center`, in
   * the plane whose normal is `normal`. Backed by exact rational conic spans.
   */
  static makeEllipse(radius_x: number, radius_y: number, rotation: number, center: Point3Js, normal: Vector3Js): Curve3DJs;
  /**
   * Construct a polyline (open or closed) through 3D control points.
   */
  static makePolyline(points: Point3Js[], closed: boolean): Curve3DJs;
  /**
   * Number of exact spans.
   */
  segmentCount(): number;
  /**
   * Defining vertices (span endpoints) as 3D points.
   *
   * One point per exact span, plus the final endpoint on an open curve — so an ellipse
   * yields its four conic span joints, not several hundred sampled points.
   */
  controlPoints(): Point3Js[];
  /**
   * The arc-length parameter (in `[0, 1]`) at absolute length `len`.
   */
  paramAtLength(len: number): number;
  /**
   * Construct a smooth NURBS curve of `degree` (>= 2) interpolating the given 3D points.
   *
   * Stored as the **exact** spline. This used to compute the NURBS and then immediately
   * discard it for a 1e-5-chord polyline, so a spline arrived in meshup as ~2400
   * degree-1 segments: `degree()` reported 1, `controlPoints()` returned thousands of
   * sampled points rather than the solved control net, and every downstream operation
   * worked on line work.
   */
  static makeInterpolated(points: Point3Js[], degree: number): Curve3DJs;
  /**
   * Rotate the curve by a unit quaternion `(w, x, y, z)` about the origin.
   */
  rotateQuaternion(w: number, x: number, y: number, z: number): Curve3DJs;
  /**
   * Per-axis scale about `origin`, exact for **closed** curves.
   *
   * A per-axis scale is not a similarity, so hypercurve's `transform_similarity` cannot
   * express it — but the map it induces *within* the curve's plane is a plain 2D affine,
   * and `CurveRegion2::transform_affine` accepts one. Scaling a circle by `[2, 1, 1]`
   * therefore yields an exact **ellipse** of rational conic spans.
   *
   * Returns an error for open curves (a region is required) and for a scale that
   * collapses the plane; the caller falls back to resampling.
   */
  scaleNonUniform(sx: number, sy: number, sz: number, origin: Point3Js): Curve3DJs;
  /**
   * Construct an **elliptical arc** from `start_angle` to `end_angle` (radians,
   * in the pre-rotation circle parameter). A full turn yields a closed ellipse.
   * Semi-axes `radius_x`/`radius_y`, rotated `rotation` radians in-plane, centred
   * at `center`, in the plane whose normal is `normal`.
   */
  static makeEllipticalArc(radius_x: number, radius_y: number, rotation: number, start_angle: number, end_angle: number, center: Point3Js, normal: Vector3Js): Curve3DJs;
  /**
   * Tessellate each native segment separately, returning a JS array of flat 3D
   * point arrays (`Array<Float64Array>`, `[x,y,z,...]` per segment). Lets the TS
   * layer rebuild a faithful compound curve (one span per arc/line) instead of a
   * single flattened polyline.
   */
  segmentTessellations(tol?: number | null): any;
  /**
   * The arc-length parameter (in `[0, 1]`) of the tessellation vertex closest
   * to the given 3D point.
   */
  paramClosestToPoint(p: Point3Js): number;
  /**
   * Signed area (closed curves only); `None`/error for open curves.
   */
  area(): number;
  /**
   * World axis-aligned bounding box as `[minx,miny,minz, maxx,maxy,maxz]`.
   *
   * Solved exactly from the native geometry rather than min/maxed over a tessellation,
   * which always fell short on an arc bulge that was not a sample point (a 30°-rotated
   * 50x25 ellipse under-reported its x extent by ~4e-3).
   *
   * For each world axis `e`, `p·e = origin·e + u*(x·e) + v*(y·e)` is a linear functional
   * of the local coordinates, so its extent is an exact support query in the in-plane
   * direction `(x·e, y·e)` — see [`hcurve::support_extent`]. A degenerate direction
   * (world axis perpendicular to the plane) contributes only the origin term.
   *
   * A non-coplanar polyline keeps its retained true 3D vertices, so it is measured
   * directly from those.
   */
  bbox(tol?: number | null): Float64Array;
  /**
   * Native sub-curve between arc-length fractions `t0`, `t1` in `[0, 1]`,
   * preserving line/arc segments exactly (no tessellation). Always open.
   *
   * An exact [`Geom::Path`] still goes through a line approximation: the cut points are
   * given as *arc-length* fractions, and inverting arc length on a rational conic has no
   * closed form (hypercurve exposes `inverse_length_parameter_region` for polynomial
   * Bezier spans only). Trimming a conic exactly needs that inversion, not just
   * `Curve2::subcurve`, which takes a curve parameter.
   */
  trim(t0: number, t1: number): Curve3DJs;
  /**
   * The knot vector, when this curve is carried by a single spline span.
   *
   * Empty for line/arc geometry and for multi-span paths, which have no single knot
   * vector. Line/arc curves are re-parameterised by arc length instead.
   */
  knots(): Float64Array;
  /**
   * Uniform scale about the world origin (hypercurve supports only uniform,
   * similarity scaling of planar curves).
   */
  scale(s: number): Curve3DJs;
  /**
   * One `Curve3DJs` per exact span (each an open single-span curve). A conic or spline
   * span comes back as an exact single-span path, not as a chord.
   */
  spans(): Curve3DJs[];
  /**
   * Whether the curve is closed.
   */
  closed(): boolean;
  /**
   * Join this curve with `others`, in order, into one connected curve.
   *
   * Every span is carried across exactly and gaps are bridged with straight connectors,
   * so joining an arc to a line keeps the arc. The TypeScript layer used to do this by
   * concatenating `controlPoints()` and running a polyline through them — and since
   * `controlPoints()` yields only span *endpoints*, a semicircle became its chord. That
   * is why `Sketch().lineTo().arcTo().close()` lost its arcs: every `Sketch.end()`
   * funnels through that join.
   *
   * `others` are mapped into this curve's plane by an exact similarity; a non-coplanar
   * operand is an error.
   * NOTE: takes `other` by REFERENCE, one curve at a time, and callers fold.
   *
   * It originally took `Vec<Curve3DJs>`, which looks natural but is a trap: wasm-bindgen
   * unwraps each element by *destroying it into a raw pointer*, so every operand's JS
   * wrapper was freed on the way in. Callers that reused an input afterwards — and
   * `Curve.Compound()` sits under every `Sketch.end()` and `ShapeCollection.combine()` —
   * then hit "null pointer passed to rust". A borrowed argument cannot do that.
   */
  concat(other: Curve3DJs): Curve3DJs;
  /**
   * Effective polynomial degree: the max over exact spans (line = 1, arc/conic/quadratic
   * = 2, cubic and above = 3+). A native re-architecture of curvo's single-NURBS
   * `degree()`. An ellipse is degree 2 and an interpolated NURBS reports its real degree,
   * where both used to report 1 from the line approximation.
   */
  degree(): number;
  /**
   * Extend the curve by `length` along its endpoint tangent(s).
   *
   * `side` is `"start"`, `"end"` or `"both"`. The extension is a straight span appended
   * to the exact geometry, so the original spans survive — this used to rebuild the whole
   * curve as a polyline through `controlPoints()`, collapsing any arc to a chord.
   */
  extend(length: number, side: string): Curve3DJs;
  /**
   * Fillet (round) interior corners with an arc of the given `radius`.
   * Corners where the radius does not fit are left sharp. Works on both closed
   * contours (every vertex) and open curve strings (interior vertices only —
   * the two free endpoints are not corners).
   *
   * `at`: optional corner (vertex) indices to fillet. Omit for every corner. Vertex `vi`
   * is the junction of segment `vi-1` and segment `vi`; closed curves start at 0, open
   * curves at 1. Indices are resolved on the TS side (see Curve.fillet) so the tolerance
   * policy for point matching stays out of the kernel.
   */
  fillet(radius: number, at?: Uint32Array | null): Curve3DJs;
  /**
   * Approximate length / perimeter.
   */
  length(tol?: number | null): number;
  /**
   * Mirror across the plane through `origin` with unit normal `normal`.
   *
   * Costs nothing geometrically. A reflection `R` is affine, so for a planar curve
   * `R(o + x*u + y*v) = R(o) + R(x)*u + R(y)*v` — the local `(u, v)` coordinates are
   * unchanged and only the frame moves. A mirrored circle therefore stays two arc spans,
   * where this used to reflect the tessellated boundary and rebuild a ~500-segment
   * polyline, permanently destroying the geometry to apply an isometry.
   *
   * The reflected frame's normal is recomputed from `x cross y`, which correctly flips:
   * a reflection reverses orientation.
   */
  mirror(normal: Vector3Js, origin: Point3Js): Curve3DJs;
  /**
   * One-sided offset by `distance`, returning a new curve in the same frame.
   *
   * Line/arc geometry is offset natively: hypercurve miters line-line corners and joins
   * the rest with circular arcs, so `Circle(50).offset(10)` comes back as a circle of
   * radius 60 — two arc spans — rather than the 128-gon this used to produce by
   * tessellating the native result away.
   *
   * An exact path (conic / Bezier / spline) has no exact parallel — the offset of a
   * general rational curve is not itself rational — so it uses hypercurve's *certified*
   * Blend2D parallel, which stays a curve and carries a proven error bound. When
   * hypercurve declines (an authored corner it will not blend, or a self-intersecting
   * offset, which it does not trim), this falls back to offsetting a certified
   * projection, i.e. the previous behaviour.
   */
  offset(distance: number, tol?: number | null): Curve3DJs;
  /**
   * Boolean against another closed curve (`union`/`intersection`/`difference`/
   * `xor`), computed on **native geometry** (arcs/lines preserved, nothing
   * tessellated). The other curve is mapped into this curve's plane by an exact
   * similarity; both must be closed and coplanar. Results are native regions
   * (exterior + holes) in this frame — feed them straight into further booleans
   * to keep chained ops fast and compact. Errors (→ caller may fall back) when
   * inputs are open / non-coplanar or hypercurve declines the topology.
   */
  boolean(other: Curve3DJs, op: string, _tol?: number | null): BooleanRegion3DJs[];
  /**
   * Chamfer (bevel) interior corners, cutting back `setback` along each edge.
   * Works on both closed contours and open curve strings (interior vertices only).
   *
   * `at`: optional corner (vertex) indices to chamfer. Omit for every corner. Indexing
   * matches [`Curve3DJs::fillet`].
   */
  chamfer(setback: number, at?: Uint32Array | null): Curve3DJs;
  /**
   * Reverse the curve's direction.
   */
  reverse(): Curve3DJs;
  /**
   * Classify the curve by its exact span families:
   * `Line` | `Arc` | `Circle` | `Rect` | `Polyline` | `Ellipse` | `Spline`.
   */
  subtype(): string;
  /**
   * The per-control-point weights, when this curve is carried by a single spline span.
   * Empty otherwise — a native arc is exact, not a weighted rational control net.
   */
  weights(): Float64Array;
  /**
   * Deep copy.
   */
  clone(): Curve3DJs;
  /**
   * Whether the geometry is curved anywhere — a circular arc, or any conic / Bezier /
   * spline span. Named for the line/arc case it was introduced for; on an exact path it
   * answers the same underlying question ("is this more than straight line work?"), which
   * the old line approximation always answered `false` to.
   */
  hasArcs(): boolean;
  /**
   * Construct a circular arc through three 3D points (open).
   */
  static makeArc(start: Point3Js, mid: Point3Js, end: Point3Js): Curve3DJs;
  /**
   * Point at normalised arc-length parameter `t` in `[0, 1]`.
   */
  pointAt(t: number): Point3Js;
  /**
   * Intersection points with another curve (both projected into this frame),
   * returned as 3D points.
   */
  intersect(other: Curve3DJs, tol?: number | null): Point3Js[];
  /**
   * A `Curve3DJs` is planar by construction.
   */
  isPlanar(): boolean;
  /**
   * Construct a straight line between two 3D points (open).
   */
  static makeLine(a: Point3Js, b: Point3Js): Curve3DJs;
  /**
   * Translate the curve by a world-space vector (moves the frame origin).
   */
  translate(offset: Vector3Js): Curve3DJs;
}

export class EdgeProjectionResultJs {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Returns hidden polylines as a JS value.
   *
   * Shape: `Array< Array<[x: number, y: number, z: number]> >`
   */
  hiddenPolylines(): any;
  /**
   * Returns visible polylines as a JS value.
   *
   * Shape: `Array< Array<[x: number, y: number, z: number]> >`
   */
  visiblePolylines(): any;
  /**
   * Indices into `visiblePolylines()` whose source edge is a silhouette or
   * open-mesh boundary — i.e. the outer contour of the projection.
   */
  silhouetteIndices(): Uint32Array;
}

export class Matrix4Js {
  free(): void;
  [Symbol.dispose](): void;
  constructor(m11: number, m12: number, m13: number, m20: number, m21: number, m22: number, m23: number, m30: number, m31: number, m32: number, m33: number, m34: number, m41: number, m42: number, m43: number, m44: number);
  toArray(): Float64Array;
}

export class MeshJs {
  free(): void;
  [Symbol.dispose](): void;
  difference(other: MeshJs): MeshJs;
  static octahedron(radius: number, metadata: any): MeshJs;
  static polyhedron(points: any, faces: any, metadata: any): MeshJs;
  convexHull(): MeshJs;
  /**
   * Import a **3MF** package as a merged Mesh (geometry only).
   */
  static from3MF(data: Uint8Array, metadata: any): MeshJs;
  /**
   * Import an **AMF** model (plain XML or zipped) as a merged Mesh.
   */
  static fromAMF(data: Uint8Array, metadata: any): MeshJs;
  /**
   * Import a **DXF** drawing (closed polylines / circles → faces) as a Mesh.
   */
  static fromDXF(dxf_data: Uint8Array, metadata: any): MeshJs;
  /**
   * Import a Wavefront **OBJ** mesh from its text content.
   */
  static fromOBJ(obj_data: string, metadata: any): MeshJs;
  static fromSketch(sketch_js: SketchJs): MeshJs;
  /**
   * Import a binary or ASCII **STL** mesh from raw bytes.
   */
  static fromSTL(stl_data: Uint8Array, metadata: any): MeshJs;
  static frustum_ptp(start: Point3Js, end: Point3Js, radius1: number, radius2: number, segments: number, metadata: any): MeshJs;
  static icosahedron(radius: number, metadata: any): MeshJs;
  renormalize(): MeshJs;
  triangulate(): MeshJs;
  boundingBox(): any;
  /**
   * Import a **glTF 2.0** model (`.glb` or `.gltf`) as a single merged Mesh.
   */
  static fromGLTF(data: Uint8Array, metadata: any): MeshJs;
  intersection(other: MeshJs): MeshJs;
  /**
   * Whether this mesh is convex — the precondition for the per-shape
   * drawing strategies. See [`crate::mesh::Mesh::is_convex`].
   */
  isConvex(): boolean;
  toSTLASCII(): string;
  vertexCount(): number;
  static fromPolygons(polygons: PolygonJs[], metadata: any): MeshJs;
  minkowskiSum(other: MeshJs): MeshJs;
  sameMetadata(other: MeshJs): boolean;
  /**
   * Sample the signed distance field at a query point.
   *
   * Returns a **negative** signed distance when inside the mesh.
   * Returns `undefined` if the mesh has no polygons.
   */
  sampleSdf(x: number, y: number, z: number): SdfSampleJs | undefined;
  taubinSmooth(lambda: number, mu: number, iterations: number, preserve_boundaries: boolean): MeshJs;
  toSTLBinary(): Uint8Array;
  /**
   * Minimum separating distance between this mesh and another.
   *
   * Returns `0.0` if they intersect.
   */
  distanceTo(other: MeshJs): number;
  distributeArc(count: number, radius: number, start_angle: number, end_angle: number): MeshJs;
  /**
   * All-hits raycast: every triangle intersection along the ray, sorted by distance.
   */
  raycastAll(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max_dist: number): RaycastHitJs[];
  /**
   * Split this mesh by a plane into two halves.
   *
   * Returns `[front_mesh, back_mesh]` where:
   * - `front_mesh` contains polygons on the side the plane normal points toward.
   * - `back_mesh` contains polygons on the opposite side.
   *
   * Polygons spanning the plane are split at the intersection using
   * Sutherland-Hodgman clipping.  Coplanar polygons go to `front_mesh`.
   * Either half may be empty (zero polygons) if the mesh lies entirely on
   * one side of the plane.
   */
  splitByPlane(plane: PlaneJs): MeshJs[];
  /**
   * Number of triangles (handy to sanity-check).
   */
  triangleCount(): number;
  adaptiveRefine(quality_threshold: number, max_edge_length: number, curvature_threshold_deg: number): MeshJs;
  containsVertex(p: Point3Js): boolean;
  distributeGrid(rows: number, cols: number, row_spacing: number, col_spacing: number): MeshJs;
  massProperties(density: number): any;
  /**
   * Project a query point onto the nearest mesh surface (BVH-accelerated).
   *
   * Returns `undefined` if the mesh has no polygons.
   */
  closestPoint(x: number, y: number, z: number): ClosestPointResultJs | undefined;
  laplacianSmooth(lambda: number, iterations: number, preserve_boundaries: boolean): MeshJs;
  /**
   * BVH-accelerated edge projection with hidden-line removal.
   *
   * - `(vx, vy, vz)` – view direction (normalised internally).
   * - `(ox, oy, oz)` – projection plane origin.
   * - `(nx, ny, nz)` – projection plane normal.
   * - `feature_angle_deg` – crease angle threshold in degrees (e.g. `15.0`).
   * - `n_samples` – HLR ray samples per edge segment (e.g. `8`).
   * - `occluders` – additional meshes that can occlude edges of `self`;
   *   `self` is always included as an occluder.
   * - `strategy` – which HLR algorithm to run: `"raycast"` (the sampling
   *   solver, and the default when omitted or unrecognised) or `"exact"`
   *   (analytic interval clipping). `n_samples` only affects `"raycast"`.
   */
  projectEdges(vx: number, vy: number, vz: number, ox: number, oy: number, oz: number, nx: number, ny: number, nz: number, feature_angle_deg: number, n_samples: number, occluders: MeshJs[], strategy?: string | null): EdgeProjectionResultJs;
  /**
   * BVH-accelerated first-hit raycast.
   *
   * Returns the closest intersection along `origin + t * direction` where
   * `t ∈ [0, max_dist]`, or `undefined` if there is no hit.
   */
  raycastFirst(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max_dist: number): RaycastHitJs | undefined;
  sliceComponents(normal_x: number, normal_y: number, normal_z: number, offset: number): SketchJs;
  distributeLinear(count: number, direction: Vector3Js, spacing: number): MeshJs;
  /**
   * Merge coplanar, edge-adjacent faces back into n-gons. Applied
   * automatically after boolean ops; exposed for manual use too.
   */
  reconstructNgons(): MeshJs;
  /**
   * Rotate this mesh by a unit quaternion given as components `(w, x, y, z)`.
   * The quaternion is normalized before use, so non-unit input is safe.
   */
  rotateQuaternion(w: number, x: number, y: number, z: number): MeshJs;
  static teardropCylinder(width: number, length: number, height: number, shape_segments: number, metadata: any): MeshJs;
  toAMFWithColor(object_name: string, units: string, r: number, g: number, b: number): string;
  /**
   * Create a mesh from pre-sampled SDF values on a regular grid.
   *
   * `values` must be laid out as `[z * res_y * res_x + y * res_x + x, ...]`.
   * `iso_value` is the isosurface threshold (typically `0.0`).
   */
  static fromSdfValues(values: Float64Array, res_x: number, res_y: number, res_z: number, min_x: number, min_y: number, min_z: number, max_x: number, max_y: number, max_z: number, iso_value: number): MeshJs;
  static spurGearInvolute(module_: number, teeth: number, pressure_angle_deg: number, clearance: number, backlash: number, segments_per_flank: number, thickness: number, metadata: any): MeshJs;
  /**
   * Orthographically project every vertex of this mesh onto a plane.
   *
   * `(ox, oy, oz)` is a point on the plane; `(nx, ny, nz)` is its normal.
   */
  projectToPlane(ox: number, oy: number, oz: number, nx: number, ny: number, nz: number): MeshJs;
  subdivideTriangles(levels: number): MeshJs;
  /**
   * Minimum absolute distance from any mesh vertex to a plane.
   *
   * `(ox, oy, oz)` is a point on the plane; `(nx, ny, nz)` is its normal.
   */
  distanceToPlane(ox: number, oy: number, oz: number, nx: number, ny: number, nz: number): number;
  /**
   * Hidden-line-project free-standing polylines against a set of solids.
   *
   * This is the entry point for linear shapes — wireframes, centrelines,
   * imported linework — which are part of the drawing but belong to no mesh.
   * They are hidden by the occluders but never occlude anything themselves.
   *
   * - `points` – all polyline vertices, flattened as x,y,z triples.
   * - `counts` – how many *points* each polyline contributes, in order.
   *
   * Occlusion is always solved exactly here. The sampling solver never
   * supported curves at all, so there is no prior behaviour to preserve, and
   * no reason to approximate what can be computed.
   */
  static projectPolylines(points: Float64Array, counts: Uint32Array, vx: number, vy: number, vz: number, ox: number, oy: number, oz: number, nx: number, ny: number, nz: number, occluders: MeshJs[]): EdgeProjectionResultJs;
  transformComponents(m00: number, m01: number, m02: number, m03: number, m10: number, m11: number, m12: number, m13: number, m20: number, m21: number, m22: number, m23: number, m30: number, m31: number, m32: number, m33: number): MeshJs;
  translateComponents(dx: number, dy: number, dz: number): MeshJs;
  distanceToLegacy(other: MeshJs): number;
  /**
   * Find intersection points between a raw polyline (array of Point3Js) and this Mesh.
   * Each consecutive pair of points defines a segment tested against the mesh.
   *
   * # Arguments
   * - `points`: Ordered 3D points forming a polyline.
   *
   * # Returns
   * A `Vec<Point3Js>` of 3D intersection points, in polyline order.
   */
  intersectPolyline(points: Point3Js[]): Point3Js[];
  removePoorTriangles(min_quality: number): MeshJs;
  /**
   * Create a triangulated mesh from a planar polygon (flat [x,y,z,...] outer boundary)
   * with interior holes (array of flat [x,y,z,...] arrays).
   *
   * The normal for each vertex is computed from the outer boundary.
   */
  static fromPointsWithHoles(outer_points: Float64Array, hole_arrays: Float64Array[], metadata: any): MeshJs;
  static frustum_ptpComponents(start_x: number, start_y: number, start_z: number, end_x: number, end_y: number, end_z: number, radius1: number, radius2: number, segments: number, metadata: any): MeshJs;
  invalidateBoundingBox(): void;
  /**
   * Slice at a section plane and return visible/hidden edge projections plus
   * the cut sketch.
   *
   * - `(snx, sny, snz)` / `section_offset` – section plane normal + d offset.
   * - `(vx, vy, vz)` – view direction.
   * - `(ox, oy, oz)` / `(nx, ny, nz)` – projection plane origin + normal.
   * - `feature_angle_deg`, `n_samples`, `occluders` – as in `projectEdges`.
   */
  projectEdgesSection(snx: number, sny: number, snz: number, section_offset: number, vx: number, vy: number, vz: number, ox: number, oy: number, oz: number, nx: number, ny: number, nz: number, feature_angle_deg: number, n_samples: number, occluders: MeshJs[], strategy?: string | null): SectionElevationResultJs;
  containsVertexComponents(x: number, y: number, z: number): boolean;
  filterPolygonsByMetadata(needle: any): MeshJs;
  /**
   * Batch first-hit visibility test.
   *
   * `origins` — flat `Float64Array` with 3×N floats (x₀,y₀,z₀, x₁,y₁,z₁, …).
   * `dx, dy, dz` — shared ray direction (need not be normalised).
   * `max_dist` — maximum hit distance.
   *
   * Returns a `Uint8Array` of length N: `1` = ray hit something (occluded),
   * `0` = no hit (visible).
   *
   * This is the batch companion to `raycastFirst` for the TypeScript HLR pipeline:
   * it builds the BVH once and does all raycasts inside Rust, eliminating N
   * JS→WASM round-trips.
   */
  raycastBatchVisibility(origins: Float64Array, dx: number, dy: number, dz: number, max_dist: number): Uint8Array;
  distributeLinearComponents(count: number, dx: number, dy: number, dz: number, spacing: number): MeshJs;
  static egg(width: number, length: number, revolve_segments: number, outline_segments: number, metadata: any): MeshJs;
  constructor();
  xor(other: MeshJs): MeshJs;
  static cube(size: number, metadata: any): MeshJs;
  static arrow(start: Point3Js, direction: Vector3Js, segments: number, orientation: boolean, metadata: any): MeshJs;
  clone(): MeshJs;
  float(): MeshJs;
  scale(sx: number, sy: number, sz: number): MeshJs;
  slice(plane: PlaneJs): SketchJs;
  static torus(major_r: number, minor_r: number, segments_major: number, segments_minor: number, metadata: any): MeshJs;
  union(other: MeshJs): MeshJs;
  center(): MeshJs;
  static cuboid(width: number, length: number, height: number, metadata: any): MeshJs;
  gyroid(resolution: number, scale: number, iso_value: number, metadata: any): MeshJs;
  mirror(plane: PlaneJs): MeshJs;
  rotate(rx: number, ry: number, rz: number): MeshJs;
  static sphere(radius: number, segments_u: number, segments_v: number, metadata: any): MeshJs;
  toAMF(object_name: string, units: string): string;
  flatten(): SketchJs;
  static frustum(radius1: number, radius2: number, height: number, segments: number, metadata: any): MeshJs;
  /**
   * Test whether this mesh physically overlaps another (BVH-accelerated).
   */
  hits(other: MeshJs): boolean;
  /**
   * Return triangle indices (u32).
   */
  indices(): Uint32Array;
  inverse(): MeshJs;
  /**
   * Return an interleaved array of vertex normals (nx,ny,nz)*.
   */
  normals(): Float64Array;
  toGLTF(object_name: string, up_axis: string): string;
  static cylinder(radius: number, height: number, segments: number, metadata: any): MeshJs;
  /**
   * +MESHUP
   */
  polygons(): PolygonJs[];
  static teardrop(width: number, length: number, revolve_segments: number, shape_segments: number, metadata: any): MeshJs;
  vertices(): any;
  static ellipsoid(rx: number, ry: number, rz: number, segments: number, stacks: number, metadata: any): MeshJs;
  /**
   * Return an interleaved array of vertex positions (x,y,z)*.
   */
  positions(): Float64Array;
  schwarzD(resolution: number, scale: number, iso_value: number, metadata: any): MeshJs;
  schwarzP(resolution: number, scale: number, iso_value: number, metadata: any): MeshJs;
  /**
   * Convert a mesh to arrays of positions, normals, and indices
   */
  toArrays(): object;
  transform(mat: Matrix4Js): MeshJs;
  translate(offset: Vector3Js): MeshJs;
}

export class PlaneJs {
  free(): void;
  [Symbol.dispose](): void;
  static fromNormal(normal: Vector3Js, offset: number): PlaneJs;
  static fromPoints(a: Point3Js, b: Point3Js, c: Point3Js): PlaneJs;
  orientPlane(other: PlaneJs): number;
  orientPoint(p: Point3Js): number;
  static FromVertices(vertices: VertexJs[]): PlaneJs;
  static FromComponents(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number): PlaneJs;
  toXYTransform(): any;
  classifyPolygon(polygon_js: PolygonJs): number;
  static fromNormalComponents(nx: number, ny: number, nz: number, offset: number): PlaneJs;
  orientPointComponents(x: number, y: number, z: number): number;
  constructor(vertices: VertexJs[]);
  flip(): void;
  normal(): Vector3Js;
  offset(): number;
  points(): Point3Js[];
}

export class Point3Js {
  free(): void;
  [Symbol.dispose](): void;
  toString(): string;
  constructor(x: number, y: number, z: number);
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export class PolygonJs {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Number of holes.
   */
  holeCount(): number;
  /**
   * Triangulate this polygon into a list of triangular polygons.
   *
   * Returns `PolygonJs[]`, each of which is a triangle.
   */
  triangulate(): PolygonJs[];
  /**
   * Axis-aligned bounding box of this polygon as `{ min: Point3Js, max: Point3Js }`.
   */
  boundingBox(): any;
  /**
   * Set metadata from any JSON-serializable JS value.
   */
  setMetadata(metadata: any): void;
  /**
   * Construct from vertices (same as constructor, but named).
   */
  static fromVertices(vertices: VertexJs[], metadata: any): PolygonJs;
  /**
   * Recompute and assign a new flat normal to all vertices.
   */
  setNewNormal(): void;
  /**
   * Subdivide this polygon's triangles, returning the refined triangular polygons.
   *
   * If `levels` is 0, returns a single-element array containing this polygon.
   */
  subdivideTriangles(levels: number): PolygonJs[];
  /**
   * Recalculate a normal from all vertices and return it.
   */
  calculateNewNormal(): Vector3Js;
  /**
   * Construct a polygon from a list of vertices and optional metadata.
   *
   * Metadata may be any JSON-serializable value; it is stored as a JSON string
   * in the underlying Rust `Polygon<String>`.
   */
  constructor(vertices: VertexJs[], metadata: any);
  /**
   * Flip winding order and vertex normals in place.
   */
  flip(): void;
  /**
   * Get the holes as an array of `VertexJs[][]`.
   */
  holes(): any;
  /**
   * Get the polygon's plane as a `PlaneJs`.
   */
  plane(): PlaneJs;
  /**
   * Add a hole defined by vertices.
   */
  addHole(hole_vertices: VertexJs[]): void;
  /**
   * Get metadata as a JSON string, or `null` if none.
   */
  metadata(): string | undefined;
  /**
   * Flatten all vertices to a single Float64 array:
   * `[x, y, z, nx, ny, nz, x, y, z, nx, ny, nz, ...]`
   */
  toArray(): Float64Array;
  /**
   * Get the vertices as `VertexJs[]`.
   */
  vertices(): any;
  /**
   * Returns `true` if this polygon has interior holes.
   */
  hasHoles(): boolean;
}

export class RaycastHitJs {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  readonly triangleIndex: number;
  readonly pointX: number;
  readonly pointY: number;
  readonly pointZ: number;
  readonly distance: number;
  readonly normalX: number;
  readonly normalY: number;
  readonly normalZ: number;
}

export class SdfSampleJs {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  readonly distance: number;
  readonly closestX: number;
  readonly closestY: number;
  readonly closestZ: number;
  readonly isInside: boolean;
}

export class SectionElevationResultJs {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  cutSketch(): SketchJs;
  /**
   * Indices into `visiblePolylines()` forming the outer silhouette contour.
   */
  silhouetteIndices(): Uint32Array;
  hiddenPolylines(): any;
  visiblePolylines(): any;
}

export class SketchJs {
  free(): void;
  [Symbol.dispose](): void;
  difference(other: SketchJs): SketchJs;
  static supershape(a: number, b: number, m: number, n1: number, n2: number, n3: number, segments: number, metadata: any): SketchJs;
  renormalize(): SketchJs;
  boundingBox(): any;
  /**
   * Build a 2-D Sketch from **single-stroke line text** using a Hershey `.jhf`
   * font. Each glyph stroke becomes an open `LineString` (ideal for CNC
   * engraving / pen plotting). `offset_code` is the Unicode code point mapped
   * to the font's first record (32 = ASCII space for the standard fonts).
   *
   * See `Sketch::from_hershey_str`.
   */
  static fromHershey(text: string, jhf: string, size: number, offset_code: number, metadata: any): SketchJs;
  intersection(other: SketchJs): SketchJs;
  static regularNGon(sides: number, radius: number, metadata: any): SketchJs;
  static airfoilNACA4(max_camber: number, camber_position: number, thickness: number, chord: number, samples: number, metadata: any): SketchJs;
  /**
   * Fill this sketch with a Hilbert-curve path of the given recursion `order`.
   *
   * Unrelated to offsetting — this used to sit behind the `offset` feature gate by
   * accident, which kept it out of builds that did not enable geo-buf.
   */
  hilbertCurve(order: number, padding: number): SketchJs;
  static involuteGear(module_: number, teeth: number, pressure_angle_deg: number, clearance: number, backlash: number, segments_per_flank: number, metadata: any): SketchJs;
  /**
   * Return a human-readable summary of every ring coordinate in the
   * underlying `geo::GeometryCollection`.  Useful for debugging sketch
   * content from TypeScript without having to read raw buffers.
   *
   * Example output:
   * ```
   * Geometry[0] Polygon
   *   exterior (6 pts): [0.00,0.00] [1.00,0.00] ...
   *   hole[0]   (5 pts): [0.25,0.25] ...
   * Geometry[1] LineString
   *   (3 pts): [0.00,0.00] [5.00,5.00] ...
   * ```
   */
  debugGeometry(): string;
  extrudeVector(dir: Vector3Js): MeshJs;
  static rightTriangle(width: number, height: number, metadata: any): SketchJs;
  toMultiPolygon(): string;
  static circleWithFlat(radius: number, segments: number, flat_dist: number, metadata: any): SketchJs;
  sweepComponents(path: any): MeshJs;
  static roundedRectangle(width: number, height: number, corner_radius: number, corner_segments: number, metadata: any): SketchJs;
  static circleWithKeyway(radius: number, segments: number, key_width: number, key_depth: number, metadata: any): SketchJs;
  transformComponents(m00: number, m01: number, m02: number, m03: number, m10: number, m11: number, m12: number, m13: number, m20: number, m21: number, m22: number, m23: number, m30: number, m31: number, m32: number, m33: number): SketchJs;
  translateComponents(dx: number, dy: number, dz: number): SketchJs;
  static circleWithTwoFlats(radius: number, segments: number, flat_dist: number, metadata: any): SketchJs;
  invalidateBoundingBox(): void;
  extrudeVectorComponents(dx: number, dy: number, dz: number): MeshJs;
  static egg(width: number, length: number, segments: number, metadata: any): SketchJs;
  constructor();
  xor(other: SketchJs): SketchJs;
  static ring(id: number, thickness: number, segments: number, metadata: any): SketchJs;
  static star(num_points: number, outer_radius: number, inner_radius: number, metadata: any): SketchJs;
  /**
   * Build a 2-D Sketch from **outline (filled) text** using a TrueType/OpenType
   * font. Each glyph becomes closed `Polygon`(s) with holes for counters (the
   * hole in `O`, `e`, `A`, …), plus open `LineString`s for any open contours.
   * `scale` is the desired point size; glyphs are laid out with the font's own
   * horizontal advance metrics. Extrude the result for solid 3-D text.
   *
   * See `Sketch::text`.
   */
  static text(text: string, font_data: Uint8Array, scale: number, metadata: any): SketchJs;
  static arrow(shaft_length: number, shaft_width: number, head_length: number, head_width: number, metadata: any): SketchJs;
  static heart(width: number, height: number, segments: number, metadata: any): SketchJs;
  /**
   * Typed accessor for ring geometry. Returns
   * `Array<{ points: Float64Array([x0,y0,x1,y1,...]), closed: boolean }>`.
   * Polygon exteriors and holes are emitted as separate `closed: true`
   * rings; LineStrings / Lines come back as `closed: false`.
   */
  rings(): any;
  scale(sx: number, sy: number, sz: number): SketchJs;
  sweep(path: Point3Js[]): MeshJs;
  union(other: SketchJs): SketchJs;
  static bezier(control: any, segments: number, metadata: any): SketchJs;
  center(): SketchJs;
  static circle(radius: number, segments: number, metadata: any): SketchJs;
  rotate(rx: number, ry: number, rz: number): SketchJs;
  static square(width: number, metadata: any): SketchJs;
  toSVG(): string;
  static bspline(control: any, p: number, segments_per_span: number, metadata: any): SketchJs;
  static ellipse(width: number, height: number, segments: number, metadata: any): SketchJs;
  extrude(height: number): MeshJs;
  inverse(): SketchJs;
  static keyhole(circle_radius: number, handle_width: number, handle_height: number, segments: number, metadata: any): SketchJs;
  static polygon(points: any, metadata: any): SketchJs;
  revolve(angle_degrees: number, segments: number): MeshJs;
  static crescent(outer_r: number, inner_r: number, offset: number, segments: number, metadata: any): SketchJs;
  /**
   * Import 2-D geometry from DXF as a Sketch (curves). See `Sketch::from_dxf`.
   */
  static fromDXF(dxf_data: Uint8Array, metadata: any): SketchJs;
  static fromGeo(geo_json: string, metadata: any): SketchJs;
  static fromSVG(svg_data: string, metadata: any): SketchJs;
  isEmpty(): boolean;
  static reuleaux(sides: number, diameter: number, circle_segments: number, metadata: any): SketchJs;
  static squircle(width: number, height: number, segments: number, metadata: any): SketchJs;
  static teardrop(width: number, length: number, segments: number, metadata: any): SketchJs;
  static fromMesh(mesh_js: MeshJs): SketchJs;
  static pieSlice(radius: number, start_angle_deg: number, end_angle_deg: number, segments: number, metadata: any): SketchJs;
  static rectangle(width: number, length: number, metadata: any): SketchJs;
  toArrays(): any;
  transform(mat: Matrix4Js): SketchJs;
  translate(offset: Vector3Js): SketchJs;
  static trapezoid(top_width: number, bottom_width: number, height: number, top_offset: number, metadata: any): SketchJs;
}

export class SvgImportJs {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Move the imported curves out (call once). Leaves the result empty.
   */
  takeCurves(): Curve3DJs[];
  /**
   * Non-fatal warnings gathered during import (skipped elements/commands).
   */
  readonly warnings: string[];
}

export class Vector3Js {
  free(): void;
  [Symbol.dispose](): void;
  isOrthogonal(tolerance: number): boolean;
  /**
   * Compute the shortest-arc unit quaternion that rotates `self` to align with `other`.
   * Returns a plain JS object `{ w, x, y, z }`.
   * For anti-parallel vectors, a 180° rotation around a perpendicular axis is chosen.
   */
  rotationBetween(other: Vector3Js): any;
  /**
   * Rotate this vector by a unit quaternion given as components `(w, x, y, z)`.
   * The quaternion is expected to be unit-length.
   */
  rotateQuaternion(w: number, x: number, y: number, z: number): Vector3Js;
  abs(): Vector3Js;
  add(other: Vector3Js): Vector3Js;
  dot(other: Vector3Js): number;
  constructor(x: number, y: number, z: number);
  angle(other: Vector3Js): number;
  cross(other: Vector3Js): Vector3Js;
  scale(factor: number): Vector3Js;
  equals(other: Vector3Js): boolean;
  length(): number;
  rotate(axis: Vector3Js, angle: number): Vector3Js;
  reverse(): Vector3Js;
  subtract(other: Vector3Js): Vector3Js;
  normalize(): Vector3Js;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export class VertexJs {
  free(): void;
  [Symbol.dispose](): void;
  toString(): string;
  static fromComponents(x: number, y: number, z: number): VertexJs;
  static fromPositionNormal(position: Point3Js, normal: Vector3Js): VertexJs;
  constructor(position: Point3Js, normal: Vector3Js);
  normal(): Vector3Js;
  position(): Point3Js;
  toArray(): Float64Array;
}

/**
 * Import an SVG document into native planar curves. Lines, circular arcs and Béziers are
 * all kept exact — a `C` command arrives as a `CubicBezier2` span, not as chords.
 * Unsupported path commands (elliptical arcs with rx ≠ ry) are skipped and surfaced via
 * `warnings`. Coordinates are SVG-space (y-down) at z = 0.
 */
export function importSvgCurves(doc: string): SvgImportJs;

export function init_panic_hook(): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly __wbg_booleanregion3djs_free: (a: number, b: number) => void;
  readonly __wbg_closestpointresultjs_free: (a: number, b: number) => void;
  readonly __wbg_curve3djs_free: (a: number, b: number) => void;
  readonly __wbg_edgeprojectionresultjs_free: (a: number, b: number) => void;
  readonly __wbg_matrix4js_free: (a: number, b: number) => void;
  readonly __wbg_meshjs_free: (a: number, b: number) => void;
  readonly __wbg_planejs_free: (a: number, b: number) => void;
  readonly __wbg_point3js_free: (a: number, b: number) => void;
  readonly __wbg_polygonjs_free: (a: number, b: number) => void;
  readonly __wbg_sdfsamplejs_free: (a: number, b: number) => void;
  readonly __wbg_sectionelevationresultjs_free: (a: number, b: number) => void;
  readonly __wbg_sketchjs_free: (a: number, b: number) => void;
  readonly __wbg_svgimportjs_free: (a: number, b: number) => void;
  readonly __wbg_vertexjs_free: (a: number, b: number) => void;
  readonly booleanregion3djs_exterior: (a: number) => number;
  readonly booleanregion3djs_holeCount: (a: number) => number;
  readonly booleanregion3djs_holes: (a: number) => [number, number];
  readonly closestpointresultjs_distance: (a: number) => number;
  readonly closestpointresultjs_is_inside: (a: number) => number;
  readonly closestpointresultjs_normal_x: (a: number) => number;
  readonly closestpointresultjs_normal_y: (a: number) => number;
  readonly closestpointresultjs_normal_z: (a: number) => number;
  readonly closestpointresultjs_point_x: (a: number) => number;
  readonly closestpointresultjs_point_y: (a: number) => number;
  readonly closestpointresultjs_point_z: (a: number) => number;
  readonly curve3djs_area: (a: number) => [number, number, number];
  readonly curve3djs_bbox: (a: number, b: number, c: number) => [number, number, number, number];
  readonly curve3djs_boolean: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
  readonly curve3djs_chamfer: (a: number, b: number, c: number, d: number) => [number, number, number];
  readonly curve3djs_clone: (a: number) => number;
  readonly curve3djs_closePath: (a: number) => [number, number, number];
  readonly curve3djs_closed: (a: number) => number;
  readonly curve3djs_concat: (a: number, b: number) => [number, number, number];
  readonly curve3djs_controlPoints: (a: number) => [number, number];
  readonly curve3djs_degree: (a: number) => number;
  readonly curve3djs_extend: (a: number, b: number, c: number, d: number) => [number, number, number];
  readonly curve3djs_fillet: (a: number, b: number, c: number, d: number) => [number, number, number];
  readonly curve3djs_getOnPlane: (a: number) => [number, number];
  readonly curve3djs_hasArcs: (a: number) => number;
  readonly curve3djs_intersect: (a: number, b: number, c: number, d: number) => [number, number, number, number];
  readonly curve3djs_isPlanar: (a: number) => number;
  readonly curve3djs_knots: (a: number) => [number, number];
  readonly curve3djs_knotsDomain: (a: number) => [number, number];
  readonly curve3djs_length: (a: number, b: number, c: number) => [number, number, number];
  readonly curve3djs_makeArc: (a: number, b: number, c: number) => [number, number, number];
  readonly curve3djs_makeCircle: (a: number, b: number, c: number) => [number, number, number];
  readonly curve3djs_makeEllipse: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
  readonly curve3djs_makeEllipticalArc: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
  readonly curve3djs_makeInterpolated: (a: number, b: number, c: number) => [number, number, number];
  readonly curve3djs_makeLine: (a: number, b: number) => [number, number, number];
  readonly curve3djs_makePolyline: (a: number, b: number, c: number) => [number, number, number];
  readonly curve3djs_mirror: (a: number, b: number, c: number) => [number, number, number];
  readonly curve3djs_offset: (a: number, b: number, c: number, d: number) => [number, number, number];
  readonly curve3djs_paramAtLength: (a: number, b: number) => [number, number, number];
  readonly curve3djs_paramClosestToPoint: (a: number, b: number) => [number, number, number];
  readonly curve3djs_pointAt: (a: number, b: number) => [number, number, number];
  readonly curve3djs_reverse: (a: number) => [number, number, number];
  readonly curve3djs_rotateAxis: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
  readonly curve3djs_rotateQuaternion: (a: number, b: number, c: number, d: number, e: number) => number;
  readonly curve3djs_scale: (a: number, b: number) => [number, number, number];
  readonly curve3djs_scaleNonUniform: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
  readonly curve3djs_segmentCount: (a: number) => number;
  readonly curve3djs_segmentTessellations: (a: number, b: number, c: number) => [number, number, number];
  readonly curve3djs_spanParams: (a: number) => [number, number, number];
  readonly curve3djs_spans: (a: number) => [number, number, number, number];
  readonly curve3djs_subtype: (a: number) => [number, number];
  readonly curve3djs_tangentAt: (a: number, b: number) => [number, number, number];
  readonly curve3djs_tessellate: (a: number, b: number, c: number) => [number, number, number, number];
  readonly curve3djs_translate: (a: number, b: number) => number;
  readonly curve3djs_trim: (a: number, b: number, c: number) => [number, number, number];
  readonly curve3djs_weights: (a: number) => [number, number];
  readonly edgeprojectionresultjs_hiddenPolylines: (a: number) => any;
  readonly edgeprojectionresultjs_silhouetteIndices: (a: number) => any;
  readonly edgeprojectionresultjs_visiblePolylines: (a: number) => any;
  readonly importSvgCurves: (a: number, b: number) => [number, number, number];
  readonly matrix4js_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number) => number;
  readonly matrix4js_toArray: (a: number) => [number, number];
  readonly meshjs_adaptiveRefine: (a: number, b: number, c: number, d: number) => number;
  readonly meshjs_arrow: (a: number, b: number, c: number, d: number, e: any) => number;
  readonly meshjs_boundingBox: (a: number) => any;
  readonly meshjs_center: (a: number) => number;
  readonly meshjs_clone: (a: number) => number;
  readonly meshjs_closestPoint: (a: number, b: number, c: number, d: number) => number;
  readonly meshjs_containsVertex: (a: number, b: number) => number;
  readonly meshjs_containsVertexComponents: (a: number, b: number, c: number, d: number) => number;
  readonly meshjs_convexHull: (a: number) => number;
  readonly meshjs_cube: (a: number, b: any) => number;
  readonly meshjs_cuboid: (a: number, b: number, c: number, d: any) => number;
  readonly meshjs_cylinder: (a: number, b: number, c: number, d: any) => number;
  readonly meshjs_difference: (a: number, b: number) => number;
  readonly meshjs_distanceTo: (a: number, b: number) => number;
  readonly meshjs_distanceToLegacy: (a: number, b: number) => number;
  readonly meshjs_distanceToPlane: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
  readonly meshjs_distributeArc: (a: number, b: number, c: number, d: number, e: number) => number;
  readonly meshjs_distributeGrid: (a: number, b: number, c: number, d: number, e: number) => number;
  readonly meshjs_distributeLinear: (a: number, b: number, c: number, d: number) => number;
  readonly meshjs_distributeLinearComponents: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
  readonly meshjs_egg: (a: number, b: number, c: number, d: number, e: any) => number;
  readonly meshjs_ellipsoid: (a: number, b: number, c: number, d: number, e: number, f: any) => number;
  readonly meshjs_filterPolygonsByMetadata: (a: number, b: any) => number;
  readonly meshjs_flatten: (a: number) => number;
  readonly meshjs_float: (a: number) => number;
  readonly meshjs_from3MF: (a: number, b: number, c: any) => [number, number, number];
  readonly meshjs_fromAMF: (a: number, b: number, c: any) => [number, number, number];
  readonly meshjs_fromDXF: (a: number, b: number, c: any) => [number, number, number];
  readonly meshjs_fromGLTF: (a: number, b: number, c: any) => [number, number, number];
  readonly meshjs_fromOBJ: (a: number, b: number, c: any) => [number, number, number];
  readonly meshjs_fromPointsWithHoles: (a: number, b: number, c: number, d: number, e: any) => number;
  readonly meshjs_fromPolygons: (a: number, b: number, c: any) => number;
  readonly meshjs_fromSTL: (a: number, b: number, c: any) => [number, number, number];
  readonly meshjs_fromSdfValues: (a: any, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => number;
  readonly meshjs_fromSketch: (a: number) => number;
  readonly meshjs_frustum: (a: number, b: number, c: number, d: number, e: any) => number;
  readonly meshjs_frustum_ptp: (a: number, b: number, c: number, d: number, e: number, f: any) => number;
  readonly meshjs_frustum_ptpComponents: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: any) => number;
  readonly meshjs_gyroid: (a: number, b: number, c: number, d: number, e: any) => number;
  readonly meshjs_hits: (a: number, b: number) => number;
  readonly meshjs_icosahedron: (a: number, b: any) => number;
  readonly meshjs_indices: (a: number) => any;
  readonly meshjs_intersectPolyline: (a: number, b: number, c: number) => [number, number];
  readonly meshjs_intersection: (a: number, b: number) => number;
  readonly meshjs_invalidateBoundingBox: (a: number) => void;
  readonly meshjs_inverse: (a: number) => number;
  readonly meshjs_isConvex: (a: number) => number;
  readonly meshjs_laplacianSmooth: (a: number, b: number, c: number, d: number) => number;
  readonly meshjs_massProperties: (a: number, b: number) => any;
  readonly meshjs_minkowskiSum: (a: number, b: number) => number;
  readonly meshjs_mirror: (a: number, b: number) => number;
  readonly meshjs_new: () => number;
  readonly meshjs_normals: (a: number) => any;
  readonly meshjs_octahedron: (a: number, b: any) => number;
  readonly meshjs_polygons: (a: number) => [number, number];
  readonly meshjs_polyhedron: (a: any, b: any, c: any) => [number, number, number];
  readonly meshjs_positions: (a: number) => any;
  readonly meshjs_projectEdges: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number) => number;
  readonly meshjs_projectEdgesSection: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number, s: number, t: number) => number;
  readonly meshjs_projectPolylines: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number) => number;
  readonly meshjs_projectToPlane: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
  readonly meshjs_raycastAll: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
  readonly meshjs_raycastBatchVisibility: (a: number, b: any, c: number, d: number, e: number, f: number) => any;
  readonly meshjs_raycastFirst: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => number;
  readonly meshjs_reconstructNgons: (a: number) => number;
  readonly meshjs_removePoorTriangles: (a: number, b: number) => number;
  readonly meshjs_renormalize: (a: number) => number;
  readonly meshjs_rotate: (a: number, b: number, c: number, d: number) => number;
  readonly meshjs_rotateQuaternion: (a: number, b: number, c: number, d: number, e: number) => number;
  readonly meshjs_sameMetadata: (a: number, b: number) => number;
  readonly meshjs_sampleSdf: (a: number, b: number, c: number, d: number) => number;
  readonly meshjs_scale: (a: number, b: number, c: number, d: number) => number;
  readonly meshjs_schwarzD: (a: number, b: number, c: number, d: number, e: any) => number;
  readonly meshjs_schwarzP: (a: number, b: number, c: number, d: number, e: any) => number;
  readonly meshjs_slice: (a: number, b: number) => number;
  readonly meshjs_sliceComponents: (a: number, b: number, c: number, d: number, e: number) => number;
  readonly meshjs_sphere: (a: number, b: number, c: number, d: any) => number;
  readonly meshjs_splitByPlane: (a: number, b: number) => [number, number];
  readonly meshjs_spurGearInvolute: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: any) => number;
  readonly meshjs_subdivideTriangles: (a: number, b: number) => number;
  readonly meshjs_taubinSmooth: (a: number, b: number, c: number, d: number, e: number) => number;
  readonly meshjs_teardrop: (a: number, b: number, c: number, d: number, e: any) => number;
  readonly meshjs_teardropCylinder: (a: number, b: number, c: number, d: number, e: any) => number;
  readonly meshjs_toAMF: (a: number, b: number, c: number, d: number, e: number) => [number, number];
  readonly meshjs_toAMFWithColor: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
  readonly meshjs_toArrays: (a: number) => any;
  readonly meshjs_toGLTF: (a: number, b: number, c: number, d: number, e: number) => [number, number];
  readonly meshjs_toSTLASCII: (a: number) => [number, number, number, number];
  readonly meshjs_toSTLBinary: (a: number) => [number, number, number, number];
  readonly meshjs_torus: (a: number, b: number, c: number, d: number, e: any) => number;
  readonly meshjs_transform: (a: number, b: number) => number;
  readonly meshjs_transformComponents: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number) => number;
  readonly meshjs_translate: (a: number, b: number) => number;
  readonly meshjs_translateComponents: (a: number, b: number, c: number, d: number) => number;
  readonly meshjs_triangleCount: (a: number) => number;
  readonly meshjs_triangulate: (a: number) => number;
  readonly meshjs_union: (a: number, b: number) => number;
  readonly meshjs_vertexCount: (a: number) => number;
  readonly meshjs_vertices: (a: number) => any;
  readonly meshjs_xor: (a: number, b: number) => number;
  readonly planejs_FromComponents: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => number;
  readonly planejs_FromVertices: (a: number, b: number) => number;
  readonly planejs_classifyPolygon: (a: number, b: number) => number;
  readonly planejs_flip: (a: number) => void;
  readonly planejs_fromNormal: (a: number, b: number) => number;
  readonly planejs_fromNormalComponents: (a: number, b: number, c: number, d: number) => number;
  readonly planejs_fromPoints: (a: number, b: number, c: number) => number;
  readonly planejs_normal: (a: number) => number;
  readonly planejs_offset: (a: number) => number;
  readonly planejs_orientPlane: (a: number, b: number) => number;
  readonly planejs_orientPoint: (a: number, b: number) => number;
  readonly planejs_orientPointComponents: (a: number, b: number, c: number, d: number) => number;
  readonly planejs_points: (a: number) => [number, number];
  readonly planejs_toXYTransform: (a: number) => any;
  readonly point3js_new: (a: number, b: number, c: number) => number;
  readonly point3js_toString: (a: number) => [number, number];
  readonly polygonjs_addHole: (a: number, b: number, c: number) => void;
  readonly polygonjs_boundingBox: (a: number) => any;
  readonly polygonjs_calculateNewNormal: (a: number) => number;
  readonly polygonjs_flip: (a: number) => void;
  readonly polygonjs_fromVertices: (a: number, b: number, c: any) => number;
  readonly polygonjs_hasHoles: (a: number) => number;
  readonly polygonjs_holeCount: (a: number) => number;
  readonly polygonjs_holes: (a: number) => any;
  readonly polygonjs_metadata: (a: number) => [number, number];
  readonly polygonjs_plane: (a: number) => number;
  readonly polygonjs_setMetadata: (a: number, b: any) => void;
  readonly polygonjs_setNewNormal: (a: number) => void;
  readonly polygonjs_subdivideTriangles: (a: number, b: number) => [number, number];
  readonly polygonjs_toArray: (a: number) => [number, number];
  readonly polygonjs_triangulate: (a: number) => [number, number];
  readonly polygonjs_vertices: (a: number) => any;
  readonly raycasthitjs_triangle_index: (a: number) => number;
  readonly sdfsamplejs_is_inside: (a: number) => number;
  readonly sectionelevationresultjs_cutSketch: (a: number) => number;
  readonly sectionelevationresultjs_hiddenPolylines: (a: number) => any;
  readonly sectionelevationresultjs_silhouetteIndices: (a: number) => any;
  readonly sectionelevationresultjs_visiblePolylines: (a: number) => any;
  readonly sketchjs_airfoilNACA4: (a: number, b: number, c: number, d: number, e: number, f: any) => number;
  readonly sketchjs_arrow: (a: number, b: number, c: number, d: number, e: any) => number;
  readonly sketchjs_bezier: (a: any, b: number, c: any) => [number, number, number];
  readonly sketchjs_boundingBox: (a: number) => any;
  readonly sketchjs_bspline: (a: any, b: number, c: number, d: any) => [number, number, number];
  readonly sketchjs_center: (a: number) => number;
  readonly sketchjs_circle: (a: number, b: number, c: any) => number;
  readonly sketchjs_circleWithFlat: (a: number, b: number, c: number, d: any) => number;
  readonly sketchjs_circleWithKeyway: (a: number, b: number, c: number, d: number, e: any) => number;
  readonly sketchjs_circleWithTwoFlats: (a: number, b: number, c: number, d: any) => number;
  readonly sketchjs_crescent: (a: number, b: number, c: number, d: number, e: any) => number;
  readonly sketchjs_debugGeometry: (a: number) => [number, number];
  readonly sketchjs_difference: (a: number, b: number) => number;
  readonly sketchjs_egg: (a: number, b: number, c: number, d: any) => number;
  readonly sketchjs_ellipse: (a: number, b: number, c: number, d: any) => number;
  readonly sketchjs_extrude: (a: number, b: number) => number;
  readonly sketchjs_extrudeVector: (a: number, b: number) => number;
  readonly sketchjs_extrudeVectorComponents: (a: number, b: number, c: number, d: number) => number;
  readonly sketchjs_fromDXF: (a: number, b: number, c: any) => [number, number, number];
  readonly sketchjs_fromGeo: (a: number, b: number, c: any) => [number, number, number];
  readonly sketchjs_fromHershey: (a: number, b: number, c: number, d: number, e: number, f: number, g: any) => number;
  readonly sketchjs_fromMesh: (a: number) => number;
  readonly sketchjs_fromSVG: (a: number, b: number, c: any) => [number, number, number];
  readonly sketchjs_heart: (a: number, b: number, c: number, d: any) => number;
  readonly sketchjs_hilbertCurve: (a: number, b: number, c: number) => number;
  readonly sketchjs_intersection: (a: number, b: number) => number;
  readonly sketchjs_invalidateBoundingBox: (a: number) => void;
  readonly sketchjs_inverse: (a: number) => number;
  readonly sketchjs_involuteGear: (a: number, b: number, c: number, d: number, e: number, f: number, g: any) => number;
  readonly sketchjs_isEmpty: (a: number) => number;
  readonly sketchjs_keyhole: (a: number, b: number, c: number, d: number, e: any) => number;
  readonly sketchjs_new: () => number;
  readonly sketchjs_pieSlice: (a: number, b: number, c: number, d: number, e: any) => number;
  readonly sketchjs_polygon: (a: any, b: any) => [number, number, number];
  readonly sketchjs_rectangle: (a: number, b: number, c: any) => number;
  readonly sketchjs_regularNGon: (a: number, b: number, c: any) => number;
  readonly sketchjs_renormalize: (a: number) => number;
  readonly sketchjs_reuleaux: (a: number, b: number, c: number, d: any) => number;
  readonly sketchjs_revolve: (a: number, b: number, c: number) => [number, number, number];
  readonly sketchjs_rightTriangle: (a: number, b: number, c: any) => number;
  readonly sketchjs_ring: (a: number, b: number, c: number, d: any) => number;
  readonly sketchjs_rings: (a: number) => any;
  readonly sketchjs_rotate: (a: number, b: number, c: number, d: number) => number;
  readonly sketchjs_roundedRectangle: (a: number, b: number, c: number, d: number, e: any) => number;
  readonly sketchjs_scale: (a: number, b: number, c: number, d: number) => number;
  readonly sketchjs_square: (a: number, b: any) => number;
  readonly sketchjs_squircle: (a: number, b: number, c: number, d: any) => number;
  readonly sketchjs_star: (a: number, b: number, c: number, d: any) => number;
  readonly sketchjs_supershape: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: any) => number;
  readonly sketchjs_sweep: (a: number, b: number, c: number) => number;
  readonly sketchjs_sweepComponents: (a: number, b: any) => number;
  readonly sketchjs_teardrop: (a: number, b: number, c: number, d: any) => number;
  readonly sketchjs_text: (a: number, b: number, c: number, d: number, e: number, f: any) => number;
  readonly sketchjs_toArrays: (a: number) => any;
  readonly sketchjs_toMultiPolygon: (a: number) => [number, number];
  readonly sketchjs_toSVG: (a: number) => [number, number];
  readonly sketchjs_transform: (a: number, b: number) => number;
  readonly sketchjs_transformComponents: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number) => number;
  readonly sketchjs_translate: (a: number, b: number) => number;
  readonly sketchjs_translateComponents: (a: number, b: number, c: number, d: number) => number;
  readonly sketchjs_trapezoid: (a: number, b: number, c: number, d: number, e: any) => number;
  readonly sketchjs_union: (a: number, b: number) => number;
  readonly sketchjs_xor: (a: number, b: number) => number;
  readonly svgimportjs_takeCurves: (a: number) => [number, number];
  readonly svgimportjs_warnings: (a: number) => [number, number];
  readonly vector3js_abs: (a: number) => number;
  readonly vector3js_add: (a: number, b: number) => number;
  readonly vector3js_angle: (a: number, b: number) => number;
  readonly vector3js_cross: (a: number, b: number) => number;
  readonly vector3js_dot: (a: number, b: number) => number;
  readonly vector3js_equals: (a: number, b: number) => number;
  readonly vector3js_isOrthogonal: (a: number, b: number) => number;
  readonly vector3js_length: (a: number) => number;
  readonly vector3js_normalize: (a: number) => number;
  readonly vector3js_reverse: (a: number) => number;
  readonly vector3js_rotate: (a: number, b: number, c: number) => number;
  readonly vector3js_rotateQuaternion: (a: number, b: number, c: number, d: number, e: number) => number;
  readonly vector3js_rotationBetween: (a: number, b: number) => [number, number, number];
  readonly vector3js_scale: (a: number, b: number) => number;
  readonly vector3js_subtract: (a: number, b: number) => number;
  readonly vertexjs_fromComponents: (a: number, b: number, c: number) => number;
  readonly vertexjs_fromPositionNormal: (a: number, b: number) => number;
  readonly vertexjs_new: (a: number, b: number) => number;
  readonly vertexjs_normal: (a: number) => number;
  readonly vertexjs_position: (a: number) => number;
  readonly vertexjs_toArray: (a: number) => [number, number];
  readonly vertexjs_toString: (a: number) => [number, number];
  readonly init_panic_hook: () => void;
  readonly vector3js_new: (a: number, b: number, c: number) => number;
  readonly polygonjs_new: (a: number, b: number, c: any) => number;
  readonly point3js_x: (a: number) => number;
  readonly point3js_y: (a: number) => number;
  readonly point3js_z: (a: number) => number;
  readonly raycasthitjs_distance: (a: number) => number;
  readonly raycasthitjs_normal_x: (a: number) => number;
  readonly raycasthitjs_normal_y: (a: number) => number;
  readonly raycasthitjs_normal_z: (a: number) => number;
  readonly raycasthitjs_point_x: (a: number) => number;
  readonly raycasthitjs_point_y: (a: number) => number;
  readonly raycasthitjs_point_z: (a: number) => number;
  readonly sdfsamplejs_closest_x: (a: number) => number;
  readonly sdfsamplejs_closest_y: (a: number) => number;
  readonly sdfsamplejs_closest_z: (a: number) => number;
  readonly sdfsamplejs_distance: (a: number) => number;
  readonly vector3js_x: (a: number) => number;
  readonly vector3js_y: (a: number) => number;
  readonly vector3js_z: (a: number) => number;
  readonly planejs_new: (a: number, b: number) => number;
  readonly __wbg_raycasthitjs_free: (a: number, b: number) => void;
  readonly __wbg_vector3js_free: (a: number, b: number) => void;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_exn_store: (a: number) => void;
  readonly __externref_table_alloc: () => number;
  readonly __wbindgen_externrefs: WebAssembly.Table;
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
  readonly __externref_drop_slice: (a: number, b: number) => void;
  readonly __externref_table_dealloc: (a: number) => void;
  readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
