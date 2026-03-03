/**
 *  Curve.ts
 *
 *  Wrapper around the csgrs NurbsCurve3DJs or CompoundCurve3DJs (see meshup.rs)
 *
 *  A BSpline consists of:
 *
 *  - Control Points: the points that define the shape of the curve
 *  - Weights: higher is closer to control point
 *  - Knots / Knot Vector: defines the parameter space, for example where the curve is clamped
 *
 *  and has: 
 *  - degree: 1 = straight, 2 = quadratic, 3 = cubic
 *  - order: degree + 1
 *
 *  NOTES:
 *    - we always use 3D version, so no 2D curves classes. This for simplicity and consistency.
 * 
 */

import { TESSELATION_TOLERANCE } from './constants';

import { NurbsCurve3DJs, CompoundCurve3DJs, Vector3Js } from "./wasm/csgrs";

import { getCsgrs, Mesh } from './index';
import type { CsgrsModule, PointLike, Axis, GLTFBuffer } from './types';
import { isPointLike } from './types'
import { Point } from './Point';
import { Vector } from './Vector';
import { Bbox } from './Bbox';

import { toBase64, rad } from "./utils";


export class Curve
{
    _curve: NurbsCurve3DJs|CompoundCurve3DJs|undefined = undefined;

    metadata: Record<string, any> = {};

    constructor()
    {
        // TODO
    }

    // Add a getter that always references the global state
    get _csgrs(): CsgrsModule
    {
        return getCsgrs(); // Always gets the current global instance
    }

    /** Get internal curve with checking */
    inner(): NurbsCurve3DJs|CompoundCurve3DJs
    {
        if (!this._curve)
        {
            throw new Error('Curve::inner(): Curve not initialized');
        }
        
        return this._curve;
    }

    copy(): Curve
    {
        const newCurve = new Curve();
        newCurve._curve = this._curve?.clone();
        return newCurve;
    }

    //// CREATION ////
    /*
        We use factory methods for it's clean syntax
    */

    static fromCsgrs(curve: NurbsCurve3DJs|CompoundCurve3DJs): Curve
    {
        if(!curve) { throw new Error('Curve::fromCsgrs(): Invalid curve'); }
        const newCurve = new Curve();
        newCurve._curve = curve;
        return newCurve;
    }

    static Line(start: PointLike, end: PointLike): Curve
    {
        if(!isPointLike(start) || !isPointLike(end)){ throw new Error('Curve.Line(): Invalid start or end point. Please supply a PointLike: [x,y], [x,y,z], Point, Vector etc'); }
        return this.Polyline([Point.from(start), Point.from(end)]); // We can use polyline here
    }

    /** Make a polyline curve with corners given by control points */
    static Polyline(controlPoints: PointLike|Array<PointLike>, ...args: Array<PointLike>): Curve
    {
        if(!isPointLike(controlPoints) && !(Array.isArray(controlPoints) && controlPoints.every(isPointLike)))
        {
            throw new Error('Curve.Polyline(): Invalid control points. Please supply PointLike(s) as arguments or an array of PointLike.');
        }

        // For flat args: Curve.Polyline(p1,p2,p3)
        if(isPointLike(controlPoints))
        {
            controlPoints = [controlPoints, ...(args?.filter(p => isPointLike(p)) || [])];
        }
        else {
            controlPoints = controlPoints as Array<PointLike>; // already in correct format
        }

        return Curve.fromCsgrs(
            getCsgrs()?.NurbsCurve3DJs?.makePolyline(
                controlPoints.map(p => Point.from(p).toPoint3Js()),
                true,
            )
        );
    }

    /** Make a NURBS curve by interpolating through given points */
    static Interpolated(controlPoints: PointLike[], degree: number = 3): Curve
    {
        return Curve.fromCsgrs(
            getCsgrs()
                ?.NurbsCurve3DJs
                    ?.makeInterpolated(
                        controlPoints.map(p => new Point(p).toPoint3Js()),
                        degree,
            )
        );
    }

