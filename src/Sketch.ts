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
 *             These curves are stored in the _curves property as a ShapeCollection.
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

import { PolygonJs, SketchJs, VertexJs, Vector3Js } from "./wasm/csgrs";

import { Vector } from "./Vector";
import { Point } from "./Point";
import { ShapeCollection } from "./ShapeCollection";
import { Curve } from "./Curve";
import { Mesh, getCsgrs } from "./index";

import type { Axis, BasePlane, PointLike } from "./types";
import { isBasePlane, isPointLike } from "./types";

import { BASE_PLANE_NAME_TO_PLANE } from "./constants";


export class Sketch  
{
    declare _origin: Point; // origin point of the Sketch plane in world coordinates
    declare _normal: Vector; // normal vector of the Sketch plane in world coordinates
    declare _xDir: Vector; // direction of the X axis of the Sketch plane in world coordinates
    declare _yDir: Vector; // direction of the Y axis of the Sketch plane in world coordinates

    _curves: ShapeCollection<Curve> = new ShapeCollection<Curve>(); // collection of curves in the sketch
    _cursors: Array<SketchCursor> = []; // active cursor stack
    _callbacks: Record<'end', [(curves: ShapeCollection<Curve>) => void, boolean]> = {} as any;

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
            this._normal = Vector.from(normal);
            this._xDir = Vector.from(xDir);
            this._yDir = Vector.from(yDir);
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

    //// EVENT MANAGEMENT ////

    /** Register a callback to be called when the sketch ends */
    onEnd(callback: (curves: ShapeCollection<Curve>) => void, useResult:boolean=true): this
    {
        if(typeof callback !== 'function'){ throw new Error('Sketch::onEnd(): Callback must be a function');}
        this._callbacks.end = [callback, useResult];
        return this;
    }

    //// CURSOR MANAGEMENT ////

    private _pushCursor(at: Point, direction:Vector = Vector.from(1,0)): void
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
            (cur) =>
            {
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
        const last = this._curves.last();
        if (!last) return this;

        last.offset(distance); // in place
        
        return this;
    }

    /** Copy and offset last curve */
    offsetted(distance:number): this
    {
        this.copy()?.offset(distance);   
        return this;
    }

