/** Make working with Points easier */

import type { Axis, PointLike } from './internal'
import { Point2Js, Vector2Js, Point3Js, Vector3Js,  } from "./wasm/csgrs";

export class Point
{
    x: number;
    y: number
    z: number;

    /** Make a Point out of different entities */
    constructor(x: PointLike|number, y?: number, z?: number)
    {
        if (typeof x === 'number' && typeof y === 'number' && typeof z === 'number')
        {
                this.x = x;
                this.y = y;
                this.z = z;
        }
        else if (Array.isArray(x) && x.length >= 2)
        {
            this.x = x[0];
            this.y = x[1];
            this.z = x[2];
        }
        else if (x instanceof Point2Js || x instanceof Vector2Js)
        {
            this.x = x.x;
            this.y = x.y;
        }
        else if (x instanceof Point3Js || x instanceof Vector3Js)
        {
            this.x = x.x;
            this.y = x.y;
            this.z = x.z;
        }
        else
        {
            throw new Error('Point(): Invalid parameters');
        }
    }

    dimension(): 2 | 3
    {
        return (this.z === undefined) ? 2 : 3;
    }

    //// RELATIONSHIPS WITH OTHER POINTS ////

    sameCoordAt(other:PointLike): Axis|null
    {
        const otherPoint = new Point(other);
        if(this.x === otherPoint.x) return 'x';
        if(this.y === otherPoint.y) return 'y';
        if(this.z === otherPoint.z) return 'z';
        return null;
    }

    // NOTE: For other functions use underlying Point3Js or Vector3Js methods

    //// AUTO CONVERSION ////

    toArray(): [number, number, number?]
    {
        return (this.dimension() === 2) 
            ? [this.x, this.y] 
            : [this.x, this.y, this.z];
    }

    toPoint(): Point2Js|Point3Js
    {
        return (this.dimension() === 2) 
            ? new Point2Js(this.x, this.y) 
            : new Point3Js(this.x, this.y, this.z);
    }

    toVector(): Vector2Js|Vector3Js
    {
        return (this.dimension() === 2) 
            ? new Vector2Js(this.x, this.y) 
            : new Vector3Js(this.x, this.y, this.z);
    }

    //// HARD CONVERSIONS ////

    toPoint2Js(): Point2Js
    {
        return new Point2Js(this.x, this.y);
    }

    toPoint3Js(): Point3Js
    {
        return new Point3Js(this.x, this.y, this.z || 0.0);
    }

    toVector2Js(): Vector2Js
    {
        return new Vector2Js(this.x, this.y);
    }

    toVector3Js(): Vector3Js
    {
        return new Vector3Js(this.x, this.y, this.z || 0.0);
    }

    

}   