    static Circle(radius:number = 50, center:PointLike = [0,0,0], normal:PointLike = [0,0,1]): Curve
    {
        if(!isPointLike(center) || typeof radius !== 'number' || !isPointLike(normal))
        { 
            throw new Error('Curve.Circle(): Invalid center, radius, or normal. Please supply a PointLike for center and normal, and a number for radius.');
        }

        return Curve.fromCsgrs(
                getCsgrs()
                    ?.NurbsCurve3DJs
                    ?.makeCircle(
                        radius,
                        Point.from(center).toPoint3Js(),
                        Point.from(normal).toVector3Js()
                    )
                );
        
    }

    //// PROPERTIES ////

    isCompound():boolean
    {
        return this._curve instanceof CompoundCurve3DJs;
    }
    

    /** Get control points of Curve */
    controlPoints(): Array<Point>
    {
        return this.inner()
                ?.controlPoints()
                ?.map(p => Point.from(p));
    }

    /** Alias for controlPoints */
    points(): Array<Point>
    {
        return this.controlPoints();
    }

    /** Get knots of Curve */
    knots()
    {
        if(!this.isCompound())
        {
            return (this.inner() as NurbsCurve3DJs).knots();
        }
        else {
            console.warn(`Curve::knots(): Curve is compound. Use specific span to get knots`);
        }
    }

    knotsDomain():Array<number|number>|undefined
    {
        if(!this.isCompound())
        {
            return Array.from(this.inner()?.knotsDomain());
        }
        else {
            console.warn(`Curve::knots(): Curve is compound. Use specific span to get knots`);
        }
    }

    weights()
    {
        if(!this.isCompound())
        {
            return Array.from((this.inner() as NurbsCurve3DJs)?.weights());
        }
        else {
            console.warn(`Curve::weights(): Curve is compound. Use specific span to get weights`);
        }
    }

    //// CALCULATED PROPERTIES ////
    /*
        NOTES:
            - We use getter this.inner() to have error checking if _curve is undefined
    */

    isClosed(): boolean
    {
        return this.inner()?.closed() ?? false;
    }

    isPlanar(): boolean
    {
        if (this._curve instanceof NurbsCurve3DJs) {
            return this._curve.isPlanar();
        }
        // For compound curves, check via getOnPlane
        return this.getOnPlane() !== null;
    }

    /** Get the plane of the Curve as { normal, x, y }.
     *  The local axes are aligned to the closest global axes.
     *  Returns null if the curve is not planar.
     */
    getOnPlane(tolerance: number = 1e-6): { normal: Vector, x: Vector, y: Vector } | null
    {
        if (this._curve instanceof NurbsCurve3DJs) {
            const result = this._curve.getOnPlane(tolerance);
            if (!result || result.length === 0) return null;
            return {
                normal: new Vector(result[0].x, result[0].y, result[0].z),
                x: new Vector(result[1].x, result[1].y, result[1].z),
                y: new Vector(result[2].x, result[2].y, result[2].z),
            };
        }

        // For compound curves: check each span's plane
        if (this._curve instanceof CompoundCurve3DJs) {
            const spans = this._curve.spans();
            if (!spans || spans.length === 0) return null;
            const firstResult = spans[0].getOnPlane(tolerance);
            if (!firstResult || firstResult.length === 0) return null;
            // Verify all spans share the same plane
            for (let i = 1; i < spans.length; i++) {
                const r = spans[i].getOnPlane(tolerance);
                if (!r || r.length === 0) return null;
            }
            return {
                normal: new Vector(firstResult[0].x, firstResult[0].y, firstResult[0].z),
                x: new Vector(firstResult[1].x, firstResult[1].y, firstResult[1].z),
                y: new Vector(firstResult[2].x, firstResult[2].y, firstResult[2].z),
            };
        }

        return null;
    }

    length(): number
    {
        return this.inner().length(); 
    }
    
    degree(): number|null
    {
        if(!this.isCompound())
        {
            return (this.inner() as NurbsCurve3DJs)?.degree();
        }
        else {
            console.warn(`Curve::degree(): Curve is compound. Use specific span to get degree`);
            return null;
        }
    }

