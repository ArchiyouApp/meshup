/**
 *  Curve.ts
 *
 *  Wrapper around the native hypercurve Curve3DJs (see wasm/curve_js.rs)
 *
 *  A NurbsCurve consists of:
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

import { ANGLE_COMPARE_TOLERANCE, TESSELATION_TOLERANCE, BASE_PLANE_NAME_TO_PLANE } from './constants';

import { Vector3Js, VertexJs, Point3Js, PolygonJs, SketchJs, Curve3DJs } from "./wasm/meshup";

import { ShapeCollection, getCsgrs, Mesh } from './index';
import { Shape } from './Shape';
import type { SceneNode } from './SceneNode';
import type { CsgrsModule, PointLike, Axis, BasePlane } from './types';
import { isPointLike, isBasePlane } from './types'
import { Point } from './Point';
import { Vector } from './Vector';
import { Vertex } from './Vertex';
import { Bbox } from './Bbox';
import { OBbox } from './OBbox';
import { Polygon } from './Polygon';

import { rad } from "./utils";
import { GLTFBuilder } from './GLTFBuilder';
import { Selector } from './Selector';


export class Curve extends Shape
{
    /** Below this length a curve is considered degenerate (zero-length) and rejected. */
    static readonly ZERO_LENGTH_TOLERANCE = 1e-7;

    // inherits: _id, _node, style, metadata from Shape
    /** The curve geometry — a native hypercurve-backed planar 3D curve. */
    _curve: Curve3DJs|undefined = undefined;

    /** Interior hole curves (e.g. from boolean difference where one curve contains the other) */
    private _holes: Array<Curve> = [];

    constructor()
    {
        super();
        // TODO
    }

    // Add a getter that always references the global state
    get _csgrs(): CsgrsModule
    {
        return getCsgrs(); // Always gets the current global instance
    }

    /** Get internal curve with checking */
    inner(): Curve3DJs
    {
        if (!this._curve)
        {
            throw new Error('Curve::inner(): Curve not initialized');
        }

        return this._curve;
    }

    /** Get inner WASM pointer — useful for debugging only. Use id() for stable identity. */
    wasmPtr(): number
    {
        return (this.inner() as any).__wbg_ptr;
    }

    /** Update internal curve */
    update(c:Curve|Curve3DJs): this
    {
        if(c instanceof Curve)
        {
            this._curve = c._curve;
            this._holes = c._holes.map(h => h.copy());
        }
        else if(c instanceof Curve3DJs)
        {
            this._curve = c;
        }
        return this
    }

    /** Get interior hole curves (if any, e.g. from boolean difference creating a hole) */
    holes(): Array<Curve>
    {
        return this._holes;
    }

    /** Check if this curve has interior holes */
    hasHoles(): boolean
    {
        return this._holes.length > 0;
    }

    /** Add an interior hole curve */
    addHole(hole: Curve): this
    {
        this._holes.push(hole);
        return this;
    }

    override copy(): this
    {
        const newCurve = new Curve();
        newCurve._curve = this._curve?.clone();
        newCurve._holes = this._holes.map(h => h.copy());
        newCurve.style.merge(this.style.explicitData() as any);

        // if original shape is tied to scene: add copy too, as sibling
        // TODO: keep this structural and put in Shape
        if (this.node())
        {
            const parent = this.node()?.parent() || this.node(); 
            if (parent)
            {
                parent.addShape(newCurve); // TODO: name with 'copy'
            };
        }

        return newCurve as this;
    }

    /** Replicate this Curve a given number of times and return in a ShapeCollection<Curve> */
    replicate(num: number, transform: (curve: Curve, index: number, prev:Curve|undefined) => Curve): ShapeCollection<Curve>
    {
        const newCurves = new ShapeCollection<Curve>();
        new Array(num).fill(0).map((_, i) => 
        {
            const newCurve = transform(
                                this.copy(), 
                                i, 
                                i > 0 ? newCurves.get(i - 1) : undefined);
            if(newCurve) newCurves.add(newCurve);
        });
        return newCurves;
    }

    /** Arrange copies of this Curve in a 3-D array.
     *  @param sizes   Number of copies along [x, y, z] axes (default [2, 2, 1]).
     *                 Non-integer values are floored; values < 1 map to 1.
     *  @param offsets Distance between copy origins along [x, y, z].
     *                 Defaults to the bbox extent on each axis so copies are placed adjacent.
     *  @returns ShapeCollection<Curve> containing all copies (the original sits at [0,0,0]).
     */
    array(sizes: PointLike = [2, 2, 1], offsets?: PointLike): ShapeCollection<Curve>
    {
        const s = Point.from(sizes);
        const nx = Math.max(1, Math.floor(s.x));
        const ny = Math.max(1, Math.floor(s.y));
        const nz = Math.max(1, Math.floor(s.z));

        const bb = this.bbox();
        const defaultOff = bb ? new Vector(bb.width(), bb.depth(), bb.height()) : new Vector(1, 1, 1);
        const off = offsets ? Vector.from(offsets) : defaultOff;

        const curves = new ShapeCollection<Curve>();
        for (let x = 0; x < nx; x++)
        {
            for (let y = 0; y < ny; y++)
            {
                for (let z = 0; z < nz; z++)
                {
                    const curve = this.copy();
                    curve.translate(x * off.x, y * off.y, z * off.z);
                    curves.add(curve);
                }
            }
        }
        return curves;
    }

    //// CREATION ////
    /*
        We use factory methods for it's clean syntax
    */

    /** Wrap a native hypercurve {@link Curve3DJs} as a meshup `Curve`. */
    static fromCsgrs(curve: Curve3DJs): Curve
    {
        if(!curve) { throw new Error('Curve::fromCsgrs(): Invalid curve'); }
        const newCurve = new Curve();
        newCurve._curve = curve;
        return newCurve;
    }

    /** Alias of {@link fromCsgrs}: the internal representation is now `Curve3DJs`. */
    static fromCurve3D(c: Curve3DJs): Curve
    {
        return Curve.fromCsgrs(c);
    }

    /** Convert a csgrs `SketchJs` (2-D geometry) into meshup `Curve`s.
     *
     *  Each ring from `SketchJs.rings()` becomes one polyline `Curve` on the XY
     *  plane (z = 0). Polygon exteriors and holes come back as separate
     *  `closed: true` rings; LineStrings/Lines as `closed: false`. Degenerate
     *  rings are skipped.
     *
     *  This is the inverse of {@link Sketch._toSketchJs} and the bridge the
     *  {@link Importer} uses for SVG / GeoJSON / DXF import.
     *
     *  NOTE: rings are returned as a flat collection — hole↔exterior nesting is
     *  not reconstructed, and source styling (SVG colors etc.) is not carried by
     *  `rings()` and is therefore dropped.
     */
    static fromSketchJs(sketch: SketchJs): ShapeCollection<Curve>
    {
        if(!sketch) { throw new Error('Curve::fromSketchJs(): Invalid SketchJs'); }

        const rings = Mesh._extractSketchRings(sketch); // { points:[[x,y]...], closed }[]
        const curves = new ShapeCollection<Curve>();

        rings.forEach((ring) =>
        {
            if(!ring.points || ring.points.length < 2) { return; } // need at least 2 points
            const pts: Array<[number, number, number]> = ring.points.map(([x, y]) => [x, y, 0]);

            // Defensively close a ring flagged closed whose endpoints don't coincide
            // (geo exteriors already repeat the first point, so this is usually a no-op).
            if(ring.closed)
            {
                const [fx, fy, fz] = pts[0];
                const [lx, ly, lz] = pts[pts.length - 1];
                if(Math.hypot(fx - lx, fy - ly, fz - lz) > Curve.ZERO_LENGTH_TOLERANCE)
                {
                    pts.push([fx, fy, fz]);
                }
            }

            try { curves.add(Curve.Polyline(pts)); }
            catch(e){ console.warn('Curve.fromSketchJs(): skipped a degenerate ring:', (e as Error)?.message); }
        });

        return curves;
    }

    static Line(start: PointLike, end: PointLike): Curve
    {
        if(!isPointLike(start) || !isPointLike(end)){ throw new Error('Curve.Line(): Invalid start or end point. Please supply a PointLike: [x,y], [x,y,z], Point, Vector etc'); }
        const startPt = Point.from(start);
        const endPt = Point.from(end);
        if(startPt.distance(endPt) < Curve.ZERO_LENGTH_TOLERANCE)
        {
            throw new Error(`Curve.Line(): Cannot create a zero-length line — start and end are the same point (${startPt.toString()}). Please supply two distinct points.`);
        }
        return this.Polyline([startPt, endPt]); // We can use polyline here
    }

    /** Make a polyline curve with corners given by control points */
    static Polyline(controlPoints: PointLike|Array<PointLike>, ...args: Array<PointLike>): Curve
    {
        if(!isPointLike(controlPoints) && !(Array.isArray(controlPoints) && controlPoints.every(isPointLike)))
        {
            throw new Error('Curve.Polyline(): Invalid control points. Please supply PointLike(s) as arguments or an array of PointLike.');
        }

        // For flat args: Curve.Polyline(p1,p2,p3)
        if(isPointLike(controlPoints))
        {
            controlPoints = [controlPoints, ...(args?.filter(p => isPointLike(p)) || [])];
        }
        else
        {
            controlPoints = controlPoints as Array<PointLike>; // already in correct format
        }

        // Reject degenerate input that would produce a zero-length curve: fewer than two
        // points, or all points coincident (cumulative path length ~ 0).
        const points = (controlPoints as Array<PointLike>).map(p => Point.from(p));
        const totalLength = points.reduce((sum, p, i) => i === 0 ? 0 : sum + points[i - 1].distance(p), 0);
        if(points.length < 2 || totalLength < Curve.ZERO_LENGTH_TOLERANCE)
        {
            throw new Error(`Curve.Polyline(): Cannot create a zero-length curve — the ${points.length} supplied point(s) are coincident (e.g. ${points[0]?.toString()}). Please supply at least two distinct points.`);
        }

        // A polyline is closed when its last point returns to the first (e.g. rings
        // from SketchJs / boolean results); otherwise it is an open path.
        const closed = points.length > 2
            && points[0].distance(points[points.length - 1]) < Curve.ZERO_LENGTH_TOLERANCE;
        return Curve.fromCsgrs(
            getCsgrs()?.Curve3DJs?.makePolyline(
                points.map(p => p.toPoint3Js()),
                closed,
            )
        );
    }

    /** Make a NURBS curve by interpolating through given points */
    static Interpolated(...args: Array<PointLike|Array<PointLike>>): Curve
    {
        // arguments can be flat [p1, p2, p3] or all in first args [[p1, p2, p3]]
        const controlPoints = (args.length === 1 && Array.isArray(args[0]) && args[0].some(isPointLike))
                                ? args[0].filter(isPointLike).map(p => Point.from(p)) // BEWARE: one coord can be a PointLike move(10) → [10,0,0]
                                : args.filter(isPointLike).map(p => Point.from(p));
                                
        if(controlPoints.length < 3)
        {
            throw new Error(`Curve.Interpolated(): At least 3 control points are required. Got: ${controlPoints.length}: ${controlPoints.map(p => p.toString()).join(', ')}. Please supply PointLikes (p1,p2,p3) or [p1,p2,p3].`);
        }

        return Curve.fromCsgrs(
            getCsgrs()
                ?.Curve3DJs?.makeInterpolated(
                        controlPoints.map(p => new Point(p).toPoint3Js()),
                        3,
            )
        );
    }

    static Circle(radius:number = 50, center:PointLike = [0,0,0], normal:PointLike = [0,0,1]): Curve
    {
        if(!isPointLike(center) || typeof radius !== 'number' || !isPointLike(normal))
        { 
            throw new Error('Curve.Circle(): Invalid center, radius, or normal. Please supply a PointLike for center and normal, and a number for radius.');
        }

        return Curve.fromCsgrs(
                getCsgrs()
                    ?.Curve3DJs?.makeCircle(
                        radius,
                        Point.from(center).toPoint3Js(),
                        Point.from(normal).toVector3Js()
                    )
                );
        
    }
    /** Build an arc (a portion of a circle).
     *
     *  Two methods are available:
     *
     *  - `'threepoint': `start`, `mid`, `end` are three points on the arc.
     *     The three points must not be collinear.
     *
     *  - `'tangent'`: `start` is the start point, `mid` is the tangent direction at start,
     *     and `end` is the end point. The tangent must not be parallel to start→end.
     */
    static Arc(start: PointLike, mid: PointLike, end: PointLike, method: 'threepoint'|'tangent' = 'tangent'): Curve
    {
        if (!isPointLike(start) || !isPointLike(mid) || !isPointLike(end))
        {
            throw new Error('Curve.Arc(): Invalid start, mid, or end point. Please supply PointLike values.');
        }

        if (method === 'tangent')
        {
            return Curve._arcFromTangent(Point.from(start), Vector.from(mid), Point.from(end));
        }

        return Curve._arcFromThreePoints(Point.from(start), Point.from(mid), Point.from(end));
    }

    /** Three-point arc: start, mid-point, end all lie on the arc. */
    private static _arcFromThreePoints(A: Point, B: Point, C: Point): Curve
    {
        // Vectors from A to B and A to C
        const ab = Vector.from(B.x - A.x, B.y - A.y, B.z - A.z);
        const ac = Vector.from(C.x - A.x, C.y - A.y, C.z - A.z);

        // Plane normal (cross product of two edges)
        const rawNormal = ab.copy().cross(ac);
        if (rawNormal.length() < 1e-10)
        {
            throw new Error('Curve.Arc(): start, mid, and end are collinear — no arc can be defined.');
        }
        const normalUnit = rawNormal.normalize();

        const { center, radius } = Curve._circumcenter(A, B, C, normalUnit);

        return Curve._trimArcFromCircle(A, B, C, center, radius, normalUnit);
    }

    /** Tangent arc: start point, tangent direction at start, end point. */
    private static _arcFromTangent(A: Point, tangent: Vector, C: Point): Curve
    {
        const tanUnit = tangent.normalize();
        const chord = Vector.from(C.x - A.x, C.y - A.y, C.z - A.z);

        if (chord.length() < 1e-10)
        {
            throw new Error('Curve.Arc(): start and end are the same point.');
        }

        // The plane normal is the cross product of the tangent and the chord
        const rawNormal = tanUnit.copy().cross(chord);
        if (rawNormal.length() < 1e-10)
        {
            throw new Error('Curve.Arc(): tangent is parallel to start→end — no arc can be defined.');
        }
        const normalUnit = rawNormal.normalize();

        // The center lies on the line through A perpendicular to the tangent in the plane.
        // perpAtA = normal × tangent — points from A towards center
        const perpAtA = normalUnit.copy().cross(tanUnit).normalize();

        // Also the center must be equidistant from A and C → lies on perpendicular bisector of AC.
        const midAC = Vector.from((A.x + C.x) / 2, (A.y + C.y) / 2, (A.z + C.z) / 2);
        const chordDir = chord.normalize();
        const perpBisector = normalUnit.copy().cross(chordDir).normalize();

        // Solve: A + t·perpAtA = midAC + s·perpBisector
        // → t·perpAtA − s·perpBisector = midAC − A
        const dx = midAC.x - A.x;
        const dy = midAC.y - A.y;
        const dz = midAC.z - A.z;

        const d1 = perpAtA;
        const d2neg = perpBisector.scale(-1);

        const det_xy = d1.x * d2neg.y - d2neg.x * d1.y;
        const det_xz = d1.x * d2neg.z - d2neg.x * d1.z;
        const det_yz = d1.y * d2neg.z - d2neg.y * d1.z;

        let t: number;
        if (Math.abs(det_xy) >= Math.abs(det_xz) && Math.abs(det_xy) >= Math.abs(det_yz))
        {
            t = (dx * d2neg.y - d2neg.x * dy) / det_xy;
        }
        else if (Math.abs(det_xz) >= Math.abs(det_yz))
        {
            t = (dx * d2neg.z - d2neg.x * dz) / det_xz;
        }
        else
        {
            t = (dy * d2neg.z - d2neg.y * dz) / det_yz;
        }

        const center = new Point(A.x + t * perpAtA.x, A.y + t * perpAtA.y, A.z + t * perpAtA.z);
        const radius = Math.sqrt((A.x - center.x) ** 2 + (A.y - center.y) ** 2 + (A.z - center.z) ** 2);

        // Synthesise a mid-point on the correct side of the chord for direction resolution
        const midChord = new Point((A.x + C.x) / 2, (A.y + C.y) / 2, (A.z + C.z) / 2);
        const centerToMid = Vector.from(midChord.x - center.x, midChord.y - center.y, midChord.z - center.z);
        const midOnArc = new Point(
            center.x + centerToMid.normalize().scale(radius).x,
            center.y + centerToMid.normalize().scale(radius).y,
            center.z + centerToMid.normalize().scale(radius).z,
        );

        // Use the tangent cross chord to pick the arc side consistent with the tangent direction.
        // If perpAtA (which points from A towards center) has a positive dot with center−A,
        // the arc should go the "short way" through midOnArc. Otherwise flip.
        const centerFromA = Vector.from(center.x - A.x, center.y - A.y, center.z - A.z);
        const sameSide = centerFromA.dot(perpAtA) > 0;

        // B is the guide point that tells the trimmer which side of the circle to take
        let B: Point;
        if (sameSide)
        {
            // midOnArc is between A and C on the side the tangent bends towards
            B = midOnArc;
        }
        else
        {
            // Reflect midOnArc through center to get the point on the opposite arc
            B = new Point(
                2 * center.x - midOnArc.x,
                2 * center.y - midOnArc.y,
                2 * center.z - midOnArc.z,
            );
        }

        return Curve._trimArcFromCircle(A, B, C, center, radius, normalUnit);
    }

    /** Compute circumcenter and radius for three non-collinear points on a plane with given normal. */
    private static _circumcenter(A: Point, B: Point, C: Point, normalUnit: Vector): { center: Point, radius: number }
    {
        const ab = Vector.from(B.x - A.x, B.y - A.y, B.z - A.z);
        const ac = Vector.from(C.x - A.x, C.y - A.y, C.z - A.z);

        const mAB = Vector.from((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
        const mAC = Vector.from((A.x + C.x) / 2, (A.y + C.y) / 2, (A.z + C.z) / 2);

        const dAB = normalUnit.copy().cross(ab).normalize();
        const dAC = normalUnit.copy().cross(ac).normalize();

        const dx = mAC.x - mAB.x;
        const dy = mAC.y - mAB.y;
        const dz = mAC.z - mAB.z;

        const det_xy = dAB.x * (-dAC.y) - (-dAC.x) * dAB.y;
        const det_xz = dAB.x * (-dAC.z) - (-dAC.x) * dAB.z;
        const det_yz = dAB.y * (-dAC.z) - (-dAC.y) * dAB.z;

        let t: number;
        if (Math.abs(det_xy) >= Math.abs(det_xz) && Math.abs(det_xy) >= Math.abs(det_yz))
        {
            t = (dx * (-dAC.y) - (-dAC.x) * dy) / det_xy;
        }
        else if (Math.abs(det_xz) >= Math.abs(det_yz))
        {
            t = (dx * (-dAC.z) - (-dAC.x) * dz) / det_xz;
        }
        else
        {
            t = (dy * (-dAC.z) - (-dAC.y) * dz) / det_yz;
        }

        const center = new Point(mAB.x + t * dAB.x, mAB.y + t * dAB.y, mAB.z + t * dAB.z);
        const radius = Math.sqrt((A.x - center.x) ** 2 + (A.y - center.y) ** 2 + (A.z - center.z) ** 2);

        return { center, radius };
    }

    /** Trim an arc A→(through B)→C from a full circle defined by center, radius, and normal.
     *  B is a guide point that determines which side of the circle the arc follows.
     */
    private static _trimArcFromCircle(A: Point, B: Point, C: Point, _center: Point, _radius: number, _normalUnit: Vector): Curve
    {
        // hypercurve builds a circular arc natively through three points (start,
        // through, end); no circle-trim/parameter juggling needed.
        const csgrs = getCsgrs();
        return Curve.fromCsgrs(csgrs.Curve3DJs.makeArc(A.toPoint3Js(), B.toPoint3Js(), C.toPoint3Js()));
    }

    /** Create a closed rectangle centered at a given position on an optional base plane.
     *  @param width  - size along the local X axis of the plane
     *  @param height - size along the local Y axis of the plane
     *  @param center - centre of the rectangle (default: origin)
     *  @param plane  - base plane the rectangle lies on (default: 'xy')
     */
    static Rect(width: number, height: number, center: PointLike = [0, 0, 0], plane: BasePlane = 'xy'): Curve
    {
        if (typeof width !== 'number' || typeof height !== 'number')
        {
            throw new Error('Curve.Rect(): width and height must be numbers.');
        }

        const c = Point.from(center);
        const def = BASE_PLANE_NAME_TO_PLANE[plane];
        const xDir = Vector.from(def.xDir as [number, number, number]);
        const yDir = Vector.from(def.yDir as [number, number, number]);

        const hw = width / 2;
        const hh = height / 2;

        const p0 = new Point(c.x - hw * xDir.x - hh * yDir.x, c.y - hw * xDir.y - hh * yDir.y, c.z - hw * xDir.z - hh * yDir.z);
        const p1 = new Point(c.x + hw * xDir.x - hh * yDir.x, c.y + hw * xDir.y - hh * yDir.y, c.z + hw * xDir.z - hh * yDir.z);
        const p2 = new Point(c.x + hw * xDir.x + hh * yDir.x, c.y + hw * xDir.y + hh * yDir.y, c.z + hw * xDir.z + hh * yDir.z);
        const p3 = new Point(c.x - hw * xDir.x + hh * yDir.x, c.y - hw * xDir.y + hh * yDir.y, c.z - hw * xDir.z + hh * yDir.z);

        return Curve.Polyline([p0, p1, p2, p3, p0]);
    }

    /** Create a closed rectangle defined by two opposite corner points.
     *  The rectangle lies on the given base plane; if omitted, the plane is inferred
     *  from the axis with the smallest span between the two points.
     *  @param from  - first corner
     *  @param to    - opposite corner
     *  @param plane - optional base plane override
     */
    static RectBetween(from: PointLike, to: PointLike, plane?: BasePlane): Curve
    {
        if (!isPointLike(from) || !isPointLike(to))
        {
            throw new Error('Curve.RectBetween(): from and to must be PointLike values.');
        }

        const a = Point.from(from);
        const b = Point.from(to);
        const dx = Math.abs(b.x - a.x);
        const dy = Math.abs(b.y - a.y);
        const dz = Math.abs(b.z - a.z);
        const resolvedPlane = plane
            ?? ((dz <= dy && dz <= dx) ? 'xy' as const
                : (dy <= dx) ? 'xz' as const
                : 'yz' as const);
        const def = BASE_PLANE_NAME_TO_PLANE[resolvedPlane];
        const xDir = Vector.from(def.xDir as [number, number, number]);
        const yDir = Vector.from(def.yDir as [number, number, number]);

        // Project both corners onto the plane's local axes
        const ax = a.x * xDir.x + a.y * xDir.y + a.z * xDir.z;
        const ay = a.x * yDir.x + a.y * yDir.y + a.z * yDir.z;
        const bx = b.x * xDir.x + b.y * xDir.y + b.z * xDir.z;
        const by = b.x * yDir.x + b.y * yDir.y + b.z * yDir.z;

        // Normal component: average of the two points so the rect sits between them
        const nDir = Vector.from(def.normal as [number, number, number]);
        const an = a.x * nDir.x + a.y * nDir.y + a.z * nDir.z;
        const bn = b.x * nDir.x + b.y * nDir.y + b.z * nDir.z;
        const avgN = (an + bn) / 2;

        const toWorld = (u: number, v: number): Point =>
            new Point(
                u * xDir.x + v * yDir.x + avgN * nDir.x,
                u * xDir.y + v * yDir.y + avgN * nDir.y,
                u * xDir.z + v * yDir.z + avgN * nDir.z,
            );

        const p0 = toWorld(ax, ay);
        const p1 = toWorld(bx, ay);
        const p2 = toWorld(bx, by);
        const p3 = toWorld(ax, by);

        return Curve.Polyline([p0, p1, p2, p3, p0]);
    }

    /** Build a CompoundCurve from an ordered array of connecting Curves.
     *  Rebuilds a joined polyline through the concatenated control points.
     */
    static Compound(curves: Array<Curve>): Curve
    {
        if(!Array.isArray(curves) || curves.length === 0)
        {
            throw new Error('Curve.Compound(): Supply a non-empty array of Curves.');
        }

        // Concatenate the curves' control points into one polyline (native geometry
        // is segment-based; a joined path is a polyline through all vertices).
        const pts: Point[] = [];
        for(const c of curves)
        {
            for(const p of c.controlPoints())
            {
                if(pts.length === 0 || pts[pts.length - 1].distance(p) > Curve.ZERO_LENGTH_TOLERANCE)
                {
                    pts.push(p);
                }
            }
        }
        return Curve.Polyline(pts.map(p => [p.x, p.y, p.z] as [number, number, number]));
    }


    //// PROPERTIES ////

    /** Return the SceneNode this curve belongs to, or null. */
    node(): SceneNode | null { return this._node; }
    override readonly type = 'Curve' as const;

    /** Classify this curve as 'Line'|'Arc'|'Circle'|'Rect'|'Polyline'|'Spline'.
     *  Delegates to the native segment-based classification in {@link Curve3DJs}. */
    subtype(): 'Line'|'Arc'|'Circle'|'Rect'|'Polyline'|'Spline'|'Compound'
    {
        return this.inner().subtype() as 'Line'|'Arc'|'Circle'|'Rect'|'Polyline'|'Spline';
    }

    /** A curve is "compound" when it has more than one native segment. */
    isCompound():boolean
    {
        return this.inner().segmentCount() > 1;
    }

    /** Get control points (native segment vertices) of the Curve */
    controlPoints(): Array<Point>
    {
        return this.inner()
                ?.controlPoints()
                ?.map(p => Point.from(p));
    }

    /** Alias for controlPoints */
    points(): Array<Point>
    {
        return this.controlPoints();
    }

    /** Native curves are re-parameterised by arc length; there is no explicit knot
     *  vector, so this returns the parameter domain endpoints `[0, 1]`. */
    knots(): Array<number>
    {
        return Array.from(this.inner().knotsDomain());
    }

    knotsDomain():Array<number>|undefined
    {
        return Array.from(this.inner().knotsDomain());
    }

    /** Native segment geometry carries no per-control-point weights (arcs are exact,
     *  not rational NURBS); returns an empty array. */
    weights(): Array<number>
    {
        return [];
    }

    spans(): ShapeCollection<Curve>
    {
        if(!this.isCompound())
        {
            // If not compound, return self as single span for consistent API
            return new ShapeCollection<Curve>(this);
        }
        return new ShapeCollection<Curve>(
            this.inner().spans().map(span => Curve.fromCsgrs(span))
        );
    }


    //// CALCULATED PROPERTIES ////
    /*
        NOTES:
            - We use getter this.inner() to have error checking if _curve is undefined
    */

    isClosed(): boolean
    {
        return this.inner()?.closed() ?? false;
    }

    isPlanar(): boolean
    {
        return this.getOnPlane() !== null;
    }

    /** Whether this curve is a single straight segment (all sampled points collinear). */
    isStraight(tolerance: number = 1e-6): boolean
    {
        const pts = this.tessellate();
        if (pts.length < 2) { return false; }

        const a = pts[0];
        const b = pts[pts.length - 1];
        const dir = Vector.from(b.x - a.x, b.y - a.y, b.z - a.z);
        if (dir.length() < tolerance) { return false; } // degenerate / closed
        dir.normalize();

        for (let i = 1; i < pts.length - 1; i++)
        {
            const ap = Vector.from(pts[i].x - a.x, pts[i].y - a.y, pts[i].z - a.z);
            if (dir.copy().cross(ap).length() > tolerance) { return false; }
        }
        return true;
    }

    /** Whether this (planar) curve crosses itself.
     *
     *  The curve is tessellated into a polyline, projected onto its own plane, and
     *  every pair of non-adjacent segments is tested for a proper crossing. Segments
     *  that share an endpoint by construction (consecutive segments, and the closing
     *  wrap-around pair of a closed curve) are skipped.
     *
     *  Useful to reject degenerate inputs before operations that assume a simple
     *  (non-self-intersecting) curve — e.g. splitting a Polygon with a cutting curve.
     *
     *  Non-planar curves are not supported: a warning is emitted and `false` returned.
     *
     *  @param tolerance planar-fit tolerance passed to getOnPlane()
     */
    selfIntersecting(tolerance: number = 1e-6): boolean
    {
        const plane = this.getOnPlane(tolerance);
        if (!plane)
        {
            console.warn('Curve::selfIntersecting(): curve is not planar; self-intersection test is not applicable. Returning false.');
            return false;
        }

        // Project each tessellated point onto the plane's in-plane axes → 2D (u, v)
        let pts: Array<[number, number]> = this.tessellate().map(p =>
        {
            const v = p.toVector();
            return [v.dot(plane.x), v.dot(plane.y)] as [number, number];
        });

        const closed = this.isClosed();
        // A closed curve repeats its start point at the end — drop the duplicate so the
        // wrap-around segment (last → first) is formed via modulo indexing instead.
        if (closed && pts.length > 1)
        {
            const [fx, fy] = pts[0];
            const [lx, ly] = pts[pts.length - 1];
            if (Math.hypot(fx - lx, fy - ly) < 1e-9) { pts = pts.slice(0, -1); }
        }

        const n = pts.length;
        if (n < 4) { return false; } // need at least 2 non-adjacent segments to cross
        const segCount = closed ? n : n - 1;

        for (let i = 0; i < segCount; i++)
        {
            const a1 = pts[i];
            const a2 = pts[(i + 1) % n];
            for (let j = i + 2; j < segCount; j++)
            {
                // Skip the wrap-around pair of a closed curve (segment 0 and last share a vertex)
                if (closed && i === 0 && j === segCount - 1) { continue; }
                if (_seg2DProperlyIntersect(a1, a2, pts[j], pts[(j + 1) % n])) { return true; }
            }
        }
        return false;
    }

    /** Get the plane of the Curve as { normal, x, y }.
     *  The local axes are aligned to the closest global axes.
     *  Returns null if the curve is not planar.
     */
    getOnPlane(tolerance: number = 1e-6): { normal: Vector, x: Vector, y: Vector } | null
    {
        // A straight line is planar-ambiguous (it lies in infinitely many planes). The
        // WASM getOnPlane() always defaults such a line to the XY plane, which is wrong
        // when the line actually lies in another coordinate plane (e.g. XZ) — offset()
        // then collapses it and intersect() finds no hits. Detect an axis-aligned
        // coordinate plane from a constant coordinate and use that instead. This runs
        // for both single (Nurbs) and compound representations of a straight line, since
        // offset() returns a degree-1 CompoundCurve.
        if (this.isStraight(tolerance))
        {
            const axisPlane = this._straightLineCoordPlane(tolerance);
            if (axisPlane) return axisPlane;
            // else: fully diagonal line — genuinely ambiguous, fall through to defaults
        }

        // Native curve: derive the plane normal from three non-collinear tessellated
        // points, verify the whole curve is coplanar (rejecting a genuinely non-planar
        // 3D path), then align the local axes to the closest global axes.
        const pts = this.tessellate();
        if (pts.length < 3) { return null; }
        const ab = Vector.from(pts[1].x - pts[0].x, pts[1].y - pts[0].y, pts[1].z - pts[0].z);
        let normal: Vector | null = null;
        for (let i = 2; i < pts.length; i++)
        {
            const ac = Vector.from(pts[i].x - pts[0].x, pts[i].y - pts[0].y, pts[i].z - pts[0].z);
            const candidate = ab.copy().cross(ac);
            if (candidate.length() > tolerance) { normal = candidate.normalize(); break; }
        }
        if (!normal) { return null; }

        // A plane normal is sign-ambiguous (a plane has two opposite normals). For a
        // *closed* curve, canonicalize a near-axis-aligned normal toward the positive
        // cardinal axis so its normal() is stable regardless of vertex winding. Open
        // curves keep their winding-derived normal (their orientation is meaningful,
        // e.g. a sketch polyline on the 'front' plane whose normal is −Y).
        if (this.isClosed())
        {
            const ax = Math.abs(normal.x), ay = Math.abs(normal.y), az = Math.abs(normal.z);
            const dom = (ax >= ay && ax >= az) ? normal.x : (ay >= az ? normal.y : normal.z);
            const nearCardinal = Math.max(ax, ay, az) > 1 - 1e-6;
            if (nearCardinal && dom < 0) { normal = normal.scale(-1); }
        }

        const o = pts[0].toVector();
        const planeTol = Math.max(tolerance, 1e-4);
        for (const p of pts)
        {
            if (Math.abs(p.toVector().subtract(o).dot(normal)) > planeTol) { return null; } // non-planar
        }
        return this._frameFromNormal(normal, tolerance);
    }

    /** Get normal of planar Curve, returns null if not planar 
     *  IMPORTANT: This method returns consistent normals independent of curve orientation
                Use normalOrientation() to get orientation-dependent normal if needed
    */
    normal(): Vector|null
    {
        const plane = this.getOnPlane();
        if(!plane){ console.error(`Curve::normal(): Curve is not planar.`); return null; }
        return plane ? plane.normal : null;
    }

    /** Get normal based on curve orientation, returns null if not planar */
    normalOrientation(): Vector|null
    {
        if(!this.isPlanar()){ console.error(`Curve::normalOrientation(): Curve is not planar.`); return null; }
        // Use well-separated tessellation points (control points can be < 3 for arcs/
        // circles). Three spread-out points give a reliable winding-dependent normal.
        const pnts = this.tessellate();
        if(pnts.length < 3){ return this.normal(); }
        const i1 = Math.floor(pnts.length / 3);
        const i2 = Math.floor((2 * pnts.length) / 3);
        const v1 = pnts[i1].toVector().subtract(pnts[0].toVector());
        const v2 = pnts[i2].toVector().subtract(pnts[i1].toVector());
        const c = v1.cross(v2);
        return c.length() > 1e-9 ? c.normalize() : this.normal();
    }

    length(): number
    {
        // hypercurve native engine: exact per-segment length (lines exact, arcs via
        // radius·angle).
        return this.inner().length();
    }

    /** Net area enclosed by this curve: the boundary area minus any interior holes
     *  (e.g. from a boolean difference where the subtrahend lands fully inside).
     *  Only valid for closed planar curves; warns and returns undefined otherwise. */
    area(): number | undefined
    {
        if (!this.isClosed())
        {
            console.warn('Curve.area(): curve is not closed — area is undefined.');
            return undefined;
        }
        if (!this.isPlanar())
        {
            console.warn('Curve.area(): curve is not planar — area is undefined.');
            return undefined;
        }
        // hypercurve native engine: exact planar area, minus any interior holes.
        try
        {
            const holesArea = this._holes.reduce((sum, hole) =>
            {
                try { return sum + Math.abs(hole.inner().area()); }
                catch { return sum + (hole._boundaryArea() ?? 0); }
            }, 0);
            return Math.max(0, Math.abs(this.inner().area()) - holesArea);
        }
        catch (e)
        {
            console.warn('Curve.area(): hypercurve area failed, using fallback:', e);
        }
        const holesArea = this._holes.reduce((sum, hole) => sum + (hole._boundaryArea() ?? 0), 0);
        return Math.max(0, this._boundaryArea() - holesArea);
    }


    /** Unsigned area enclosed by this curve's boundary only, ignoring interior holes.
     *  3D shoelace over the tessellated boundary; plane-agnostic. */
    private _boundaryArea(): number
    {
        const pts = this.tessellate();
        const n = pts.length;
        if (n < 3) return 0;
        const v0 = pts[0];
        let ax = 0, ay = 0, az = 0;
        for (let i = 1; i < n - 1; i++)
        {
            const a = pts[i], b = pts[i + 1];
            const ux = a.x - v0.x, uy = a.y - v0.y, uz = a.z - v0.z;
            const vx = b.x - v0.x, vy = b.y - v0.y, vz = b.z - v0.z;
            ax += uy * vz - uz * vy;
            ay += uz * vx - ux * vz;
            az += ux * vy - uy * vx;
        }
        return 0.5 * Math.sqrt(ax * ax + ay * ay + az * az);
    }

    /** Curves have no volume — returns undefined */
    volume(): undefined
    {
        console.warn('Curve.volume(): curves are 1D and have no volume.');
        return undefined;
    }

    /** Start point of the curve (arc-length parameter 0). */
    start(): Vertex
    {
        return new Vertex(new Point(this.inner().pointAt(0)));
    }

    /** End point of the curve (arc-length parameter 1). */
    end(): Vertex
    {
        return new Vertex(new Point(this.inner().pointAt(1)));
    }

    /** Point at the midpoint of the curve by arc length */
    middle(): Point|null
    {
        return this.pointAtPerc(0.5);
    }

    degree(): number|null
    {
        return this.inner().degree();
    }

    /** Get maximum degree over the native segments. */
    maxDegree(): number
    {
        return this.inner().degree();
    }

    /** Native curves are uniformly (arc-length) parameterised, so there are no
     *  mixed per-span degrees to guard against. */
    compoundMixedDegrees(): boolean
    {
        return false;
    }

    paramAtLength(length: number): number|null
    {
        return this.inner().paramAtLength(length);
    }

    paramClosestToPoint(point: PointLike): number|null
    {
        try
        {
            return this.inner()?.paramClosestToPoint(new Point(point).toPoint3Js());
        }
        catch (e)
        {
            if(this.subtype() === 'Circle')
            {
                // all params are closest, just return start of domain for consistency
                console.warn('Curve::paramClosestToPoint(): Curve is a circle, all parameters are equally close. Returning start of domain.');
                return 0;
            }
            console.error('Curve::paramClosestToPoint(): Error:', e);
            return null;
        }
    }

    pointAtParam(p: number): Point
    {
        return new Point(
            this.inner().pointAt(p));
    }

    pointAtLength(length: number): Point|null
    {
        const param = this.paramAtLength(length);
        if(param === null) { return null; }
        return this.pointAtParam(param);
    }

    /** Get point at given percentage of the curve length */
    pointAtPerc(perc: number): Point|null
    {
        const length = this.length();
        if(length === 0) { return null; }
        return this.pointAtLength(perc * length);
    }

    /** Get the tangent direction at the closest point on the curve to the given point.
     *  Returns a normalised Vector, or null if the closest parameter cannot be found.
     */
    tangentAt(point: PointLike): Vector|null
    {
        const param = this.paramClosestToPoint(point);
        if(param === null){ return null; }
        return Vector.from(this.inner().tangentAt(param));
    }

    /** Minimum distance to another PointLike or Curve
     *  Returns null if the closest parameter cannot be determined.
     */
    distance(to: PointLike|Curve|Mesh|Polygon): number|null
    {
        if(isPointLike(to))
        {
            return this._distanceToPoint(Point.from(to));
        }
        else if(to instanceof Curve)
        {
            return this._distanceToCurve(to);
        }
        // Surface shapes measure curve↔surface distance themselves (Polygon → its mesh).
        else if(to instanceof Mesh)
        {
            return to.distanceTo(this);
        }
        else if(to instanceof Polygon)
        {
            return to.toMesh().distanceTo(this);
        }
        return null;
    }

    /** Find the closest pair of points between this curve and another.
     *  Uses coarse sampling + multi-seed alternating closest-point refinement.
     *  Returns [pointOnThis, pointOnOther], or null if it cannot be determined.
     */
    closestPoints(other: Curve): [Point, Point]|null
    {
        const NUM_SAMPLES = 30;
        const NUM_SEEDS = 3;
        const MAX_ACI_ITER = 15;
        const ACI_TOL = 1e-10;

        // 1. Sample both curves uniformly
        const domainA = this.inner().knotsDomain();
        const domainB = other.inner().knotsDomain();
        const samplesA: Array<{ param: number, pt: Point }> = [];
        const samplesB: Array<{ param: number, pt: Point }> = [];

        Array.from({ length: NUM_SAMPLES + 1 }, (_, i) =>
        {
            const tA = domainA[0] + (domainA[1] - domainA[0]) * i / NUM_SAMPLES;
            const tB = domainB[0] + (domainB[1] - domainB[0]) * i / NUM_SAMPLES;
            samplesA.push({ param: tA, pt: this.pointAtParam(tA) });
            samplesB.push({ param: tB, pt: other.pointAtParam(tB) });
        });

        // 2. Find top-k closest pairs as seeds
        const seeds: Array<{ distSq: number, paramA: number, paramB: number }> = [];
        samplesA.forEach(a =>
        {
            samplesB.forEach(b =>
            {
                const dx = a.pt.x - b.pt.x;
                const dy = a.pt.y - b.pt.y;
                const dz = a.pt.z - b.pt.z;
                const distSq = dx * dx + dy * dy + dz * dz;

                if (seeds.length < NUM_SEEDS)
                {
                    seeds.push({ distSq, paramA: a.param, paramB: b.param });
                    seeds.sort((a, b) => b.distSq - a.distSq);
                }
                else if (distSq < seeds[0].distSq)
                {
                    seeds[0] = { distSq, paramA: a.param, paramB: b.param };
                    seeds.sort((a, b) => b.distSq - a.distSq);
                }
            });
        });

        if (seeds.length === 0) return null;

        // 3. Refine each seed with alternating closest-point iteration
        let bestDist = Infinity;
        let bestPair: [Point, Point]|null = null;

        seeds.forEach(seed =>
        {
            let ptA = this.pointAtParam(seed.paramA);
            let ptB = other.pointAtParam(seed.paramB);
            let prevDist = Infinity;

            for (let i = 0; i < MAX_ACI_ITER; i++) // perf: keep as loop (convergence with break)
            {
                const paramB = other.paramClosestToPoint(ptA);
                if (paramB === null) break;
                ptB = other.pointAtParam(paramB);

                const paramA = this.paramClosestToPoint(ptB);
                if (paramA === null) break;
                ptA = this.pointAtParam(paramA);

                const dist = ptA.distance(ptB);
                if (Math.abs(prevDist - dist) < ACI_TOL) { prevDist = dist; break; }
                prevDist = dist;
            }

            if (prevDist < bestDist)
            {
                bestDist = prevDist;
                bestPair = [ptA, ptB];
            }
        });

        return bestPair;
    }

    private _distanceToCurve(other: Curve): number|null
    {
        const pair = this.closestPoints(other);
        if (!pair) return null;
        return pair[0].distance(pair[1]);
    }

    private _distanceToPoint(point: PointLike): number|null
    {
        if(!isPointLike(point)){ throw new Error(`Curve::distance(): Please supply a PointLike. Got: ${point}`); }
        const param = this.paramClosestToPoint(point);
        if (param === null) return null;
        return Point.from(this.pointAtParam(param)).distance(Point.from(point));
    }

    /** Get Bbox from Curve. 
     *  NOTE: If Curve is in 3D space, returns a 3D Bbox - if Curve is planar or not
     */
    bbox():undefined|Bbox
    {
        const b = this.inner()?.bbox();
        return (b && b.length >= 6)
            ? new Bbox([b[0], b[1], b[2]], [b[3], b[4], b[5]])
            : undefined;
    }

    /** Get oriented bounding box of this Curve using PCA */
    obbox(): OBbox
    {
        return OBbox.fromCurve(this);
    }

    /** Whether this Curve is essentially a cuboid (rectangle in 2D).
     *
     *  A single line is 1D and never a cuboid. For 2D-or-bigger curves, builds
     *  the PCA-based OBB and checks every tessellated point: each point must
     *  sit on the OBB surface — within ±halfExtent on every non-zero axis and
     *  touching at least one face — within `tolerance`. Arcs / circles /
     *  splines / non-rect polylines fail; tessellated rectangles pass even
     *  when sides are subdivided.
     */
    isCuboid(tolerance: number = 0.5): boolean
    {
        const obb = this.obbox();
        if (obb.is1D()) return false;
        const halfExtents = obb.halfExtents();
        const axes        = obb.axes();
        const c           = obb.center();
        const activeAxis: Array<0|1|2> = [0,1,2].filter(i => halfExtents[i] > tolerance) as Array<0|1|2>;
        if (activeAxis.length < 2) return false;

        // Tessellate at a tolerance tighter than the cuboid tolerance so arcs
        // and splines are sampled finely enough to be flagged as non-cuboid.
        const pts = this.tessellate(Math.min(tolerance * 0.5, TESSELATION_TOLERANCE));
        if (!pts || pts.length === 0) return false;

        for (const v of pts)
        {
            const dx = v.x - c.x, dy = v.y - c.y, dz = v.z - c.z;
            let onAFace = false;
            for (const i of activeAxis)
            {
                const a = axes[i];
                const proj = dx * a.x + dy * a.y + dz * a.z;
                if (Math.abs(proj) > halfExtents[i] + tolerance) return false;
                if (Math.abs(Math.abs(proj) - halfExtents[i]) < tolerance) onAFace = true;
            }
            if (!onAFace) return false;
        }
        return true;
    }

    /** Whether this curve lies in a 2D plane (zero extent on one axis) */
    is2D(): boolean
    {
        const bb = this.bbox();
        if (!bb) return false;
        return bb.width() === 0 || bb.depth() === 0 || bb.height() === 0;
    }

    /** Direction vector from start to end point (not normalised) */
    direction(): Vector
    {
        return Vector.from(this.end()).subtract(Vector.from(this.start()));
    }

    //// SELECT ////

    /** Select (sub)shapes from this Curve using a selector string (see Selector.ts).
     *  Supported shapes for a Curve target: `vertex` (control points),
     *  `curve`/`wire` (the curve itself or its spans).
     *  Selectors are greedy: an underspecified selector returns every match.
     *  A ShapeCollection result is collapsed to the single shape when there is
     *  exactly one match (checkSingle), and an empty result warns. */
    select(what: string)
    {
        const result = new Selector(what).execute(this);
        Selector.warnIfEmpty(what, result);
        return (result instanceof ShapeCollection) ? result.checkSingle() : result;
    }

    /** Corner vertices along this Curve, in order.
     *  - a straight line or single arc/spline span yields [start, end]
     *  - polylines and rects yield every corner (segment junction) vertex
     *  Coincident consecutive points (including the wrap for closed curves) are
     *  collapsed, so a closed rect returns its 4 distinct corners. */
    vertices(): ShapeCollection<Vertex>
    {
        const EPS = 1e-6;
        const segs = this.segments().toArray();

        // Ordered list of candidate points: each segment's start, plus the final
        // end for open curves (a closed curve's final end coincides with the start).
        const points: Point[] = segs.map(seg => new Point(seg.start()));
        if (!this.isClosed() && segs.length > 0)
        {
            points.push(new Point(segs[segs.length - 1].end()));
        }

        // Collapse consecutive duplicates, and the wrap-around pair for closed curves.
        const unique: Point[] = [];
        for (const p of points)
        {
            if (unique.length === 0 || unique[unique.length - 1].distance(p) > EPS)
            {
                unique.push(p);
            }
        }
        if (this.isClosed() && unique.length > 1 && unique[0].distance(unique[unique.length - 1]) <= EPS)
        {
            unique.pop();
        }

        return new ShapeCollection<Vertex>(...unique.map(p => new Vertex(p)));
    }

    /** Return all atomic segments of this Curve.
     *  - degree-1 spans (polylines) are split into individual line segments (N CPs → N-1 edges)
     *  - higher-degree spans (arcs, splines) are returned as-is, one per span
     */
    segments(): ShapeCollection<Curve>
    {
        const segs: Curve[] = this.spans().toArray().flatMap(span =>
        {
            const inner = span.inner();
            if (inner.degree() === 1)
            {
                const cps = span.controlPoints();
                return cps.slice(0, -1).map((cp, i) => Curve.Line(cp, cps[i + 1]));
            }
            return [span];
        });
        return new ShapeCollection<Curve>(...segs);
    }

    /** For BREP compatibility: alias for segments() */
    edges(): ShapeCollection<Curve>
    {
        return this.segments();
    }

    /** Copy a range of this Curve's atomic segments (see segments()) and combine them
     *  into a single Curve.
     *
     *  Segments are taken in forward order from `fromIndex` to `toIndex` (both inclusive).
     *  When `fromIndex > toIndex` the range wraps around the end of a *closed* curve
     *  (its last segment joins back to its first), e.g. `segment(-1, 0)` on a closed rect
     *  returns the last + first edge. Wrapping an open curve is an error.
     *
     *  @param fromIndex - first segment index (inclusive, 0-based). Negative indexes count from the end.
     *  @param toIndex   - last segment index (inclusive). Defaults to fromIndex (single segment). Negative indexes count from the end.
     *  @returns a single Curve — one span stays a plain Curve, multiple spans become a CompoundCurve.
     */
    segment(fromIndex: number, toIndex: number = fromIndex): Curve
    {
        // Build the atomic segments as FRESH, plain-meshup Curves (never Smart*, never
        // scene-bound). Do NOT route through the public segments()/copy() — on a Smart
        // subclass those are scene-decorated, which would both pollute the scene and,
        // after Curve.Compound() consumes the pieces' kernel pointers, leave freed shapes
        // in the scene (→ "null pointer passed to rust" on the next kernel call).
        const segs = this._atomicSegmentsRaw();
        const n = segs.length;
        if (n === 0) { throw new Error('Curve::segment(): Curve has no segments.'); }

        // Resolve negative indices relative to the end
        const from = fromIndex < 0 ? n + fromIndex : fromIndex;
        const to   = toIndex   < 0 ? n + toIndex   : toIndex;

        if (from < 0 || from >= n || to < 0 || to >= n)
        {
            throw new Error(`Curve::segment(): index range [${fromIndex}, ${toIndex}] out of bounds — Curve has ${n} segment(s).`);
        }

        // Forward, inclusive. from > to wraps around the end of a closed curve.
        let picked: Curve[];
        if (from <= to)
        {
            picked = segs.slice(from, to + 1);
        }
        else if (this.isClosed())
        {
            picked = [...segs.slice(from), ...segs.slice(0, to + 1)];
        }
        else
        {
            throw new Error(`Curve::segment(): fromIndex (${fromIndex}) resolves after toIndex (${toIndex}) but the curve is open — cannot wrap around. Pass indices in ascending order.`);
        }

        return picked.length === 1 ? picked[0] : Curve.Compound(picked);
    }

    /** Atomic segments as fresh, plain-meshup Curves — same decomposition as segments()
     *  but each piece is a brand-new kernel curve safe to consume (e.g. hand to
     *  Curve.Compound). Bypasses any Smart* override so internal callers never touch the
     *  scene or alias `this`'s kernel curve. */
    private _atomicSegmentsRaw(): Curve[]
    {
        return this.spans().toArray().flatMap(span =>
        {
            const inner = span.inner();
            if (inner.degree() === 1)
            {
                const cps = span.controlPoints();
                return cps.slice(0, -1).map((cp, i) => Curve.Line(cp, cps[i + 1]));
            }
            // Clone so combining/consuming the segment never frees this curve's span.
            return [Curve.fromCsgrs(inner.clone())];
        });
    }

    /** Store annotations on this curve — placeholder for old-API compat */
    addAnnotations(_annotations: any[]): this
    {
        // TODO: implement when annotation storage is added to geometry classes
        return this;
    }

    /** Center point of this curve's bounding box */
    center(): Point
    {
        const bb = this.bbox();
        if (bb) return bb.center();
        // Fallback: midpoint along the curve
        return this.pointAtPerc(0.5) ?? new Point(this.start());
    }

    /** Tessellate the curve into a series of points.
     *  @param tol - tessellation normal tolerance
     *  @returns array of points representing the tessellated curve
     * 
     *  NOTE: tessellation tolerance is the hypercurve chord error
     *      More control can be added in the future
     */
    tessellate(tol: number = TESSELATION_TOLERANCE): Array<Point>
    {
        return this.inner().tessellate(tol)
            .map(p => Point.from(p));
    }

    /** Create new Curve by tessellating any (compound) curve with degree > 1 into a degree-1 polyline,
     *  then run `mergeColinearLines()` to collapse redundant collinear segments.
     *  Curves that are already fully degree-1 are returned unchanged.
     *  @param tol - tessellation tolerance (default: TESSELATION_TOLERANCE)
     */
    toDegree1(tol: number = TESSELATION_TOLERANCE): Curve
    {
        const maxDeg = this.maxDegree();
        if (maxDeg !== null && maxDeg <= 1) return this;

        const pts = this.tessellate(tol);
        if (pts.length < 2) return this;

        return Curve.Polyline(pts).mergeColinearLines();
    }


    //// OPERATIONS ////

    override translate(px: PointLike | number, dy?: number, dz?: number): this
    {
        // NOTE: because PointLike matches [number], we need to check y and z first
        const vec = (typeof dy === 'number' && (typeof dz === 'number' || dz === undefined)) 
                        ? Point.from(px, dy, dz ?? 0) 
                        : Point.from(px); // throws error if invalid

        if(!vec){ throw new Error('Curve.translate(): Invalid translation input. Please use PointLike or valid offset coordinates.'); }
        this.update(this.inner().translate(vec.toVector3Js()));
        return this;
    }

    /** Move the curve so its bbox center lands at the given point */
    moveTo(target: PointLike): this
    {
        const bb = this.bbox();
        if (!bb) return this;
        const c = bb.center();
        const t = Point.from(target);
        return this.translate(t.x - c.x, t.y - c.y, t.z - c.z);
    }

    moveToX(x: number): this
    {
        const bb = this.bbox();
        return bb ? this.translate(x - bb.center().x, 0, 0) : this;
    }

    moveToY(y: number): this
    {
        const bb = this.bbox();
        return bb ? this.translate(0, y - bb.center().y, 0) : this;
    }

    moveToZ(z: number): this
    {
        const bb = this.bbox();
        return bb ? this.translate(0, 0, z - bb.center().z) : this;
    }

    /** Rotate the given curve a specified angle (in degrees) around an axis through the world origin */
    override rotate(angle: number, axis: Axis | PointLike = 'z', pivot: PointLike = [0, 0, 0]): this
    {
        return this.update(this.rotateAround(angle, axis, pivot));
    }

    /** Rotate Curve by angleDeg around an axis through a pivot point.
     *  Uses Rodrigues' rotation formula on control points — works for any axis.
     *  @param angleDeg - rotation angle in degrees
     *  @param axis     - 'x' | 'y' | 'z' or an arbitrary direction vector (PointLike)
     *  @param pivot    - point the axis passes through (default: world origin)
     */
    override rotateAround(angleDeg: number, axis: Axis | PointLike = 'z', pivot: PointLike = [0, 0, 0]): this
    {
        const p = Point.from(pivot);
        this.translate([-p.x, -p.y, -p.z]);

        if (typeof axis === 'string')
        {
            const a = rad(angleDeg);
            this.update(this.inner().rotateAxis(
                a,
                axis === 'x' ? 1 : 0,
                axis === 'y' ? 1 : 0,
                axis === 'z' ? 1 : 0,
            ));
        }
        else
        {
            const axVec = Point.from(axis).toVector().normalize();
            const half = rad(angleDeg) / 2;
            const s = Math.sin(half);
            this.rotateQuaternion(Math.cos(half), axVec.x * s, axVec.y * s, axVec.z * s);
        }

        this.translate([p.x, p.y, p.z]);
        this._holes = this._holes.map(h => { h.rotateAround(angleDeg, axis, pivot); return h; });
        return this;
    }

    /** Rotate Curve by a quaternion given as components `(w, x, y, z)`.
     *  The quaternion is normalized internally, so non-unit input is safe.
     */
    override rotateQuaternion(wOrObj: number | {w: number, x: number, y: number, z: number}, x?: number, y?: number, z?: number): this
    {
        if (typeof wOrObj === 'number')
        {
            return this.update(this.inner().rotateQuaternion(wOrObj, x!, y!, z!));
        }
        else
        {
            return this.update(this.inner().rotateQuaternion(wOrObj.w, wOrObj.x, wOrObj.y, wOrObj.z));
        }
    }
    

    /** Align this Curve by mapping 3 source points onto 3 target points.
     *
     *  - **withScale:** if true, apply a uniform scale (centered at q1) so edge lengths match.
     *
     *  @param sourcePoints - 3 reference points on the curve (current space)
     *  @param targetPoints - 3 corresponding destination points
     *  @param withScale    - optionally scale uniformly to match first-edge length
     */
    alignByPoints(
        sourcePoints: [PointLike, PointLike, PointLike],
        targetPoints: [PointLike, PointLike, PointLike],
        withScale = false
    ): this
    {
        if(sourcePoints.length < 3 || targetPoints.length < 3)
        {
            throw new Error('Curve.alignPoints(): sourcePoints and targetPoints must have at least 3 points for fully defined alignment.');
        }

        if (sourcePoints.length !== targetPoints.length)
        {
            throw new Error('Curve.alignPoints(): sourcePoints and targetPoints must have the same length.');
        }

        const p1 = Point.from(sourcePoints[0]);
        const p2 = Point.from(sourcePoints[1]);
        const q1 = Point.from(targetPoints[0]);
        const q2 = Point.from(targetPoints[1]);

        // Step 1: translate so p1 → q1 ---
        this.translate([q1.x - p1.x, q1.y - p1.y, q1.z - p1.z]);

        // Edge vectors (source and target)
        const srcEdge = Vector.from(p2.x - p1.x, p2.y - p1.y, p2.z - p1.z);
        const tgtEdge = Vector.from(q2.x - q1.x, q2.y - q1.y, q2.z - q1.z);

        // Step 2: optional uniform scale (before rotation, centered at q1) ---
        let scaleFactor = 1;
        if (withScale)
        {
            const srcLen = srcEdge.length();
            const tgtLen = tgtEdge.length();
            if (srcLen > 1e-10)
            {
                scaleFactor = tgtLen / srcLen;
                this.translate([-q1.x, -q1.y, -q1.z]);
                this.scale(scaleFactor);
                this.translate([q1.x, q1.y, q1.z]);
            }
        }

        // Step 3: rotate around q1 to align srcEdge → tgtEdge ---
        const R1 = srcEdge.rotationBetween(tgtEdge);
        this.translate([-q1.x, -q1.y, -q1.z]);
        this.rotateQuaternion(R1.w, R1.x, R1.y, R1.z);
        this.translate([q1.x, q1.y, q1.z]);

        // Step 4: twist around the now-aligned edge axis ---
        if (sourcePoints.length === 3)
        {
            const p3 = Point.from((sourcePoints as [PointLike, PointLike, PointLike])[2]);
            const q3 = Point.from((targetPoints as [PointLike, PointLike, PointLike])[2]);

            // Where p3 ended up after translate + scale + R1 (relative to q1):
            const rel = Vector.from(p3.x - p1.x, p3.y - p1.y, p3.z - p1.z)
                            .scale(scaleFactor)
                            .rotateQuaternion(R1.w, R1.x, R1.y, R1.z);

            // Where q3 sits relative to q1:
            const goal = Vector.from(q3.x - q1.x, q3.y - q1.y, q3.z - q1.z);

            // Twist axis = the aligned first edge (unit)
            const axLen = tgtEdge.length();
            if (axLen > 1e-10)
            {
                const axis = tgtEdge.copy().scale(1 / axLen);

                // Project both vectors onto the plane perpendicular to axis
                // Use copies so axis is not mutated (dot products can be 0, zeroing axis in-place)
                const d1 = rel.dot(axis);
                const d2 = goal.dot(axis);
                const u1 = rel.subtract(axis.copy().scale(d1));
                const u2 = goal.subtract(axis.copy().scale(d2));

                const len1 = u1.length(), len2 = u2.length();
                if (len1 > 1e-10 && len2 > 1e-10)
                {
                    // Signed angle from u1 → u2 around axis
                    const cosA = Math.max(-1, Math.min(1, u1.dot(u2) / (len1 * len2)));
                    // sin component: (u1 × u2) · axis / (|u1| |u2|)
                    const crossVec = u1.cross(u2);
                    const sinA = crossVec.dot(axis) / (len1 * len2);
                    const angle = Math.atan2(sinA, cosA);

                    if (Math.abs(angle) > 1e-10)
                    {
                        const half = angle / 2;
                        const sh = Math.sin(half);
                        this.translate([-q1.x, -q1.y, -q1.z]);
                        this.rotateQuaternion(Math.cos(half), axis.x * sh, axis.y * sh, axis.z * sh);
                        this.translate([q1.x, q1.y, q1.z]);
                    }
                }
            }
        }
        return this;
    }

    override scale(factor: number | PointLike, origin?: PointLike): this
    {
        const [sx, sy, sz] = (typeof factor === 'number') ? [factor, factor, factor] : [Point.from(factor).x, Point.from(factor).y, Point.from(factor).z];
        const o = origin ? Point.from(origin) : null;
        // hypercurve only supports uniform (similarity) scaling of native geometry;
        // for a per-axis scale, resample the boundary and rebuild as a polyline.
        const uniform = Math.abs(sx - sy) < 1e-9 && Math.abs(sy - sz) < 1e-9;
        if (o) { this.translate([-o.x, -o.y, -o.z]); }
        if (uniform)
        {
            this.update(this.inner().scale(sx));
        }
        else
        {
            const pts = this.tessellate().map(p => [p.x * sx, p.y * sy, p.z * sz] as [number, number, number]);
            this.update(Curve.Polyline(pts));
        }
        if (o) { this.translate([o.x, o.y, o.z]); }
        return this;
    }

    /** Reverse the direction of this curve (swap start/end).
     *  Returns self for chaining.
     */
    reverse(): this
    {
        return this.update(this.inner().reverse());
    }

    /** Mirror Curve across a plane defined by a direction (Axis or normal vector) and an optional position.
     *  If no position is given, the bbox center of the curve is used.
     *  Works by reflecting each NURBS control point across the plane: P' = P - 2·(dot(P−Q, n))·n
     */
    override mirror(dir: Axis | PointLike, pos?: PointLike): this
    {
        const planeNormal = isPointLike(dir)
                                ? Point.from(dir).toVector()
                                : Vector.from(dir); // converts axis to Vector
        const n = planeNormal.normalize();
        const planePos = pos
                            ? Point.from(pos)
                            : this.bbox()?.center() ?? new Point([0, 0, 0]);

        // Reflect a single point: P' = P - 2·dot(P−Q, n)·n
        const mirrorPoint = (p: Point): Point =>
        {
            const dot2 = 2 * ((p.x - planePos.x) * n.x + (p.y - planePos.y) * n.y + (p.z - planePos.z) * n.z);
            return new Point([p.x - dot2 * n.x, p.y - dot2 * n.y, p.z - dot2 * n.z]);
        };

        // Reflect the tessellated boundary and rebuild as a polyline (native geometry
        // is segment-based; a reflected curve is re-sampled rather than rebuilt span-wise).
        const pts = this.tessellate().map(p => mirrorPoint(p));
        this.update(Curve.Polyline(pts.map(p => [p.x, p.y, p.z] as [number, number, number])));
        this._holes = this._holes.map(h => h.mirror(dir, pos));
        return this;
    }

    mirrorX(pos?: number): this
    {
        const planePos = (typeof pos === 'number') ? new Point(pos, 0, 0) : this.bbox()?.center() ?? new Point([0, 0, 0]);
        return this.mirror('x', planePos);
    }

    mirrorY(pos?: number): this
    {
        const planePos = (typeof pos === 'number') ? new Point(0, pos, 0) : this.bbox()?.center() ?? new Point([0, 0, 0]);
        return this.mirror('y', planePos);
    }
    
    mirrorZ(pos?: number): this
    {       
        const planePos = (typeof pos === 'number') ? new Point(0, 0, pos) : this.bbox()?.center() ?? new Point([0, 0, 0]);
        return this.mirror('z', planePos);
    }

    /** Project this Curve onto a plane, flattening all control points onto it.
     *  @param plane - a named base plane ('xy', 'yz', 'xz', 'front', 'back', 'left', 'right')
     *               or an object { normal: PointLike, origin?: PointLike } for an arbitrary plane.
     *               If no origin is given for a custom plane, the world origin [0,0,0] is used.
     */
    projectOnto(plane: BasePlane | { normal: PointLike; origin?: PointLike }): this
    {
        let normal: Vector;
        let origin: Point;

        if (isBasePlane(plane))
        {
            const def = BASE_PLANE_NAME_TO_PLANE[plane];
            normal = Vector.from(def.normal as [number, number, number]);
            origin = new Point(0, 0, 0);
        }
        else
        {
            normal = Vector.from(plane.normal);
            origin = plane.origin ? Point.from(plane.origin) : new Point(0, 0, 0);
        }

        const n = normal.normalize();

        // Project a single point onto the plane: P' = P - dot(P - Q, N) * N
        const projectPoint = (p: Point): Point =>
        {
            const dot = (p.x - origin.x) * n.x + (p.y - origin.y) * n.y + (p.z - origin.z) * n.z;
            return new Point(p.x - dot * n.x, p.y - dot * n.y, p.z - dot * n.z);
        };

        // Project the tessellated boundary onto the plane and rebuild as a polyline.
        const pts = this.tessellate().map(p => projectPoint(p));
        this.update(Curve.Polyline(pts.map(p => [p.x, p.y, p.z] as [number, number, number])));
        this._holes = this._holes.map(h => h.projectOnto(plane));
        return this;
    }

    /** Build an in-plane { normal, x, y } frame from a plane normal, aligning x to
     *  the closest global axis not parallel to the normal (right-handed y = n × x). */
    private _frameFromNormal(normal: Vector, tolerance: number = 1e-6): { normal: Vector, x: Vector, y: Vector }
    {
        const n = normal.copy().normalize();
        const candidates: Vector[] = [ Vector.from(1,0,0), Vector.from(0,1,0), Vector.from(0,0,1) ];
        const xDir = candidates
            .filter(c => Math.abs(c.dot(n)) < 1 - tolerance)
            .sort((a, b) => Math.abs(a.dot(n)) - Math.abs(b.dot(n)))[0];

        const x = xDir.copy().subtract(n.copy().scale(xDir.dot(n))).normalize();
        const y = n.copy().cross(x).normalize();
        return { normal: n, x, y };
    }

    /** For a straight line lying on an axis-aligned coordinate plane (one coordinate
     *  constant along its whole length), return that plane's frame. Straight lines are
     *  planar-ambiguous, so this gives offset() a well-defined plane. When several
     *  coordinates are constant (an axis-aligned line), the normal is chosen Z→Y→X.
     *  Returns null for a fully diagonal line (no constant coordinate). */
    private _straightLineCoordPlane(tolerance: number = 1e-6): { normal: Vector, x: Vector, y: Vector } | null
    {
        const s = this.start().toArray();
        const e = this.end().toArray();

        // A straight line's endpoints share a coordinate ⇒ the whole (collinear) line does.
        const xConst = Math.abs((s[0] ?? 0) - (e[0] ?? 0)) <= tolerance;
        const yConst = Math.abs((s[1] ?? 0) - (e[1] ?? 0)) <= tolerance;
        const zConst = Math.abs((s[2] ?? 0) - (e[2] ?? 0)) <= tolerance;

        // Prefer a Z normal (XY plane), then Y (XZ), then X (YZ) when ambiguous.
        let normal: Vector | null = null;
        if (zConst)      normal = Vector.from(0, 0, 1);
        else if (yConst) normal = Vector.from(0, 1, 0);
        else if (xConst) normal = Vector.from(1, 0, 0);

        return normal ? this._frameFromNormal(normal, tolerance) : null;
    }

    /** Native segment geometry is already minimal; kept for API compatibility. */
    mergeColinearLines(_colinearTol: number = 1e-3): this
    {
        return this;
    }

    /** Close this curve by adding a segment from end back to start.
     *  If already closed, returns self unchanged. */
    close(): this
    {
        if (this.isClosed()) return this;
        const pts = this.controlPoints().map(p => [p.x, p.y, p.z] as [number, number, number]);
        if (pts.length < 2) return this;
        pts.push([pts[0][0], pts[0][1], pts[0][2]]); // close the ring
        this.update(Curve.Polyline(pts));
        return this;
    }

    /** Fillet (round) the sharp corners of a Curve with arcs of `radius`, via
     *  hypercurve's exact vertex fillet. Works on both closed curves (every corner)
     *  and open curves (interior corners only — the two free endpoints are not
     *  corners). Corners where the radius does not fit are left sharp. (The optional
     *  `at` corner filter is not yet supported — all fitting corners are filleted.) */
    fillet(radius: number, at?: PointLike|Array<PointLike>): this|null
    {
        void at; // TODO: fillet only the corners nearest `at`
        try { return this.update(Curve.fromCsgrs(this.inner().fillet(radius))); }
        catch (e) { console.warn('Curve.fillet():', e); return this; }
    }

    /** Chamfer (bevel) the sharp corners of a Curve, cutting back `setback` along
     *  each edge. Works on both closed and open curves (interior corners only). */
    chamfer(setback: number): this
    {
        try { return this.update(Curve.fromCsgrs(this.inner().chamfer(setback))); }
        catch (e) { console.warn('Curve.chamfer():', e); return this; }
    }

    filletAtParams(radius: number, at: Array<number>): this|null
    {
        void at; // TODO: fillet only the corners at the given params; currently all corners
        return this.fillet(radius);
    }

    /** Extend the curve by `length` at its start / end / both, along the endpoint
     *  tangent(s). Rebuilds as a polyline through the extended vertices. */
    extend(length: number, side: 'start'|'end'|'both' = 'end'): this
    {
        const pts = this.controlPoints().map(p => [p.x, p.y, p.z] as [number, number, number]);
        if (pts.length < 2) return this;
        if (side === 'end' || side === 'both')
        {
            const t = this.inner().tangentAt(1);
            const e = pts[pts.length - 1];
            pts.push([e[0] + t.x * length, e[1] + t.y * length, e[2] + t.z * length]);
        }
        if (side === 'start' || side === 'both')
        {
            const t = this.inner().tangentAt(0);
            const s = pts[0];
            pts.unshift([s[0] - t.x * length, s[1] - t.y * length, s[2] - t.z * length]);
        }
        this.update(Curve.Polyline(pts));
        return this;
    }

    grid(cx:number=2, cy:number=2, cz:number=1, spacing:number|PointLike=2):ShapeCollection<Curve>
    {
        if(typeof cx !== 'number' || typeof cy !== 'number' || typeof cz !== 'number')
        {
            throw new Error("Curve::grid(): Please supply valid numbers for counts along each axes!");
        }

        const spacingVector = (typeof spacing === 'number')
            ? new Vector(spacing, spacing, spacing)
            : Vector.from(spacing)
        const curves = new ShapeCollection<Curve>()

        for(let x=0; x<cx; x++)
        {
            for(let y=0; y<cy; y++)
            {
                for(let z=0; z<cz; z++)
                {
                    const curve = this.copy()
                    if(curve)
                    {
                        curve.move(
                            x * spacingVector.x,
                            y * spacingVector.y,
                            z * spacingVector.z,
                        )
                        curves.add(curve)
                    }
                }
            }
        }

        return curves
    }

    /** Create a row of copies of this Curve with specific spacing between them
     *
     *  Spacing is measured from the bounding boxes of the curves, so they are placed adjacent plus the specified spacing.
     *
     *  @param count     - number of copies in the row (including the original)
     *  @param spacing   - distance between bounding boxes of copies (default: 10)
     *  @param direction - direction of the row (default: 'x')
    */
    row(count:number, spacing:number=10, direction:PointLike|Axis='x'):ShapeCollection<Curve>
    {
        const dirVec = Vector.from(direction).normalize(); // auto converts Axis
        const bbox = this.bbox();
        const offsetSize = bbox
            ? new Vector(bbox.width(), bbox.depth(), bbox.height())
                .scale(dirVec)
                .length()
            : 0;

        const curves = new ShapeCollection<Curve>();

        new Array(count).fill(0).forEach((_, i) =>
        {
            const curve = (i === 0) ? this : this.copy();
            if(curve)
            {
                curve.move(dirVec.copy().scale(i * (offsetSize + spacing)));
                curves.add(curve);
            }
        });

        return curves;
    }

    /** Extend this curve to another curve or shape collection.
     *  Fires a probe ray from each end along its tangent direction and finds
     *  the closest approach to `other` (= intersection for converging curves)
     *  using ACI-refined closestPoints.  Extends the nearer end by that amount.
     */
    extendTo(other: Curve | ShapeCollection<Curve>): this
    {
        const targets: Curve[] = ShapeCollection.isShapeCollection(other)
            ? (other as ShapeCollection<Curve>).curves().toArray()
            : [other as Curve];

        if (targets.length === 0) return this;

        let bestDist = Infinity;
        let bestSide: 'start' | 'end' = 'end';

        const startPt = new Point(this.start());
        const endPt   = new Point(this.end());
        const tangentEnd   = this.tangentAt(endPt)?.normalize();
        const tangentStart = this.tangentAt(startPt)?.normalize();

        targets.forEach(target =>
        {
            // --- 'end' side ---
            if (tangentEnd)
            {
                const d = this._rayIntersectDist(endPt, tangentEnd, target);
                if (d !== null && d > 1e-6 && d < bestDist)
                {
                    bestDist = d;
                    bestSide = 'end';
                }
            }
            // --- 'start' side: ray goes in -tangent direction ---
            if (tangentStart)
            {
                const revDir = tangentStart.copy().scale(-1);
                const d = this._rayIntersectDist(startPt, revDir, target);
                if (d !== null && d > 1e-6 && d < bestDist)
                {
                    bestDist = d;
                    bestSide = 'start';
                }
            }
        });

        if (bestDist === Infinity)
        {
            console.error('Curve::extendTo(): No valid extension found to target curves. Returning original curve.');
            return this;
        }
        return this.extend(bestDist, bestSide);
    }

    /** Project a ray (origin + unit dir) onto a target curve using a probe line +
     *  ACI-refined closestPoints, returning the distance along the ray to the
     *  closest approach point.  Returns null if no forward intersection is found.
     * 
     *  TODO: clean this up after AI
     */
    private _rayIntersectDist(origin: Point, dir: Vector, target: Curve): number | null
    {
        // Probe long enough to reach well past the target
        const probeLen = this.length() * 10 + target.length() * 2 + 1000;
        const probe = Curve.Line(
            origin,
            new Point(
                origin.x + dir.x * probeLen,
                origin.y + dir.y * probeLen,
                origin.z + dir.z * probeLen,
            ),
        );
        const pair = probe.closestPoints(target);
        if (!pair) return null;
        const [ptOnProbe] = pair;
        // Project onto the ray: t = (ptOnProbe - origin) · dir
        const t = (ptOnProbe.x - origin.x) * dir.x
                + (ptOnProbe.y - origin.y) * dir.y
                + (ptOnProbe.z - origin.z) * dir.z;
        return t > 0 ? t : null;
    }

    /** Offset a Curve a given amount (+grows / −shrinks) with optional corner type. */
    offset(distance: number, cornerType:'sharp'|'round'|'smooth'='sharp'): Curve|null
    {
        if(!this.isPlanar()){ throw new Error(`Curve::offset(): Cannot offset a non-planar curve!`);}
        void cornerType; // hypercurve offset uses miter/arc joins; corner style not selectable

        // Fast path for circles: offsetting a circle just changes its radius.
        if(this.subtype() === 'Circle')
        {
            const center = this.center();
            const normal = this.normal() ?? undefined;
            const radius = center.distance(this.start());
            const newRadius = radius + distance;
            if(newRadius <= 0) { return null; }
            return this.update(Curve.Circle(newRadius, center, normal));
        }

        try
        {
            // meshup convention: +distance always grows, −distance always shrinks,
            // regardless of winding. hypercurve offsets a fixed side, so pick the sign.
            const sign = this._offsetGrowSign();
            const off = this.inner().offset(distance * sign);
            return this.update(Curve.fromCsgrs(off));
        }
        catch (e)
        {
            console.warn(`Curve::offset(): offset failed: "${e}". Returning null.`);
            return null;
        }
    }

    /** Sign such that a positive `distance` grows a closed curve and negative shrinks
     *  it (independent of winding). Probes a tiny +offset and compares enclosed area. */
    private _offsetGrowSign(): number
    {
        // meshup convention: +distance always grows the curve, −distance shrinks it,
        // regardless of winding. hypercurve offsets a fixed side, so probe which sign
        // enlarges the shape and align to it. Closed curves compare enclosed area;
        // open curves compare the bounding-box size (a fixed-side offset of an open
        // path still moves it inward or outward of its own bbox).
        try
        {
            if(this.isClosed())
            {
                const a0 = Math.abs(this.area() ?? 0);
                const a1 = Math.abs(Curve.fromCsgrs(this.inner().offset(1e-3)).area() ?? 0);
                return (a1 >= a0) ? 1 : -1;
            }
            const size = (c: Curve): number => {
                const b = c.bbox();
                return b ? (b.width() + b.depth() + b.height()) : 0;
            };
            const s0 = size(this);
            const s1 = size(Curve.fromCsgrs(this.inner().offset(1e-3)));
            return (s1 >= s0) ? 1 : -1;
        }
        catch { return 1; }
    }

    /** Fallback offset — the native hypercurve offset now handles all planar cases,
     *  so this delegates to {@link offset}. */
    offsetFallback(distance: number): Curve|null
    {
        return this.offset(distance);
    }
    

    /** Trim the curve to a sub-curve between parameters t0 and t1.
     *  Returns an array of Curves (typically one for inside trim).
     *  Parameters are in the curve's knot domain (see knotsDomain()).
     */
    trim(t0: number, t1: number): Array<Curve>;
    /** Trim this curve against another Curve — alias for cutoffBy(). */
    trim(other: Curve, keepSmallest?: boolean): Curve | ShapeCollection<Curve> | null;
    trim(t0OrOther: number | Curve, t1OrKeep?: number | boolean): Array<Curve> | Curve | ShapeCollection<Curve> | null
    {
        // When given a Curve cutter, trim behaves as an alias for cutoffBy().
        if (t0OrOther instanceof Curve)
        {
            return this.cutoffBy(t0OrOther, t1OrKeep as boolean | undefined);
        }

        try
        {
            return [this._trimByParam(t0OrOther, t1OrKeep as number)];
        }
        catch (e)
        {
            console.error('Curve::trim(): Error:', e);
            return [];
        }
    }

    /** Sub-curve between arc-length parameters `t0` and `t1` (both in [0,1]),
     *  sampled to a polyline. */
    private _trimByParam(t0: number, t1: number): Curve
    {
        // Native segment-preserving trim: interior line/arc segments are kept
        // whole, only the two boundary segments are split. No tessellation.
        try
        {
            return Curve.fromCsgrs(this.inner().trim(t0, t1));
        }
        catch (e)
        {
            // Degenerate sub-range (e.g. zero-length window) — return a copy.
            return this.copy();
        }
    }

    /** Split the curve at parameter t, returning [left, right]. 
     *  Parameter t must be within the curve's knot domain.
     */
    split(t: number): [Curve, Curve] | null
    {
        try
        {
            return [this._trimByParam(0, t), this._trimByParam(t, 1)];
        }
        catch (e)
        {
            console.error('Curve::split(): Error:', e);
            return null;
        }
    }


    
    //// INTERACTION WITH OTHER CURVES ////

    /** Get intersection points with other curve
     *   Empty array if no intersections, null if error (e.g. invalid curve type)
    */
    intersect(other:Curve):Array<Point>|null
    {
        try
        {
            // hypercurve's native intersect projects `other` into this curve's plane via
            // an exact similarity and returns the 3D hit points — no manual local-frame
            // dance needed.
            const hits = this.inner().intersect(other.inner());
            return (hits || []).map(p => Point.from(p).round());
        }
        catch (e)
        {
            console.error('Curve::intersect(): Error:', e);
            return null;
        }
    }

    /** Connect endpoints to endpoints of another Curve by creating Line
     *      and if possible create a single continuous (closed) curve
     * 
     *  Setting the distance controls behaviour:
     *  - maxGap = undefined: connect both endpoints unrelated to distance
     *  - maxGap < distance(other) - can't connect
     *  - maxGap >= distance(other) - connect closest endpoints
     */
    connect(other:Curve, maxGap?: number):this
    {
        if(!(other instanceof Curve)){ throw new Error(`Curve::connect(): Expected a Curve. Got: ${other}`); }

        const curStart = new Point(this.start());
        const curEnd   = new Point(this.end());
        const otherStart = new Point(other.start());
        const otherEnd   = new Point(other.end());

        // Two complementary ways to pair the endpoints of both curves into a single
        // continuous loop. Pick the one with the smallest total gap: that is the
        // non-crossing pairing (crossing connectors always have a larger total length).
        const pairingA = [[curStart, otherStart], [curEnd, otherEnd]] as const;   // start↔start, end↔end
        const pairingB = [[curStart, otherEnd], [curEnd, otherStart]] as const;   // start↔end,   end↔start
        const totalGap = (pairing: typeof pairingA) => pairing.reduce((sum, [a, b]) => sum + a.distance(b), 0);
        const bestPairing = totalGap(pairingA) <= totalGap(pairingB) ? pairingA : pairingB;

        // Create a connector line for each pair within maxGap (undefined = always connect).
        const addedLines: Array<Curve> = [];
        bestPairing.forEach(([a, b]) =>
        {
            const dist = a.distance(b);
            if (maxGap === undefined || dist <= maxGap)
            {
                addedLines.push(Curve.Line(a, b));
            }
        });

        // Combine both curves' spans with the added connector lines into a new CompoundCurve
        const combinedCurves = new ShapeCollection<Curve>(
                    ...this.spans().toArray().concat(
                            other.spans().toArray()).concat(addedLines)).combine();
        // The combined collection should always be a Curve or CompoundCurve
        // But just to make sure:
        if(combinedCurves.count() > 1)
        {
            console.warn(`Curve::connect(): Unexpected result: more than one combined curve. Check connectivity and maxGap.`, combinedCurves);
        }

        this._curve = combinedCurves.first()?.inner();
        
        return this;
    }

    //// BOOLEAN OPERATIONS ////
    /*
        NOTES:
            - If boolean operation succeeds:
                    - Result is single Curve: current Curve is replaced by the result
                    - Result are multiple Curves: a new ShapeCollection<Curve> is returned, current Curve is unchanged (also give warning)
            - If it fails: return original curve with warning
            - the operant (other) is not modified/removed in either case
    */

    /** Perform a boolean operation against another Curve
     *  Dispatches to the correct WASM method based on curve types.
     *  @returns ShapeCollection<Curve> of result Curves (each with holes attached), or null on error.
     */
    /** Perform a boolean operation against another Curve via hypercurve's exact
     *  NATIVE region engine (arcs/lines preserved, no tessellation). Both curves are
     *  closed regions; the other is mapped into this curve's plane by an exact
     *  similarity. Returns result Curves (each with holes attached), or null. */
    private _booleanOp(other: Curve, operation: 'union'|'difference'|'intersection'): ShapeCollection<Curve> | null
    {
        try
        {
            const regions = this.inner().boolean(other.inner(), operation) as Array<any>;
            if (!regions || regions.length === 0) { return null; }
            const curves = regions.map(rg =>
            {
                const exterior = Curve.fromCsgrs(rg.exterior);
                (rg.holes() as Array<Curve3DJs>).forEach(h => exterior.addHole(Curve.fromCsgrs(h)));
                return exterior;
            });
            return new ShapeCollection<Curve>(...curves);
        }
        catch (e)
        {
            console.warn(`Curve::${operation}(): hypercurve boolean failed:`, e);
            return null;
        }
    }

    /** Boolean union of this (closed) Curve with another (closed) Curve.
     *  Both curves must be closed and coplanar.
     *  Returns the exterior outlines of the resulting regions,
     *  or null on error.
     */
    union(other: Curve): Curve|ShapeCollection<Curve>|null
    {
        const bool = this._booleanOp(other, 'union')?.checkSingle() || null;
        if(bool instanceof Curve){ return this.update(bool);}
        else if (bool instanceof ShapeCollection)
        {
            console.warn('Curve::union(): Result are multiple curves. Returning a ShapeCollection<Curve>');
            return bool;
        }
        else { console.warn('Curve::union(): Boolean operation failed. Returning null.'); return null; }
    }

    /** Boolean subtraction: this Curve minus the other Curve.
     *  Both curves must be closed and coplanar.
     *  Returns the exterior outlines of the resulting regions,
     *  or null on error.
     */
    difference(other: Curve): Curve|ShapeCollection<Curve>|null
    {
        const bool = this._booleanOp(other, 'difference')?.checkSingle() || null;
        if(bool instanceof Curve){ return this.update(bool);}
        else if (bool instanceof ShapeCollection)
        {
            console.warn('Curve::difference(): Result are multiple curves. Returning a ShapeCollection<Curve>');
            return bool;
        }
        else { console.warn('Curve::difference(): Boolean operation failed. Returning null.'); return null; }
    }

    // Alias for difference
    subtract(other: Curve): Curve|ShapeCollection<Curve>|null
    {
        return this.difference(other);
    }

    /** Cut current Curve by other and keep the biggest part (inside other).
     *  Set keepSmallest=true to keep the smallest part instead.
     *
     *  - Open this Curve (e.g. a line): split at the intersection point(s) with other
     *    and keep the biggest/smallest segment.
     *  - Closed this Curve + closed other: region boolean (intersection/difference).
     *  - Closed this Curve + open other (e.g. a line crossing it): split the closed
     *    curve along the cutter into two regions and keep the biggest/smallest by area.
     */
    cutoffBy(other: Curve, keepSmallest?: boolean): Curve|ShapeCollection<Curve>|null
    {
        // Region boolean only makes sense for closed curves; an open curve is
        // instead split at its intersection points (like a brep Edge/Wire cutoffBy).
        if(!this.isClosed())
        {
            return this._cutoffOpen(other, keepSmallest);
        }
        if(!other.isClosed())
        {
            return this._cutoffClosedByLine(other, keepSmallest);
        }
        return keepSmallest ? this.difference(other) : this._booleanOp(other, 'intersection')?.checkSingle() || null;
    }

    /** Split this closed Curve along an open cutter Curve into the two regions either
     *  side of the cutter chord, and keep the biggest (default) or smallest by area.
     *  Mutates and returns this; returns this unchanged when the cutter doesn't cross it. */
    private _cutoffClosedByLine(other: Curve, keepSmallest?: boolean): Curve|null
    {
        const hits = this.intersect(other);
        if(!hits || hits.length < 2)
        {
            console.warn('Curve::cutoffBy(): the cutter does not cross the closed curve (need 2 intersections) — no cut performed. Returning original Curve.');
            return this;
        }

        const [d0, d1] = this.inner().knotsDomain();
        const eps = (d1 - d0) * 1e-6;

        // Params where the cutter crosses the boundary, de-duplicated and ordered.
        const params: Array<number> = [];
        for(const pt of hits)
        {
            const t = this.paramClosestToPoint(pt);
            if(t === null) continue;
            if(params.every(p => Math.abs(p - t) > eps)) params.push(t);
        }
        params.sort((a, b) => a - b);

        if(params.length < 2)
        {
            console.warn('Curve::cutoffBy(): the cutter only grazes the closed curve — no cut performed. Returning original Curve.');
            return this;
        }
        if(params.length > 2)
        {
            console.warn(`Curve::cutoffBy(): cutter crosses the closed curve ${params.length} times; using the first and last crossing.`);
        }

        const tA = params[0];
        const tB = params[params.length - 1];

        // The two boundary arcs between the crossings; each closed by the chord (close()).
        const region1 = this._closedRegionFromArc(this.trim(tA, tB));
        const region2 = this._closedRegionFromArc([...this.trim(tB, d1), ...this.trim(d0, tA)]);

        if(!region1 || !region2)
        {
            console.warn('Curve::cutoffBy(): could not build the split regions — no cut performed. Returning original Curve.');
            return this;
        }

        const a1 = region1.area() ?? 0;
        const a2 = region2.area() ?? 0;
        const bigger = (a1 >= a2) ? region1 : region2;
        const smaller = (a1 >= a2) ? region2 : region1;

        return this.update(keepSmallest ? smaller : bigger);
    }

    /** Combine boundary arc curves (in order) into a single closed region Curve by
     *  concatenating their spans and closing end→start with the cutter chord. */
    private _closedRegionFromArc(arcCurves: Array<Curve>): Curve|null
    {
        const pts: Point[] = [];
        for(const c of arcCurves)
        {
            for(const p of c.controlPoints())
            {
                if(pts.length === 0 || pts[pts.length - 1].distance(p) > Curve.ZERO_LENGTH_TOLERANCE) { pts.push(p); }
            }
        }
        if(pts.length < 2) return null;
        return Curve.Polyline(pts.map(p => [p.x, p.y, p.z] as [number, number, number])).close();
    }

    /** Split this (open) Curve at its intersection point(s) with other and keep
     *  the biggest (default) or smallest resulting segment. Mutates and returns this.
     *  Returns this unchanged (with a warning) when the curves don't intersect. */
    private _cutoffOpen(other: Curve, keepSmallest?: boolean): Curve|ShapeCollection<Curve>|null
    {
        const hits = this.intersect(other);
        if(!hits || hits.length === 0)
        {
            console.warn('Curve::cutoffBy(): the curves do not intersect — no cut performed. Returning original Curve.');
            return this;
        }

        const [d0, d1] = this.inner().knotsDomain();
        const eps = (d1 - d0) * 1e-6;

        // Map intersection points to curve parameters strictly inside the domain
        const params = hits
            .map(pt => this.paramClosestToPoint(pt))
            .filter((t): t is number => t !== null && t > d0 + eps && t < d1 - eps)
            .sort((a, b) => a - b);

        if(params.length === 0)
        {
            console.warn('Curve::cutoffBy(): intersection only touches the Curve endpoints — no cut performed. Returning original Curve.');
            return this;
        }

        // Build the segments between consecutive split parameters
        const breaks = [d0, ...params, d1];
        const segments: Array<{ curves: Array<Curve>, length: number }> = [];
        for(let i = 0; i < breaks.length - 1; i++)
        {
            const curves = this.trim(breaks[i], breaks[i + 1]);
            if(curves.length === 0) continue;
            segments.push({ curves, length: curves.reduce((sum, c) => sum + c.length(), 0) });
        }

        if(segments.length === 0)
        {
            console.warn('Curve::cutoffBy(): split produced no segments — no cut performed. Returning original Curve.');
            return this;
        }

        segments.sort((a, b) => b.length - a.length);
        const winner = keepSmallest ? segments[segments.length - 1] : segments[0];

        return (winner.curves.length === 1)
            ? this.update(winner.curves[0])
            : new ShapeCollection<Curve>(...winner.curves);
    }

    /** Get intersecting Curves with either closed Curves or Mesh */
    intersections(other: Curve|Mesh): ShapeCollection<Curve>|null
    {
        return (other instanceof Mesh) 
                    ? this._intersectionMesh(other) 
                    : this._intersectionCurve(other);
    }

    /** Get single intersection of Curve with another Curve or Mesh */
    intersection(other: Curve|Mesh): Curve|ShapeCollection<Curve>|null
    {
        return this.intersections(other)?.checkSingle() || null;
    }

    /** Boolean intersection of this (closed) Curve with another (closed) Curve.
     *  Both curves must be closed and coplanar.
     *  Returns the exterior outlines of the resulting regions,
     *  or null on error.
     *
     *  NOTE: This is curve-vs-curve boolean intersection.
     *        For intersection with a Mesh, use `intersection(mesh)` instead.
     */
    private _intersectionCurve(other: Curve): ShapeCollection<Curve> | null
    {
        if(!this.isClosed){ throw new Error('Curve::intersection(): Intersection requires closed curves for now!'); }
        
        return this._booleanOp(other, 'intersection');
    }

    /** Intersect this Curve with a Mesh and return the trimmed sub-curve(s) as ShapeCollection<Curve>.
     *  If the curve doesn't intersect the mesh, returns null
     *
     *  With an even number of intersections the curve alternates
     *  between outside and inside the mesh. The "inside" segments are returned.
     *  With two intersection points, a single trimmed curve is returned.
     *
     *  @param mesh - The Mesh to intersect with
     *  @param tolerance - Tessellation tolerance for finding intersections (default: 1e-4)
     *  @returns Array of Curve segments that lie inside the mesh
     */
    private _intersectionMesh(mesh: Mesh, tolerance?: number): ShapeCollection<Curve>|null
    {
        if(!mesh || !(mesh instanceof Mesh))
        {
            throw new Error('Curve::intersection(): Please supply a valid Mesh instance!');
        }

        // Find intersection points
        const hitPoints = this._intersectionPointsMesh(mesh, tolerance);
        if(hitPoints.length < 2)
        {
            // 0 hits = curve is either entirely inside or entirely outside
            // 1 hit = tangent touch, no enclosed segment
            return null;
        }

        // Map each intersection point to a curve parameter
        const params: Array<number> = [];
        for(const pt of hitPoints)
        {
            const p = this.paramClosestToPoint(pt);
            if(p !== null) params.push(p);
        }
        params.sort((a, b) => a - b);

        if(params.length < 2) return null;

        // Determine which segments are inside: 
        //    test the midpoint of each consecutive pair
        const results: Array<Curve> = [];
        const meshInner = (mesh as any)._mesh;

        for(let i = 0; i < params.length - 1; i++)
        {
            const t0 = params[i];
            const t1 = params[i + 1];
            const tMid = (t0 + t1) / 2;
            const midPoint = this.pointAtParam(tMid);

            // Check if the midpoint is inside the mesh
            if(meshInner?.containsVertex(midPoint.toPoint3Js()))
            {
                const trimmed = this.trim(t0, t1);
                results.push(...trimmed);
            }
        }

        return (results.length > 0) ? new ShapeCollection<Curve>(results) : null;
    }

    /** Find intersection points between this Curve and a Mesh.
     *  The curve is tessellated into a polyline and each segment is tested
     *  against every triangle of the mesh surface.
     * 
     *  @param mesh - A Mesh instance to test against
     *  @param tolerance - Tessellation tolerance for the curve (default: 1e-4)
     *  @returns Array of intersection Points, in order along the curve. Empty array if none found.
     */
    private _intersectionPointsMesh(mesh: Mesh, tolerance?: number): Array<Point>
    {
        if(!mesh || !(mesh instanceof Mesh))
        {
            throw new Error('Curve::intersectMesh(): Please supply a valid Mesh instance!');
        }

        try
        {
            const meshInner = (mesh as any)._mesh;
            if(!meshInner){ throw new Error('Mesh has no inner WASM object'); }

            // TODO: MeshJs.intersectCurve still expects the legacy curve type; wire a Curve3DJs path.
            const pts = mesh.inner()?.intersectCurve(this.inner() as any, tolerance);

            return (pts || []).map((p: any) => Point.from(p));
        }
        catch (e)
        {
            console.error('Curve::intersectMesh(): Error:', e);
            return [];
        }
    }

    //// SURFACES/SOLIDS OPERATIONS ////

    /** Extrude this curve along a direction to create a Mesh.
     *  If the curve is closed and planar, creates a solid extrusion.
     *  If the curve is open or non-planar, creates a swept surface.
     *  @param length - The extrusion length (default: 1) 
     *  @param direction - The extrusion direction vector (default planar normal or [0,0,1])
     *  @returns A new Mesh representing the extruded geometry
     * 
     *  NOTE: bring this into the Rust/WASM layer?
     */
    extrude(length: number, direction?: PointLike): Mesh | Polygon | null
    {
        if (!this._curve) { return null; }

        // Default to the curve's own planar normal so a closed planar curve extrudes
        // perpendicular to its own plane rather than always along world Z.
        const resolvedDirection = direction ?? (this.isPlanar() ? this.normal() : null) ?? [0, 0, 1];

        const d = Vector.from(resolvedDirection as any).normalize().scale(length);
        const dirVec = new Vector3Js(d.x, d.y, d.z);

        // A straight, open curve sweeps into a single flat quad. Return a planar Polygon
        // (which itself has .extrude() to build a solid) rather than a Mesh.
        if (!this.isClosed() && this.isStraight())
        {
            const s = this.start();
            const e = this.end();
            return new Polygon([
                [s.x,       s.y,       s.z],
                [e.x,       e.y,       e.z],
                [e.x + d.x, e.y + d.y, e.z + d.z],
                [s.x + d.x, s.y + d.y, s.z + d.z],
            ]);
        }

        // A closed, planar curve encloses a face: extrude it as a solid prism via
        // Polygon.extrude(), which guarantees consistent outward-facing winding. The
        // hand-rolled NURBS-wall + cap construction below builds the side walls (from the
        // extruded surface tessellation) and the end caps independently, so their orientations
        // can disagree — producing an inverted/mixed solid that measures a positive volume but
        // fails as a boolean cutter (mesh.difference(it) keeps the cutter instead of removing
        // it). Delegating keeps a single, correct orientation path.
        if (this.isClosed() && this.isPlanar())
        {
            const face = this.toPolygon();
            if (face) { return face.extrude(length, resolvedDirection as any); }
        }

        void dirVec;
        // Open / curved curve: sweep its tessellated profile along `d`, stitching a
        // quad per segment (hypercurve has no surfaces, so we build the mesh directly).
        const profile = this.tessellate();
        const mkVert = (x: number, y: number, z: number) =>
            new VertexJs(new Point3Js(x, y, z), new Vector3Js(0, 0, 0));
        const polygons: PolygonJs[] = [];
        for (let i = 0; i < profile.length - 1; i++)
        {
            const a = profile[i];
            const b = profile[i + 1];
            polygons.push(new PolygonJs([
                mkVert(a.x, a.y, a.z),
                mkVert(b.x, b.y, b.z),
                mkVert(b.x + d.x, b.y + d.y, b.z + d.z),
                mkVert(a.x + d.x, a.y + d.y, a.z + d.z),
            ], {}));
        }

        // If closed and planar, add end caps so the result is a watertight solid
        if (this.isClosed() && this.isPlanar())
        {
            const pts = this.tessellate();
            // Drop the closing duplicate point if present (many closed curves repeat the first vertex)
            const capPts = (pts.length > 1 && pts[0].distance(pts[pts.length - 1]) < 1e-6)
                ? pts.slice(0, -1)
                : pts;

            if (capPts.length >= 3)
            {
                const extrusionDir = Vector.from(resolvedDirection as any).normalize();
                const curveNormal  = this.normalOrientation();

                // When the curve normal is aligned with the extrusion direction, the original
                // winding order faces "upward" — so the bottom cap needs reversed winding to
                // face downward, and the top cap keeps the original winding.
                // When the curve normal opposes the extrusion direction, the roles swap.
                const needsReverse = curveNormal !== null
                    ? curveNormal.dot(extrusionDir) > 0
                    : true;

                const bottomPts = needsReverse ? [...capPts].reverse() : capPts;
                const topPts    = needsReverse ? capPts : [...capPts].reverse();

                // Vertex normals: flat-shaded caps use ±extrusionDir
                const botNorVec = new Vector3Js(-extrusionDir.x, -extrusionDir.y, -extrusionDir.z);
                const topNorVec = new Vector3Js( extrusionDir.x,  extrusionDir.y,  extrusionDir.z);

                const bottomVerts = bottomPts.map(p =>
                    new VertexJs(new Point3Js(p.x, p.y, p.z), botNorVec)
                );
                const topVerts = topPts.map(p =>
                    new VertexJs(new Point3Js(p.x + d.x, p.y + d.y, p.z + d.z), topNorVec)
                );

                polygons.push(new PolygonJs(bottomVerts, {}));
                polygons.push(new PolygonJs(topVerts,    {}));
            }
        }

        if (polygons.length === 0) { return null; }
        return Mesh.from(this._csgrs.MeshJs.fromPolygons(polygons, {}));
    }

    /** Loft a ruled surface/solid through this curve and one or more other curves.
     *  Builds a ruled mesh by stitching the tessellated profiles.
     *
     *  - **Open profiles** → a lofted surface. Two straight open curves give a single flat
     *    `Polygon` (quad); any other open loft returns a triangulated surface `Mesh`.
     *  - **Closed profiles** → a `Mesh`. With `solid = true` (default) end caps are added at
     *    the first and last profile for a watertight solid; with `solid = false` only the
     *    open tube wall is returned.
     *
     *  @param others  A single Curve or an array of Curves to loft through (in order after this).
     *  @param solid   When all profiles are closed, cap the ends into a watertight solid (default true).
     *  @returns A new Mesh or Polygon, or null on invalid input.
     */
    loft(others: Curve | Curve[], solid: boolean = true): Mesh | Polygon | null
    {
        if (!this._curve) { return null; }

        const otherList = Array.isArray(others) ? others : [others];
        const profiles: Curve[] = [this, ...otherList];

        if (profiles.some(p => !(p instanceof Curve) || !p.inner()))
        {
            console.warn('Curve::loft(): all inputs must be initialized Curves.');
            return null;
        }
        if (profiles.length < 2)
        {
            console.warn('Curve::loft(): need at least two profile curves to loft.');
            return null;
        }

        const allClosed = profiles.every(p => p.isClosed());
        const allStraightOpen = profiles.every(p => !p.isClosed() && p.isStraight());

        // Two straight open curves loft into a single flat quad — return a planar Polygon
        // (which itself has .extrude()) rather than a tessellated Mesh, matching extrude().
        if (allStraightOpen && profiles.length === 2)
        {
            const s0 = profiles[0].start(); const e0 = profiles[0].end();
            const s1 = profiles[1].start(); const e1 = profiles[1].end();
            return new Polygon([
                [s0.x, s0.y, s0.z],
                [e0.x, e0.y, e0.z],
                [e1.x, e1.y, e1.z],
                [s1.x, s1.y, s1.z],
            ]);
        }

        // Ruled loft: resample every profile to the same number of points (by
        // arc-length parameter) and stitch corresponding points between consecutive
        // profiles into quads. hypercurve has no surfaces, so we build the mesh directly.
        const N = 64;
        const rings: Point[][] = profiles.map(p =>
        {
            const r: Point[] = [];
            for (let i = 0; i <= N; i++) { r.push(new Point(p.inner().pointAt(i / N))); }
            return r;
        });
        const mkVert = (pt: Point) => new VertexJs(new Point3Js(pt.x, pt.y, pt.z), new Vector3Js(0, 0, 0));
        const polygons: PolygonJs[] = [];
        for (let k = 0; k < rings.length - 1; k++)
        {
            const A = rings[k];
            const B = rings[k + 1];
            for (let i = 0; i < N; i++)
            {
                polygons.push(new PolygonJs([mkVert(A[i]), mkVert(A[i + 1]), mkVert(B[i + 1]), mkVert(B[i])], {}));
            }
        }

        // Cap the two end profiles into a watertight solid when all profiles are closed.
        if (allClosed && solid)
        {
            const first = profiles[0];
            const last  = profiles[profiles.length - 1];
            // Outward cap normals point away from the neighbouring profile.
            const firstOut = Vector.from(first.center()).subtracted(profiles[1].center()).normalize();
            const lastOut  = Vector.from(last.center()).subtracted(profiles[profiles.length - 2].center()).normalize();

            const firstCap = this._makeCap(first, firstOut);
            const lastCap  = this._makeCap(last, lastOut);
            if (firstCap) { polygons.push(firstCap); }
            if (lastCap)  { polygons.push(lastCap); }
        }

        if (polygons.length === 0) { return null; }
        return Mesh.from(this._csgrs.MeshJs.fromPolygons(polygons, {}));
    }

    /** Build a single cap face for a closed profile, wound so its normal faces `outward`. */
    private _makeCap(profile: Curve, outward: Vector): PolygonJs | null
    {
        const pts = profile.tessellate();
        // Drop the closing duplicate point if present (closed curves repeat the first vertex).
        const capPts = (pts.length > 1 && pts[0].distance(pts[pts.length - 1]) < 1e-6)
            ? pts.slice(0, -1)
            : pts;
        if (capPts.length < 3) { return null; }

        const curveNormal = profile.normalOrientation();
        // Keep original winding when the curve's own normal already faces outward, else reverse.
        const needsReverse = curveNormal !== null ? curveNormal.dot(outward) < 0 : false;
        const orderedPts = needsReverse ? [...capPts].reverse() : capPts;

        const norVec = new Vector3Js(outward.x, outward.y, outward.z);
        const verts = orderedPts.map(p => new VertexJs(new Point3Js(p.x, p.y, p.z), norVec));
        return new PolygonJs(verts, {});
    }



    //// TRANSFORMATION TO OTHER TYPES ////

    /** Convert this curve to a Polygon via tessellation (including hole rings if present). */
    toPolygon(tolerance: number = TESSELATION_TOLERANCE): Polygon | undefined
    {
        this.close(); // ensure the curve is closed before tessellation
        const points = this.tessellate(tolerance);

        if (points.length < 3)
        {
            console.warn(`Curve::toPolygon(): Not enough points (${points.length}) to create a polygon. A minimum of 3 non-collinear points is required.`);
            return undefined;
        }

        const poly = new Polygon(points);

        if (this.hasHoles())
        {
            this._holes.forEach(hole =>
            {
                const holePoints = hole.tessellate(tolerance);
                if (holePoints.length >= 3)
                {
                    poly.addHole(holePoints);
                }
            });
        }
        return poly;
    }

    /** Alias for toPolygon() */
    toFace(tolerance: number = TESSELATION_TOLERANCE): Polygon | undefined
    {
        return this.toPolygon(tolerance);
    }

    toMesh(tolerance: number = TESSELATION_TOLERANCE): Mesh | undefined
    {
        const poly = this.toPolygon(tolerance);
        if (!poly)
        {
            return undefined;
        }

        // Build mesh from one polygon (preserves holes on PolygonJs level)
        const m = Mesh.from(this._csgrs.MeshJs.fromPolygons([poly.inner()], {}));

        // When converting to Mesh, the orientation is important for the resulting normal of new polygons/faces.
        // Once case is ackward: If Curve normal (based on orientation) is pointing away from default camera position ([0,1,0])
        // It is not immediately visible. Correct this.
        return ((this.isPlanar() && this.normalOrientation()!.dot(Vector.from(0, 1, 0)) < 0))
                ? m.inverse()
                : m;
    }

     //// STYLING ////
    /** Forwards to Style instance */

    /** Set color (both stroke and fill) of (closed) Curve */
    color(color: number|string, g?: number, b?: number): this
    {
        if (typeof color === 'number' && typeof g === 'number' && typeof b === 'number')
        {
            this.style.color = [color, g, b];
        }
        else
        {
            this.style.color = color as string;
        }
        return this;
    }

    /** Set opacity of (closed) Curve */
    opacity(opacity: number): this
    {
        this.style.opacity = opacity;
        return this;
    }

    /** Alias for `opacity()`. */
    alpha(a: number): this { return this.opacity(a); }

    /** Set stroke dash pattern. Defaults to [2, 2] when called with no arguments. */
    dashed(dash: number[] = [2, 2]): this
    {
        this.style.strokeDash = dash;
        return this;
    }

    //// LAYOUT & ALIGNMENT ////

    /** Rotate the curve to lay flat on the XY plane, then drop it so its lowest point sits at Z = 0.
     *  Uses a shortest-arc rotation to align the thinnest OBB axis with world +Z, leaving the
     *  in-plane orientation untouched (avoids instability for symmetric curves with equal eigenvalues).
     */
    layflat(): this
    {
        let thinAxis = this.obbox().axes()[2].copy();
        if (thinAxis.dot(Vector.from(0, 0, 1)) < 0) thinAxis.reverse();

        const dot = thinAxis.dot(Vector.from(0, 0, 1));
        let q: { x: number; y: number; z: number; w: number };
        if (dot >= 1 - 1e-10)
        {
            q = { x: 0, y: 0, z: 0, w: 1 };
        }
        else if (dot <= -1 + 1e-10)
        {
            q = { x: 1, y: 0, z: 0, w: 0 };
        }
        else
        {
            const cr = thinAxis.copy().cross(Vector.from(0, 0, 1));
            const qw = 1 + dot;
            const len = Math.hypot(cr.x, cr.y, cr.z, qw) || 1;
            q = { x: cr.x / len, y: cr.y / len, z: cr.z / len, w: qw / len };
        }

        this.rotateQuaternion(q);
        const bb = this.bbox();
        return bb ? this.translate(0, 0, -bb.minZ()) : this;
    }

    //// OUTPUTS ////

    toString()
    {
        return `<Curve (${this.isCompound() ? 'Compound' : 'Single'}): length="${this.length().toFixed(3)}", planar="${this.isPlanar()}", closed="${this.isClosed()}">`;
    }

    /** Return raw tessellated points as a flat Float32Array (xyz per point, no axis remapping).
     *  Used by GLTFBuilder to assemble GLTF geometry. */
    toBuffer(): Float32Array
    {
        const points = this.tessellate();
        const buf = new Float32Array(points.length * 3);
        points.forEach((p, i) => { buf[i * 3] = p.x; buf[i * 3 + 1] = p.y; buf[i * 3 + 2] = p.z; });
        return buf;
    }

    /**
     * Return just the SVG element for this curve (`<path>` or `<circle>`),
     * without the outer `<svg>` wrapper. Used by SceneNode to compose hierarchies.
     * Assumes the curve is already 2D (on the XY plane). Use `is2D()` to check first.
     */
    toSVGElem(cssClass?: string): string
    {
        const fmt = (n: number) => +n.toFixed(6);
        const to2D = (p: { x: number; y: number; z: number }): [number, number] => [p.x, -p.y];
        const classAttr = cssClass ? ` class="${cssClass}"` : '';

        if (this.subtype() === 'Circle')
        {
            const bb = this.bbox();
            if (bb)
            {
                const cx = fmt((bb.min().x + bb.max().x) / 2);
                const cy = fmt(-((bb.min().y + bb.max().y) / 2));
                const r  = fmt((bb.max().x - bb.min().x) / 2);
                return `<circle cx="${cx}" cy="${cy}" r="${r}"${classAttr} ${this.style.toSvgAttrs(true)}/>`;
            }
        }

        const pathParts: string[] = [];
        const spans = this._getSvgSpans();

        spans.forEach((spanRaw, si) =>
        {
            const spanCurve = spanRaw;
            const cps = spanCurve.controlPoints();
            const curveType = spanCurve.subtype();

            if (si === 0)
            {
                const [sx, sy] = to2D(cps[0]);
                pathParts.push(`M${fmt(sx)} ${fmt(sy)}`);
            }

            switch (curveType)
            {
                case 'Line':
                case 'Polyline':
                case 'Rect':
                {
                    cps.slice(1).forEach(cp =>
                    {
                        const [x, y] = to2D(cp);
                        pathParts.push(`L${fmt(x)} ${fmt(y)}`);
                    });
                    break;
                }
                case 'Arc':
                case 'Circle':
                {
                    _appendArcSvg(spanRaw, to2D, fmt, pathParts);
                    break;
                }
                case 'Spline':
                {
                    const deg = spanRaw.degree() ?? 1;
                    const weights = Array.from(spanRaw.weights());
                    const bezierSegs = _bsplineToBezierSegments(
                        spanRaw.controlPoints(), Array.from(spanRaw.knots()), weights, deg);

                    if (deg === 2)
                    {
                        bezierSegs.forEach(seg =>
                        {
                            const [, cp1, end] = seg.map(to2D);
                            pathParts.push(`Q${fmt(cp1[0])} ${fmt(cp1[1])} ${fmt(end[0])} ${fmt(end[1])}`);
                        });
                    }
                    else
                    {
                        bezierSegs.forEach(seg =>
                        {
                            const [, cp1, cp2, end] = seg.map(to2D);
                            pathParts.push(`C${fmt(cp1[0])} ${fmt(cp1[1])} ${fmt(cp2[0])} ${fmt(cp2[1])} ${fmt(end[0])} ${fmt(end[1])}`);
                        });
                    }
                    break;
                }
                default:
                {
                    spanCurve.tessellate().slice(1).forEach(pt =>
                    {
                        const [x, y] = to2D(pt);
                        pathParts.push(`L${fmt(x)} ${fmt(y)}`);
                    });
                    break;
                }
            }
        });

        if (this.isClosed()) pathParts.push('Z');

        const d = pathParts.join(' ');
        return `<path d="${d}"${classAttr} ${this.style.toSvgAttrs(this.isClosed())}/>`;
    }

    /** Export this curve as a self-contained GLTF JSON string (LINE_STRIP). */
    async toGLTF(up: Axis = 'z'): Promise<string>
    {
        return new GLTFBuilder(up).add(this).applyExtensions().toGLTF();
    }

    /** Export this curve as a GLB binary (Uint8Array, LINE_STRIP). */
    async toGLB(up: Axis = 'z'): Promise<Uint8Array>
    {
        return new GLTFBuilder(up).add(this).applyExtensions().toGLB();
    }

    /** Export this curve as a self-contained SVG string.
     *  Assumes the curve is already 2D (on the XY plane).
     *  Preserves arc geometry: degree-2 rational NURBS → SVG `A`, quadratic → `Q`, cubic → `C`, line → `L`.
     */
    toSVG(): string
    {
        const element = this.toSVGElem();
        const fmt = (n: number) => +n.toFixed(6);

        const bb = this.bbox();
        let vbX: number, vbY: number, vbW: number, vbH: number;
        if (bb)
        {
            const svgW = bb.max().x - bb.min().x;
            const svgH = bb.max().y - bb.min().y;
            const pad = Math.max(svgW, svgH) * 0.05 || 1;
            vbX = fmt(bb.min().x - pad);
            vbY = fmt(-bb.max().y - pad);
            vbW = fmt(svgW + 2 * pad);
            vbH = fmt(svgH + 2 * pad);
        }
        else
        {
            vbX = 0; vbY = 0; vbW = 1; vbH = 1;
        }

        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}">${element}</svg>`;
    }

    /** Collect the individual native spans (arcs/lines) of this curve for SVG export.
     *  Native geometry already stores each arc/line as a separate open segment, so a
     *  circle comes back as two open arcs — no closed-span splitting needed. */
    private _getSvgSpans(): Curve[]
    {
        return this.spans().toArray();
    }
}

