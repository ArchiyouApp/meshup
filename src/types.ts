import { Vector } from './Vector'
import { Vertex } from './Vertex';
import { Point } from './Point';
import { StyleData } from './Style';
import { PROJECTION_DEFAULTS, PROJECTION_LEGACY_ARGS } from './constants';

import { 
  Point3Js,
  Vector3Js,
  VertexJs, 
  Matrix4Js,
  MeshJs,
  Curve3DJs,
  SketchJs,
  PlaneJs, 
  PolygonJs, 
} from './wasm/meshup.js';


/** Main CsgrsModule (manually types) 
 *  TODO: Auto-generate from WASM bindings
*/
export type CsgrsModule = 
{
  Point3Js: typeof Point3Js;
  Vector3Js: typeof Vector3Js;
  Matrix4Js: typeof Matrix4Js;
  MeshJs: typeof MeshJs;
  SketchJs: typeof SketchJs;
  PlaneJs:  typeof PlaneJs;
  PolygonJs: typeof PolygonJs;
  VertexJs: typeof VertexJs;
  Curve3DJs: typeof Curve3DJs;
  // TODO: more
};

export type Axis = 'x'|'y'|'z';
export function isAxis(obj: any): obj is Axis {
  return obj === 'x' || obj === 'y' || obj === 'z';
}

/** In-plane orientation of a Shape: aligned with the X axis ('horizontal')
 *  or with the Y axis ('vertical'). See Mesh/Curve.rotateToOrtho(). */
export type OrientationXY = 'horizontal'|'vertical';
export function isOrientationXY(obj: any): obj is OrientationXY {
  return obj === 'horizontal' || obj === 'vertical';
}

export type PointLike = number | Point | Vector | Vertex |
  Point3Js |  Vector3Js | VertexJs | Array<number> |
  // z is optional: the Point constructor accepts {x,y} and defaults z to 0
  { x: number; y: number; z?: number; };

export function isPointLike(obj: any): obj is PointLike 
{
  return typeof obj === 'number' || // single number (x), treated as [x,0,0]
    isAxis(obj) || // x,y,z as shorthand for unit vectors
    obj instanceof Point ||
    obj instanceof Vector ||
    obj instanceof Vertex ||
    obj instanceof Point3Js ||
    obj instanceof Vector3Js ||
    obj instanceof VertexJs ||
    (Array.isArray(obj) && obj.every(item => typeof item === 'number')) || // [x], [x,y], [x,y,z] - needs to be numbers
    // z is optional, matching PointLike and the Point constructor (which defaults it to 0)
    typeof obj === 'object' && obj !== null && 'x' in obj && 'y' in obj
}


/** What Curve.fillet()/chamfer() accept for their `at` corner filter: a corner index
 *  (negative counts from the end), several indices as a Uint32Array, a point (nearest
 *  corner wins), a Vertex, a selector string, a collection, or an array mixing them.
 *
 *  A flat array of numbers is always a point, never an index list — `[0, 2]` is the
 *  point (0,2). Use a Uint32Array for several indices. */
export type CurveCornerSelection = number | string | PointLike | Vertex | Uint32Array
  | Array<number | string | PointLike | Vertex>
  | { toArray(): Array<any> };

export type BasePlane = 'xy' | 'yz' | 'xz' | 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';
export function isBasePlane(obj: any): obj is BasePlane {
  return ['xy', 'yz', 'xz', 'front', 'back', 'left', 'right', 'top', 'bottom'].includes(obj);
}

//// EXACT SPAN PARAMETERS ////

/** A world-space 3D point as a plain triple, the form `Curve3DJs.spanParams()` returns. */
export type SpanPoint = [number, number, number];

/** The ellipse a conic span lies on, in world space.
 *
 *  `majorAxis` is the centre-to-major-axis-endpoint **vector**, not a length — DXF's
 *  `ELLIPSE` entity wants it that way (groups 11/21/31), and it carries the rotation an
 *  SVG `A` command needs at the same time. `startParam`/`endParam` are eccentric
 *  anomalies in that frame, ordered so a counter-clockwise sweep from the first reaches
 *  the second along the actual span. */
export interface SpanEllipse
{
    center: SpanPoint;
    majorAxis: SpanPoint;
    ratio: number;
    startParam: number;
    endParam: number;
    ccw: boolean;
}

/** One exact span of a Curve, described by the parameters a file format needs.
 *
 *  Returned by {@link Curve.spanParams}. See that method for why the other accessors
 *  (`subtype()`, `controlPoints()`, `knots()`) cannot answer this question.
 */
