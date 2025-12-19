import type { 
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
export type PointLike = Point2Js | Point3Js | Vector2Js | 
  Vector3Js | VertexJs | Array<number> | 
  { x: number; y: number; z: number; };