/**
 * Decompose a B-spline into piecewise Bezier segments via Boehm's knot insertion.
 *
 * For a degree-p B-spline with a clamped knot vector, each interior knot must
 * have multiplicity p for the curve to split into independent Bezier pieces.
 * After full insertion, every (p+1) consecutive control points define one Bezier segment.
 *
 * @returns Array of Bezier segments, each is an array of (degree+1) 3D points.
 */
function _bsplineToBezierSegments(
    controlPoints: { x: number; y: number; z: number }[],
    knots: number[],
    weights: number[],
    degree: number,
): Array<Array<{ x: number; y: number; z: number }>>
{
    // Work in homogeneous coordinates for rational curves:  (w*x, w*y, w*z, w)
    let pts = controlPoints.map((p, i) =>
    {
        const w = weights[i] ?? 1;
        return { x: p.x * w, y: p.y * w, z: p.z * w, w };
    });
    let U = knots.slice(); // mutable copy

    // Find distinct interior knots and insert each until multiplicity == degree
    const p = degree;
    const interiorKnots = _distinctInteriorKnots(U, p);

    interiorKnots.forEach(({ value, multiplicity }) =>
    {
        const timesToInsert = p - multiplicity;
        Array.from({ length: timesToInsert }, () =>
        {
            const result = _boehmInsert(pts, U, p, value);
            pts = result.points;
            U = result.knots;
        });
    });

    // After full knot insertion, each Bezier segment spans (p+1) control points
    // with overlap at boundary points.
    const numSegments = (pts.length - 1) / p;

    return Array.from({ length: numSegments }, (_, i) =>
        Array.from({ length: p + 1 }, (_, j) =>
        {
            const h = pts[i * p + j];
            const invW = h.w !== 0 ? 1 / h.w : 1;
            return { x: h.x * invW, y: h.y * invW, z: h.z * invW };
        })
    );
}

