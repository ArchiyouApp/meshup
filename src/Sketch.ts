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
 *             These curves are stored in the _shapes property as a Collection.
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
import { Collection } from "./Collection";


import type { BasePlane, PointLike } from "./types";
import { isBasePlane, isPointLike } from "./types";

import { BASE_PLANE_NAME_TO_PLANE } from "./constants";
import { Curve } from "./Curve";


export class Sketch  
{
    declare _origin: Point; // origin point of the Sketch plane in world coordinates
    declare _normal: Vector; // normal vector of the Sketch plane in world coordinates
    declare _xDir: Vector; // direction of the X axis of the Sketch plane in world coordinates
    declare _yDir: Vector; // direction of the Y axis of the Sketch plane in world coordinates

    _shapes: Collection = new Collection(); // collection of shapes in the sketch (mostly Curves)
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
            // TODO
            // NOTE: also add fitting plane to the polygon 
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
    moveTo(m: PointLike): this
    {
        if(!isPointLike(m)){ throw new Error('Sketch::moveTo(): Invalid point. Please supply a PointLike like [x,y], [x,y,z], Point(x,y), Vector(x,y) etc');}
        this._pushCursor(new Point(m));
        return this;
    }

    //// LINEAR SHAPES ////

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
                    this._shapes.add(l);
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
        // TODO
        return this;
    }

    /** Make a NURBS Curve through given 2D points as control points */
    splineTo(pnts:Array<PointLike>): this
    {
        // TODO
        return this;
    }

    //// CLOSED SHAPES //// 

    // TODO

    //// CONSOLIDATION ////

    /** 
     *  Combine all shapes into the minimal set of curves:
     *   - Consecutive collinear degree-1 segments are merged into single polylines
     *   - All remaining connected segments become CompoundCurves
     *   - Disconnected groups stay as separate curves
     */
    consolidate(): this
    {
        const curves = this._shapes.curves();
        if(curves.length <= 1) return this;

        const chains = this._buildChains(curves);
        const consolidated = chains.map(chain => this._chainToCurve(chain));
        this._shapes = new Collection(...consolidated);
        return this;
    }

    /**
     *  Group curves into ordered end-to-start connected chains.
     *  Tries both orientations of each candidate.
     */
    private _buildChains(curves: Array<Curve>): Array<Array<Curve>>
    {
        if(curves.length === 0) return [];

        const remaining = [...curves];
        const chains: Array<Array<Curve>> = [];
        const TOLERANCE = 1e-6;

        while(remaining.length > 0)
        {
            const chain: Array<Curve> = [remaining.shift()!];
            let extended = true;
            while(extended)
            {
                extended = false;
                const chainEnd = chain.at(-1)!.end();

                for(let i = 0; i < remaining.length; i++)
                {
                    const c = remaining[i];
                    const cStart = c.start();
                    const cEnd = c.end();
                    // Forward: candidate start connects to chain end
                    if(this._pointDist(chainEnd, cStart) < TOLERANCE)
                    {
                        chain.push(c);
                        remaining.splice(i, 1);
                        extended = true;
                        break;
                    }
                    // Reversed: candidate end connects to chain end
                    if(this._pointDist(chainEnd, cEnd) < TOLERANCE)
                    {
                        chain.push(c.copy().reverse());
                        remaining.splice(i, 1);
                        extended = true;
                        break;
                    }
                }
            }
            chains.push(chain);
        }
        return chains;
    }

    /**
     *  Convert a connected chain into the simplest representation:
     *   - Single curve          → as-is
     *   - All collinear degree-1 → single Polyline
     *   - Mixed types           → CompoundCurve
     */
    private _chainToCurve(chain: Array<Curve>): Curve
    {
        if(chain.length === 1) return chain[0];

        const merged = this._mergeCollinearSegments(chain);
        if(merged.length === 1) return merged[0];

        return Curve.Compound(merged);
    }

    /**
     *  Walk a chain and merge consecutive collinear degree-1 segments
     *  into single polylines.  Non-linear curves pass through as-is.
     *
     *  Collinearity test:  |cross(dirA, dirB)| < tolerance
     */
    private _mergeCollinearSegments(chain: Array<Curve>): Array<Curve>
    {
        const TOLERANCE = 1e-6;
        const result: Array<Curve> = [];
        let run: Array<Point> = [];  // accumulated polyline points

        const flushRun = () => {
            if(run.length >= 2)
            {
                result.push(Curve.Polyline(run));
            }
            run = [];
        };

        for(const curve of chain)
        {
            if(!curve.isCompound() && curve.degree() === 1)
            {
                const segStart = curve.start();
                const segEnd   = curve.end();
                const dx = segEnd.x - segStart.x;
                const dy = segEnd.y - segStart.y;
                const dz = segEnd.z - segStart.z;
                const len = Math.sqrt(dx*dx + dy*dy + dz*dz);
                if(len < TOLERANCE) continue;  // skip zero-length
                const segDir = new Vector(dx/len, dy/len, dz/len);

                if(run.length === 0)
                {
                    // Start a new run
                    run.push(segStart, segEnd);
                }
                else
                {
                    // Check collinearity against last segment direction
                    const prev = run.at(-2)!;
                    const last = run.at(-1)!;
                    const px = last.x - prev.x;
                    const py = last.y - prev.y;
                    const pz = last.z - prev.z;
                    const plen = Math.sqrt(px*px + py*py + pz*pz);
                    const prevDir = plen > TOLERANCE 
                        ? new Vector(px/plen, py/plen, pz/plen) 
                        : segDir;

                    const cross = prevDir.cross(segDir);
                    if(cross.length() < TOLERANCE)
                    {
                        // Collinear — extend the run (shared endpoint already present)
                        run.push(segEnd);
                    }
                    else
                    {
                        // Direction change — flush and start new
                        flushRun();
                        run.push(segStart, segEnd);
                    }
                }
            }
            else
            {
                // Non-linear or compound curve — flush any pending polyline run
                flushRun();
                result.push(curve);
            }
        }
        flushRun();
        return result;
    }

    //// FINISHING ////

    end(): Collection
    {
        this.consolidate();
        return this._shapes;
    }

    /** Alias for end */
    importSketch(): Collection
    {
        return this.end();
    }

    /** Euclidean distance between two Points */
    private _pointDist(a: Point, b: Point): number
    {
        const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
        return Math.sqrt(dx*dx + dy*dy + dz*dz);
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