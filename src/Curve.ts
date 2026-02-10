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

import { getCsgrs } from './index';
import type { CsgrsModule, PointLike, Axis } from './types';
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

    isCompound(): this is CompoundCurve3DJs
    {
        return this._curve instanceof CompoundCurve3DJs;
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

    static fromCsgrs(curve: NurbsCurve3DJs): Curve
    {
        if(!curve) { throw new Error('Curve::fromCsgrs(): Invalid curve'); }
        const newCurve = new Curve();
        newCurve._curve = curve;
        return newCurve;
    }

    /** Make a polyline curve with corners given by control points
     *  IMPORTANT: Controlpoints have a weight component too! 
     *     So 2D Curves use 3D control points, and 3D curves 4D points 
    */
    static Polyline(controlPoints: PointLike[]): Curve
    {
        return this.fromCsgrs(
            getCsgrs()?.NurbsCurve3DJs?.makePolyline(
                controlPoints.map(p => new Point(p).toPoint3Js()),
                true,
            )
        );
    }

    /** Make a NURBS curve by interpolating through given points */
    static Interpolated(controlPoints: PointLike[], degree: number = 3): Curve
    {
        return this.fromCsgrs(
            getCsgrs()?.NurbsCurve3DJs?.makeInterpolated(
                controlPoints.map(p => new Point(p).toPoint3Js()),
                degree,
            )
        );
    }

    //// PROPERTIES ////

    /** Get control points of Curve */
    controlPoints(): Array<Point>
    {
        return this.inner()
                ?.controlPoints()
                ?.map(p => Point.from(p));
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

    knotsDomain():Array<number|number>
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
            return Array.from(this.inner()?.weights());
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
        if(!this.isCompound())
        {
            return (this.inner() as NurbsCurve3DJs)?.paramClosestToPoint(new Point(point).toPoint3Js());
        }
        else {
            console.warn(`Curve::paramClosestToPoint(): Curve is compound. Use specific span to get parameter closest to point`);
            return null;
        }
    }

    pointAtParam(p: number): Point
    {
        return new Point(
            this.inner().pointAtParam(p));
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

    extend(length: number): this|null
    {
        // TODO    
    }

    offset(distance: number, cornerType:'sharp'|'round'|'smooth'='sharp'): this|null
    {
        /* CSGRS/Curvo can only offset curves in 2D, so we need to convert the current
            one (either compound of single) to the 2D version, 
            then offset and turn back into a 3D Curve on TS layer
        */

        if(!this.isPlanar()){ throw new Error(`Curve:offset(): Cannot offset a 3D curve!`);}

        if(!this.isCompound())
        {
            console.log('==== HIERO ===');
            this._curve = (this.inner() as NurbsCurve3DJs).offset(distance, cornerType);
            return this;
        }
        else {
            console.log('Curve::offset(): Compound curve not implemented');
        }
        

    }
    
    //// TRANSFORMS ////

    

    //// EXPORTS ////

    toGLTF(up:Axis='z')
    {
        const points = this.tessellate(); // use default tolerance
        const pointsFlat = new Float32Array(
            points
                .map(p => {
                    const arr = p.toArray();
                    if(up === 'z')
                    {
                        return [arr[0], arr[2], -arr[1]];
                    }
                    else if(up === 'x')
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
 
        if(pointsFlat.length < 3)
        { 
            throw new Error(`Curve::toGLTF(): Not enough vertices to export!`);
        }
        
        const bbox = this.bbox();
        const dataBase64 = toBase64(pointsFlat);

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
                count: points.length,
                type: "VEC3",
                max: bbox?.max.toArray(),
                min: bbox?.min.toArray()
            }],
            bufferViews: [{
                buffer: 0,
                byteOffset: 0,
                byteLength: pointsFlat.byteLength,
                target: 34962 // ARRAY_BUFFER
            }],
            buffers: [{
                byteLength: pointsFlat.byteLength,
                uri: `data:application/octet-stream;base64,${dataBase64}`
            }]
        };

        return JSON.stringify(gltf);

    }

}   