/** Make working with Points easier */

import type { Axis, PointLike } from './types'
import { isPointLike, isAxis } from './types';
import { Vector } from './Vector';
import { Vertex } from './Vertex';

// CSGRS WASM LAYER
import { Point2Js, Vector2Js, Point3Js, Vector3Js, VertexJs  } from "./wasm/csgrs";

export class Point
{
    private _x: number = 0;
    private _y: number = 0;
    private _z: number = 0;

    /** Make a Point out of different entities */
    constructor(x: PointLike|number, y?: number, z?: number)
    {
        if (typeof x === 'number' && typeof y === 'number' && typeof z === 'number')
        {
            this._x = x;
            this._y = y;
            this._z = z;
        }
        else if (Array.isArray(x) && x.length >= 2)
        {
            this._x = x[0];
            this._y = x[1];
            this._z = x[2];
        }
        else if(x instanceof Point || x instanceof Vector || x instanceof Vertex)
        {
            this._x = x.x;
            this._y = x.y;
            if(typeof x.z === 'number') this._z = x.z;
        }
        else if (x instanceof Point2Js || x instanceof Vector2Js)
        {
            this._x = x.x;
            this._y = x.y;
        }
        else if (x instanceof Point3Js || x instanceof Vector3Js)
        {
            this._x = x.x;
            this._y = x.y;
            this._z = x.z;
        }
        else if(x instanceof VertexJs)
        {
            this._x = x.position().x;
            this._y = x.position().y;
            this._z = x.position().z;
        }
        else
        {
            throw new Error(`Point(): Invalid parameters: (<${x?.constructor?.name || typeof x}> ${JSON.stringify(x)}, ${y}, ${z}) `);
        }
    }

    /** Create a new Point instance from the given parameters */
    static from(x: PointLike|number, y?: number, z?: number):Point
    {
        return new Point(x, y, z);
    }

    //// GETTERS / SETTERS

    get x(): number
    {
        return this._x;
    }

    get y(): number
    {
        return this._y;
    }

    get z(): number
    {
        return this._z;
    }

    //// TRANSFORMS ////



    //// CALCULATED PROPS ////

    dimension(): 2 | 3
    {
        return (this._z === undefined) ? 2 : 3;
    }

    //// RELATIONSHIPS WITH OTHER POINTS ////

    sameCoordAt(other:PointLike): Axis|null
    {
        const otherPoint = new Point(other);
        if(this._x === otherPoint._x) return 'x';
        if(this._y === otherPoint._y) return 'y';
        if(this._z === otherPoint._z) return 'z';
        return null;
    }

    // NOTE: For other functions use underlying Point3Js or Vector3Js methods

    //// AUTO CONVERSION ////

    toArray(): [number, number, number?]
    {
        return (this.dimension() === 2) 
            ? [this._x, this._y] 
            : [this._x, this._y, this._z];
    }

    toVector(): Vector
    {
        return new Vector(this._x, this._y, this._z);
    }

    toVertex(n?:PointLike): Vertex
    {
        const normal = isPointLike(n) ? new Point(n) : new Point([0,0,0]);
        return new Vertex(this, normal);
        // NOTE: need to calculate normals later
    }

    //// CSGRS WASM LAYER ////

    toPointJs(): Point2Js|Point3Js
    {
        return (this.dimension() === 2) 
            ? new Point2Js(this._x, this._y) 
            : new Point3Js(this._x, this._y, this._z);
    }

    toPoint2Js(): Point2Js
    {
        return new Point2Js(this._x, this._y);
    }

    toPoint3Js(): Point3Js
    {
        return new Point3Js(this._x, this._y, this._z || 0.0);
    }

    toVector2Js(): Vector2Js
    {
        return new Vector2Js(this._x, this._y);
    }

    toVector3Js(): Vector3Js
    {
        return new Vector3Js(this._x, this._y, this._z || 0.0);
    }

    

}   