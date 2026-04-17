/**
 *  Vector.ts
 *
 *  Wraps CSGRS Vector3Js via composition (not inheritance).
 *  All transform methods mutate this and return this for chaining.
 *
 *  NOTES:
 *
 *    - ANGLES IN DEGREES
 *        Although the underlying CSGRS library uses radians, we convert all angles to degrees in our API.
 *
*/

import { Vector3Js  } from "./wasm/csgrs";

import type { PointLike, Axis } from "./types";
import { isAxis, isPointLike } from "./types";

import { Point } from "./Point";
import { deg } from "./utils";

export class Vector
{
  private _inner: Vector3Js;

  constructor(x: number|PointLike|Axis|Vector3Js, y: number = 0, z: number = 0)
  {
    this._inner = Vector.from(x, y, z)._inner;
  }

  /** Create a Vector from numbers, PointLike, Axis, or Vector3Js.
   *  A Vector3Js is wrapped directly (no copy); everything else is converted. */
  static from(x: number|PointLike|Axis|Vector3Js, y: number = 0, z: number = 0): Vector
  {
    if(typeof x === 'number')
    {
      return new Vector(new Vector3Js(x, y, z));
    }
    else if(isAxis(x))
    {
      const AXIS_TO_VEC = { x: [1,0,0], y: [0,1,0], z: [0,0,1] };
      const [ax, ay, az] = AXIS_TO_VEC[x];
      return new Vector(new Vector3Js(ax, ay, az));
    }
    else if((x as any) instanceof Vector3Js)
    {
      // Use Object.create to avoid re-entering the constructor → from() cycle
      const vec = Object.create(Vector.prototype) as Vector;
      (vec as any)._inner = x as Vector3Js;
      return vec;
    }
    else if(isPointLike(x))
    {
      const p = Point.from(x);
      return new Vector(new Vector3Js(p.x, p.y, p.z));
    }
    throw new Error('Vector.from(): Invalid argument. Supply (x,y,z), PointLike, Axis, or Vector3Js.');
  }

  inner(): Vector3Js
  {
    return this._inner;
  }

  get x(): number { return this._inner.x; }
  get y(): number { return this._inner.y; }
  get z(): number { return this._inner.z; }

  /** Replace inner Vector3Js and return this */
  update(vector: Vector3Js|Vector): this
  {
    if(vector instanceof Vector)
    {
      this._inner = new Vector3Js(vector.x, vector.y, vector.z);
    }
    else if(vector instanceof Vector3Js)
    {
      this._inner = new Vector3Js(vector.x, vector.y, vector.z);
    }
    else
    {
      throw new Error('Vector::update(): Invalid argument. Please supply a Vector3Js or Vector instance.');
    }
    return this;
  }

  //// CALCULATED PROPERTIES

  length(): number
  {
    return this._inner.length();
  }

  angle(other: PointLike): number
  {
    if(!isPointLike(other)){ throw new Error('Vector::angle(): Invalid argument. Please supply a PointLike instance.'); }
    return deg(this._inner.angle(Point.from(other).toVector3Js()));
  }

  /** Returns true if this vector is parallel (or anti-parallel) to the given PointLike, within the given angular tolerance in degrees */
  isParallel(other: PointLike, tolerance: number = 1e-6): boolean
  {
    if(!isPointLike(other)){ throw new Error('Vector::isParallel(): Invalid argument. Please supply a PointLike instance.'); }
    const a = this.angle(other);
    return a < tolerance || Math.abs(a - 180) < tolerance;
  }

  /** Get the shortest-arc rotation (as a quaternion) to align this vector with another */
  rotationBetween(other: PointLike): { x: number, y: number, z: number, w: number }
  {
    if(!isPointLike(other)){ throw new Error('Vector::rotationBetween(): Invalid argument. Please supply a PointLike instance.'); }
    return this._inner.rotationBetween(Vector.from(other).inner());
  }

  /** Returns true if this vector points along a single world axis (within tolerance) */
  isOrtho(tolerance: number = 1e-6): boolean
  {
    const n = this.copy().normalize();
    const axes: [number, number, number][] = [[1,0,0],[0,1,0],[0,0,1]];
    return axes.some(([ax, ay, az]) =>
      (Math.abs(Math.abs(n.x) - ax) < tolerance &&
       Math.abs(Math.abs(n.y) - ay) < tolerance &&
       Math.abs(Math.abs(n.z) - az) < tolerance)
    );
  }

  /** Returns the axis ('x'|'y'|'z') with the largest absolute component */
  largestAxis(): Axis
  {
    const ax = Math.abs(this.x);
    const ay = Math.abs(this.y);
    const az = Math.abs(this.z);
    if(ax >= ay && ax >= az) return 'x';
    if(ay >= az) return 'y';
    return 'z';
  }

  dot(other: Vector3Js|Vector): number
  {
    const v = other instanceof Vector ? other.inner() : other;
    return this._inner.dot(v);
  }

