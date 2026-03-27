import { Vector } from './Vector'
import { Vertex } from './Vertex';
import { Point } from './Point';

import { 
  Point3Js,
  Vector3Js,
  VertexJs, 
  Matrix4Js,
  MeshJs, 
  NurbsCurve3DJs,
  SketchJs, 
  PlaneJs, 
  PolygonJs, 
} from './wasm/csgrs.js';


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
  NurbsCurve3DJs: typeof NurbsCurve3DJs;
  // TODO: more
};

export type Axis = 'x'|'y'|'z';
export function isAxis(obj: any): obj is Axis {
  return obj === 'x' || obj === 'y' || obj === 'z';
}

export type PointLike = Point | Vector | Vertex |
  Point3Js |  Vector3Js | VertexJs | Array<number> | 
  { x: number; y: number; z: number; };

export function isPointLike(obj: any): obj is PointLike {
  return (
    obj instanceof Point ||
    obj instanceof Vector ||
    obj instanceof Vertex ||
    obj instanceof Point3Js ||
    obj instanceof Vector3Js ||
    obj instanceof VertexJs ||
    (Array.isArray(obj) && obj.every(item => typeof item === 'number')) || // [x], [x,y], [x,y,z] - needs to be numbers
    typeof obj === 'object' && obj !== null && 'x' in obj && 'y' in obj && 'z' in obj
  );
}

export type BasePlane = 'xy' | 'yz' | 'xz' | 'front' | 'back' | 'left' | 'right';
export function isBasePlane(obj: any): obj is BasePlane {
  return ['xy', 'yz', 'xz', 'front', 'back', 'left', 'right'].includes(obj);
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

// ── BVH Spatial-Query Result Types ───────────────────────────────────────────

/** Result of a BVH-accelerated first-hit raycast. */
export interface RaycastHit {
  pointX: number; pointY: number; pointZ: number;
  normalX: number; normalY: number; normalZ: number;
  distance: number;
  triangleIndex: number;
}

/** Result of a closest-surface-point query. */
export interface ClosestPointResult {
  pointX: number; pointY: number; pointZ: number;
  normalX: number; normalY: number; normalZ: number;
  distance: number;
  isInside: boolean;
}

/** Signed-distance-field sample at a query point. */
export interface SdfSample {
  distance: number;
  isInside: boolean;
  closestX: number; closestY: number; closestZ: number;
}

// ── Edge Projection Result Types ─────────────────────────────────────────────
// Defined in Collection.ts (alongside CurveCollection) to avoid circular imports.
// Re-exported from there for external consumers.