    paramAtLength(length: number): number|null
    {
        if(!this.isCompound())
        {
            return (this.inner() as NurbsCurve3DJs)?.paramAtLength(length);
        }
        else {
            console.warn(`Curve::paramAtLength(): Curve is compound. Use specific span to get parameter at length`);
            return null;
        }
            
    }

    paramClosestToPoint(point: PointLike): number|null
    {
        try
        {
            return this.inner()?.paramClosestToPoint(new Point(point).toPoint3Js());
        }
        catch (e)
        {
            console.error('Curve::paramClosestToPoint(): Error:', e);
            return null;
        }
    }

    pointAtParam(p: number): Point
    {
        return new Point(
            this.inner().pointAtParam(p));
    }

    pointAtLength(length: number): Point|null
    {
        const param = this.paramAtLength(length);
        if(param === null) { return null; }
        return this.pointAtParam(param);
    }

    /** Get point at given percentage of the curve length */
    pointAtPerc(perc: number): Point|null
    {
        const length = this.length();
        if(length === 0) { return null; }
        return this.pointAtLength(perc * length);
    }

    bbox():undefined|Bbox
    {
        const bboxCoords = this.inner()?.bbox();
        return bboxCoords ? new Bbox(bboxCoords) : undefined;
    }

    tessellate(tol: number = TESSELATION_TOLERANCE): Array<Point>
    {
        return this.inner().tessellate(tol)
            .map(p => Point.from(p));
    }


    //// OPERATIONS ////

    translate(vecOrX: PointLike | number, dy?: number, dz?: number): this
    {
        const vec = (isPointLike(vecOrX)) 
                        ? Point.from(vecOrX) 
                        : Point.from(vecOrX, dy || 0, dz || 0);

        if(!vec){ throw new Error('Curve.translate(): Invalid translation input. Please use PointLike or valid offset coordinates.'); }
        this._curve = this._curve?.translate(vec.toVector3Js());
        return this;
    }

    /** Alias for translate */
    move(vecOrX: PointLike | number, dy?: number, dz?: number): this
    {
        return this.translate(vecOrX, dy, dz);
    }

    /** rotate the given curve for the specified angles (in degrees) per axis */
    rotate(ax: number, ay?: number, az?: number): this
    {
        this._curve = this._curve?.rotate(rad(ax), rad(ay || 0), rad(az || 0));
        return this;
    }

    scale(sx: number, sy: number, sz: number): this
    {
        this._curve = this._curve?.scale(sx, sy, sz);
        return this;
    }

    /** Fillet sharp corner(s) of Curve. Optionally only at given point(s) */
    fillet(radius: number, at?: PointLike|Array<PointLike>): this|null
    {
        const atPoints = (isPointLike(at)) 
                        ? [new Point(at).toPoint3Js()] 
                        : (Array.isArray(at)) 
                            ? at.map(p => new Point(p).toPoint3Js()).filter(p => p) 
                            : null;
        if(!this.isCompound())
        {
            // Any fillet operation results in compound curve
            const compoundCurve = (this.inner() as NurbsCurve3DJs).fillet(radius, atPoints);
            this._curve = compoundCurve; // override inner curve
            return this;
        }
        return null;
    }

    filletAtParams(radius: number, at: Array<number>): this|null
    {
        if(!this.isCompound())
        {
            // Any fillet operation results in compound curve
            const compoundCurve = (this.inner() as NurbsCurve3DJs).filletAtParams(radius, new Float64Array(at));
            this._curve = compoundCurve; // override inner curve
            return this;
        }
        return null;
    }
    

    extend(length: number, side: 'start'|'end'|'both' = 'end'): this
    {
        // Both NurbsCurve3DJs and CompoundCurve3DJs now return CompoundCurve3DJs
        this._curve = this.inner().extend(length, side);
        return this;
    }

