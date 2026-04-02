/* tslint:disable */
/* eslint-disable */

export class BooleanRegionJs {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Number of interior holes
   */
  holeCount(): number;
  /**
   * Whether this region has any interior holes
   */
  hasHoles(): boolean;
  /**
   * Get the interior hole curves of this region
   */
  readonly holes: CompoundCurve3DJs[];
  /**
   * Get the exterior boundary curve of this region
   */
  readonly exterior: CompoundCurve3DJs;
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

export class CompoundCurve3DJs {
  free(): void;
  [Symbol.dispose](): void;
  tangentAt(param: number): Vector3Js;
  /**
   * Tessellate curve into evenly spaced points by count
   */
  tessellate(tol?: number | null): Point3Js[];
  /**
   * Trim the compound curve to the sub-curve between parameters t0 and t1.
   * Parameters are in the compound curve's global knot domain.
   * Returns one or more NurbsCurve3DJs segments.
   */
  trimRange(t0: number, t1: number): NurbsCurve3DJs[];
  knotsDomain(): Float64Array;
  /**
   * Perform a boolean operation (union / intersection / difference) with a NurbsCurve3D.
   * Both curves must be planar and coplanar. The operation is performed in 2D
   * and the result is projected back to 3D.
   * Returns BooleanRegionJs results containing exterior curves and interior holes.
   */
  booleanCurve(other: NurbsCurve3DJs, operation: string): BooleanRegionJs[];
  closestPoint(point: Point3Js): Point3Js;
  /**
   * Get all unique control points across all spans
   */
  controlPoints(): Point3Js[];
  /**
   * Get the point at given parameter
   */
  pointAtParam(param: number): Point3Js;
  /**
   * Rotate the compound curve by a unit quaternion given as components `(w, x, y, z)`.
   * The quaternion is normalized before use.
   */
  rotateQuaternion(w: number, x: number, y: number, z: number): CompoundCurve3DJs;
  /**
   * Extrude each span of this compound curve along XYZ components.
   *
   * Returns one `NurbsSurfaceJs` per span.
   */
  extrudeComponents(dx: number, dy: number, dz: number): NurbsSurfaceJs[];
  /**
   * Find intersection points with another `CompoundCurve3DJs`.
   * Intersects each span of `self` against each span of `other`.
   * Returns the 3D intersection points.
   */
  intersectCompound(other: CompoundCurve3DJs): Point3Js[];
  /**
   * Merge consecutive collinear degree-1 spans into single polyline spans.
   *
   * Walks through all spans and checks if consecutive degree-1 spans share
   * the same direction (within a small angular tolerance). Collinear runs are
   * collapsed into one polyline keeping only start and end points. Non-degree-1
   * spans and non-collinear degree-1 spans are preserved unchanged.
   *
   * Always returns a `CompoundCurve3DJs`.
   */
  mergeColinearLines(colinear_tol: number): CompoundCurve3DJs;
  /**
   * Perform a boolean operation (union / intersection / difference) with another CompoundCurve3D.
   * Both curves must be planar and coplanar. The operation is performed in 2D
   * and the result is projected back to 3D.
   * Returns BooleanRegionJs results containing exterior curves and interior holes.
   */
  booleanCompoundCurve(other: CompoundCurve3DJs, operation: string): BooleanRegionJs[];
  /**
   * Find the closest parameter on this compound curve to the given point.
   * Iterates over all spans and returns the parameter with the minimum distance.
   */
  paramClosestToPoint(point: Point3Js): number;
  constructor(spans: NurbsCurve3DJs[]);
  bbox(): Point3Js[];
  clone(): CompoundCurve3DJs;
  /**
   * Scale the compound curve by factors along the X, Y, and Z axes
   */
  scale(sx: number, sy: number, sz: number): CompoundCurve3DJs;
  /**
   * PROPERTIES ///
   */
  spans(): NurbsCurve3DJs[];
  /**
   * Split the compound curve at parameter t, returning [left, right] as CompoundCurve3DJs.
   */
  split(t: number): CompoundCurve3DJs[];
  closed(tol?: number | null): boolean;
  /**
   * Extend the compound curve at one or both ends.
   *
   * - **Degree-1 boundary spans** are extended inline (new control point).
   * - **Higher-degree boundary spans** get a tangent line segment prepended/appended.
   *
   * # Arguments
   * * `distance` – how far to extend (world units)
   * * `side`     – `"end"` (default), `"start"`, or `"both"`
   */
  extend(distance: number, side?: string | null): CompoundCurve3DJs;
  length(): number;
  /**
   * Offset the compound curve by a distance with the specified corner type ('sharp','round','smooth').
   * The curve must already lie in the XY plane (z = 0).
   */
  offset(distance: number, corner_type: string): CompoundCurve3DJs;
  /**
   * Rotate the compound curve by Euler angles (in radians) around the X, Y, and Z axes
   */
  rotate(ax: number, ay: number, az: number): CompoundCurve3DJs;
  /**
   * Extrude each span of this compound curve along a direction vector.
   *
   * Returns one `NurbsSurfaceJs` per span. The surfaces share boundaries at
   * span junctions and together form a continuous ruled solid.
   */
  extrude(direction: Vector3Js): NurbsSurfaceJs[];
  /**
   * Reverse the direction of the compound curve (swap start/end).
   * Returns a new reversed copy.
   */
  reverse(): CompoundCurve3DJs;
  find_span(param: number): NurbsCurve3DJs;
  /**
   * Find intersection points with a `NurbsCurve3DJs`.
   * Intersects each span of `self` against `other`.
   * Returns the 3D intersection points.
   */
  intersect(other: NurbsCurve3DJs): Point3Js[];
  /**
   * Translate the compound curve by a Vector3Js offset
   */
  translate(offset: Vector3Js): CompoundCurve3DJs;
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
  static fromSketch(sketch_js: SketchJs): MeshJs;
  static frustum_ptp(start: Point3Js, end: Point3Js, radius1: number, radius2: number, segments: number, metadata: any): MeshJs;
  static icosahedron(radius: number, metadata: any): MeshJs;
  renormalize(): MeshJs;
  triangulate(): MeshJs;
  boundingBox(): any;
  intersection(other: MeshJs): MeshJs;
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
   * Number of triangles (handy to sanity-check).
   */
  triangleCount(): number;
  adaptiveRefine(quality_threshold: number, max_edge_length: number, curvature_threshold_deg: number): MeshJs;
  containsVertex(p: Point3Js): boolean;
  distributeGrid(rows: number, cols: number, row_spacing: number, col_spacing: number): MeshJs;
  /**
   * Find intersection points between a NURBS curve and this Mesh.
   * The curve is tessellated into a polyline (using the given tolerance),
   * then each segment is tested against the mesh triangles.
   *
   * # Arguments
   * - `curve`: A `NurbsCurve3DJs` to intersect with this mesh.
   * - `tolerance`: Optional tessellation tolerance for the curve (default: 1e-4).
   *
   * # Returns
   * A `Vec<Point3Js>` of 3D intersection points, in order along the curve.
   */
  intersectCurve(curve: NurbsCurve3DJs, tolerance?: number | null): Point3Js[];
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
   */
  projectEdges(vx: number, vy: number, vz: number, ox: number, oy: number, oz: number, nx: number, ny: number, nz: number, feature_angle_deg: number, n_samples: number, occluders: MeshJs[]): EdgeProjectionResultJs;
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
  transformComponents(m00: number, m01: number, m02: number, m03: number, m10: number, m11: number, m12: number, m13: number, m20: number, m21: number, m22: number, m23: number, m30: number, m31: number, m32: number, m33: number): MeshJs;
  translateComponents(dx: number, dy: number, dz: number): MeshJs;
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
   * Find intersection points between a compound curve and this Mesh.
   * Each span of the compound curve is tessellated and tested against the mesh.
   *
   * # Arguments
   * - `curve`: A `CompoundCurve3DJs` to intersect with this mesh.
   * - `tolerance`: Optional tessellation tolerance (default: 1e-4).
   *
   * # Returns
   * A `Vec<Point3Js>` of 3D intersection points, in order along the curve.
   */
  intersectCompoundCurve(curve: CompoundCurve3DJs, tolerance?: number | null): Point3Js[];
  /**
   * Slice at a section plane and return visible/hidden edge projections plus
   * the cut sketch.
   *
   * - `(snx, sny, snz)` / `section_offset` – section plane normal + d offset.
   * - `(vx, vy, vz)` – view direction.
   * - `(ox, oy, oz)` / `(nx, ny, nz)` – projection plane origin + normal.
   * - `feature_angle_deg`, `n_samples`, `occluders` – as in `projectEdges`.
   */
  projectEdgesSection(snx: number, sny: number, snz: number, section_offset: number, vx: number, vy: number, vz: number, ox: number, oy: number, oz: number, nx: number, ny: number, nz: number, feature_angle_deg: number, n_samples: number, occluders: MeshJs[]): SectionElevationResultJs;
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

export class NurbsCurve3DJs {
  free(): void;
  [Symbol.dispose](): void;
  tangentAt(param: number): Vector3Js;
  tessellate(tol?: number | null): Point3Js[];
  /**
   * Trim the curve to the sub-curve between parameters t0 and t1.
   * When t0 < t1, returns the "inside" portion.
   * Returns one or more NurbsCurve3DJs segments.
   */
  trimRange(t0: number, t1: number): NurbsCurve3DJs[];
  /**
   * Create an exact NURBS circle.
   *
   * # Arguments
   *
   * * `radius`  – radius of the circle (required)
   * * `center`  – centre point; defaults to the origin
   * * `normal`  – plane normal; defaults to `(0, 0, 1)` (XY-plane).
   *               The X and Y axes of the circle plane are derived from this vector.
   *
   * Returns a closed degree-2 NURBS curve that is an exact rational circle.
   */
  static makeCircle(radius: number, center?: Point3Js | null, normal?: Vector3Js | null): NurbsCurve3DJs;
  /**
   * Get the plane the curve lies on, returned as [normal, localX, localY].
   * Returns an empty array if the curve is not planar.
   * Local axes are aligned to the closest global axes for consistency.
   */
  getOnPlane(tolerance?: number | null): Vector3Js[];
  knotsDomain(): Float64Array;
  /**
   * Perform a boolean operation (union / intersection / difference) with another NurbsCurve3D.
   * Both curves must be planar and coplanar. The operation is performed in 2D
   * and the result is projected back to 3D.
   * Returns BooleanRegionJs results containing exterior curves and interior holes.
   */
  booleanCurve(other: NurbsCurve3DJs, operation: string): BooleanRegionJs[];
  static makePolyline(points: Point3Js[], normalize: boolean): NurbsCurve3DJs;
  /**
   * PROPERTIES ///
   */
  controlPoints(): Point3Js[];
  /**
   * Get the point at given parameter
   */
  pointAtParam(param: number): Point3Js;
  paramAtLength(length: number): number;
  filletAtParams(radius: number, at: Float64Array): CompoundCurve3DJs;
  /**
   * Create NURBS Curve (degree 3) passing through given control points
   *
   *  # Arguments
   * 
   * * `points` - Control points to interpolate through (x,y,z)
   * 
   */
  static makeInterpolated(points: Point3Js[], degree: number): NurbsCurve3DJs;
  /**
   * Rotate the curve by a unit quaternion given as components `(w, x, y, z)`.
   * The quaternion is normalized before use.
   */
  rotateQuaternion(w: number, x: number, y: number, z: number): NurbsCurve3DJs;
  /**
   * Extrude this curve along XYZ components to create a `NurbsSurfaceJs`.
   */
  extrudeComponents(dx: number, dy: number, dz: number): NurbsSurfaceJs;
  /**
   * Find intersection points with a `CompoundCurve3DJs`.
   * Intersects `self` against each span of the compound curve.
   * Returns the 3D intersection points.
   */
  intersectCompound(other: CompoundCurve3DJs): Point3Js[];
  /**
   * Perform a boolean operation (union / intersection / difference) with a CompoundCurve3D.
   * Both curves must be planar and coplanar. The operation is performed in 2D
   * and the result is projected back to 3D.
   * Returns BooleanRegionJs results containing exterior curves and interior holes.
   */
  booleanCompoundCurve(other: CompoundCurve3DJs, operation: string): BooleanRegionJs[];
  paramClosestToPoint(point: Point3Js): number;
  constructor(degree: number, control_points: Point3Js[], weights: Float64Array | null | undefined, knots: Float64Array);
  bbox(): Point3Js[];
  /**
   * Loft through an ordered array of curves to create a `NurbsSurfaceJs`.
   *
   * Static method — call as `NurbsCurve3DJs.loft(curves, degreeV?)`.
   *
   * # Arguments
   * * `curves`   – ordered array of profile curves
   * * `degree_v` – optional degree for the loft direction
   */
  static loft(curves: NurbsCurve3DJs[], degree_v?: number | null): NurbsSurfaceJs;
  clone(): NurbsCurve3DJs;
  knots(): Float64Array;
  /**
   * Scale the curve by factors along the X, Y, and Z axes
   */
  scale(sx: number, sy: number, sz: number): NurbsCurve3DJs;
  /**
   * Split the curve at parameter t, returning [left, right].
   */
  split(t: number): NurbsCurve3DJs[];
  /**
   * Sweep this curve (as profile) along a `rail` curve to create a `NurbsSurfaceJs`.
   *
   * # Arguments
   * * `rail`     – the path curve
   * * `degree_v` – optional degree for the sweep direction
   */
  sweep(rail: NurbsCurve3DJs, degree_v?: number | null): NurbsSurfaceJs;
  closed(): boolean;
  /**
   * Get the degree of the curve
   */
  degree(): number;
  /**
   * Extend a curve at one or both ends.
   *
   * - **Degree 1 (polyline)**: appends/prepends a new control point along the last/first segment direction.
   * - **Degree > 1**: adds a straight-line segment tangent to the curve at the boundary.
   *
   * Always returns a `CompoundCurve3DJs` (single-span for extended polylines).
   *
   * # Arguments
   * * `distance` – how far to extend (world units)
   * * `side`     – `"end"` (default), `"start"`, or `"both"`
   */
  extend(distance: number, side?: string | null): CompoundCurve3DJs;
  fillet(radius: number, at?: Point3Js[] | null): CompoundCurve3DJs;
  length(): number;
  /**
   * Offset the curve by a distance in the specified corner type ('sharp','round', 'smooth').
   * The curve must already lie in the XY plane (z = 0).
   */
  offset(distance: number, corner_type: string): CompoundCurve3DJs;
  /**
   * Rotate the curve by Euler angles (in radians) around the X, Y, and Z axes
   */
  rotate(ax: number, ay: number, az: number): NurbsCurve3DJs;
  /**
   * Extrude this curve along a direction vector to create a `NurbsSurfaceJs`.
   */
  extrude(direction: Vector3Js): NurbsSurfaceJs;
  /**
   * Reverse the direction of this curve (swap start/end).
   * Returns a new reversed copy.
   */
  reverse(): NurbsCurve3DJs;
  weights(): Float64Array;
  /**
   * Find intersection points with another `NurbsCurve3DJs`.
   * Returns the 3D intersection points.
   */
  intersect(other: NurbsCurve3DJs): Point3Js[];
  /**
   * Check if all control points lie on a single plane
   */
  isPlanar(tolerance?: number | null): boolean;
  /**
   * Translate the curve by a Vector3Js offset
   */
  translate(offset: Vector3Js): NurbsCurve3DJs;
}

export class NurbsSurfaceJs {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Knot domains as [u_min, u_max, v_min, v_max]
   */
  knotsDomain(): Float64Array;
  /**
   * Return a regular (uniform grid) tessellation as `{ positions, normals, indices }`.
   *
   * # Arguments
   * * `divs_u` – number of divisions in the U direction
   * * `divs_v` – number of divisions in the V direction
   */
  toArraysRegular(divs_u: number, divs_v: number): any;
  /**
   * Scale the surface by per-axis factors
   */
  scale(sx: number, sy: number, sz: number): NurbsSurfaceJs;
  /**
   * Rotate the surface by Euler angles (radians)
   */
  rotate(ax: number, ay: number, az: number): NurbsSurfaceJs;
  /**
   * Point on surface at parameters (u, v)
   */
  pointAt(u: number, v: number): Point3Js;
  /**
   * U-direction degree of the surface
   */
  uDegree(): number;
  /**
   * V-direction degree of the surface
   */
  vDegree(): number;
  /**
   * Normal vector at parameters (u, v)
   */
  normalAt(u: number, v: number): Vector3Js;
  /**
   * Tessellate the surface and return `{ positions, normals, indices }` flat typed arrays.
   *
   * # Arguments
   * * `tolerance` – adaptive tessellation normal-tolerance (default `1e-2`).
   *                 Smaller values produce a finer mesh.
   */
  toArrays(tolerance?: number | null): any;
  /**
   * Translate the surface by a vector
   */
  translate(offset: Vector3Js): NurbsSurfaceJs;
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

export class Point4Js {
  free(): void;
  [Symbol.dispose](): void;
  toString(): string;
  constructor(x: number, y: number, z: number, w: number);
  readonly w: number;
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
  intersection(other: SketchJs): SketchJs;
  static regularNGon(sides: number, radius: number, metadata: any): SketchJs;
  static airfoilNACA4(max_camber: number, camber_position: number, thickness: number, chord: number, samples: number, metadata: any): SketchJs;
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
  static arrow(shaft_length: number, shaft_width: number, head_length: number, head_width: number, metadata: any): SketchJs;
  static heart(width: number, height: number, segments: number, metadata: any): SketchJs;
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

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly __wbg_booleanregionjs_free: (a: number, b: number) => void;
  readonly __wbg_closestpointresultjs_free: (a: number, b: number) => void;
  readonly __wbg_compoundcurve3djs_free: (a: number, b: number) => void;
  readonly __wbg_edgeprojectionresultjs_free: (a: number, b: number) => void;
  readonly __wbg_matrix4js_free: (a: number, b: number) => void;
  readonly __wbg_meshjs_free: (a: number, b: number) => void;
  readonly __wbg_nurbscurve3djs_free: (a: number, b: number) => void;
  readonly __wbg_nurbssurfacejs_free: (a: number, b: number) => void;
  readonly __wbg_planejs_free: (a: number, b: number) => void;
  readonly __wbg_point3js_free: (a: number, b: number) => void;
  readonly __wbg_point4js_free: (a: number, b: number) => void;
  readonly __wbg_polygonjs_free: (a: number, b: number) => void;
  readonly __wbg_sdfsamplejs_free: (a: number, b: number) => void;
  readonly __wbg_sectionelevationresultjs_free: (a: number, b: number) => void;
  readonly __wbg_sketchjs_free: (a: number, b: number) => void;
  readonly __wbg_vertexjs_free: (a: number, b: number) => void;
  readonly booleanregionjs_exterior: (a: number) => number;
  readonly booleanregionjs_hasHoles: (a: number) => number;
  readonly booleanregionjs_holeCount: (a: number) => number;
  readonly booleanregionjs_holes: (a: number) => [number, number];
  readonly closestpointresultjs_distance: (a: number) => number;
  readonly closestpointresultjs_is_inside: (a: number) => number;
  readonly closestpointresultjs_normal_x: (a: number) => number;
  readonly closestpointresultjs_normal_y: (a: number) => number;
  readonly closestpointresultjs_normal_z: (a: number) => number;
  readonly closestpointresultjs_point_x: (a: number) => number;
  readonly closestpointresultjs_point_y: (a: number) => number;
  readonly closestpointresultjs_point_z: (a: number) => number;
  readonly compoundcurve3djs_bbox: (a: number) => [number, number];
  readonly compoundcurve3djs_booleanCompoundCurve: (a: number, b: number, c: number, d: number) => [number, number, number, number];
  readonly compoundcurve3djs_booleanCurve: (a: number, b: number, c: number, d: number) => [number, number, number, number];
  readonly compoundcurve3djs_clone: (a: number) => number;
  readonly compoundcurve3djs_closed: (a: number, b: number, c: number) => number;
  readonly compoundcurve3djs_closestPoint: (a: number, b: number) => [number, number, number];
  readonly compoundcurve3djs_controlPoints: (a: number) => [number, number];
  readonly compoundcurve3djs_extend: (a: number, b: number, c: number, d: number) => [number, number, number];
  readonly compoundcurve3djs_extrude: (a: number, b: number) => [number, number];
  readonly compoundcurve3djs_extrudeComponents: (a: number, b: number, c: number, d: number) => [number, number];
  readonly compoundcurve3djs_find_span: (a: number, b: number) => number;
  readonly compoundcurve3djs_intersect: (a: number, b: number) => [number, number, number, number];
  readonly compoundcurve3djs_intersectCompound: (a: number, b: number) => [number, number, number, number];
  readonly compoundcurve3djs_knotsDomain: (a: number) => [number, number];
  readonly compoundcurve3djs_length: (a: number) => number;
  readonly compoundcurve3djs_mergeColinearLines: (a: number, b: number) => number;
  readonly compoundcurve3djs_new: (a: number, b: number) => [number, number, number];
  readonly compoundcurve3djs_offset: (a: number, b: number, c: number, d: number) => [number, number, number];
  readonly compoundcurve3djs_paramClosestToPoint: (a: number, b: number) => [number, number, number];
  readonly compoundcurve3djs_pointAtParam: (a: number, b: number) => number;
  readonly compoundcurve3djs_reverse: (a: number) => number;
  readonly compoundcurve3djs_rotate: (a: number, b: number, c: number, d: number) => number;
  readonly compoundcurve3djs_rotateQuaternion: (a: number, b: number, c: number, d: number, e: number) => number;
  readonly compoundcurve3djs_scale: (a: number, b: number, c: number, d: number) => number;
  readonly compoundcurve3djs_spans: (a: number) => [number, number];
  readonly compoundcurve3djs_split: (a: number, b: number) => [number, number, number, number];
  readonly compoundcurve3djs_tangentAt: (a: number, b: number) => number;
  readonly compoundcurve3djs_tessellate: (a: number, b: number, c: number) => [number, number];
  readonly compoundcurve3djs_translate: (a: number, b: number) => number;
  readonly compoundcurve3djs_trimRange: (a: number, b: number, c: number) => [number, number, number, number];
  readonly edgeprojectionresultjs_hiddenPolylines: (a: number) => any;
  readonly edgeprojectionresultjs_visiblePolylines: (a: number) => any;
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
  readonly meshjs_fromPointsWithHoles: (a: number, b: number, c: number, d: number, e: any) => number;
  readonly meshjs_fromPolygons: (a: number, b: number, c: any) => number;
  readonly meshjs_fromSdfValues: (a: any, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => number;
  readonly meshjs_fromSketch: (a: number) => number;
  readonly meshjs_frustum: (a: number, b: number, c: number, d: number, e: any) => number;
  readonly meshjs_frustum_ptp: (a: number, b: number, c: number, d: number, e: number, f: any) => number;
  readonly meshjs_frustum_ptpComponents: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: any) => number;
  readonly meshjs_gyroid: (a: number, b: number, c: number, d: number, e: any) => number;
  readonly meshjs_hits: (a: number, b: number) => number;
  readonly meshjs_icosahedron: (a: number, b: any) => number;
  readonly meshjs_indices: (a: number) => any;
  readonly meshjs_intersectCompoundCurve: (a: number, b: number, c: number, d: number) => [number, number];
  readonly meshjs_intersectCurve: (a: number, b: number, c: number, d: number) => [number, number];
  readonly meshjs_intersectPolyline: (a: number, b: number, c: number) => [number, number];
  readonly meshjs_intersection: (a: number, b: number) => number;
  readonly meshjs_invalidateBoundingBox: (a: number) => void;
  readonly meshjs_inverse: (a: number) => number;
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
  readonly meshjs_projectEdges: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number) => number;
  readonly meshjs_projectEdgesSection: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number) => number;
  readonly meshjs_projectToPlane: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
  readonly meshjs_raycastAll: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
  readonly meshjs_raycastBatchVisibility: (a: number, b: any, c: number, d: number, e: number, f: number) => any;
  readonly meshjs_raycastFirst: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => number;
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
  readonly nurbscurve3djs_bbox: (a: number) => [number, number];
  readonly nurbscurve3djs_booleanCompoundCurve: (a: number, b: number, c: number, d: number) => [number, number, number, number];
  readonly nurbscurve3djs_booleanCurve: (a: number, b: number, c: number, d: number) => [number, number, number, number];
  readonly nurbscurve3djs_clone: (a: number) => number;
  readonly nurbscurve3djs_closed: (a: number) => number;
  readonly nurbscurve3djs_controlPoints: (a: number) => [number, number];
  readonly nurbscurve3djs_degree: (a: number) => number;
  readonly nurbscurve3djs_extend: (a: number, b: number, c: number, d: number) => [number, number, number];
  readonly nurbscurve3djs_extrude: (a: number, b: number) => number;
  readonly nurbscurve3djs_extrudeComponents: (a: number, b: number, c: number, d: number) => number;
  readonly nurbscurve3djs_fillet: (a: number, b: number, c: number, d: number) => [number, number, number];
  readonly nurbscurve3djs_filletAtParams: (a: number, b: number, c: number, d: number) => [number, number, number];
  readonly nurbscurve3djs_getOnPlane: (a: number, b: number, c: number) => [number, number];
  readonly nurbscurve3djs_intersect: (a: number, b: number) => [number, number, number, number];
  readonly nurbscurve3djs_intersectCompound: (a: number, b: number) => [number, number, number, number];
  readonly nurbscurve3djs_isPlanar: (a: number, b: number, c: number) => number;
  readonly nurbscurve3djs_knots: (a: number) => [number, number];
  readonly nurbscurve3djs_knotsDomain: (a: number) => [number, number];
  readonly nurbscurve3djs_length: (a: number) => number;
  readonly nurbscurve3djs_loft: (a: number, b: number, c: number) => [number, number, number];
  readonly nurbscurve3djs_makeCircle: (a: number, b: number, c: number) => [number, number, number];
  readonly nurbscurve3djs_makeInterpolated: (a: number, b: number, c: number) => [number, number, number];
  readonly nurbscurve3djs_makePolyline: (a: number, b: number, c: number) => number;
  readonly nurbscurve3djs_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
  readonly nurbscurve3djs_offset: (a: number, b: number, c: number, d: number) => [number, number, number];
  readonly nurbscurve3djs_paramAtLength: (a: number, b: number) => [number, number, number];
  readonly nurbscurve3djs_paramClosestToPoint: (a: number, b: number) => [number, number, number];
  readonly nurbscurve3djs_pointAtParam: (a: number, b: number) => number;
  readonly nurbscurve3djs_reverse: (a: number) => number;
  readonly nurbscurve3djs_rotate: (a: number, b: number, c: number, d: number) => number;
  readonly nurbscurve3djs_rotateQuaternion: (a: number, b: number, c: number, d: number, e: number) => number;
  readonly nurbscurve3djs_scale: (a: number, b: number, c: number, d: number) => number;
  readonly nurbscurve3djs_split: (a: number, b: number) => [number, number, number, number];
  readonly nurbscurve3djs_sweep: (a: number, b: number, c: number) => [number, number, number];
  readonly nurbscurve3djs_tangentAt: (a: number, b: number) => number;
  readonly nurbscurve3djs_tessellate: (a: number, b: number, c: number) => [number, number];
  readonly nurbscurve3djs_translate: (a: number, b: number) => number;
  readonly nurbscurve3djs_trimRange: (a: number, b: number, c: number) => [number, number, number, number];
  readonly nurbscurve3djs_weights: (a: number) => [number, number];
  readonly nurbssurfacejs_knotsDomain: (a: number) => [number, number];
  readonly nurbssurfacejs_normalAt: (a: number, b: number, c: number) => number;
  readonly nurbssurfacejs_pointAt: (a: number, b: number, c: number) => number;
  readonly nurbssurfacejs_rotate: (a: number, b: number, c: number, d: number) => number;
  readonly nurbssurfacejs_scale: (a: number, b: number, c: number, d: number) => number;
  readonly nurbssurfacejs_toArrays: (a: number, b: number, c: number) => any;
  readonly nurbssurfacejs_toArraysRegular: (a: number, b: number, c: number) => any;
  readonly nurbssurfacejs_translate: (a: number, b: number) => number;
  readonly nurbssurfacejs_uDegree: (a: number) => number;
  readonly nurbssurfacejs_vDegree: (a: number) => number;
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
  readonly point4js_new: (a: number, b: number, c: number, d: number) => number;
  readonly point4js_toString: (a: number) => [number, number];
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
  readonly sketchjs_fromGeo: (a: number, b: number, c: any) => [number, number, number];
  readonly sketchjs_fromMesh: (a: number) => number;
  readonly sketchjs_fromSVG: (a: number, b: number, c: any) => [number, number, number];
  readonly sketchjs_heart: (a: number, b: number, c: number, d: any) => number;
  readonly sketchjs_intersection: (a: number, b: number) => number;
  readonly sketchjs_inverse: (a: number) => number;
  readonly sketchjs_involuteGear: (a: number, b: number, c: number, d: number, e: number, f: number, g: any) => number;
  readonly sketchjs_isEmpty: (a: number) => number;
  readonly sketchjs_keyhole: (a: number, b: number, c: number, d: number, e: any) => number;
  readonly sketchjs_pieSlice: (a: number, b: number, c: number, d: number, e: any) => number;
  readonly sketchjs_polygon: (a: any, b: any) => [number, number, number];
  readonly sketchjs_rectangle: (a: number, b: number, c: any) => number;
  readonly sketchjs_regularNGon: (a: number, b: number, c: any) => number;
  readonly sketchjs_renormalize: (a: number) => number;
  readonly sketchjs_reuleaux: (a: number, b: number, c: number, d: any) => number;
  readonly sketchjs_revolve: (a: number, b: number, c: number) => [number, number, number];
  readonly sketchjs_rightTriangle: (a: number, b: number, c: any) => number;
  readonly sketchjs_ring: (a: number, b: number, c: number, d: any) => number;
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
  readonly vector3js_new: (a: number, b: number, c: number) => number;
  readonly polygonjs_new: (a: number, b: number, c: any) => number;
  readonly sketchjs_invalidateBoundingBox: (a: number) => void;
  readonly sketchjs_new: () => number;
  readonly point3js_x: (a: number) => number;
  readonly point3js_y: (a: number) => number;
  readonly point3js_z: (a: number) => number;
  readonly point4js_w: (a: number) => number;
  readonly point4js_x: (a: number) => number;
  readonly point4js_y: (a: number) => number;
  readonly point4js_z: (a: number) => number;
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
  readonly __externref_drop_slice: (a: number, b: number) => void;
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
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
