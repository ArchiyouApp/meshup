import { Point3Js, PlaneJs } from './wasm/meshup.js';

import { Point } from './Point';
import { Vertex } from './Vertex';
import { Polygon } from './Polygon.js';
import { Curve } from './Curve';
import { Mesh } from './Mesh';
import { ShapeCollection } from './ShapeCollection';


import type { PointLike, Axis } from './types';
import { isPointLike } from './types';

import { BASE_PLANE_NAME_TO_PLANE, TOLERANCE, BBOX_SIDES, BBOX_FLAT_EPS, BBOX_FLAT_REL_EPS } from './constants';
import { addResultToScene } from './sceneDecorators';


/** Axis-aligned Bounding Box */
export class Bbox
{
    private _min: Point;
    private _max: Point;
    /** The Shape this bbox was measured from — lets box()/rect() land in its scene.
     *  Non-enumerable: a Bbox is compared and serialised by its bounds alone. */
    declare _source: any;

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
        Object.defineProperty(this, '_source', { value: null, writable: true, enumerable: false });
    }

    static fromMesh(m:Mesh): Bbox
    {
        const bbox = m?._mesh?.boundingBox();
        if (!bbox)
        {
            throw new Error('Mesh has no bounding box.');
        }
        return new Bbox(bbox.min, bbox.max)._fromShape(m);
    }

    //// SCENE ////

    /** Tie this bbox to the Shape it was measured from, so the shapes it makes can join that
     *  shape's scene. Fluent and internal — set by the bbox() accessors. */
    _fromShape(shape: any): this
    {
        this._source = shape;
        return this;
    }

    /** Put a shape this bbox just built into the measured shape's scene (no-op when there is
     *  no source, or the source is standalone / tmp()). */
    _attach<T>(shape: T): T
    {
        addResultToScene(this._source, shape);
        return shape;
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
        const isXYPlane = this._isFlatAlong(this.height());
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

    maxSize(): number
    {
        const s = this.size();
        return Math.max(s.x, s.y, s.z);
    }

    /** Smallest of the three bbox dimensions */
    minSize(): number
    {
        const s = this.size();
        return Math.min(s.x, s.y, s.z);
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

    /** Returns the axis that has (near-)zero extent in a 2D bbox, or null for 3D bboxes */
    axisMissingIn2D(): Axis | null
    {
        if (this._isFlatAlong(this.height())) return 'z';
        if (this._isFlatAlong(this.depth())) return 'y';
        if (this._isFlatAlong(this.width())) return 'x';
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

    /** Minimum Euclidean distance between two axis-aligned bounding boxes. */
    distance(other: Bbox): number
    {
        const dx = Math.max(0, other._min.x - this._max.x, this._min.x - other._max.x)
        const dy = Math.max(0, other._min.y - this._max.y, this._min.y - other._max.y)
        const dz = Math.max(0, other._min.z - this._max.z, this._min.z - other._max.z)

        if (dx === 0 && dy === 0 && dz === 0)
        {
            return 0
        }

        return Math.sqrt(dx * dx + dy * dy + dz * dz)
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
    maxSizeAxis(): Axis
    {
        const w = this.width(), d = this.depth(), h = this.height();
        if (w >= d && w >= h) return 'x';
        if (d >= w && d >= h) return 'y';
        return 'z';
    }

    /** Axis of the smallest bbox dimension */
    minSizeAxis(): Axis
    {
        const w = this.width(), d = this.depth(), h = this.height();
        if (w <= d && w <= h) return 'x';
        if (d <= w && d <= h) return 'y';
        return 'z';
    }

    /** Is the bbox flat along this extent?
     *  NOT an exact zero test: a shape rotated onto a plane (layflat(), a lofted face laid
     *  down) keeps float residue — a 100mm part typically lands ~1e-14 thick, and an exact
     *  test would call that a 3D bbox and break every 2D code path downstream.
     *  Scales with the bbox so the check holds for very large models too. */
    private _isFlatAlong(extent: number): boolean
    {
        return extent <= Math.max(BBOX_FLAT_EPS, this.maxSize() * BBOX_FLAT_REL_EPS);
    }

    /** A zero-size bbox: every extent collapsed (what an empty or single-point shape measures) */
    isPoint():boolean
    {
        return [this.width(), this.depth(), this.height()].every(d => this._isFlatAlong(d));
    }

    is1D():boolean
    {
        const dims = [this.width(), this.depth(), this.height()].filter(d => !this._isFlatAlong(d));
        return dims.length === 1;
    }

    is2D():boolean
    {
        return this._isFlatAlong(this.height()) || this._isFlatAlong(this.depth()) || this._isFlatAlong(this.width());
    }

    is3D():boolean
    {
        return !this.is2D();
    }

    //// SHAPE REPRESENTATIONS ////

    /**
     * The real geometry of this bounding box, matching its dimensionality:
     *   - 3D → a box `Mesh`
     *   - 2D → a closed rectangle `Curve` in the plane the bbox is flat in
     *   - 1D → a straight line `Curve` along the bbox' one axis
     *   - a zero-size (point) bbox → a `Vertex` at its centre
     *
     * Mirrors OBbox.shape() (and the brep Bbox), except everything here stays axis-aligned.
     *
     * The result is added to the scene the measured shape lives in (same layer an
     * `@sceneAdd` result would land on). Measured off a standalone or `tmp()` shape it stays
     * out of the scene, as does a bbox built straight from points.
     */
    shape(): Vertex|Curve|Mesh|null
    {
        // vertex()/line()/rect()/box() attach the result themselves
        return this.isPoint() ? this.vertex()
                : this.is1D() ? this.line()
                : this.is2D() ? this.rect()
                : this.box();
    }

    /** Alias for shape() */
    toShape(): Vertex|Curve|Mesh|null
    {
        return this.shape();
    }

    /** A Vertex at the centre of a zero-size bbox. Null when the bbox has any size. */
    vertex(): Vertex|null
    {
        if(!this.isPoint())
        {
            console.warn(`Bbox::vertex(): Bbox has size, so can't turn it into a single Vertex!`);
            return null;
        }
        return this._attach(new Vertex(this.center()));
    }

    /** A straight line Curve along this bbox' one non-flat axis. Null when not 1D. */
    line(): Curve|null
    {
        if(!this.is1D())
        {
            console.warn(`Bbox::line(): Bbox is not 1D, so can't turn it into a single line!`);
            return null;
        }
        return this._attach(Curve.Line(this._min, this._max));
    }

    /** Returns a closed rectangular Curve outline of this (flat) bbox.
     *  The plane is the one the bbox is flat in (XY for a 2D shape on the ground plane).
     *  Returns null for a 3D bbox — use box() for that. */
    rect(): Curve|null
    {
        if(!this.is2D())
        {
            console.warn(`Bbox::rect(): Bbox is not 2D, so can't turn it into a rectangle Curve!`);
            return null;
        }
        const flatAxis = this.axisMissingIn2D();
        const plane = (flatAxis === 'z') ? 'xy' : (flatAxis === 'y') ? 'xz' : 'yz';
        return this._attach(Curve.RectBetween(this._min, this._max, plane));
    }

    /** Generate a box Mesh representation of this bbox.
     *  Added to the scene the measured shape lives in - see _attach(). */
    box(): Mesh
    {
        return this._attach(this._boxRaw());
    }

    /** The box Mesh without any scene bookkeeping - for measuring/derivation inside meshup */
    _boxRaw(): Mesh
    {
        return Mesh.Box(this.width(), this.depth(), this.height())
                .translate(this.center());
    }

    /** get all planes as polygons of this bbox */
    planes(): Array<Polygon>
    {
       return this._boxRaw().polygons().toArray();
    }

    /** Get side face of bbox  
     *  front/back, left/right, top/bottom
     *  NOTE: polygons are converted to Mesh
    */
    getPlane(alignment: string): Polygon|undefined
    {
        const basePlane = BASE_PLANE_NAME_TO_PLANE[alignment.toLowerCase().trim()];        
        if(!basePlane){ throw new Error(`Bbox.getPlane(): Unknown alignment "${alignment}". Use one of: top, bottom, front, back, left, right, xy, yz, xz.`); }
        
        return this.planes().find(pl => {
            return pl.normal().angle(basePlane.normal) < TOLERANCE;
        });
    }
    
    /** Sub-shape at a named side of this bbox, matching the bbox' own dimensionality:
     *  a Polygon for a 3D bbox, the side edge (Curve) for a flat 2D one, a Vertex for a point.
     *  This mirrors the brep Bbox, where side accessors degrade the same way. */
    getSide(side: string): Polygon|Curve|Vertex|undefined
    {
        if(this._isFlatAlong(this.maxSize())){ return new Vertex(this.center()); }
        if(this.is2D()){ return this.getSidesShapes(side, 'edge').first() as Curve|undefined; }
        return this.getPlane(side);
    }

    /** Returns the back side of this bbox (max-Y side) */
    back(): Polygon|Curve|Vertex|undefined
    {
        return this.getSide('back');
    }

    /** Returns the left side of this bbox (min-X side) */
    left(): Polygon|Curve|Vertex|undefined
    {
        return this.getSide('left');
    }

    /** Returns the right side of this bbox (max-X side) */
    right(): Polygon|Curve|Vertex|undefined
    {
        return this.getSide('right');
    }

    /** Returns the top side of this bbox (max-Z side) */
    top(): Polygon|Curve|Vertex|undefined
    {
        return this.getSide('top');
    }

    /** Returns the bottom side of this bbox (min-Z side) */
    bottom(): Polygon|Curve|Vertex|undefined
    {
        return this.getSide('bottom');
    }

    /** Returns the front side of this bbox (min-Y side) */
    front(): Polygon|Curve|Vertex|undefined
    {
        return this.getSide('front');
    }

    /** Returns the face(s), edge(s) or vertex/vertices at the given named side of the bbox.
     *
     *  Selectors are **greedy**: when the alignment underspecifies the requested shape,
     *  every matching subshape is returned. Each side keyword pins one axis to its min/max
     *  bound; the real (non-degenerate) axes that stay loose are either spanned by the
     *  shape (edges span 1, faces span 2) or enumerated over both bounds.
     *
     *  @example
     *    // rect(100,100) — flat XY bbox
     *    bbox.getSidesShapes('left', 'vertex')   // 2 vertices (the two left corners)
     *    bbox.getSidesShapes('front', 'edge')    // 1 edge (the front edge)
     *    // 3D box
     *    bbox.getSidesShapes('top', 'vertex')    // 4 vertices (top face corners)
     *    bbox.getSidesShapes('top', 'edge')      // 4 edges (top face edges)
     *    bbox.getSidesShapes('leftfront', 'vertex') // 2 vertices (the left-front edge ends)
     *
     *   alignments can be any combination of:
     *         top, bottom, front, back, left, right (case-insensitive, order doesn't matter)
    */
    getSidesShapes(alignments: string, type: 'face'|'edge'|'vertex'): ShapeCollection
    {
        const s = alignments.toLowerCase();
        const sides = BBOX_SIDES.filter(k => s.includes(k));

        // Faces are the bbox planes: one per named side, or every plane when unspecified.
        if (type === 'face')
        {
            const planes = (sides.length === 0)
                ? this.planes()
                : sides.map(k => this.getPlane(k)).filter((p): p is Polygon => !!p);
            return new ShapeCollection<Polygon>(planes);
        }

        const mins    = [this._min.x, this._min.y, this._min.z];
        const maxs    = [this._max.x, this._max.y, this._max.z];
        const extents = [this.width(), this.depth(), this.height()];

        // Real axes have extent; degenerate axes (flat/thin bboxes) are always at their single value.
        const realAxes = ([0, 1, 2] as Array<0|1|2>).filter(a => !this._isFlatAlong(extents[a]));

        // Each side keyword pins one axis to its min (false) or max (true) bound.
        // On a flat XY bbox (Z degenerate) top/bottom alias to back/front (Y), matching corner().
        const isXYPlane = this._isFlatAlong(this.height());
        const AXIS_OF: Record<string, 0|1|2> = { left: 0, right: 0, front: 1, back: 1, bottom: 2, top: 2 };
        const MAX_KEYS = new Set(['right', 'back', 'top']);
        const pins = new Map<0|1|2, boolean>();
        sides.forEach(k =>
        {
            const axis = (isXYPlane && (k === 'top' || k === 'bottom')) ? 1 : AXIS_OF[k];
            pins.set(axis, MAX_KEYS.has(k));
        });

        // Freedom of the requested shape: how many real axes it spans (vertex 0, edge 1).
        const freeDim = (type === 'edge') ? 1 : 0;

        // Loose real axes are those not pinned by a keyword: some become the shape's spanning
        // (free) axes, the rest are enumerated over both bounds ("greedy" — select all).
        const loose = realAxes.filter(a => !pins.has(a));
        if (loose.length < freeDim) return new ShapeCollection([]); // can't form this shape here

        // Base coordinate with pinned axes set; loose/degenerate axes default to min.
        const baseFor = (): [number, number, number] =>
        {
            const base: [number, number, number] = [mins[0], mins[1], mins[2]];
            pins.forEach((isMax, a) => { base[a] = isMax ? maxs[a] : mins[a]; });
            return base;
        };

        const results: Array<Vertex | Curve> = [];

        // For every choice of `freeDim` spanning axes out of the loose axes …
        Bbox._combinations(loose, freeDim).forEach(freeAxes =>
        {
            const enumerated = loose.filter(a => !freeAxes.includes(a));
            // … enumerate the remaining loose axes over {min, max}.
            Bbox._boolCombos(enumerated.length).forEach(bits =>
            {
                const base = baseFor();
                enumerated.forEach((a, i) => { base[a] = bits[i] ? maxs[a] : mins[a]; });

                if (type === 'vertex')
                {
                    results.push(new Vertex(base));
                }
                else // edge: a line spanning its single free axis
                {
                    const free = freeAxes[0];
                    const p1 = [...base] as [number, number, number];
                    const p2 = [...base] as [number, number, number];
                    p1[free] = mins[free];
                    p2[free] = maxs[free];
                    results.push(Curve.Line(p1, p2));
                }
            });
        });

        return new ShapeCollection(results);
    }

    /** All ways to pick `k` items from `arr`, preserving order (k=0 → [[]]). */
    private static _combinations<T>(arr: Array<T>, k: number): Array<Array<T>>
    {
        if (k === 0) return [[]];
        if (k > arr.length) return [];
        return arr.flatMap((item, i) =>
            Bbox._combinations(arr.slice(i + 1), k - 1).map(rest => [item, ...rest]));
    }

    /** All 2^n boolean tuples of length n (n=0 → [[]]). */
    private static _boolCombos(n: number): Array<Array<boolean>>
    {
        return Array.from({ length: 1 << n }, (_, mask) =>
            Array.from({ length: n }, (_, bit) => (mask & (1 << bit)) !== 0));
    }

}