/** Get the distinct interior knots and their multiplicities. */
function _distinctInteriorKnots(
    knots: number[],
    degree: number
): Array<{ value: number; multiplicity: number }>
{
    const result: Array<{ value: number; multiplicity: number }> = [];
    const n = knots.length;
    // Interior knots are those strictly between the clamped ends
    // For a clamped knot vector, the first (degree+1) and last (degree+1) knots are at the boundaries
    const lo = knots[degree];
    const hi = knots[n - degree - 1];

    let i = degree + 1;
    while (i < n - degree - 1) // perf: keep as loop (stateful index advance)
    {
        const val = knots[i];
        if (val > lo && val < hi)
        {
            let mult = 0;
            let j = i;
            while (j < n - degree - 1 && Math.abs(knots[j] - val) < 1e-12) // perf: keep as loop
            {
                mult++;
                j++;
            }
            result.push({ value: val, multiplicity: mult });
            i = j;
        }
        else
        {
            i++;
        }
    }
    return result;
}

/**
 * Boehm's single knot insertion.
 * Insert knot value `u` once into the B-spline defined by `pts`, `knots`, `degree`.
 */
function _boehmInsert(
    pts: Array<{ x: number; y: number; z: number; w: number }>,
    knots: number[],
    degree: number,
    u: number
): { points: Array<{ x: number; y: number; z: number; w: number }>; knots: number[] }
{
    const n = pts.length;
    const p = degree;

    // Find knot span k such that knots[k] <= u < knots[k+1]
    const kIdx = knots.slice(p, knots.length - 1).findIndex((kv, off) =>
        kv <= u + 1e-12 && u < knots[p + off + 1] - 1e-12
    );
    const k = kIdx === -1 ? knots.length - p - 2 : p + kIdx;

    // Compute new control points
    const newPts = Array.from({ length: n + 1 }, (_, i) =>
    {
        if (i <= k - p)
        {
            return { ...pts[i] };
        }
        else if (i >= k + 1)
        {
            return { ...pts[i - 1] };
        }
        else
        {
            // k-p+1 <= i <= k
            const denom = knots[i + p] - knots[i];
            const alpha = denom > 1e-14 ? (u - knots[i]) / denom : 0;
            return {
                x: (1 - alpha) * pts[i - 1].x + alpha * pts[i].x,
                y: (1 - alpha) * pts[i - 1].y + alpha * pts[i].y,
                z: (1 - alpha) * pts[i - 1].z + alpha * pts[i].z,
                w: (1 - alpha) * pts[i - 1].w + alpha * pts[i].w,
            };
        }
    });

    // Insert knot value into knot vector
    const newKnots = [...knots.slice(0, k + 1), u, ...knots.slice(k + 1)];

    return { points: newPts, knots: newKnots };
}

