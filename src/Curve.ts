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

import { NurbsCurve3DJs } from "./wasm/csgrs";

import { getCsgrs } from './index';
import type { CsgrsModule, PointLike, Axis } from './types';
import { Point } from './Point';
import { Bbox } from './Bbox';

import { toBase64 } from "./utils";


export class Curve
{
    _curve: NurbsCurve3DJs|undefined = undefined;

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
    internalCurve(): NurbsCurve3DJs
    {
        if (!this._curve)
        {
            throw new Error('Curve::internalCurve(): Curve not initialized');
        }
        return this._curve;
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
        return this.internalCurve()
                ?.controlPoints()
                ?.map(p => Point.from(p));
    }

    knots()
    {
        return this.internalCurve()?.knots();
    }

    weights()
    {
        return this.internalCurve()?.weights();
    }

    //// CALCULATED PROPERTIES ////
    /*
        NOTES:
            - We use getter this.internalCurve() to have error checking if _curve is undefined
    */

    length(): number
    {
        return this.internalCurve().length(); 
    }
    
    degree(): number
    {
        return this.internalCurve().degree(); 
    }

    paramAtLength(length: number): number
    {
        return this.internalCurve().paramAtLength(length);
    }

    paramClosestToPoint(point: PointLike): number
    {
        return this.internalCurve()
            .paramClosestToPoint(
                new Point(point).toPoint3Js());
    }

    pointAtParam(p: number): Point
    {
        return new Point(
            this.internalCurve().pointAtParam(p));
    }

    bbox():undefined|Bbox
    {
        const bboxCoords = this.internalCurve()?.bbox();
        return bboxCoords ? new Bbox(bboxCoords) : undefined;
    }

    tessellate(tol: number = 1): Array<Point>
    {
        return this.internalCurve().tessellate(tol)
            .map(p => Point.from(p));
    }

    //// EXPORTS ////

    toGLTF(up:Axis='z')
    {
        const points = this.tessellate(1);
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