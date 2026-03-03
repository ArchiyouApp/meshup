/**
 *  
 *    Sketch.ts
 * 
 *      A sketch is a collection of 2D curves that form the base for further 3D operations
 *      
 *      Features:
 * 
 *      - Different ways to define next coordinates in relation to the current cursor point:
 *           - absolute: .lineTo(x,y)
 *           - relative: .lineTo('+dx','-dy')
 *           - polar: .lineTo('r<angle') // or compatible with autocad
 *           - polar relative: .lineTo('r<<angle')
 * 
 *      - Draw on standard planes (xy, yz, zx) or custom plane defined by normal vector and origin point:
 *          Sketch('xy') // standard plane
 *          Sketch('yz')
 *          Sketch('zx')
 *          Sketch(normalVector, originPoint) // custom plane
 *          Sketch(Polygon) // plane defined by polygon contour
 *              
 *      - Create contours from basic non-closed curves:
 *              Sketch('xy')
 *                  .moveTo(x,y)
 *                  .lineTo(x,y)
 *                  .arcTo(mid, end)
 *                  .splineTo(p1,p2,p3)
 *      
 *      - Combine closed curves into a single sketch with (automatic) booleans:
 *            Sketch('xy')
 *                  .lineTo(x1,y1)
 *                  .lineTo(x2,y2) 
 *                  .lineTo(x3,y3)
 *                  .close() // closes the contour by adding extra line where needed
 * 
 *            Sketch()
 *                 .rectTo(100,100) // outer contour
 *                  // because shapes are inside the previous one, this will be subtracted from the first rectangle
 *                 .circle(10).at(0.5, 0.5) // add circular hole at center of the (bbox of) rectangle
 *                 .circle(5).at(10, 10) // add circular hole at absolute coordinates
 *                  // because shapes are outside/overlap the previous one, this will be added to the first rectangle
 *                  .rect(10,10).pivot(1,1).at(0,1) // add small rectangle at top right corner of the first rectangle
 *                 
 *      - Tag shapes for use in later operations [TODO]:
 *          Sketch('xy')
 *              .rect(100,100).tag('base') // tag the first rectangle as 'base'
 *              .circle(this.base).width()*0.5)
 *  
 *      - Import SVG paths [TODO]:
 *          Sketch('xy')
 *              .loadSvg('shape.svg').scale(0.1).at(50,50)
 * 
 * 
 */

import { PolygonJs } from "./wasm/csgrs";

import { Vector } from "./Vector";
import { Point } from "./Point";
import { CurveCollection } from "./CurveCollection";


import type { BasePlane, PointLike } from "./types";
import { isBasePlane } from "./types";

import { BASE_PLANE_NAME_TO_PLANE } from "./constants";



export class Sketch  
{
    declare _origin: Point; // origin point of the Sketch plane in world coordinates
    declare _normal: Vector; // normal vector of the Sketch plane in world coordinates
    declare _xDir: Vector; // direction of the X axis of the Sketch plane in world coordinates
    declare _yDir: Vector; // direction of the Y axis of the Sketch plane in world coordinates

    declare _curves: CurveCollection;

    constructor(plane: BasePlane|PolygonJs = 'xy')
    {
        this._setWorkingPlane(plane);
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



}