/** Append SVG arc (A) commands for a rational degree-2 NURBS span (circle/arc).
 *  Expects the span to already be projected onto XY. Uses (x, -y) for SVG coordinates.
 *  Uses the circumcircle of three sampled points to determine the radius,
 *  and the cross product to determine the sweep direction. */
function _appendArcSvg(
    span: Curve,
    to2D: (p: { x: number; y: number; z: number }) => [number, number],
    fmt: (n: number) => number,
    pathParts: string[]
): void
{
    const cps = span.controlPoints();
    const [domain0, domain1] = Array.from(span.knotsDomain() ?? [0, 1]);
    const midParam = (domain0 + domain1) / 2;
    const startPt3 = cps[0];
    const midPt3 = span.pointAtParam(midParam);
    const endPt3 = cps[cps.length - 1];

    const start2D = to2D(startPt3);
    const mid2D = to2D(midPt3);
    const end2D = to2D(endPt3);

    const circ = _circumcircle2D(start2D[0], start2D[1], mid2D[0], mid2D[1], end2D[0], end2D[1]);

    if (!circ)
    {
        // Degenerate (collinear) — fall back to a line
        pathParts.push(`L${fmt(end2D[0])} ${fmt(end2D[1])}`);
        return;
    }

    const r = fmt(circ.r);

    const cross = (end2D[0] - start2D[0]) * (mid2D[1] - start2D[1])
                - (end2D[1] - start2D[1]) * (mid2D[0] - start2D[0]);
    const sweepFlag = cross > 0 ? 0 : 1;

    const dx1 = start2D[0] - circ.cx, dy1 = start2D[1] - circ.cy;
    const dx2 = end2D[0] - circ.cx, dy2 = end2D[1] - circ.cy;

    const angleStart = Math.atan2(dy1, dx1);
    const angleEnd = Math.atan2(dy2, dx2);

    let sweepToEnd = sweepFlag === 1
        ? (angleEnd - angleStart + 2 * Math.PI) % (2 * Math.PI)
        : (angleStart - angleEnd + 2 * Math.PI) % (2 * Math.PI);

    const largeArcFlag = sweepToEnd > Math.PI ? 1 : 0;

    pathParts.push(`A${r} ${r} 0 ${largeArcFlag} ${sweepFlag} ${fmt(end2D[0])} ${fmt(end2D[1])}`);
}

