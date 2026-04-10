/** 
 *  Vector.ts
 *  
 *  A very thin layer around CSGRS VectorJs
 *  Mostly for more convenient usage in TypeScript and introspection
 *  
 *  NOTES:
 *  
 *    - ANGLES IN DEGREES
 *        Although the underlying CSGRS library uses radians, we convert all angles to degrees in our API. 
 * 
 *    - IMMUTABLE: For these simple Vectors we always return a new instance instead of modifying the original.
 *        This is less error prone, and enables us to easily maintain the properties
 * 
*/

import { Vector3Js  } from "./wasm/csgrs";

import type { PointLike, Axis } from "./types";
import { isAxis, isPointLike } from "./types"; // type guards

import { Point } from "./Point";

import { deg } from "./utils";

export class Vector extends Vector3Js
{
  // override getters to properties
  declare private _x:number;
  declare private _y:number;
  declare private _z:number;

  constructor(x:number|PointLike|Axis|Vector3Js, y:number=0, z:number=0)
  {
    if(typeof x === 'number' && typeof y === 'number' && typeof z === 'number')
    {
      super(x, y, z);
      this._privateFromGetters();
    }
    else if(isPointLike(x))
    {
      const point = Point.from(x);
      super(point.x, point.y, point.z);
      this._privateFromGetters();
    }
    else if(isAxis(x))
    {
      const AXIS_TO_VEC = {
        x: [1, 0, 0],
        y: [0, 1, 0],
        z: [0, 0, 1]
      };
      super(AXIS_TO_VEC[x][0],AXIS_TO_VEC[x][1],AXIS_TO_VEC[x][2]);
      this._privateFromGetters();
    }
    else if((x as any) instanceof Vector3Js) // TODO: why TS error?
    {
      const vjs = x as any as Vector3Js;
      if(typeof vjs.x === 'number' && typeof vjs.y === 'number' && typeof vjs.z === 'number')
      {
        super(vjs.x, vjs.y, vjs.z);
        this._privateFromGetters();
      }
    }
    else
    {
      throw new Error('Vector::constructor(): Invalid parameters. Please supply (x,y,z) or PointLike as first argument!');
    }
  }

  _privateFromGetters()
  {
    this._x = this.x;
    this._y = this.y;
    this._z = this.z;
  }

  static from(x:number|PointLike|Axis|Vector3Js, y:number=0, z:number=0): Vector
  {
    return new Vector(x, y, z);
  }

  //// CALCULATED PROPERTIES 

  length(): number
  {
    return super.length();
  }

  angle(other:PointLike):number
  {
    if(!isPointLike(other)){ throw new Error('Vector::angle(): Invalid argument. Please supply a PointLike instance.'); }
    return deg(super.angle(Point.from(other).toVector3Js()));
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
      return super.rotationBetween(Vector.from(other).toVector3Js());
  }

  //// METHODS

  abs(): Vector
  {
    return Vector.from(super.abs());
  }

  /** Create new Vector instance by adding another vector */
  add(other: PointLike): Vector
  {
    if(!isPointLike(other)){ throw new Error('Vector::add(): Invalid argument. Please supply a PointLike instance.'); }
    return Vector.from(super.add(Vector.from(other).toVector3Js()));
  }

  /** Create new Vector instance by subtracting another vector */
  subtract(other: PointLike): Vector
  {
    if(!isPointLike(other)){ throw new Error('Vector::subtract(): Invalid argument. Please supply a PointLike instance.'); }
    return Vector.from(super.subtract(Vector.from(other).toVector3Js()));
  }

  /** Alias for subtract — for old-API compatibility */
  subtracted(other: PointLike): Vector
  {
    return this.subtract(other);
  }

  /** Alias for normalize — for old-API compatibility */
  normalized(): Vector
  {
    return this.normalize();
  }

  /** Round each component to the given number of decimal places (default 0) */
  round(decimals: number = 0): Vector
  {
    const f = Math.pow(10, decimals);
    return new Vector(
      Math.round(this.x * f) / f,
      Math.round(this.y * f) / f,
      Math.round(this.z * f) / f,
    );
  }

