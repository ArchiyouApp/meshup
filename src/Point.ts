/** Point.ts
 * 
 * Make working with Points easier by wrapping Point3Js
 * 
 * NOTES:
 *    - we always use 3D version, so no 2D points classes. This for simplicity and consistency.
 * 
 * */

import type { Axis, PointLike } from './types'
import { isPointLike, isAxis } from './types';
import { Vector } from './Vector';
import { Vertex } from './Vertex';
import { rad } from './utils';

import { POINT_TOLERANCE  } from './constants'; 

// CSGRS WASM LAYER
import { Point3Js, Vector3Js, VertexJs  } from "./wasm/csgrs";

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
            this._z = x[2] || 0;
        }
        else if(x instanceof Point || x instanceof Vector || x instanceof Vertex)
        {
            this._x = x.x;
            this._y = x.y;
            if(typeof x.z === 'number') this._z = x.z;
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

    /** Round to a given tolerance */
    round(tolerance: number = POINT_TOLERANCE): Point
    {
        this._x = Math.round(this._x / tolerance) * tolerance;
        this._y = Math.round(this._y / tolerance) * tolerance;
        this._z = Math.round(this._z / tolerance) * tolerance;
        return this;
    }


    //// CALCULATED PROPS ////


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

    //// RESOLVE RELATIVE COORDINATES ////

    /** Resolve relative 2D coordinates for Sketches 
     *  example: 
     *      lineTo(10,10) - absolute
     *      lineTo('+10', '-5') - relative to current point
     *      lineTo('r<45') - polar relative to current point (r is distance, < is angle in degrees)
     *      lineTo('r<<45') - polar relative to current point, but angle is relative to the last segment (like in autocad)
    */
    resolveRelativeCoord2D(cursor:{ at: PointLike, dir: Vector }, args: Array<string|number>): Point
    {
        const prevPoint = Point.from(cursor.at);
        // absolute coordinates
        if(Array.isArray(args) && args.every(arg => typeof arg === 'number'))
        {
            return new Point(args[0], args[1], 0);
        }
        // relative coords
        else if(Array.isArray(args) && args.length === 2 && args.every(arg => typeof arg === 'string'))
        {
            try 
            {
                const xStr = args[0] as string;
                const yStr = args[1] as string;
                const x = xStr.startsWith('+') ? prevPoint.x + parseFloat(xStr.slice(1)) : (xStr.startsWith('-') ? prevPoint.x - parseFloat(xStr.slice(1)) : parseFloat(xStr));
                const y = yStr.startsWith('+') ? prevPoint.y + parseFloat(yStr.slice(1)) : (yStr.startsWith('-') ? prevPoint.y - parseFloat(yStr.slice(1)) : parseFloat(yStr));
                return new Point(x, y, 0);
            }
            catch (e)
            {
                throw new Error(`Point::resolveRelativeCoord2D(): Invalid relative coordinates: ${args}`);
            }
        }
        // polar coords
        else if(Array.isArray(args) && args.length === 1 && typeof args[0] === 'string')
        {
            // polar absolute: "{radius}<{angle}"
            if(args[0].match(/^\d+(\.\d+)?<\d+(\.\d+)?$/)) 
            {
                try 
                {
                    const [rStr, angleStr] = (args[0] as string).split('<');
                    const r = parseFloat(rStr);
                    const angle = rad(parseFloat(angleStr)); // convert to radians
                    const x = prevPoint.x + r * Math.cos(angle);
                    const y = prevPoint.y + r * Math.sin(angle);
                    return new Point(x, y, 0);
                }
                catch (e)                {
                    throw new Error(`Point::resolveRelativeCoord2D(): Invalid polar coordinates: ${args[0]}`);
                }
            }
            else if(args[0].match(/^\d+(\.\d+)?<<\d+(\.\d+)?$/))  // polar relative: "{radius}<<{angle}"
            {
                try
                {
                    const angleStr = (args[0] as string).split('<<')[1];
                    const r = parseFloat((args[0] as string).split('<<')[0].slice(1)); // remove 'r' prefix
                    const angle = rad(parseFloat(angleStr)); // convert to radians
                    // calculate angle of the last segment (direction vector) and add the relative angle to it
                    const prevAngle = new Vector(cursor.dir).angle(new Vector(1,0)); // angle to x-axis
                    const totalAngle = prevAngle + angle;
                    const x = prevPoint.x + r * Math.cos(totalAngle);
                    const y = prevPoint.y + r * Math.sin(totalAngle);
                    return new Point(x, y, 0);
                }
                catch (e)
                {
                    throw new Error(`Point::resolveRelativeCoord2D(): Invalid polar relative coordinates: ${args[0]}`);
                }
            }
        }
    }



    //// AUTO CONVERSION ////

    toArray(): [number, number, number?]
    {
        return [this._x, this._y, this._z];
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

    toPointJs(): Point3Js
    {
        return new Point3Js(this._x, this._y, this._z);
    }

    toPoint3Js(): Point3Js
    {
        return new Point3Js(this._x, this._y, this._z || 0.0);
    }

    toVector3Js(): Vector3Js
    {
        return new Vector3Js(this._x, this._y, this._z || 0.0);
    }

    

}   