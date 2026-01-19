/** A very thin layer around CSGRS VectorJs
 *  Mostly for more convenient usage in TypeScript and introspection
 *  
 *  NOTES:
 *    - IMMUTABLE: For these simple Vectors we always return a new instance instead of modifying the original.
 * 
*/

import type { PointLike } from "./types";
import { isPointLike } from "./types";
import { Point } from "./Point";
import { Vector3Js  } from "./wasm/csgrs";

export class Vector extends Vector3Js
{
  // override getters to properties
  declare private _x:number;
  declare private _y:number;
  declare private _z:number;

  constructor(x:number|PointLike, y:number=0, z:number=0)
  {
    if(typeof x === 'number' && typeof y === 'number' && typeof z === 'number')
    {
      super(x, y, z);
      this._privateFromGetters();
    }
    else if(isPointLike(x))
    {
      const point = new Point(x);
      super(point.x, point.y, point.z);
      this._privateFromGetters();
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

  //// Methods

  // Static helper to create Vector from Vector3Js
  static from(v: Vector3Js): Vector
  {
    return new Vector(v.x, v.y, v.z);
  }

  // Override methods that return vectors
  add(other: Vector3Js): Vector
  {
    return Vector.from(super.add(other));
  }

  subtract(other: Vector3Js): Vector
  {
    return Vector.from(super.subtract(other));
  }

  scale(scalar: number): Vector
  {
    return Vector.from(super.scale(scalar));
  }

  normalize(): Vector
  {
    return Vector.from(super.normalize());
  }

  cross(other: Vector3Js): Vector
  {
    return Vector.from(super.cross(other));
  }

  reverse(): Vector
  {
    return Vector.from(super.reverse());
  }

  // Scalar methods stay unchanged
  dot(other: Vector3Js): number
  {
    return super.dot(other);
  }

  length(): number
  {
    return super.length();
  }

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

  rotateEuler(roll: number, pitch: number, yaw: number): Vector3Js {
    return Vector.from(
      super.rotateEuler(roll, pitch, yaw)
    );
  }

  toString(): string
  {
    return `Vector { x: ${this.x}, y: ${this.y}, z: ${this.z} }`;
  }

}