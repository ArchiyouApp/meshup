import { Point3Js, PlaneJs } from './wasm/csgrs.js';

import { Point } from './Point';
import { Mesh } from './Mesh';
import type { PointLike } from './types';
import { isPointLike } from './types';

/** Axis-aligned Bounding Box */
export class Bbox
{
    private _min: Point;
    private _max: Point;

    constructor(min: PointLike|Array<PointLike>, max?: PointLike)
    {
        if(isPointLike(min) && isPointLike(max))
        {
            this._min = new Point(min);
            this._max = new Point(max);
        }
        else if(Array.isArray(min) && min.length === 2 && isPointLike(min[0]) && isPointLike(min[1]))
        {
            this._min = new Point(min[0]);
            this._max = new Point(min[1]);
        }
        else
        {
            throw new Error('Bbox::constructor(): Invalid parameters. Please supply (min:PointLike, max:PointLike) or ([min:PointLike, max:PointLike])');
        }
    }

    static fromMesh(m:Mesh): Bbox
    {
        const bbox = m?._mesh?.boundingBox();
        if (!bbox)
        {
            throw new Error('Mesh has no bounding box.');
        }
        return new Bbox(bbox.min, bbox.max);
    }

    //// CALCULATED PROPERTIES ////

    min(): Point
    {
        return this._min;
    }

    max(): Point
    {
        return this._max;
    }

    center(): Point
    {
        return new Point(
            (this._min.x + this._max.x) / 2,
            (this._min.y + this._max.y) / 2,
            (this._min.z + this._max.z) / 2,
        );
    }

    /** Get corner (or edge/face midpoint) of a 2D/3D bbox.
     *  Combine any of: left, right, top, bottom, front, back — in any order.
     *  Unspecified axes default to the centre of that axis.
     *  For flat XY bboxes (height = 0): top/back and bottom/front are aliases for max-Y and min-Y.
     *  For 3D bboxes: top/bottom refer to Z, front/back refer to Y.
     *
     *  @example
     *    bbox.corner('topleft')       // 2D: max-Y, min-X
     *    bbox.corner('lefttop')       // same — order doesn't matter
     *    bbox.corner('topleftfront')  // 3D: max-Z, min-X, min-Y
     *    bbox.corner('left')          // midpoint of the left face
     */
    corner(where: string): Point
    {
        const s = where.toLowerCase();

        const hasLeft   = s.includes('left');
        const hasRight  = s.includes('right');
        const hasTop    = s.includes('top');
        const hasBottom = s.includes('bottom');
        const hasFront  = s.includes('front');
        const hasBack   = s.includes('back');

        if (hasLeft   && hasRight)  throw new Error(`Bbox.corner(): conflicting keywords 'left' and 'right' in "${where}"`);
        if (hasTop    && hasBottom) throw new Error(`Bbox.corner(): conflicting keywords 'top' and 'bottom' in "${where}"`);
        if (hasFront  && hasBack)   throw new Error(`Bbox.corner(): conflicting keywords 'front' and 'back' in "${where}"`);

        const cx = (this._min.x + this._max.x) / 2;
        const cy = (this._min.y + this._max.y) / 2;
        const cz = (this._min.z + this._max.z) / 2;

        const x = hasLeft  ? this._min.x : hasRight ? this._max.x : cx;

        // For flat XY bboxes (height = 0), top/bottom address Y; front/back are ignored.
        // For 3D bboxes, top/bottom address Z, front/back address Y.
        const isXYPlane = this.height() === 0;
        let y: number, z: number;

        if (isXYPlane)
        {
            // In 2D (XY plane): front = bottom (min Y), back = top (max Y)
            if ((hasTop || hasBack) && (hasBottom || hasFront))
                throw new Error(`Bbox.corner(): conflicting Y-axis keywords in 2D bbox in "${where}"`);
            y = (hasTop || hasBack) ? this._max.y : (hasBottom || hasFront) ? this._min.y : cy;
            z = this._min.z;
        }
        else
        {
            y = hasFront  ? this._min.y : hasBack   ? this._max.y : cy;
            z = hasTop    ? this._max.z : hasBottom ? this._min.z : cz;
        }

        return new Point(x, y, z);
    }

    /** Get size of current bbox along the 3 axis */
    size(): Point3Js
    {
        return new Point3Js(
            this._max.x - this._min.x,
            this._max.y - this._min.y,
            this._max.z - this._min.z,
        );
    }

    width(): number
    {
        return this._max.x - this._min.x;
    }

    depth(): number
    {
        return this._max.y - this._min.y;
    }

    height(): number
    {
        return this._max.z - this._min.z;
    }

    is1D():boolean
    {
        const dims = [this.width(), this.depth(), this.height()].filter(d => d > 0);
        return dims.length === 1;
    }
    
    is2D():boolean
    {
        return this.height() === 0 || this.depth() === 0 || this.width() === 0;
    }

    is3D():boolean
    {
        return this.height() > 0 && this.depth() > 0 && this.width() > 0;
    }

    /** Get Shape representation of current Bbox */
    /*
    shape():Mesh|PlaneJs|Point3Js
    {
        if (this.is3D())
        {
            return new Mesh(this);
        }
        
    }
    */

}