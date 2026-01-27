/**
 *  Curve.ts
 *  
 *  Wrapper around the NURBS of csgrs => Curvo
 *  
 *  A BSpline consists of:
 *
 *  - Control Points: the points that define the shape of the curve
 *  - Weights: higher is closer to control point
 *  - Knots / Knot Vector: defines the parameter space
 *
 *  and has: 
 *  - degree: 1 = straight, 2 = quadratic, 3 = cubic
 *  - order: degree + 1
 *
 *  NOTES:
 *    - we always use 3D version, so no 2D curves classes. This for simplicity and consistency.
 * 
 *  TODO:
 *    - Create CompoundCurve3DJs and use for composite curves
 */

import { TESSELATION_TOLERANCE } from './constants';

import { NurbsCurve3DJs, CompoundCurve3DJs } from "./wasm/csgrs";

import { getCsgrs } from './index';
import type { CsgrsModule, PointLike, Axis } from './types';
import { isPointLike } from './types'
import { Point } from './Point';
import { Bbox } from './Bbox';

import { toBase64 } from "./utils";


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

    controlPoints(): Array<Point>
    {
        if(!this.isCompound())
        {
            return this.inner()
                    ?.controlPoints()
                    ?.map(p => Point.from(p));
        } 
        else 
        {
            // TODO
            return []
        }
    }

    knots()
    {
        return this.inner()?.knots();
    }

    weights()
    {
        return this.inner()?.weights();
    }

    //// CALCULATED PROPERTIES ////
    /*
        NOTES:
            - We use getter this.inner() to have error checking if _curve is undefined
    */

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
 
        if(pointsFlat.length < 3){ 
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