    /** Extend the last curve by the given length on the given side */
    extend(length: number, side: 'start'|'end'|'both' = 'end'): this
    {
        if (this._curves.count() === 0) return this;
        const last = this._curves.last();

        last.extend(length, side)

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
            (cur) =>
            {
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
                    this._pushCursor(p, l.tangentAt(l.end()) || Vector.from(1,0,0));
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
        if (!isPointLike(mid) || !isPointLike(end))
        {
            throw new Error('Sketch::arcTo(): Please supply PointLike for mid and end.');
        }
        this._popAllCursors().forEach((cur) =>
        {
            const midPt = Point.from(mid);
            const endPt = Point.from(end);
            const arc = Curve.Arc(cur.at, midPt, endPt);
            this._curves.add(arc);
            this._pushCursor(endPt, arc.tangentAt(endPt) ?? Vector.from(1, 0, 0));
        });
        return this;
    }

    /** Draw a polyline through the given 2D/3D points, starting from the current cursor.
     *  Each point is treated as absolute world coordinates (no relative prefix support).
     *  The cursor is updated to the last point.
     */
    polyline(pnts: Array<PointLike>): this
    {
        if (!Array.isArray(pnts) || pnts.length === 0)
        {
            console.warn('Sketch::polyline(): Empty or invalid point array');
            return this;
        }
        this._popAllCursors().forEach((cur) =>
        {
            const allPoints = [cur.at, ...pnts.map(p => Point.from(p))];
            const poly = Curve.Polyline(allPoints);
            this._curves.add(poly);
            const endPt = Point.from(pnts[pnts.length - 1]);
            this._pushCursor(endPt, poly.tangentAt(endPt) ?? Vector.from(1, 0, 0));
        });
        return this;
    }

    /** Make a smooth NURBS curve from the current cursor interpolating through `pnts` */
    curveTo(pnts: Array<PointLike>): this
    {
        if (!Array.isArray(pnts) || pnts.length === 0)
        {
            console.warn('Sketch::curveTo(): Empty or invalid point array');
            return this;
        }
        this._popAllCursors().forEach((cur) =>
        {
            const endPt = Point.from(pnts[pnts.length - 1]);
            const allPoints = [cur.at, ...pnts.map(p => Point.from(p))];
            const curve = Curve.Interpolated(allPoints);
            this._curves.add(curve);
            this._pushCursor(endPt, curve.tangentAt(endPt) ?? Vector.from(1, 0, 0));
        });
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
        else
        {
            // Multiple shapes, try to connect them into one closed curve
            this._curves = this._curves.connect() as ShapeCollection<Curve>;
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

    //// 3D OPERATIONS ////

    /** @private Convert closed sketch curves directly to a SketchJs using
     *  SketchJs.polygon() — no JSON serialization step needed.
     *  Holes are subtracted via SketchJs.difference().
     */
    private _toSketchJs(): SketchJs | null
    {
        this.combine();
        const closed = this._curves.curves().toArray().filter(c => c.isClosed());

        if (closed.length === 0)
        {
            console.warn('Sketch._toSketchJs(): No closed curves found. Use close() first.');
            return null;
        }

        try
        {
            const contour = closed[0];
            const outerPoints = contour.tessellate();
            // outer sketch contour
            let sketch = SketchJs.polygon(
                            outerPoints.map(p => [p.x, p.y]), null);

            // Additional closed curves in the sketch are treated as holes (difference)
            const otherContours = closed.slice(1);
            otherContours.forEach((hole) =>
            {
                const holePoints = hole.tessellate();
                sketch = sketch.difference(SketchJs.polygon(holePoints.map(p => [p.x, p.y]), null));
            });
            
            // Holes subtracted from outer curve (from boolean ops)
            const holes = contour.holes();
            holes.forEach((hole) =>
            {
                const holePoints = hole.tessellate();
                sketch = sketch.difference(SketchJs.polygon(holePoints.map(p => [p.x, p.y]), null));
            });

            console.info(`Sketch._toSketchJs(): Built SketchJs with ${outerPoints.length} points and ${holes.length + otherContours.length} holes.`);
            //console.log(sketch.debugGeometry());

            return sketch.renormalize(); // Make sure its OK winding order
        }
        catch (e)
        {
            console.error('Sketch._toSketchJs(): Failed to build SketchJs:', e);
            return null;
        }
    }

    /** Extrude all closed curves in this sketch into a solid Mesh.
     *  Extrudes `length` units along the specified `direction` and places the
     *  result correctly in world space for any sketch plane orientation.
     *
     *  @param length - Extrusion distance (positive = along sketch normal)
     *  @returns Mesh in world space, or null if no closed curves are present.
     */
    extrude(length: number): Mesh | null
    {
        const sketch = this._toSketchJs();
        
        if (!sketch)
        {
            console.error('Sketch.extrude(): No closed curves to extrude.');
            return null;
        }
        // Always extrude along local +Z; _alignMeshToWorld rotates that into the correct world normal.
        const mesh = Mesh.from(sketch.extrudeVector(Vector.from(0, 0, length).inner()));
        return this._alignMeshToWorld(mesh);
    }

    /** Sweep all closed curves in this sketch along a 3D path Curve.
     *  The sketch cross-section (in local XY) is placed at each tessellated
     *  path point and oriented perpendicular to the path tangent.
     *
     *  @param path - 3D path Curve to sweep along (world space)
     *  @returns Mesh, or null on error.
     */
    sweep(path: Curve): Mesh | null
    {
       if(!(path instanceof Curve)){ throw new Error('Sketch.sweep(): Invalid path. Please supply a Curve instance.'); }
       const points = path.tessellate().map(p => p.toPoint3Js()); // make sure path is tessellated for sweep
       if(points.length < 2){ throw new Error('Sketch.sweep(): Path must have at least 2 points.'); }
       const sketch = this._toSketchJs();
       if (!sketch)
       {
           console.error('Sketch.sweep(): No closed curves to sweep.');
           return null;
       }
       // SketchJs sweeps along +Z, rotate to align with sketch normal
       const mesh = Mesh.from(sketch.sweep(points));
       // align mesh from sketch plan into world space
       return this._alignMeshToWorld(mesh);
    }

    loft(other: Sketch): Mesh | null
    {
        // TODO: is this really practical?
        throw new Error('Sketch.loft(): Not implemented yet!');
        return null;
    }

    private _alignMeshToWorld(mesh: Mesh): Mesh
    {
        // align mesh from sketch plan into world space
        mesh.alignByPoints(
            [[0,0,0], [1,0,0], [0,1,0]], // source points in local sketch coordinates
            [this._origin, this._origin.copy().move(this._xDir), this._origin.copy().move(this._yDir)], // target points in world coordinates
            false // do not allow scaling
        );
        mesh.translate(this._origin);
        return mesh;
    }

    //// FINISHING ////

    /** Convert all curves in Sketch to world coordinates and return copies */
    _localToWorld():ShapeCollection<Curve>
    {
        this.combine(); // connect curves if possible

        return this._curves.copy()
            .forEach((curve) =>
            {
                // NOTE: normal alone is not enough for non-XY planes, we use xDir and yDir
                curve.alignByPoints(
                    [[0,0,0], [1,0,0], [0,1,0]], // source points in local sketch coordinates
                    [this._origin, this._origin.copy().move(this._xDir), this._origin.copy().move(this._yDir)], // target points in world coordinates
                    false // do not allow scaling
                );
        });
    }

    end(): ShapeCollection<Curve>
    {
        const result = this._localToWorld();
        const r = this.executeCallbacks(result);
        // intercepts callback result if useResult is set, 
        // otherwise returns curves as default
        return r !== undefined ? r : result; 
    }

    /** Execute callbacks */
    executeCallbacks(result: ShapeCollection<Curve>): any
    {
        for(const event in this._callbacks)
        {
            const [callback, useResult] = this._callbacks[event as keyof typeof this._callbacks];
            if(typeof callback === 'function')
            {
                try { 
                    const r = callback(result);
                    if(useResult)
                    { 
                        // if useResult is set stop after first callback
                        return r;
                    }
                }
                catch(e){ console.error(`Sketch::executeCallbacks(): Error executing callback for event '${event}':`, e); }
            }
        }
    }

    /** Alias for end */
    importSketch(): ShapeCollection<Curve>
    {
        return this.end();
    }

    /** Alias for end */
    toCurves(): ShapeCollection<Curve>
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