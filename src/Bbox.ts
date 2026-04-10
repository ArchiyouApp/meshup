import { Point3Js, PlaneJs } from './wasm/csgrs.js';

import { Point } from './Point';
import { Mesh } from './Mesh';
import type { PointLike, Axis } from './types';
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

    //// AXIS ACCESSORS ////

    minX(): number { return this._min.x }
    minY(): number { return this._min.y }
    minZ(): number { return this._min.z }
    maxX(): number { return this._max.x }
    maxY(): number { return this._max.y }
    maxZ(): number { return this._max.z }

    minAtAxis(axis: Axis): number { return this._min[axis] }
    maxAtAxis(axis: Axis): number { return this._max[axis] }

    /** Size (extent) along a single axis */
    sizeAlongAxis(axis: Axis): number
    {
        return this._max[axis] - this._min[axis];
    }

    /** Returns the axis that has zero extent in a 2D bbox, or null for 3D bboxes */
    axisMissingIn2D(): Axis | null
    {
        if (this.height() === 0) return 'z';
        if (this.depth()  === 0) return 'y';
        if (this.width()  === 0) return 'x';
        return null;
    }

    /** Returns a new Bbox expanded by margin on all sides */
    enlarged(margin: number): Bbox
    {
        return new Bbox(
            new Point(this._min.x - margin, this._min.y - margin, this._min.z - margin),
            new Point(this._max.x + margin, this._max.y + margin, this._max.z + margin),
        );
    }

    /** Returns true if the given point is inside (or on the boundary of) this bbox */
    containsPoint(p: PointLike): boolean
    {
        const pt = new Point(p);
        return pt.x >= this._min.x && pt.x <= this._max.x
            && pt.y >= this._min.y && pt.y <= this._max.y
            && pt.z >= this._min.z && pt.z <= this._max.z;
    }

    /** Returns true if the given Bbox is fully inside this bbox */
    containsBbox(other: Bbox): boolean
    {
        return other._min.x >= this._min.x && other._max.x <= this._max.x
            && other._min.y >= this._min.y && other._max.y <= this._max.y
            && other._min.z >= this._min.z && other._max.z <= this._max.z;
    }

    /** General contains check: accepts a Bbox, PointLike, or a shape with a bbox() method
     *  TODO: extend when shape types are more fully defined
     */
    contains(v: Bbox | PointLike | any): boolean
    {
        if (v instanceof Bbox) return this.containsBbox(v);
        if (isPointLike(v)) return this.containsPoint(v);
        if (typeof v?.bbox === 'function') return this.containsBbox(v.bbox());
        return false;
    }

    //// AXIS QUERIES ////

    /** Returns the axes that have non-zero extent */
    hasAxes(): Array<Axis>
    {
        const axes: Array<Axis> = [];
        if (this.width()  > 0) axes.push('x');
        if (this.depth()  > 0) axes.push('y');
        if (this.height() > 0) axes.push('z');
        return axes;
    }

    /** Returns the axis with the largest extent */
    maxSizAxis(): Axis
    {
        const w = this.width(), d = this.depth(), h = this.height();
        if (w >= d && w >= h) return 'x';
        if (d >= w && d >= h) return 'y';
        return 'z';
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

    //// SHAPE REPRESENTATIONS ////
    // NOTE: These return `any` to avoid a circular dependency (Curve imports Bbox).
    //       Implement properly once a shape factory / dependency-inversion is in place.

    /** Returns a rectangular Curve outline of this bbox on the XY plane
     *  TODO: implement via shape factory to avoid Curve→Bbox circular dep
     */
    rect(): any
    {
        throw new Error('Bbox.rect(): not yet implemented — requires Curve factory');
    }

    /** Returns the back edge of this bbox as a Curve (max-Y side)
     *  TODO: implement via shape factory
     */
    back(): any
    {
        throw new Error('Bbox.back(): not yet implemented — requires Curve factory');
    }

    /** Returns the left edge of this bbox as a Curve (min-X side)
     *  TODO: implement via shape factory
     */
    left(): any
    {
        throw new Error('Bbox.left(): not yet implemented — requires Curve factory');
    }

    /** Returns the edge or vertex at the given named side of the bbox (e.g. 'bottomfront')
     *  TODO: implement via shape factory
     */
    getSidesShape(_alignment: string): any
    {
        throw new Error('Bbox.getSidesShape(): not yet implemented — requires Curve factory');
    }

}