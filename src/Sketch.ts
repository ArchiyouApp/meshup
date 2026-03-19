/**
 *  
 *    Sketch.ts
 * 
 *      A sketch is a collection of 2D curves that form the base for further 3D operations
 * 
 *      Basic architecture:
 * 
 *      1. Create a Sketch on a plane: this can be a baseplane or custom (see _normal, _origin, _xDir, _yDir)
 * 
 *              TODO: Add scaling to fit a Plane/Polygon
 * 
 *      2. A series of commands create Shapes (using Curves) on the sketch plane. 
 * 
 *             These curves are stored in the _curves property as a Collection.
 *
 *          Shapes can be of two kinds: 
 *              - linear ones (lineTo, splineTo, arcTo) - mostly used to create a contour from scratch
 *              - closed shapes (rect, circle, ellipse) - build contours by combining (union,subtract,intersect) primitive closed shapes             
 * 
 *      3. Cursors: 
 *              Most commands area sequential: meaning they use the result of the previous command as a starting point for the next one.
 *              This is tracked by the _cursors:Array<SketchCursor>
 *              
 *              - most commands leave a single cursor:
 *                  moveTo(0,0) => cursor at (0,0)
 *                  lineTo(10,0) => cursor at (10,0)
 *              - some commands can generate multiple cursors:
 *                  rect(100,100).moveToVertices() => 4 cursors at the corners of the rectangle
 *
 *      
 *      4. You can then operate on those shapes
 *          
 *           By using the Sketch contact these operations try to interpret the intent of the user and execute the right operation.
 *              
 *              - general for shapes: move, rotate, scale, mirror, align
 *               -only for linear Shapes: fillet, chamfer, offset, close
 *              - between shapes: union, subtract, intersection/difference/clip
 
 *
 *      5. Some of these operations are done before they can be executed. 
 *          These go in _pendingOps, which is processed at the end of each operation
 * 
 *           example: 
 *                  Sketch()
 *                      .lineTo(10,0)
 *                      .fillet(2) // local fillet in corner of two lines
 *                      .lineTo(10,10) // => now fillet can be executed
 * 
 *          
 *      6. Temporary shapes
 *              
 *          Shapes can be temporary meaning not part of the final output, 
 *              but used as a step in the process of creating the final curves:
 *              
 *              Sketch().rect(100,100)
 *                      .copy().offset(-10).isTemp()
 *                      .moveToVertices()
 *                      .circle(5) // add circles at the corners of the rectangle
 *     
 * 
 *      7. Access previous Shapes on stack
 * 
 *              TODO:tags
 * 
 *      8. End Sketch and import: end() / importSketch() 
 *          Once the user is done with the sketch, they can call end() to import the curves into main scene:
 *          - local 2D coordinates are converted to 3D world coordinates using the workplane definition
 * 
 * 
 */

import { PolygonJs } from "./wasm/csgrs";

import { Vector } from "./Vector";
import { Point } from "./Point";
import { Collection, CurveCollection } from "./Collection";


import type { Axis, BasePlane, PointLike } from "./types";
import { isBasePlane, isPointLike } from "./types";

import { BASE_PLANE_NAME_TO_PLANE } from "./constants";
import { Curve } from "./Curve";


export class Sketch  
{
    declare _origin: Point; // origin point of the Sketch plane in world coordinates
    declare _normal: Vector; // normal vector of the Sketch plane in world coordinates
    declare _xDir: Vector; // direction of the X axis of the Sketch plane in world coordinates
    declare _yDir: Vector; // direction of the Y axis of the Sketch plane in world coordinates

    _curves: CurveCollection = new CurveCollection(); // collection of curves in the sketch
    _cursors: Array<SketchCursor> = []; // active cursor stack

    constructor(plane: BasePlane|PolygonJs = 'xy')
    {
        this._setWorkingPlane(plane);
        this._pushCursor(new Point(0,0)); 
    }

    _setWorkingPlane(plane: BasePlane|PolygonJs): void
    {
        // Set the working plane of the sketch
        if(isBasePlane(plane))
        {
            // Initialize sketch with base plane
            const { normal, xDir, yDir } = BASE_PLANE_NAME_TO_PLANE[plane];
            this._normal = new Vector(normal);
            this._xDir = new Vector(xDir);
            this._yDir = new Vector(yDir);
            this._origin = new Point(0,0,0); // default origin at world coordinates
        }
        else if(plane instanceof PolygonJs)
        {
            // Initialize sketch with polygon
            // NOTE: also add fitting plane to the polygon 
            console.warn(`Sketch::setWorkingPlane(): Initializing sketch with a PolygonJs not implemented yet!`);
        }
        else
        {
            throw new Error(`Sketch::setWorkingPlane(): Invalid plane. Supply a base plane name ('xy', 'yz', 'zx', 'front', 'back', 'left', 'right') or a PolygonJs.`);
        }
    }

    //// CURSOR MANAGEMENT ////

    private _pushCursor(at: Point, direction:Vector = new Vector(1,0)): void
    {
        this._cursors = [{ at, direction }];
    }

