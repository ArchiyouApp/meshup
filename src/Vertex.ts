/** 
 *  Vertex.ts
 * 
 *  A very thin subclass layer on top of CSGRS VertexJs 
 *  Mostly for more convenient usage in TypeScript and introspection
 *  and avoid things like Vector { __wbg_ptr: 1123141 } when you print instances
 *  We introduce private properties for introspection
*/

import type { PointLike } from "./types";
import { Point } from "./Point";
import { Vector } from "./Vector";
import { VertexJs  } from "./wasm/csgrs";

export class Vertex extends VertexJs 
{
  declare private _position: Point;
  declare private _normal: Vector;

  constructor(p: PointLike, n: PointLike = [0, 0, 0])
  {
    const position = new Point(p).toPoint3Js();
    const normal = new Point(n).toVector3Js();
    super(position, normal);
    this._privateFromGetters();
  }

  _privateFromGetters()
  {
    this._position = Point.from(super.position()); 
    this._normal = Vector.from(super.normal());
  }

  get inner():VertexJs
  { 
    return this as VertexJs;
  }

  get x(): number 
  {
    return this?.inner?.position()?.x;
  }

  get y(): number {
    return this?.inner?.position()?.y;
  }

  get z(): number {
    return this?.inner?.position()?.z;
  }

}