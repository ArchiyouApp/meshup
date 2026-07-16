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
import { isPointLike } from "./types";
import { Point } from "./Point";
import { Vector } from "./Vector";
import { Bbox } from "./Bbox";
import { Shape } from "./Shape";
import { Style } from "./Style";
import { VertexJs  } from "./wasm/meshup";
import { uuid, rad } from "./utils";

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
    // Object.create bypasses the constructor, so manually initialize Shape fields
    (vertex as any)['_id'] = uuid();
    (vertex as any)['type'] = 'Vertex';
    vertex._node = null;
    vertex.style = new Style();
    vertex.metadata = {};
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

  override rotate(angleDeg: number, axis: Axis | PointLike = 'z'): this
  {
    const a     = rad(angleDeg) / 2;
    const axVec = Vector.from(axis).normalize();
    const sin   = Math.sin(a);
    return this.rotateQuaternion(Math.cos(a), axVec.x * sin, axVec.y * sin, axVec.z * sin);
  }

  override rotateAround(angleDeg: number, axis: Axis | PointLike = 'z', pivot?: PointLike): this
  {
    const p = pivot ? new Point(pivot) : new Point(0, 0, 0);
    this.translate(-p.x, -p.y, -p.z);
    this.rotate(angleDeg, axis);
    this.translate(p.x, p.y, p.z);
    return this;
  }

  override rotateQuaternion(wOrObj: number | { w: number; x: number; y: number; z: number }, x?: number, y?: number, z?: number): this
  {
    const w  = typeof wOrObj === 'object' ? wOrObj.w : wOrObj;
    const xv = typeof wOrObj === 'object' ? wOrObj.x : (x ?? 0);
    const yv = typeof wOrObj === 'object' ? wOrObj.y : (y ?? 0);
    const zv = typeof wOrObj === 'object' ? wOrObj.z : (z ?? 0);

    const newPos    = Vector.from(this.x, this.y, this.z).rotateQuaternion(w, xv, yv, zv);
    const newNormal = this.normal().rotateQuaternion(w, xv, yv, zv);

    this._vertex = new VertexJs(
      new Point(newPos.x, newPos.y, newPos.z).toPoint3Js(),
      newNormal.toVector3Js(),
    );
    return this;
  }

  override scale(factor: number | PointLike, origin?: PointLike): this
  {
    const [sx, sy, sz] = (typeof factor === 'number')
      ? [factor, factor, factor]
      : [new Point(factor).x, new Point(factor).y, new Point(factor).z];

    const o = origin ? new Point(origin) : new Point(0, 0, 0);

    this._vertex = new VertexJs(
      new Point(
        o.x + (this.x - o.x) * sx,
        o.y + (this.y - o.y) * sy,
        o.z + (this.z - o.z) * sz,
      ).toPoint3Js(),
      this._vertex.normal(), // normals stay unit vectors under uniform-ish scale
    );
    return this;
  }

  override mirror(dir: Axis | PointLike, pos?: PointLike): this
  {
    const origin = pos ? new Point(pos) : new Point(0, 0, 0);

    // Resolve dir to a unit normal
    const n = (typeof dir === 'string'
      ? new Vector(dir as Axis)
      : new Vector(dir as PointLike)
    ).copy().normalize();

    // Reflect position: p' = p - 2 * ((p - origin) · n) * n
    const rel = new Vector(this.x - origin.x, this.y - origin.y, this.z - origin.z);
    const d = rel.dot(n.inner());
    const newPos = new Point(this.x - 2 * d * n.x, this.y - 2 * d * n.y, this.z - 2 * d * n.z);

    // Reflect normal direction (translation-free)
    const nm = Vector.from(this._vertex.normal());
    const dn = nm.dot(n.inner());
    const newNormal = new Vector(nm.x - 2 * dn * n.x, nm.y - 2 * dn * n.y, nm.z - 2 * dn * n.z);

    this._vertex = new VertexJs(newPos.toPoint3Js(), newNormal.toVector3Js());
    return this;
  }

  override mirrorX(x?: number): this { return this.mirror('x', [x ?? 0, 0, 0]); }
  override mirrorY(y?: number): this { return this.mirror('y', [0, y ?? 0, 0]); }
  override mirrorZ(z?: number): this { return this.mirror('z', [0, 0, z ?? 0]); }

  override _copy(): this
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

  /**
   * Euclidean distance from this vertex to a PointLike (Point, Vertex, Vector, [x,y,z]).
   * For other shapes (Mesh, Curve, Polygon …) delegates to `other.distanceTo(this)`.
   */
  distance(other: PointLike | Shape): number
  {
      if (isPointLike(other))
      {
          const p = new Point(other as PointLike);
          const dx = this.x - p.x, dy = this.y - p.y, dz = this.z - p.z;
          return Math.sqrt(dx * dx + dy * dy + dz * dz);
      }
      // A shape knows how to measure to a point — delegate to it.
      const shape = other as any;
      if (typeof shape?.distanceTo === 'function') return shape.distanceTo(this); // Mesh
      if (typeof shape?.distance === 'function')   return shape.distance(this);   // Curve, Polygon
      throw new Error(`Vertex.distance(): unsupported type. Got: ${(other as any)?.constructor?.name ?? typeof other}`);
  }

  //// SHAPE PROTOCOL ////

  override readonly type = 'Vertex' as const;

  override subtype(): string | null
  {
    return null;
  }

  override is2D(): boolean
  {
    return false;
  }

  center(): Point
  {
    return this.toPoint();
  }

  override bbox(): Bbox
  {
    return new Bbox([this.x, this.y, this.z], [this.x, this.y, this.z]);
  }

  //// REPRESENTATION ////

  toString(): string
  {
    return `<Vertex(${this.x}, ${this.y}, ${this.z})>`;
  }
}