export type SpanParams =
    | { kind: 'line'; start: SpanPoint; end: SpanPoint }
    | {
        kind: 'arc';
        start: SpanPoint;
        /** Exact on-curve midpoint — with the endpoints it settles world orientation,
         *  which `ccw` alone cannot: `ccw` is measured in the curve's own plane, and a
         *  plane's normal may point at -Z. */
        mid: SpanPoint;
        end: SpanPoint;
        center: SpanPoint;
        radius: number;
        ccw: boolean;
        /** Signed radians, positive counter-clockwise in the curve's plane. */
        sweep: number;
        /** `tan(sweep / 4)` — a DXF LWPOLYLINE vertex bulge, ready to write. */
        bulge: number;
    }
    | { kind: 'quadratic'; start: SpanPoint; control: SpanPoint; end: SpanPoint }
    | { kind: 'cubic'; start: SpanPoint; control1: SpanPoint; control2: SpanPoint; end: SpanPoint }
    | {
        kind: 'conic';
        start: SpanPoint;
        mid: SpanPoint;
        end: SpanPoint;
        control: SpanPoint;
        /** Normalised middle weight: < 1 ellipse, 1 parabola, > 1 hyperbola. */
        weight: number;
        /** Absent for a parabola or hyperbola, and when the reconstruction failed its own
         *  accuracy check. Write the rational quadratic or tessellate — never an ellipse. */
        ellipse?: SpanEllipse;
    }
    | {
        kind: 'spline';
        degree: number;
        controlPoints: SpanPoint[];
        knots: number[];
        weights: number[];
        rational: boolean;
        /** The span's exact Bezier decomposition: one affine control net per knot interval,
         *  each of `degree + 1` points. Empty when hypercurve declines it.
         *
         *  Carried alongside the control net rather than instead of it: a DXF SPLINE entity
         *  wants the authored net and knot vector, a renderer wants Bezier segments it can
         *  write as `Q`/`C`. */
        beziers: SpanPoint[][];
        start: SpanPoint;
        end: SpanPoint;
    }
    | { kind: 'unsupported'; reason: string; start: SpanPoint; end: SpanPoint };

//// OUTPUT TYPES ////

export interface GLTFBuffer 
{
        data: string;       // base64-encoded binary buffer
        byteLength: number;
        count: number;      // vertex count
        min?: Point; // bbox min
        max?: Point; // bbox max
}

//// BVH AND RELATED METHODS ////

/** Result of a BVH-accelerated first-hit raycast. */
export interface RaycastHit
{
  pointX: number; pointY: number; pointZ: number;
  normalX: number; normalY: number; normalZ: number;
  distance: number;
  triangleIndex: number;
}

/** Result of a closest-surface-point query. */
export interface ClosestPointResult
{
  pointX: number; pointY: number; pointZ: number;
  normalX: number; normalY: number; normalZ: number;
  distance: number;
  isInside: boolean;
}

/** Signed-distance-field sample at a query point. */
export interface SdfSample
{
  distance: number;
  isInside: boolean;
  closestX: number; closestY: number; closestZ: number;
}

/** Which hidden-line-removal algorithm to run.
 *
 *  The algorithms live side by side so they can be compared on the same model.
 *  `'exact'` is the default (see `ISOMETRY_HLR_STRATEGY_DEFAULT`); `'raycast'` is the
 *  original sampling solver and remains available by naming it explicitly.
 *
 *  - `'raycast'` — samples visibility at points along each edge and bisects
 *    where neighbouring samples disagree. Endpoints are approximate, and an
 *    occluder narrower than the sample spacing is missed entirely.
 *  - `'exact'` — computes occlusion as exact parametric intervals. Endpoints
 *    land on the true silhouette crossing and no occluder is too small to find.
 *    Ignores `samples`.
 *  - `'clip'` — per shape: backface-cull for its own line work, then clip that
 *    against the projected silhouettes of the shapes in front of it. No ray
 *    casting at all. Requires convex, non-interpenetrating shapes.
 *  - `'painter'` — per shape, drawn back-to-front with opaque faces so nearer
 *    shapes cover farther ones. No occlusion computation whatsoever. Same shape
 *    requirements as `'clip'`, and the output carries fills.
 */
export type HlrStrategy = 'raycast' | 'exact' | 'clip' | 'painter';

export interface ProjectEdgeOptions
{
  viewDirection?: PointLike;
  planeOrigin?: PointLike;
  planeNormal?: PointLike; // for elevation and section
  featureAngle?: number; // Minimum crease angle in degrees
  samples?: number; // HLR ray samples per edge — 'raycast' only
  strategy?: HlrStrategy; // which HLR algorithm to run (default: ISOMETRY_HLR_STRATEGY_DEFAULT)
}