  angleXY(): number { return deg(Math.atan2(this.y, this.x)); }
  angleXZ(): number { return deg(Math.atan2(this.z, this.x)); }
  angleX(): number { return this.angle([1, 0, 0]); }
  angleY(): number { return this.angle([0, 1, 0]); }
  angleZ(): number { return this.angle([0, 0, 1]); }

  //// COMPARISONS ////

  /** Returns true if this vector is component-wise equal to another (within tolerance) */
  equals(other: PointLike, tolerance: number = 1e-6): boolean
  {
    const o = Vector.from(other as any);
    return Math.abs(this.x - o.x) <= tolerance
        && Math.abs(this.y - o.y) <= tolerance
        && Math.abs(this.z - o.z) <= tolerance;
  }

  //// MUTATING METHODS (mutate this, return this for chaining) ////

  abs(): this
  {
    this._inner = this._inner.abs();
    return this;
  }

  add(other: PointLike): this
  {
    if(!isPointLike(other)){ throw new Error('Vector::add(): Invalid argument. Please supply a PointLike instance.'); }
    this._inner = this._inner.add(Vector.from(other).inner());
    return this;
  }

  subtract(other: PointLike): this
  {
    if(!isPointLike(other)){ throw new Error('Vector::subtract(): Invalid argument. Please supply a PointLike instance.'); }
    this._inner = this._inner.subtract(Vector.from(other).inner());
    return this;
  }

  /** Alias for subtract */
  subtracted(other: PointLike): this
  {
    return this.subtract(other);
  }

  normalize(): this
  {
    this._inner = this._inner.normalize();
    return this;
  }

  /** Alias for normalize */
  normalized(): this
  {
    return this.normalize();
  }

  scale(scalar: number): this
  {
    this._inner = this._inner.scale(scalar);
    return this;
  }

  cross(other: Vector3Js|Vector): this
  {
    const v = other instanceof Vector ? other.inner() : other;
    this._inner = this._inner.cross(v);
    return this;
  }

  reverse(): this
  {
    this._inner = this._inner.reverse();
    return this;
  }

  round(decimals: number = 0): this
  {
    const f = Math.pow(10, decimals);
    this._inner = new Vector3Js(
      Math.round(this.x * f) / f,
      Math.round(this.y * f) / f,
      Math.round(this.z * f) / f,
    );
    return this;
  }

  setX(x: number): this { this._inner = new Vector3Js(x, this.y, this.z); return this; }
  setY(y: number): this { this._inner = new Vector3Js(this.x, y, this.z); return this; }
  setZ(z: number): this { this._inner = new Vector3Js(this.x, this.y, z); return this; }

  setComponent(axis: Axis, value: number): this
  {
    if(axis === 'x') return this.setX(value);
    if(axis === 'y') return this.setY(value);
    return this.setZ(value);
  }

  /** Mirror through a plane defined by a point and normal */
  mirror(planePoint: PointLike, planeNormal: PointLike): this
  {
    console.warn('Vector::mirror(): ***** This method changed. Make sure you get the right result ****');
    if(!isPointLike(planePoint)){ throw new Error('Vector::mirror(): planePoint must be PointLike'); }
    if(!isPointLike(planeNormal)){ throw new Error('Vector::mirror(): planeNormal must be PointLike'); }
    const n = Vector.from(planeNormal).normalize();
    const p = Point.from(planePoint);
    // v' = v - 2*(v - p)·n * n
    const diff = this.copy().subtract([p.x, p.y, p.z]);
    const dot2 = diff.dot(n.inner()) * 2;
    n.scale(dot2);
    return this.subtract([n.x, n.y, n.z]);
  }

  rotate(axis: PointLike, angle: number): this
  {
    if(!isPointLike(axis)){ throw new Error('Vector::rotate(): Invalid axis. Please supply a PointLike instance.'); }
    this._inner = this._inner.rotate(new Point(axis).toVector3Js(), angle);
    return this;
  }

  rotateQuaternion(qw: number|{ w: number, x: number, y: number, z: number }, x?: number, y?: number, z?: number): this
  {
    const q = (typeof qw === 'number') ? { w: qw, x, y, z } : qw;
    if(q.w === undefined || q.x === undefined || q.y === undefined || q.z === undefined)
    {
      throw new Error('Vector::rotateQuaternion(): Invalid quaternion. Please supply a valid quaternion.');
    }
    this._inner = this._inner.rotateQuaternion(q.w, q.x!, q.y!, q.z!);
    return this;
  }

  /** Rotate around Z-axis by given degrees */
  rotateZ(angleDeg: number): this
  {
    return this.rotate([0, 0, 1], angleDeg * Math.PI / 180);
  }

  //// COPY ////

  copy(): Vector
  {
    return Vector.from(this.x, this.y, this.z);
  }

  //// CONVERSIONS ////

  toArray(): [number, number, number]
  {
    return [this.x, this.y, this.z];
  }

  toPoint(): Point
  {
    return Point.from(this);
  }

  toVector3Js(): Vector3Js
  {
    return new Vector3Js(this.x, this.y, this.z);
  }

  //// EXPORTS ////

  toString(): string
  {
    return `<Vector { x: ${this.x}, y: ${this.y}, z: ${this.z} }>`;
  }
}
