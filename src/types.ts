import { Vector } from './Vector'
import { Vertex } from './Vertex';
import { Point } from './Point';
import { StyleData } from './Style';

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

/** Trailing options accepted by the projection entry points
 *  ({@link Mesh.isometry}, `elevation`, `section` and their collection
 *  equivalents) in place of a further positional argument.
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
  name: string
  shape?: string | null // uuid of the held shape; null/undefined for layer/group containers
  style: Partial<StyleData>
  children: SceneNodeData[]
}

/** Some style or visibility data that can not be converted into format directly
 *  For example: in GLTF export we want tag nodes as hidden
 */
export interface SceneNodeExport
{
    defaultVisible?: boolean;
}

