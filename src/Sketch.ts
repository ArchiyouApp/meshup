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
 *              TODO
 * 
 * 
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
import { Collection } from "./Collection";


import type { BasePlane, PointLike } from "./types";
import { isBasePlane } from "./types";

import { BASE_PLANE_NAME_TO_PLANE } from "./constants";



export class Sketch  
{
    declare _origin: Point; // origin point of the Sketch plane in world coordinates
    declare _normal: Vector; // normal vector of the Sketch plane in world coordinates
    declare _xDir: Vector; // direction of the X axis of the Sketch plane in world coordinates
    declare _yDir: Vector; // direction of the Y axis of the Sketch plane in world coordinates

    declare _shapes: Collection;

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