/** The trailing `view` object of the legacy positional projection signatures — see
 *  {@link resolveProjectionArgs}. The current signatures take a method and
 *  {@link ProjectionOptions} instead.
 */
export interface ProjectionViewOptions
{
  /** Which HLR algorithm to run. Defaults to {@link ISOMETRY_HLR_STRATEGY_DEFAULT}. */
  strategy?: HlrStrategy;
  /** Fall back to {@link ISOMETRY_HLR_STRATEGY_DEFAULT} with a warning when a per-shape
   *  strategy does not apply to this scene, instead of throwing. Default `false`, so a
   *  strategy that cannot run says so rather than silently changing. */
  fallback?: boolean;
}

/** The settings of a hidden-line projection, independent of which algorithm runs it: the
 *  `options` of `isometry(cam, method, options)`, `elevation(from, method, options)` and
 *  `section(pivot, normal, method, options)`.
 *
 *  Grouping them in an object is what keeps the call readable once there are five of them,
 *  and what lets options be added without growing a positional tail. The defaults are
 *  {@link PROJECTION_DEFAULTS}.
 */
export interface ProjectionOptions
{
  /** Keep occluded edges in a `'hidden'` group. Default `false`. */
  hiddenLines?: boolean;
  /** Include shapes whose style marks them invisible. Default `false`. Only a collection
   *  has shapes to leave out; a single shape ignores this. */
  includeHiddenShapes?: boolean;
  /** Minimum dihedral angle (degrees) for an edge to count as a crease.
   *  Range `[0, 180]`, monotonic — higher drops more edges. Default `10`.
   *
   *  This is the main performance control on tessellated surfaces: at a low
   *  threshold nearly every triangle edge of a sphere survives, and whichever
   *  solver runs next does that many times more work. */
  featureAngle?: number;
  /** Visibility samples per edge. **`'raycast'` only** — the other methods
   *  compute occlusion rather than sampling it, and ignore this. Default `16`. */
  samples?: number;
  /** For `'clip'` and `'painter'`: fall back to `'exact'` with a warning
   *  when the scene does not meet their requirements, instead of throwing.
   *  Default `false`, so a method that cannot run says so. */
  fallback?: boolean;
}

/** {@link ProjectionOptions} plus the method, with every default filled in. */
export interface ResolvedProjectionOptions extends Required<ProjectionOptions>
{
  /** Which hidden-line algorithm runs. */
  method: HlrStrategy;
}

/** A setting that the legacy positional projection signatures take by position. */
export type ProjectionLegacyArg = 'hiddenLines' | 'includeHiddenShapes' | 'samples' | 'featureAngle';

/** Fill in the defaults of a projection's settings. A setting given as `undefined` or `null`
 *  takes its default too, so a caller can pass its own optional values straight through. */
export function resolveProjectionOptions(options: Partial<ResolvedProjectionOptions> = {}): ResolvedProjectionOptions
{
  const given = Object.entries(options).filter(([, value]) => value != null);
  return { ...PROJECTION_DEFAULTS, ...Object.fromEntries(given) };
}

/**
 * Resolve any call form of a projection into one options object. `args` are the arguments
 * after the ones that say where to look from: `cam` for `isometry()`, `from` for
 * `elevation()`, `pivot` and `normal` for `section()`.
 *
 * ```ts
 * isometry([-1,-1,1], 'exact', { hiddenLines: true })   // current
 * isometry([-1,-1,1], undefined, { hiddenLines: true }) // current, default method
 * isometry([-1,-1,1], { method: 'exact' })              // options only
 * isometry([-1,-1,1], true, false, 16, 10)              // legacy positional
 * ```
 *
 * The forms are told apart by the first of `args`: a string names a method, an object carries
 * options, and anything else is the legacy positional form — its settings in `legacyOrder`,
 * then a trailing {@link ProjectionViewOptions} object. That order is not the same everywhere
 * (see {@link MESH_PROJECTION_LEGACY_ARGS}), which is why the caller passes it.
 *
 * The legacy positional form must keep working: scripts saved in the Archiyou script
 * database call it, and those are user content that cannot be migrated by editing this
 * repository.
 */
