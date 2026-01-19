/**
 *  Curve.ts
 *  - Has some abstractions specialized for TS/JS usage.
 * 
 */

import { NurbsCurve2DJs, Point2Js } from "./wasm/csgrs";

import { getCsgrs } from './index';
import type { CsgrsModule, PointLike } from './types';
import { Point } from './Point';


export class Curve
{
    _curve: NurbsCurve2DJs|undefined = undefined;

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

    get curve(): NurbsCurve2DJs
    {
        if (!this._curve)
        {
            throw new Error('Curve::curve(): Curve not initialized');
        }
        return this._curve;
    }

    //// CREATION ////
    /*
        We use factory methods for it's clean syntax
    */

    static fromCsgrs(curve: NurbsCurve2DJs): Curve
    {
        if(!curve) { throw new Error('Curve::fromCsgrs(): Invalid curve'); }
        const newCurve = new Curve();
        newCurve._curve = curve;
        return newCurve;
    }

    /** Make a polyline curve with corners given by control points */
    static makePolyline(controlPoints: PointLike[]): Curve
    {
        console.log('makePolyline called with points:', controlPoints);
        console.log(getCsgrs());
        console.log(getCsgrs()?.NurbsCurve2DJs);
        console.log(Object.keys(getCsgrs()?.NurbsCurve2DJs));

        return this.fromCsgrs(
            getCsgrs()?.NurbsCurve2DJs?.makePolyline(
                controlPoints.map(p => new Point(p).toPoint2Js()),
                true,
            )
        );
    }

    /** Make a NURBS curve by interpolating through given points */
    static makeInterpolated(controlPoints: PointLike[], degree: number = 3): Curve
    {
        return this.fromCsgrs(
            getCsgrs()?.NurbsCurve2DJs?.makeInterpolated(
                controlPoints.map(p => new Point(p).toPoint2Js()),
                degree,
            )
        );
    }

    //// CALCULATED PROPERTIES ////
    /*
        NOTES:
            - We use getter this.curve to have error checking if _curve is undefined
    */

    public length(): number
    {
        return this.curve.length(); 
    }
    
    public degree(): number
    {
        return this.curve.degree(); 
    }

    public paramAtLength(length: number): number
    {
        return this.curve.paramAtLength(length);
    }

    public paramClosestToPoint(point: PointLike): number
    {
        return this.curve
            .paramClosestToPoint(
                new Point(point).toPoint2Js());
    }

    public pointAtParam(p: number): Point
    {
        return new Point(
            this.curve.pointAtParam(p));
    }


}   