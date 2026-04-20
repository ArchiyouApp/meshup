/** Point.ts
 * 
 * Make working with Points easier by wrapping Point3Js
 * 
 * NOTES:
 *    - we always use 3D version, so no 2D points classes. This for simplicity and consistency.
 * 
 * */

import type { Axis, PointLike } from './types'
import type { SketchCoords, SketchCursor} from './Sketch';

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
        if (typeof x === 'number' && (typeof y === 'number' || y === undefined) && (typeof z === 'number' || z === undefined))
        {
            this._x = x;
            this._y = y || 0;
            this._z = z || 0;
        }
        else if (Array.isArray(x) && x.length >= 1 && x.every(c => typeof c === 'number'))
        {
            this._x = x[0];
            this._y = x[1] || 0;
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
        else if( typeof x === 'object') 
        {
            const obj = x as {x: number, y: number, z?: number};
            if(typeof obj.x === 'number' && typeof obj.y === 'number' && (typeof obj.z === 'number' || obj.z === undefined))
            {
                this._x = obj.x;
                this._y = obj.y;
                this._z = obj?.z || 0;
            }
        }
        else
        {
            throw new Error(`Point(): Invalid parameters: (${x}, ${y}, ${z}). Please use [x,?y,?z], {x,?y,?z} or instance of Point/Vector/Vertex/Point3Js/Vector3Js`);
        }
    }

    //// STATIC FACTORY METHODS ////

    /** Create a new Point instance from the given parameters */
    static from(x: PointLike|number, y?: number, z?: number):Point
    {
        return new Point(x, y, z);
    }

    static random(range: number): Point
    {
        const point = new Point(0, 0, 0);
        point._x += (Math.random() - 0.5) * range;
        point._y += (Math.random() - 0.5) * range;
        point._z += (Math.random() - 0.5) * range;
        return point;
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

    /** Set the given axis component, mutating this point */
    setComponent(axis: Axis, coord: number): Point
    {
        if(!isAxis(axis)){ throw new Error(`Point::setComponent(): Invalid axis: ${axis}. Use 'x', 'y' or 'z'.`); }
        if(axis === 'x') this._x = coord;
        else if(axis === 'y') this._y = coord;
        else this._z = coord;
        return this;
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

    /** Return a new Point with the same coordinates */
    copy(): Point
    {
        return new Point(this._x, this._y, this._z);
    }

    /** Translate this point by the given offset */
    move(pntOrDx: PointLike | number, dy?: number, dz?: number): Point
    {
        if(!isPointLike(pntOrDx) && typeof pntOrDx !== 'number'){ throw new Error(`Point::move(): Invalid parameter: ${pntOrDx}`); }
        // IMPORTANT: isPointLike accept numbers (for x coord only), so don't start with that check!
        const d = (typeof dy === 'number' || typeof dz === 'number') 
                        ? new Point(pntOrDx, dy || 0, dz || 0)
                        : Point.from(pntOrDx);
        this._x += d.x;
        this._y += d.y;
        this._z += d.z;
        return this;
    }

    moveX(dx: number): Point { return this.move(dx, 0, 0); }
    moveY(dy: number): Point { return this.move(0, dy, 0); }
    moveZ(dz: number): Point { return this.move(0, 0, dz); }

    //// RELATIONSHIPS WITH OTHER POINTS ////

    distance(to: PointLike): number
    {
        if(!isPointLike(to)){ throw new Error(`Point::distance(): Invalid parameter: ${to}`); }
        const otherPoint = new Point(to);
        const dx = this._x - otherPoint._x;
        const dy = this._y - otherPoint._y;
        const dz = this._z - otherPoint._z;
        // NOTE: could use WASM Vector3Js for this calculation, but might not be faster
        return Math.sqrt(dx*dx + dy*dy + dz*dz);
    }

    sameCoordAt(other:PointLike): Axis|null
    {
        const otherPoint = new Point(other);
        if(this._x === otherPoint._x) return 'x';
        if(this._y === otherPoint._y) return 'y';
        if(this._z === otherPoint._z) return 'z';
        return null;
    }

    /** Returns true if this point is within tolerance of the given PointLike */
    equals(other: PointLike, tolerance: number = POINT_TOLERANCE): boolean
    {
        if(!isPointLike(other)){ throw new Error(`Point::equals(): Invalid parameter: ${other}`); }
        return this.distance(other) <= tolerance;
    }

    // NOTE: For other functions use underlying Point3Js or Vector3Js methods

    //// RESOLVE RELATIVE COORDINATES ////

    /** Resolve relative 2D coordinates for Sketches 
     *  example: 
     *      lineTo(10,10) - absolute
     *      lineTo('+10', '-5') - relative to current point
     *      lineTo('+0', 5) - mixed
     *      lineTo('{{r}}<45') - polar relative to current point (r is distance, < is angle in degrees)
     *      lineTo('{{r}}<<45') - polar relative to current point, but angle is relative to the last segment (like in autocad)
    */
    static fromSketchCoords(cursor:SketchCursor, coords:SketchCoords): Point|null
    {
        const prevPoint = Point.from(cursor.at);

        if(typeof coords[0] === 'string' && coords[0].includes('<')) // polar coordinates
        {
            // {r}<{angle} or {r}<<{angle}  e.g. 100<45, 100<<-45
            const polarRegex = /^(-?\d*\.?\d+)(<<?)(-?\d*\.?\d+)$/;
            const match = coords[0].match(polarRegex);
            if (!match)
            {
                console.warn(`Point::fromSketchCoords(): Invalid polar coordinate format: ${coords[0]}`);
                return null;
            }

            const [, rValue, separator, angleValue] = match;
            const r = parseFloat(rValue) || 0;
            const angleDeg = parseFloat(angleValue) || 0;
            const angleRad = rad(angleDeg);

            // Determine the base angle for polar coordinates
            let baseAngle = 0;
            if (separator === '<<')
            {
                // Angle is relative to the last segment direction
                if (cursor.direction)
                {
                    baseAngle = Math.atan2(cursor.direction.y, cursor.direction.x);
                } 
                else 
                {
                    console.warn(`Point::fromSketchCoords(): No direction available for relative angle. Defaulting to 0.`);
                }
            }

            const finalAngle = baseAngle + angleRad;
            const dx = r * Math.cos(finalAngle);
            const dy = r * Math.sin(finalAngle);

            return new Point(prevPoint.x + dx, prevPoint.y + dy);
        }
        else 
        {
            // absolute or relative Cartesian coordinates
            const rx = Point._resolveRelativeCoord(coords[0], prevPoint.x);
            const ry = Point._resolveRelativeCoord(coords[1] || 0, prevPoint.y);

            return new Point(rx, ry);
        }
    }

    private static _resolveRelativeCoord(coord: number|string, prevCoord: number): number
    {
        if((typeof coord !== 'number' && typeof coord !== 'string'))
        {
            throw new Error(`Point::fromSketchCoords(): Invalid coordinate type: ${coord} (${typeof coord})`);
        }

        const rc = (typeof coord === 'number') 
                    ? coord 
                    : (typeof coord === 'string' && coord.startsWith('-') 
                            ? prevCoord - parseFloat(coord.slice(1)) 
                            : prevCoord + parseFloat(coord));
        return rc;
    }



    //// AUTO CONVERSION ////

    toArray(): [number, number, number?]
    {
        return [this._x, this._y, this._z];
    }

    toVector(): Vector
    {
        return Vector.from(this._x, this._y, this._z);
    }

    /** Returns this Point as a new Point — for old-API compatibility */
    toPoint(): Point
    {
        return new Point(this._x, this._y, this._z);
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

    toVertexJs(n?:PointLike): VertexJs
    {
        const normal = isPointLike(n) ? new Point(n) : new Point([0,0,0]);
        return new VertexJs(this.toPoint3Js(), normal.toVector3Js());
    }

    //// REPRESENTATION ////

    toString(): string
    {
        return `<Point(${this._x}, ${this._y}, ${this._z})>`;
    }

}