export function resolveProjectionArgs(
  args: any[],
  legacyOrder: ReadonlyArray<ProjectionLegacyArg> = PROJECTION_LEGACY_ARGS,
): ResolvedProjectionOptions
{
  const [first, second] = args;
  const isOptions = (value: any): boolean => value !== null && typeof value === 'object' && !Array.isArray(value);

  // elevation('front', 'exact', { ... }), or the method left out: elevation('front', undefined, { ... })
  // No legacy form has an object in second place, so the second can only be options.
  if (typeof first === 'string' || (first == null && isOptions(second)))
  {
    return resolveProjectionOptions({ ...second, method: first ?? second?.method });
  }

  // elevation('front', { method: 'exact', ... })
  if (isOptions(first))
  {
    return resolveProjectionOptions(first);
  }

  // elevation('front', hiddenLines, includeHiddenShapes, samples, featureAngle, view)
  //
  // The trailing `view` object is how the method was selected before it had a positional
  // slot; honour it so call sites written against that form keep working too.
  const settings = Object.fromEntries(legacyOrder.map((name, i) => [name, args[i]]));
  const trailing = args[legacyOrder.length];
  const view: ProjectionViewOptions = isOptions(trailing) ? trailing : {};
  return resolveProjectionOptions({ ...settings, method: view.strategy, fallback: view.fallback });
}

//// SCENE NODE TYPES ////

/** Union of all concrete shape classes usable in a SceneNode. */
// Note: the concrete Mesh / Curve types are imported by SceneNode.ts at runtime;
// here we use a structural alias to avoid circular imports.
export type ShapeType = 'Mesh' | 'Curve' | 'unknown';

/** Plain-object representation of a SceneNode for inspection/serialisation. */
export interface SceneNodeGraphNode
{
  name: string
  isLayer: boolean
  hasShape: boolean
  shapeType: ShapeType | string | undefined
  style: StyleData
  children: SceneNodeGraphNode[]
}

/** Serialised SceneNode subtree used by the host's execution-result state and GLB extras.
 *  Identity rules mirror the viewer's path-map builder (see SceneNode.toData/path). */
export interface SceneNodeData
{
  id?: string // stable node id; survives rename/reorder (see SceneNode.id())
  name: string
  shape?: string | null // uuid of the held shape; null/undefined for layer/group containers
  /** Serial id of the held shape: the order it entered the scene. Reproducible for the same
   *  script+params, unlike `shape` (a fresh uuid every run). Absent for containers. */
  sid?: number
  style: Partial<StyleData>
  children: SceneNodeData[]
}

//// GEOMETRY SERIALISATION ////

/** A point on the wire: plain `[x, y, z]`. Deliberately not `Point` — this must survive
 *  `JSON.stringify` and `structuredClone` with no class identity. */
export type PointData = [number, number, number];

/** Exact, JSON-safe description of a `Curve`.
 *
 *  Every variant maps 1:1 onto a native constructor, so `Curve.fromData(c.toData())`
 *  reproduces the original geometry — not a tessellation of it. The variants are
 *  exactly the curve kinds hypercurve can construct:
 *  `makeLine / makePolyline / makeArc / makeCircle / makeEllipse / makeEllipticalArc /
 *  makeInterpolated`.
 *
 *  `Path` is the total fallback for everything else — compounds (boolean/offset results),
 *  splines and trimmed curves. It carries SVG path-data and is rebuilt through
 *  `importSvgCurves`, which keeps lines and circular arcs **exact**. Its known losses are
 *  Béziers (flattened to line segments) and elliptical arcs (skipped) — the same losses
 *  `Importer.fromSVG` documents.
 */
export type CurveData =
  | { type: 'Line'; start: PointData; end: PointData; holes?: CurveData[] }
  | { type: 'Polyline'; points: PointData[]; closed: boolean; holes?: CurveData[] }
  | { type: 'Arc'; start: PointData; mid: PointData; end: PointData; holes?: CurveData[] }
  | { type: 'Circle'; radius: number; center: PointData; normal: PointData; holes?: CurveData[] }
  | { type: 'Ellipse'; radiusX: number; radiusY: number; rotation: number;
      center: PointData; normal: PointData; holes?: CurveData[] }
  | { type: 'EllipticalArc'; radiusX: number; radiusY: number; rotation: number;
      startAngle: number; endAngle: number;
      center: PointData; normal: PointData; holes?: CurveData[] }
  | { type: 'Interpolated'; points: PointData[]; degree: number; holes?: CurveData[] }
  | { type: 'Path'; d: string; holes?: CurveData[] };

/** One shape inside a serialised scene: its identity, its geometry and its explicit style. */
export interface SceneShapeData
{
  id: string
  name?: string
  geometry: CurveData
  style?: Partial<StyleData>
}

/** A whole serialised scene: the node tree plus the geometry its leaves reference.
 *  Shapes are stored flat and referenced by id from `root`, so a shape held by two
 *  nodes is written once. */
export interface SceneDocData
{
  version: 1
  root: SceneNodeData
  shapes: SceneShapeData[]
}

/** Some style or visibility data that can not be converted into format directly
 *  For example: in GLTF export we want tag nodes as hidden
 */
export interface SceneNodeExport
{
    defaultVisible?: boolean;
}

