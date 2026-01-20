import { Vector } from './Vector'
import { Vertex } from './Vertex';
import { Point } from './Point';

import { 
  Point2Js,
  Point3Js,
  Vector2Js,
  Vector3Js,
  VertexJs, 
  Matrix4Js,
  MeshJs, 
  NurbsCurve2DJs,
  SketchJs, 
  PlaneJs, 
  PolygonJs, 
} from './wasm/csgrs.js';


/** Main CsgrsModule (manually types) 
 *  TODO: Auto-generate from WASM bindings
*/
export type CsgrsModule = 
{
  Point2Js: typeof Point2Js;
  Point3Js: typeof Point3Js;
  Vector2Js: typeof Vector2Js;
  Vector3Js: typeof Vector3Js;
  Matrix4Js: typeof Matrix4Js;
  MeshJs: typeof MeshJs;
  SketchJs: typeof SketchJs;
  PlaneJs:  typeof PlaneJs;
  PolygonJs: typeof PolygonJs;
  VertexJs: typeof VertexJs;
  NurbsCurve2DJs: typeof NurbsCurve2DJs;
  // TODO: more
};

export type Axis = 'x'|'y'|'z';
export function isAxis(obj: any): obj is Axis {
  return obj === 'x' || obj === 'y' || obj === 'z';
}

export type PointLike = Point | Vector | Vertex |
  Point2Js | Point3Js | Vector2Js | 
  Vector3Js | VertexJs | Array<number> | 
  { x: number; y: number; z: number; };

export function isPointLike(obj: any): obj is PointLike {
  return (
    obj instanceof Point ||
    obj instanceof Vector ||
    obj instanceof Vertex ||
    obj instanceof Point2Js ||
    obj instanceof Point3Js ||
    obj instanceof Vector2Js ||
    obj instanceof Vector3Js ||
    obj instanceof VertexJs ||
    Array.isArray(obj) && obj.length >= 2 ||
    typeof obj === 'object' && obj !== null && 'x' in obj && 'y' in obj
  );
}