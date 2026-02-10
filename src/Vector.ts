/** 
 *  Vector.ts
 *  
 *  A very thin layer around CSGRS VectorJs
 *  Mostly for more convenient usage in TypeScript and introspection
 *  
 *  NOTES:
 *    - IMMUTABLE: For these simple Vectors we always return a new instance instead of modifying the original.
 *        This is less error prone, and enables us to easily maintain the properties
 * 
*/

import type { PointLike, Axis } from "./types";
import { isAxis, isPointLike } from "./types";
import { Point } from "./Point";
import { Vector3Js  } from "./wasm/csgrs";

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
    return super.angle(Point.from(other).toVector3Js());
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
    if(!isPointLike(other)){ throw new Error('Vector::add(): Invalid argument. Please supply a PointLike instance.'); }
    return Vector.from(super.subtract(Vector.from(other).toVector3Js()));
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

  /** Create new Vector by computing the dot product with another vector */
  dot(other: Vector3Js): number
  {
    return super.dot(other);
  }

  /** Create new Vector by rotating with given angle (in rad) around an axis */
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
  

  /** Create new Vector by Euler rotation */
  rotateEuler(roll: number, pitch: number, yaw: number): Vector 
  {
    return Vector.from(
      super.rotateEuler(roll, pitch, yaw)
    );
  }

  //// CONVERSIONS ////

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