    /** Take all cursors of the stack for processing */
    private _popAllCursors(): Array<SketchCursor>
    {
        const allCursors = this._cursors;
        this._cursors = [];
        return allCursors;
    }

    /** Create new cursor at the given point */
    moveTo(...coords:SketchCoords): this
    {
        this._popAllCursors()
        .forEach(
            (cur) => {
                const p = Point.fromSketchCoords(cur, coords);
                if(!isPointLike(p)){ throw new Error('Sketch::moveTo(): Invalid point. Please supply a PointLike like [x,y], [x,y,z], Point(x,y), Vector(x,y) etc');}
                this._pushCursor(new Point(p));
            });
        return this;
    }
    
    //// SHAPES GENERAL ////

    /** Copy last curve and append to shapes */
    copy(): this
    {
        this.combine(); // first combine command curves

        this._curves.add(this._curves.last()?.copy());
        return this;
    }

    /** Offset last curve */
    offset(distance: number): this
    {
        console.log('==== OFFSET SKETCH ====');

        const last = this._curves.last();
        if (!last) return this;

        console.log(last.normal());
        console.log(last.points());

        last.offset(distance); // in place

        console.log('AFTER OFFSET');
        console.log(last.normal());
        console.log(last.points());
        
        return this;
    }

    /** Translate last curve */
    translate(vecOrX: PointLike | number, dy?: number, dz?: number): this
    {
        this._curves?.last()?.translate(vecOrX as any, dy as any, dz as any);
        return this;
    }

    /** Rotate last curve a given angle around a pivot point 
     *  If given pivot not given use center of curve
    */
    rotate(angleDeg: number, pivot: PointLike): this
    {
        // NOTE: use rotateAround which is more convenient
        const lastCurve = this._curves?.last();
        lastCurve?.rotateAround(angleDeg, 'z', pivot || lastCurve?.bbox()?.center() || new Point(0,0));
        return this;
    }

    //// LINEAR CURVES ////

    /** Make a line from current cursor to the given 2D point */
    lineTo(...coords:SketchCoords): this
    {
        this._popAllCursors()
        .forEach(
            (cur) => {
                const p = Point.fromSketchCoords(cur, coords);
                if(p)
                { 
                    const l = Curve.Line(cur.at, p);

                    if(l.length() === 0)
                    {
                        console.warn(`Sketch::lineTo(): Zero length line from ${cur.at} to ${p}. Skipping.`);
                        return;
                    }
                    this._curves.add(l);
                    // make end of line (and its tangent) the new cursor
                    this._pushCursor(p, l.tangentAt(l.end()) || new Vector(1,0,0));
                }
                else 
                {
                    console.warn(`Sketch::lineTo(): Invalid coordinates: ${JSON.stringify(coords)}. Please supply absolute, relative or polar coordinates like [x,y], ['+dx','-dy'], 'r<angle' or 'r<<angle'`);
                }
            });    
        return this;
    }

    /** Make an arc from current cursor to the given 2D point, with the given mid point */
    arcTo(mid: PointLike, end: PointLike): this
    {
        console.warn(`Sketch::arcTo(): Not implemented yet!`);
        return this;
    }

    /** Make a NURBS Curve through given 2D points as control points */
    splineTo(pnts:Array<PointLike>): this
    {
        console.warn(`Sketch::splineTo(): Not implemented yet!`);
        return this;
    }

    //// CLOSED CURVES //// 

    /** Close shapes in Sketch 
     *  First we need to combine any segments into connected curves
     *  If there is only one connected curve, it is clear the user wants to close it. 
     *  If there are multiple (for example after offset), the intent is probably to connect the two (or more) curves 
    */
    close(): this
    {
        this.combine(); // connect curves if possible
        
        // Only one contineous shape, so we can just close it
        if(this._curves.count() === 1)
        {
            this._curves.first()?.close();
        }
        else {
            // Multiple shapes, try to connect them into one closed curve
            this._curves.connect();
        }
    
        return this;
    }

    // TODO: More closed shapes: rect, circle, ellipse, polygon

    //// COMBINATIONS ////

    combine(): this
    {
        const combined = this._curves.combine();
        this._curves = combined;
        return this;
    }

    //// FINISHING ////

    /** Convert all curves in Sketch to world coordinates and return copies */
    _localToWorld():CurveCollection
    {
        return this._curves.copy()
            .forEach((curve) => {
                curve.reorient(this._normal, this._origin);
        });
    }

    end(): CurveCollection
    {
        // ...existing code...
        
        return this._localToWorld();
    }

    /** Alias for end */
    importSketch(): CurveCollection
    {
        return this.end();
    }

}


//// SKETCH TYPES ////

/** Cursor keeps track of last Sketch command */
export interface SketchCursor
{
    at: Point; // 2D point
    direction?: Vector; // tangent at last (linear) Shape       
}

/** absolute, relative, polar and polar relative */
export type SketchCoords = [number|string, (number|string)?] // absolute or relative
                            | [string]; // polar absolute or polar relative (e.g. 'r<45' or 'r<<45')