/** Test whether two 2D segments (p1→p2) and (p3→p4) properly cross — i.e. each
 *  segment straddles the line through the other. Collinear/endpoint-only touches
 *  are intentionally NOT counted, keeping the test robust against tessellation
 *  artifacts on near-tangent curves. */
function _seg2DProperlyIntersect(
    p1: [number, number], p2: [number, number],
    p3: [number, number], p4: [number, number],
): boolean
{
    const cross = (a: [number, number], b: [number, number], c: [number, number]) =>
        (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

    const d1 = cross(p3, p4, p1);
    const d2 = cross(p3, p4, p2);
    const d3 = cross(p1, p2, p3);
    const d4 = cross(p1, p2, p4);

    return (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0))
         && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0)));
}

/** Compute the circumcircle of three 2D points. Returns null if points are collinear. */
function _circumcircle2D(
    ax: number, ay: number,
    bx: number, by: number,
    cx: number, cy: number
): { cx: number; cy: number; r: number } | null
{
    const D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (Math.abs(D) < 1e-10) return null;
    const a2 = ax * ax + ay * ay;
    const b2 = bx * bx + by * by;
    const c2 = cx * cx + cy * cy;
    const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / D;
    const uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / D;
    return { cx: ux, cy: uy, r: Math.sqrt((ax - ux) ** 2 + (ay - uy) ** 2) };
}
