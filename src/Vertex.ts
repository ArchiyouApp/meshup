/**
 *  Vertex.ts
 *
 *  A TypeScript wrapper around CSGRS VertexJs
 *  Mostly for more convenient usage in TypeScript and introspection
 *  and avoid things like Vector { __wbg_ptr: 1123141 } when you print instances
 *
 *  IMPORTANT: VertexJs has 6 coords: position and normal
*/

import type { PointLike, Axis } from "./types";
import { Point } from "./Point";
import { Vector } from "./Vector";
import { Bbox } from "./Bbox";
import { Shape } from "./Shape";
import { VertexJs  } from "./wasm/csgrs";

export class Vertex extends Shape
{
  private _vertex: VertexJs;

  constructor(p: PointLike, n: PointLike = [0, 0, 0])
  {
    super();
    const position = new Point(p).toPoint3Js();
    const normal = new Point(n).toVector3Js();
    this._vertex = new VertexJs(position, normal);
  }

  /** Wrap an existing VertexJs instance */
  static from(v: VertexJs): Vertex
  {
    const vertex = Object.create(Vertex.prototype) as Vertex;
    vertex._vertex = v;
    return vertex;
  }

  inner(): VertexJs
  {
    return this._vertex;
  }

  get x(): number
  {
    return this._vertex.position().x;
  }

  get y(): number
  {
    return this._vertex.position().y;
  }

  get z(): number
  {
    return this._vertex.position().z;
  }

  position(): Point
  {
    return Point.from(this._vertex.position());
  }

  normal(): Vector
  {
    return Vector.from(this._vertex.normal());
  }

  toPoint(): Point
  {
    return new Point(this.x, this.y, this.z);
  }

  toVector(): Vector
  {
    return Vector.from(this.x, this.y, this.z);
  }

  // NOTE: VertexJs toArray() returns 6 coords: position and normal. We only return position here for convenience.
  toArray(): [number, number, number]
  {
    return [this.x, this.y, this.z];
  }

  //// TRANSFORMS ////

  override translate(px: PointLike | number, dy?: number, dz?: number): this
  {
    const delta = new Point(px as PointLike, dy, dz);
    this._vertex = new VertexJs(
      new Point(this.x + delta.x, this.y + delta.y, this.z + delta.z).toPoint3Js(),
      this._vertex.normal(),
    );
    return this;
  }

  override rotate(_angleDeg: number, _axis?: Axis | PointLike, _pivot?: PointLike): this
  {
    throw new Error('Vertex.rotate(): not yet implemented');
  }

  override rotateAround(_angleDeg: number, _axis: Axis | PointLike, _pivot?: PointLike): this
  {
    throw new Error('Vertex.rotateAround(): not yet implemented');
  }

  override rotateQuaternion(_w: number | { w: number; x: number; y: number; z: number }, _x?: number, _y?: number, _z?: number): this
  {
    throw new Error('Vertex.rotateQuaternion(): not yet implemented');
  }
  
  override scale(_factor: number | PointLike, _origin?: PointLike): this
  {
    throw new Error('Vertex.scale(): not yet implemented');
  }

  override mirror(_dir: Axis | PointLike, _pos?: PointLike): this
  {
    throw new Error('Vertex.mirror(): not yet implemented');
  }

  override copy(): this
  {
    const v = new Vertex([this.x, this.y, this.z], this.normal().toArray());
    v.style.merge(this.style.toData());
    return v as this;
  }

  //// MEASUREMENTS ////

  /** Vertices are dimensionless points — returns undefined */
  length(): undefined { console.warn('Vertex.length(): a vertex is a point and has no length.'); return undefined; }
  area(): undefined   { console.warn('Vertex.area(): a vertex is a point and has no area.');   return undefined; }
  volume(): undefined { console.warn('Vertex.volume(): a vertex is a point and has no volume.'); return undefined; }

  //// SHAPE PROTOCOL ////

  override type(): 'Vertex'
  {
    return 'Vertex';
  }

  override subtype(): string | null
  {
    return null;
  }

  override is2D(): boolean
  {
    return false;
  }

  override bbox(): Bbox
  {
    return new Bbox([this.x, this.y, this.z], [this.x, this.y, this.z]);
  }

  //// REPRESENTATION ////

  toString(): string
  {
    return `Vertex(${this.x}, ${this.y}, ${this.z})`;
  }
}