    /** Offset a Curve a given amount (+ or -) and optionally provide corner type (default:sharp) */
    offset(distance: number, cornerType:'sharp'|'round'|'smooth'='sharp'): Curve|null
    {
        /* CSGRS/Curvo can only offset curves in 2D, so we need to convert the current
            one (either compound of single) to the 2D version, 
            then offset and turn back into a 3D Curve on TS layer
        */
        if(!this.isPlanar()){ throw new Error(`Curve:offset(): Cannot offset a 3D curve!`);}
        return Curve.fromCsgrs(this.inner()?.offset(distance, cornerType));
    }
    
    
    //// INTERACTION WITH OTHER CURVES ////

    /** Get intersection points with other curve 
     *   Empty array if no intersections, null if error (e.g. invalid curve type)
    */
    intersect(other:Curve):Array<Point>|null
    {
        try 
        {
            return ((this.isCompound())
                ? (!other.isCompound())
                    ? this.inner()?.intersect(other.inner() as NurbsCurve3DJs)
                    : this.inner()?.intersectCompound(other.inner() as CompoundCurve3DJs)
                : (!other.isCompound())
                    ? this.inner()?.intersect(other.inner() as NurbsCurve3DJs)
                    : this.inner()?.intersectCompound(other.inner() as CompoundCurve3DJs)
            || [])
            .map(p => Point.from(p).round()); // round to default Point tolerance to avoid most rounding errors
        } 
        catch (e)
        {
            console.error('Curve::intersect(): Error:', e);
            return null;
        }
    }

    /** Find intersection points between this Curve and a Mesh.
     *  The curve is tessellated into a polyline and each segment is tested
     *  against every triangle of the mesh surface.
     * 
     *  @param mesh - A Mesh instance to test against
     *  @param tolerance - Tessellation tolerance for the curve (default: 1e-4)
     *  @returns Array of intersection Points, in order along the curve. Empty array if none found.
     */
    intersectMesh(mesh: Mesh, tolerance?: number): Array<Point>
    {
        if(!mesh || !(mesh instanceof Mesh))
        {
            throw new Error('Curve::intersectMesh(): Please supply a valid Mesh instance!');
        }

        try
        {
            const meshInner = (mesh as any)._mesh;
            if(!meshInner){ throw new Error('Mesh has no inner WASM object'); }

            const pts = this.isCompound()
                ? meshInner.intersectCompoundCurve(this.inner() as CompoundCurve3DJs, tolerance)
                : meshInner.intersectCurve(this.inner() as NurbsCurve3DJs, tolerance);

            return (pts || []).map((p: any) => Point.from(p));
        }
        catch (e)
        {
            console.error('Curve::intersectMesh(): Error:', e);
            return [];
        }
    }

    //// TRIM & SPLIT ////

    /** Trim the curve to a sub-curve between parameters t0 and t1.
     *  Returns an array of Curves (typically one for inside trim).
     *  Parameters are in the curve's knot domain (see knotsDomain()).
     */
    trim(t0: number, t1: number): Array<Curve>
    {
        try
        {
            const spans: Array<NurbsCurve3DJs> = this.inner()?.trimRange(t0, t1);
            return (spans || []).map(s => Curve.fromCsgrs(s));
        }
        catch (e)
        {
            console.error('Curve::trim(): Error:', e);
            return [];
        }
    }

    /** Split the curve at parameter t, returning [left, right]. 
     *  Parameter t must be within the curve's knot domain.
     */
    split(t: number): [Curve, Curve] | null
    {
        try 
        {
            const parts = this.inner()?.split(t);
            if(!parts || parts.length < 2) return null;
            return [Curve.fromCsgrs(parts[0]), Curve.fromCsgrs(parts[1])];
        }
        catch (e)
        {
            console.error('Curve::split(): Error:', e);
            return null;
        }
    }

