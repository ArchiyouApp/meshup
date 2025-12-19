import { Point3Js, PlaneJs } from './wasm/csgrs.js';

import { Point, Mesh } from './internal';
import type { PointLike } from './internal';

/** Axis-aligned Bounding Box */
export class Bbox
{
    min: Point;
    max: Point;

    constructor(min: PointLike, max: PointLike)
    {
        this.min = new Point(min);
        this.max = new Point(max);
    }

    static fromMesh(m:Mesh): Bbox
    {
        const bbox = m?._mesh?.boundingBox();
        if (!bbox) {
            throw new Error('Mesh has no bounding box.');
        }
        return new Bbox(bbox.min, bbox.max);
    }

    //// CALCULATED PROPERTIES ////

    center(): Point
    {
        return new Point(
            (this.min.x + this.max.x) / 2,
            (this.min.y + this.max.y) / 2,
            (this.min.z + this.max.z) / 2,
        );
    }

    /** Get size of current bbox along the 3 axis */
    size(): Point3Js
    {
        return new Point3Js(
            this.max.x - this.min.x,
            this.max.y - this.min.y,
            this.max.z - this.min.z,
        );
    }

    width(): number
    {
        return this.max.x - this.min.x;
    }

    depth(): number
    {
        return this.max.y - this.min.y;
    }

    height(): number
    {
        return this.max.z - this.min.z;
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
    shape():Mesh|PlaneJs|Point3Js
    {
        if (this.is3D())
        {
            return new Mesh(this);
        }
        
    }

}