  /** Returns true if this vector points along a single world axis (within tolerance) */
  isOrtho(tolerance: number = 1e-6): boolean
  {
    const n = this.normalize();
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


  /** Create new Vector instance by scaling with a scalar */
  scale(scalar: number): Vector
  {
    return Vector.from(super.scale(scalar));
  }

  /** Create new Vector instance by normalizing */
  normalize(): Vector
  {
    return Vector.from(super.normalize());
  }

  /** Create new Vector instance by computing the cross product with another vector */  
  cross(other: Vector3Js): Vector
  {
    return Vector.from(super.cross(other));
  }

  /** Create new Vector instance by reversing the vector */
  reverse(): Vector
  {
    return Vector.from(super.reverse());
  }

  copy(): Vector
  {
    return new Vector(this.x, this.y, this.z);
  }

  /** Return a new Vector with x replaced */
  setX(x: number): Vector { return new Vector(x, this.y, this.z); }
  /** Return a new Vector with y replaced */
  setY(y: number): Vector { return new Vector(this.x, y, this.z); }
  /** Return a new Vector with z replaced */
  setZ(z: number): Vector { return new Vector(this.x, this.y, z); }

  /** Return a new Vector with the named component ('x'|'y'|'z') replaced */
  setComponent(axis: Axis, value: number): Vector
  {
    if(axis === 'x') return this.setX(value);
    if(axis === 'y') return this.setY(value);
    return this.setZ(value);
  }

  /** Return a new Vector mirrored through a plane defined by a point and normal.
   *  mirror(planePoint, planeNormal) — both as PointLike */
  mirror(planePoint: PointLike, planeNormal: PointLike): Vector
  {
    console.warn('Vector::mirror(): ***** This method  changed. Make sure you get the right result ****');
    if(!isPointLike(planePoint)){ throw new Error('Vector::mirror(): planePoint must be PointLike'); }
    if(!isPointLike(planeNormal)){ throw new Error('Vector::mirror(): planeNormal must be PointLike'); }
    const n = Vector.from(planeNormal).normalize();
    const p = Point.from(planePoint);
    // v' = v - 2*(v - p)·n * n
    const diff = this.subtract([p.x, p.y, p.z]);
    const dot2 = diff.dot(n.toVector3Js()) * 2;
    return this.subtract(n.scale(dot2));
  }

  /** Create new Vector by computing the dot product with another vector */
  dot(other: Vector3Js): number
  {
    return super.dot(other);
  }

  /** Create new Vector by rotating with given angle (in rad) around arch axis */
  rotate(axis: PointLike, angle: number): Vector
  {
    if(!isPointLike(axis))
    {
      throw new Error('Vector::rotate(): Invalid axis. Please supply a PointLike instance. For example a Vector!');
    }
    return Vector.from(
      super.rotate(
        new Point(axis).toVector3Js(),
        angle
      )
    );
  }
  
  /** Create new Vector by Quaternion rotation */
  rotateQuaternion(qw: number|{ w: number, x: number, y: number, z: number }, x?: number, y?: number, z?: number): Vector 
  {
    const qwObj = (typeof qw === 'number') ? { w: qw, x, y, z } : qw;    
    if(qwObj.w === undefined || qwObj.x === undefined || qwObj.y === undefined || qwObj.z === undefined)
    {
      throw new Error('Vector::rotateQuaternion(): Invalid quaternion. Please supply a valid quaternion.');
    }
    return Vector.from(
      super.rotateQuaternion(qwObj.w, qwObj.x!, qwObj.y!, qwObj.z!)
    );
  }


  /** Rotate around Z-axis by given degrees */
  rotateZ(angleDeg: number): Vector
  {
    return this.rotate([0, 0, 1], angleDeg * Math.PI / 180);
  }

  /** Angle of this vector projected onto the XY plane, measured from the +X axis.
   *  Returns degrees in the range (-180, 180].
   *  Equivalent to atan2(y, x).
   */
  angleXY(): number
  {
    return deg(Math.atan2(this.y, this.x));
  }

  /** Angle of this vector projected onto the XZ plane, measured from the +X axis.
   *  Returns degrees in the range (-180, 180].
   *  Equivalent to atan2(z, x).
   */
  angleXZ(): number
  {
    return deg(Math.atan2(this.z, this.x));
  }

  /** Angle between this vector and the +X axis. Returns degrees in [0, 180]. */
  angleX(): number
  {
    return this.angle([1, 0, 0]);
  }

  /** Angle between this vector and the +Y axis. Returns degrees in [0, 180]. */
  angleY(): number
  {
    return this.angle([0, 1, 0]);
  }

  /** Angle between this vector and the +Z axis. Returns degrees in [0, 180]. */
  angleZ(): number
  {
    return this.angle([0, 0, 1]);
  }

  //// COMPARISONS ////

  /** Returns true if this vector is component-wise equal to another (within tolerance) */
  equals(other: PointLike, tolerance: number = 1e-6): boolean
  {
    const o = new Vector(other as any);
    return Math.abs(this.x - o.x) <= tolerance
        && Math.abs(this.y - o.y) <= tolerance
        && Math.abs(this.z - o.z) <= tolerance;
  }

  //// CONVERSIONS ////

  toArray(): [number, number, number]
  {
    return [this.x, this.y, this.z];
  }

  toPoint():Point
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
