/** A very thin subclass layer on top of CSGRS VertexJs 
 *  Mostly for more convenient usage in TypeScript and introspection
 *  and avoid things like Vector { __wbg_ptr: 1123141 } when you print instances
 *  We introduced private fields to store the values
*/

import type { PointLike } from "./types";
import { Point } from "./Point";
import { VertexJs  } from "./wasm/csgrs";

export class Vertex extends VertexJs 
{
  constructor(p: PointLike, n: PointLike = [0, 0, 0])
  {
    const position = new Point(p).toPoint3Js();
    const normal = new Point(n).toVector3Js();
    super(position, normal);
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