    /** Intersect this Curve with a Mesh and return the trimmed sub-curve(s)
     *  that lie inside the mesh volume. If the curve doesn't intersect
     *  the mesh, returns an empty array.
     *
     *  With an even number of intersections the curve alternates
     *  between outside and inside the mesh. The "inside" segments are returned.
     *  With two intersection points, a single trimmed curve is returned.
     *
     *  @param mesh - The Mesh to intersect with
     *  @param tolerance - Tessellation tolerance for finding intersections (default: 1e-4)
     *  @returns Array of Curve segments that lie inside the mesh
     */
    intersection(mesh: Mesh, tolerance?: number): Array<Curve>
    {
        if(!mesh || !(mesh instanceof Mesh))
        {
            throw new Error('Curve::intersection(): Please supply a valid Mesh instance!');
        }

        // Find intersection points
        const hitPoints = this.intersectMesh(mesh, tolerance);
        if(hitPoints.length < 2)
        {
            // 0 hits = curve is either entirely inside or entirely outside
            // 1 hit = tangent touch, no enclosed segment
            return [];
        }

        // Map each intersection point to a curve parameter
        const params: Array<number> = [];
        for(const pt of hitPoints)
        {
            const p = this.paramClosestToPoint(pt);
            if(p !== null) params.push(p);
        }
        params.sort((a, b) => a - b);

        if(params.length < 2) return [];

        // Determine which segments are inside: 
        //    test the midpoint of each consecutive pair
        const results: Array<Curve> = [];
        const meshInner = (mesh as any)._mesh;

        for(let i = 0; i < params.length - 1; i++)
        {
            const t0 = params[i];
            const t1 = params[i + 1];
            const tMid = (t0 + t1) / 2;
            const midPoint = this.pointAtParam(tMid);

            // Check if the midpoint is inside the mesh
            if(meshInner?.containsVertex(midPoint.toPoint3Js()))
            {
                const trimmed = this.trim(t0, t1);
                results.push(...trimmed);
            }
        }

        return results;
    }

    //// TRANSFORMATION TO OTHER TYPES ////

    toMesh(tolerance: number = TESSELATION_TOLERANCE): Mesh
    {
        const points = this.tessellate(tolerance);
        return Mesh.fromPoints(points);
    }
    

    //// OUTPUTS ////

    /**
     * Build the raw geometry buffer for this curve, ready to be embedded in a GLTF document.
     * Returns all pieces needed to assemble one GLTF primitive so that multiple curves can be
     * combined into a single GLTF later.
     */
    toGLTFBuffer(up: Axis = 'z'): GLTFBuffer
    {
        const points = this.tessellate();
        const pointsFlat = new Float32Array(
            points
                .map(p => {
                    const arr = p.toArray();
                    if (up === 'z')
                    {
                        return [arr[0], arr[2], -arr[1]];
                    }
                    else if (up === 'x')
                    {
                        return [arr[1], arr[0], arr[2]];
                    }
                    else {
                        // GLTF is Y-up
                        return [arr[0], arr[2], arr[1]];
                    }
                })
                .flat() as Array<number>
        );

        if (pointsFlat.length < 3)
        {
            throw new Error(`Curve::toGLTFBuffer(): Not enough vertices to export!`);
        }

        const bbox = this.bbox();

        return {
            data: toBase64(pointsFlat),
            byteLength: pointsFlat.byteLength,
            count: points.length,
            min: bbox?.min,
            max: bbox?.max,
        };
    }

    /** Serialize this curve as a self-contained GLTF JSON string (LINE_STRIP). */
    toGLTF(up: Axis = 'z'): string
    {
        const buf = this.toGLTFBuffer(up);

        const gltf = {
            asset: { version: "2.0" },
            scenes: [{ nodes: [0] }],
            nodes: [{ mesh: 0 }],
            meshes: [{
                primitives: [{
                    attributes: { POSITION: 0 },
                    mode: 3 // LINE_STRIP
                }]
            }],
            accessors: [{
                bufferView: 0,
                byteOffset: 0,
                componentType: 5126, // FLOAT
                count: buf.count,
                type: "VEC3",
                max: buf.max,
                min: buf.min,
            }],
            bufferViews: [{
                buffer: 0,
                byteOffset: 0,
                byteLength: buf.byteLength,
                target: 34962 // ARRAY_BUFFER
            }],
            buffers: [{
                byteLength: buf.byteLength,
                uri: `data:application/octet-stream;base64,${buf.data}`
            }]
        };

        return JSON.stringify(gltf);
    }

}   