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
import { sceneReplace, sceneAdd, sceneUpdate, sceneCarry, sceneReplaceOrKeep, sceneLayer } from './sceneDecorators';
import type { CsgrsModule, PointLike, Axis, BasePlane, CurveCornerSelection, OrientationXY, HlrStrategy,
    SpanParams, SpanEllipse, SpanPoint } from './types';
import { resolveIsometryArgs, DEFAULT_ISOMETRY_CAM } from './projectionOptions';
import type { IsometryOptions } from './projectionOptions';
import { isPointLike, isBasePlane } from './types'
import { Point } from './Point';
import { Vector } from './Vector';
import { Vertex } from './Vertex';
import { Bbox } from './Bbox';
import { OBbox } from './OBbox';
import { Polygon } from './Polygon';
import { Style } from './Style';

import { rad, shortestArcAxisAngle, primaryOrthoXYAngle } from "./utils";
import { GLTFBuilder } from './GLTFBuilder';
import { Selector } from './Selector';


/** Chord tolerance used when locating perpendicular feet.
 *
 *  Much finer than the kernel's display tolerance, because this search needs more from the
 *  polyline than looking right: a candidate foot is accepted only when the connector meets the
 *  *segment direction* within PERPENDICULAR_ANGLE_TOLERANCE (~1°), and a chord's direction
 *  differs from the curve's true tangent by roughly the angle the curve turns across it. Sample
 *  a curve too coarsely and every genuine foot is thrown out as if it were a corner — the chord
 *  it was found on simply does not point where the curve does. At this tolerance the kernel
 *  lays ~500 samples along a span, turning well under a degree per chord.
 *
 *  Note the kernel reads a chord tolerance as a fraction of the span, not as a distance in
 *  model units, so this stays meaningful whether a script works in metres or millimetres. */
const PERPENDICULAR_CHORD_TOLERANCE = 1e-6;

/** How far off a right angle a connector may be (~1°) and still count as perpendicular. Wide
 *  enough to absorb the chord tolerance above, narrow enough to reject corners. */
const PERPENDICULAR_ANGLE_TOLERANCE = Math.sin(rad(1));

/** Least number of samples along a curve when looking for perpendicular feet. Keeps coarse
 *  polylines (a rectangle tessellates to its four corners) from hiding the feet on their edges. */
const PERPENDICULAR_MIN_SAMPLES = 64;

/** Relative size below which the orthogonality measure counts as exactly zero — well under any
 *  real signal, well over floating point noise. */
const PERPENDICULAR_ZERO_TOLERANCE = 1e-9;

/** How finely a loft subdivides a curved segment, counted per full turn: a whole circle becomes
 *  this many ring steps, a quarter-circle fillet a quarter of them. Straight segments are lofted
 *  as they are, so a rectangle stays four faces however high this is. */
const LOFT_SEGMENTS_PER_TURN = 64;

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

    override _copy(): this
    {
        const newCurve = new Curve();
        newCurve._curve = this._curve?.clone();
        newCurve._holes = this._holes.map(h => h._copy());
        newCurve.style.merge(this.style.explicitData() as any);

        // Scene registration is handled by Shape.copy() — _copy() is the pure clone.
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
        ShapeCollection._nameGrid(curves, this.name() as string | undefined, nx, ny, nz);
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

    /** Build a full ellipse (closed) with semi-axes `radiusX` (major direction)
     *  and `radiusY` (minor direction), its major axis rotated `rotation` degrees
     *  in-plane, centred at `center`, in the plane whose normal is `normal`.
     *  Backed by exact rational conic spans (not a sampled polyline). */
    static Ellipse(radiusX:number = 50, radiusY:number = 25, center:PointLike = [0,0,0], rotation:number = 0, normal:PointLike = [0,0,1]): Curve
    {
        if(typeof radiusX !== 'number' || typeof radiusY !== 'number' || typeof rotation !== 'number' || !isPointLike(center) || !isPointLike(normal))
        {
            throw new Error('Curve.Ellipse(): Invalid arguments. Supply numbers for radiusX, radiusY and rotation (degrees), and PointLike for center and normal.');
        }

        return Curve.fromCsgrs(
                getCsgrs()
                    ?.Curve3DJs?.makeEllipse(
                        radiusX,
                        radiusY,
                        rad(rotation),
                        Point.from(center).toPoint3Js(),
                        Point.from(normal).toVector3Js()
                    )
                );
    }

    /** Build an elliptical arc (a portion of an ellipse) from `startAngle` to
     *  `endAngle` (degrees, in the pre-rotation ellipse parameter). A full 360°
     *  sweep yields a closed ellipse. Semi-axes `radiusX`/`radiusY`, major axis
     *  rotated `rotation` degrees in-plane, centred at `center`. */
    static EllipticalArc(radiusX:number = 50, radiusY:number = 25, startAngle:number = 0, endAngle:number = 360, center:PointLike = [0,0,0], rotation:number = 0, normal:PointLike = [0,0,1]): Curve
    {
        if(typeof radiusX !== 'number' || typeof radiusY !== 'number' || typeof startAngle !== 'number' || typeof endAngle !== 'number' || !isPointLike(center) || !isPointLike(normal))
        {
            throw new Error('Curve.EllipticalArc(): Invalid arguments. Supply numbers for radii and angles (degrees), and PointLike for center and normal.');
        }

        return Curve.fromCsgrs(
                getCsgrs()
                    ?.Curve3DJs?.makeEllipticalArc(
                        radiusX,
                        radiusY,
                        rad(rotation),
                        rad(startAngle),
                        rad(endAngle),
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

        // Join the exact spans; gaps are bridged with straight connectors by the kernel.
        // This used to concatenate controlPoints() into one polyline, which — because
        // controlPoints() yields span endpoints — replaced every arc with its chord.
        const [first, ...rest] = curves;
        if(rest.length === 0){ return first.copy(); }
        try
        {
            // Fold one at a time: concat() borrows its operand. It used to take the whole
            // array, which wasm-bindgen unwraps by consuming each element — so every input
            // curve was freed here and the caller's next use of one threw
            // "null pointer passed to rust".
            const joined = rest.reduce(
                (acc: Curve3DJs, c: Curve) => acc.concat(c.inner()),
                first.inner(),
            );
            return Curve.fromCsgrs(joined);
        }
        catch (e)
        {
            // Non-coplanar operands have no common plane to join in; fall back to a
            // polyline through the spans' endpoints, as before.
            console.warn(`Curve.Compound(): native join failed ("${e}"); falling back to a polyline.`);
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
    }


    //// PROPERTIES ////

    /** Return the SceneNode this curve belongs to, or null. */
    node(): SceneNode | null { return this._node; }
    override readonly type = 'Curve' as const;

    /** Classify this curve as 'Line'|'Arc'|'Circle'|'Rect'|'Polyline'|'Spline'|'Ellipse'.
     *  Delegates to the native segment-based classification in {@link Curve3DJs}. */
    subtype(): 'Line'|'Arc'|'Circle'|'Rect'|'Polyline'|'Spline'|'Ellipse'|'Compound'
    {
        return this.inner().subtype() as 'Line'|'Arc'|'Circle'|'Rect'|'Polyline'|'Spline'|'Ellipse';
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

    /** The spline's knot vector.
     *
     *  A curve carried by a single NURBS span (e.g. from {@link Curve.Interpolated})
     *  returns its real knot vector. Line/arc geometry has no explicit knot vector — it is
     *  re-parameterised by arc length — so that falls back to the parameter domain `[0, 1]`.
     */
    knots(): Array<number>
    {
        const k = Array.from(this.inner().knots());
        return k.length ? k : Array.from(this.inner().knotsDomain());
    }

    knotsDomain():Array<number>|undefined
    {
        return Array.from(this.inner().knotsDomain());
    }

    /** The spline's per-control-point weights.
     *
     *  A curve carried by a single NURBS span returns its real weights. Native line/arc
     *  geometry carries none (an arc is exact, not a weighted rational control net), so
     *  that returns an empty array. */
    weights(): Array<number>
    {
        return Array.from(this.inner().weights());
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

    /** Whether this curve is curved anywhere — a circular arc, or any conic, Bézier or
     *  spline span. False for pure line work. */
    hasArcs(): boolean
    {
        return this.inner().hasArcs();
    }

    /** Number of exact spans. */
    segmentCount(): number
    {
        return this.inner().segmentCount();
    }

    /** Every exact span, described by the parameters a file format needs to write it.
     *
     *  One entry per span, in order, matching {@link segmentCount}. Each is tagged by
     *  `kind`, and arcs and conics carry the centre, radius, sweep and axes of the circle
     *  or ellipse they lie on.
     *
     *  Use this, not the other accessors, when writing a file. They answer coarser
     *  questions: {@link subtype} names the whole curve and has no name for "lines and
     *  arcs mixed"; {@link controlPoints} returns span endpoints, which for an arc is its
     *  chord; {@link knots} and {@link weights} are empty unless the whole curve is one
     *  NURBS span. Writers built on those had to guess, and guessed wrong — an arc's
     *  radius was re-derived from a circumcircle of tessellation samples, and a filleted
     *  rectangle was written as a malformed DXF SPLINE built from its chords.
     */
    spanParams(): Array<SpanParams>
    {
        return this.inner().spanParams() as Array<SpanParams>;
    }

    /** {@link spanParams}, with consecutive conic spans of the same ellipse merged.
     *
     *  hypercurve splits an ellipse into spans of at most 90° so every conic weight stays
     *  positive, so a full ellipse arrives as four spans of one shape. A format that has
     *  an ellipse primitive (DXF `ELLIPSE`, SVG `A`) wants that back as one entity, and
     *  both writers want it identically — hence one implementation here rather than two
     *  that drift.
     *
     *  Spans that are not conics, and conics whose ellipse could not be reconstructed,
     *  pass through untouched.
     *
     *  @param opts.maxSweep  Largest arc, in radians, a merged conic span may cover.
     *         Formats differ in what a single primitive can say: DXF's `ELLIPSE` carries a
     *         full turn happily, while an SVG `A` cannot — its endpoints would coincide and
     *         renderers drop the command — so the SVG writer passes `Math.PI` and gets two
     *         half-ellipses instead of one degenerate arc. Defaults to no limit.
     */
    exportSpans(opts: { maxSweep?: number } = {}): Array<SpanParams>
    {
        const maxSweep = opts.maxSweep ?? Infinity;
        const spans = this.spanParams();
        const out: Array<SpanParams> = [];

        for (const span of spans)
        {
            const prev = out[out.length - 1];
            if (span.kind === 'conic' && span.ellipse && prev?.kind === 'conic' && prev.ellipse
                && Curve._sameEllipse(prev.ellipse, span.ellipse)
                && Curve._mergedSweep(prev.ellipse, span.ellipse) <= maxSweep + 1e-9)
            {
                // Both spans run the same way around the same ellipse, so the merged arc
                // simply ends where this one does.
                //
                // The end parameter is stated as start + sweep rather than copied from the
                // span. Parameters come from atan2, so a full turn would arrive back at its
                // own start value and describe a zero-length arc — a whole ellipse written
                // to DXF as `41=0 42=0` is an empty entity.
                const sweep = Curve._mergedSweep(prev.ellipse, span.ellipse);
                const endParam = prev.ellipse.startParam
                    + (prev.ellipse.ccw ? sweep : -sweep);
                out[out.length - 1] = { ...prev, end: span.end, mid: span.mid,
                    ellipse: { ...prev.ellipse, endParam } };
                continue;
            }
            out.push(span);
        }

        // A closed curve's spans wrap, so the last may continue into the first. Subject to
        // the same cap: without it a full ellipse capped to two half-turns above would be
        // folded straight back into one, which is what this option exists to prevent.
        if (out.length > 1 && this.isClosed())
        {
            const [first] = out;
            const last = out[out.length - 1];
            if (first.kind === 'conic' && first.ellipse && last.kind === 'conic' && last.ellipse
                && Curve._sameEllipse(first.ellipse, last.ellipse)
                && Curve._mergedSweep(last.ellipse, first.ellipse) <= maxSweep + 1e-9)
            {
                const sweep = Curve._mergedSweep(last.ellipse, first.ellipse);
                const endParam = last.ellipse.startParam + (last.ellipse.ccw ? sweep : -sweep);
                out[0] = { ...last, end: first.end, mid: first.mid,
                    ellipse: { ...last.ellipse, endParam } };
                out.pop();
            }
        }
        return out;
    }

    /** Arc covered, in radians, by merging conic span `b` onto the end of span `a`. */
    private static _mergedSweep(a: SpanEllipse, b: SpanEllipse): number
    {
        const turn = Math.PI * 2;
        // Wraps into (0, 2*PI], not [0, 2*PI): a span is never degenerate, so coincident
        // ends mean a full turn, not a zero one. Mapping that to 0 made a whole ellipse
        // look like the smallest possible arc and slip past every sweep limit.
        const wrap = (x: number) =>
        {
            const r = ((x % turn) + turn) % turn;
            return r <= 1e-12 ? turn : r;
        };
        // Parameters always increase counter-clockwise; `ccw` says whether the span is
        // travelled that way.
        return a.ccw ? wrap(b.endParam - a.startParam) : wrap(a.startParam - b.endParam);
    }

    /** Whether two conic spans lie on the same ellipse and run the same way round it. */
    private static _sameEllipse(a: SpanEllipse, b: SpanEllipse): boolean
    {
        if (a.ccw !== b.ccw) { return false; }
        // Relative to the ellipse's own size, so the test means the same thing on a 2 mm
        // fillet and a 20 m arc.
        const scale = Math.hypot(a.majorAxis[0], a.majorAxis[1], a.majorAxis[2]) || 1;
        const near = (p: SpanPoint, q: SpanPoint) =>
            Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) <= scale * 1e-9;
        return near(a.center, b.center) && near(a.majorAxis, b.majorAxis)
            && Math.abs(a.ratio - b.ratio) <= 1e-9;
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

    /** Whether this curve is straight (all defining vertices collinear).
     *
     *  Answered from native geometry, never from a tessellation: an arc-bearing curve is
     *  straight by definition never, and for line-only geometry the defining vertices ARE
     *  the curve, so testing them is exact as well as O(segments) instead of O(samples).
     */
    isStraight(tolerance: number = 1e-6): boolean
    {
        // A single native line span is the answer outright.
        if (this.subtype() === 'Line') { return true; }
        // Any arc span makes the curve curved, whatever its vertices look like.
        if (this.inner().hasArcs()) { return false; }

        const pts = this.controlPoints();
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

        // Project onto the plane's in-plane axes → 2D (u, v). For line-only geometry the
        // defining vertices ARE the curve, so use those: the crossing test is exact and the
        // O(n²) pair loop runs over a handful of segments instead of hundreds of samples.
        // Arc-bearing curves still need a tessellation to see a bulge crossing.
        const source = this.inner().hasArcs() ? this.tessellate() : this.controlPoints();
        let pts: Array<[number, number]> = source.map(p =>
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
    @sceneCarry
    start(): Vertex
    {
        return new Vertex(new Point(this.inner().pointAt(0)));
    }

    /** End point of the curve (arc-length parameter 1). */
    @sceneCarry
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

    /** Find the point on this Curve where the line from the given point to that point
     *  is perpendicular to the Curve (the foot of the perpendicular).
     *
     *  By default the *nearest* such point is returned. Some points have no perpendicular foot at
     *  all — beyond the end of a line, or straight out from the corner of a rectangle — and then
     *  the closest point on the Curve is returned instead.
     *
     *  Pass `all = true` to get every perpendicular foot instead (a circle seen from outside
     *  has two, a wavy curve can have many), sorted by distance ascending. That list contains
     *  only genuine perpendicular feet and may be empty.
     *
     *  NOTE: feet are computed on the curve's tessellation, so on arcs and ellipses they are
     *  accurate to the kernel chord tolerance (~1e-4).
     *
     *  @param point - the point to drop the perpendicular from
     *  @param all - return every perpendicular foot instead of only the nearest one
     */
    perpendicularPointTo(point: PointLike): Point|null;
    perpendicularPointTo(point: PointLike, all: true): Array<Point>;
    perpendicularPointTo(point: PointLike, all?: boolean): Point|Array<Point>|null;
    perpendicularPointTo(point: PointLike, all: boolean = false): Point|Array<Point>|null
    {
        if(!isPointLike(point)){ throw new Error(`Curve::perpendicularPointTo(): Please supply a PointLike. Got: ${point}`); }

        const from = Point.from(point);
        const feet = this._perpendicularFeet(from);

        if(all){ return feet.map(f => f.point); }
        if(feet.length){ return feet[0].point; }

        // Nothing on this Curve is perpendicular to `point`: fall back to the closest point on it
        const param = this.paramClosestToPoint(from);
        return (param === null) ? null : this.pointAtParam(param);
    }

    /** Subdivide a polyline until no segment is longer than a fraction of the whole, so that every
     *  straight run carries interior points whose tangent is the run's own direction. */
    private _densified(poly: Array<Point>): Array<Point>
    {
        const total = poly.reduce( (acc, p, i) => (i === 0) ? 0 : acc + p.distance(poly[i-1]), 0);
        const maxLength = total / PERPENDICULAR_MIN_SAMPLES;
        if(maxLength <= 0){ return poly; }

        return poly.slice(0, -1).reduce( (acc:Array<Point>, a, i) =>
        {
            const ab = poly[i+1].toVector().subtract(a);
            const steps = Math.max(1, Math.ceil(ab.length() / maxLength));
            // NOTE: only the start of each segment — the next segment contributes its own start
            return acc.concat(Array.from({ length: steps }, (_, k) => ab.copy().scale(k / steps).add(a).toPoint()));
        }, []).concat(poly[poly.length-1]);
    }

    /** All perpendicular feet from a point onto this Curve, sorted by distance ascending.
     *
     *  Runs on the same tessellated polyline that pointAtParam() interpolates over. A foot is a
     *  point where the connector is orthogonal to the tangent, i.e. a zero of
     *  g(s) = (C(s) − from) · T(s) — which covers both the near feet (a local minimum of the
     *  distance) and the far ones (a local maximum, e.g. the back of a circle).
     *
     *  Every zero of g is located by a sign change between two consecutive tessellation vertices
     *  and then verified against the segment's own direction. That verification is what keeps
     *  corners out: g jumps across a corner and produces a sign change there, but the curve has no
     *  tangent at a corner so nothing through it is perpendicular to the Curve.
     */
    private _perpendicularFeet(from: Point): Array<{ point: Point, distance: number }>
    {
        // Drop repeated points so every segment has a direction, then split up long segments: a
        // coarse polyline such as a rectangle only holds its corners, and a corner has no usable
        // tangent — without intermediate points the feet on its straight runs cannot be seen.
        const pts = this._densified(
                this.tessellate(PERPENDICULAR_CHORD_TOLERANCE).reduce( (acc:Array<Point>, p) =>
                    (acc.length && acc[acc.length-1].equals(p, Curve.ZERO_LENGTH_TOLERANCE)) ? acc : acc.concat(p), []));
        if(pts.length < 2){ return []; }

        // A closed tessellation repeats its first point, making its seam an interior junction
        const wraps = pts[0].equals(pts[pts.length-1]);

        const segs = pts.slice(0, -1).map( (a, i) =>
        {
            // NOTE: Vector math mutates in place (subtracted/scaled are aliases, not copies),
            // so every operand below is a freshly built Vector
            const ab = pts[i+1].toVector().subtract(a);
            const len = ab.length();
            return { a, len, dir: ab.normalize() }; // ab is ours, normalising it in place is safe
        });

        if(segs.every( s => s.len <= 0 )){ return []; }

        // Tangent at every vertex: the mean of the segment directions meeting there
        const tangents = pts.map( (_, i) =>
        {
            const before = (i > 0) ? segs[i-1] : (wraps ? segs[segs.length-1] : null);
            const after = (i < segs.length) ? segs[i] : (wraps ? segs[0] : null);
            if(!before){ return (after as { dir:Vector }).dir.copy(); }
            if(!after){ return before.dir.copy(); }
            const mean = before.dir.copy().add(after.dir);
            return (mean.length() > Curve.ZERO_LENGTH_TOLERANCE) ? mean.normalize() : after.dir.copy();
        });

        const dists = pts.map( p => p.distance(from) );
        // g = (vertex − from) · tangent. Values that are zero but for rounding are snapped, so a
        // foot landing exactly on a vertex — the seam of a circle, say — still reads as a sign
        // change instead of two same-sign neighbours a few ulps apart.
        const g = pts.map( (p, i) =>
        {
            const value = p.toVector().subtract(from).dot(tangents[i]);
            return (Math.abs(value) <= PERPENDICULAR_ZERO_TOLERANCE * dists[i]) ? 0 : value;
        });

        // Equidistant from the whole curve and perpendicular everywhere: the centre of a circle
        if(wraps
            && (Math.max(...dists) - Math.min(...dists)) < Curve.ZERO_LENGTH_TOLERANCE
            && g.every( (v, i) => Math.abs(v) <= PERPENDICULAR_ANGLE_TOLERANCE * dists[i] ))
        {
            console.warn('Curve::perpendicularPointTo(): Every point on this Curve is perpendicular to the given point. Returning the start of the domain.');
            return [{ point: pts[0], distance: dists[0] }];
        }

        /** Keep a candidate only when the connector really is orthogonal to the curve there */
        const isPerpendicular = (point: Point, dir: Vector, distance: number): boolean =>
                (distance <= Curve.ZERO_LENGTH_TOLERANCE)
                || (Math.abs(point.toVector().subtract(from).dot(dir)) <= PERPENDICULAR_ANGLE_TOLERANCE * distance);

        const feet: Array<{ point: Point, distance: number }> = [];

        // Zeros of g between two vertices. `<= 0` on the left end so a zero sitting exactly on a
        // vertex is claimed by one pair only.
        segs.forEach( (s, i) =>
        {
            const [gA, gB] = [g[i], g[i+1]];
            if(!((gA <= 0 && gB > 0) || (gA >= 0 && gB < 0))){ return; }
            const u = (gA === gB) ? 0 : gA / (gA - gB);
            const point = s.dir.copy().scale(u * s.len).add(s.a).toPoint();
            const distance = point.distance(from);
            if(!isPerpendicular(point, s.dir, distance)){ return; } // a corner, not a foot
            feet.push({ point, distance });
        });

        // The ends of an open curve are feet too when the connector happens to meet them at a right
        // angle (the ends of a half circle seen from its axis), and no sign change reveals those.
        if(!wraps)
        {
            [{ i: 0, s: segs[0] }, { i: pts.length-1, s: segs[segs.length-1] }]
                .forEach( end =>
                {
                    const point = pts[end.i];
                    if(!isPerpendicular(point, end.s.dir, dists[end.i])){ return; }
                    if(feet.some( f => f.point.equals(point, PERPENDICULAR_CHORD_TOLERANCE) )){ return; }
                    feet.push({ point, distance: dists[end.i] });
                });
        }

        return feet.sort( (a, b) => a.distance - b.distance );
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
            ? new Bbox([b[0], b[1], b[2]], [b[3], b[4], b[5]])._fromShape(this)
            : undefined;
    }

    /** Get the oriented bounding box of this Curve: the tightest (minimum-area) box around a
     *  planar curve, the PCA box for a curve that runs through 3D. */
    obbox(): OBbox
    {
        return OBbox.fromCurve(this);
    }

    /** Whether this Curve is essentially a cuboid (rectangle in 2D).
     *
     *  A single line is 1D and never a cuboid. For 2D-or-bigger curves, builds
     *  the OBB and checks every tessellated point: each point must
     *  sit on the OBB surface — within ±halfExtent on every non-zero axis and
     *  touching at least one face — within `tolerance`. Arcs / circles /
     *  splines / non-rect polylines fail; tessellated rectangles pass even
     *  when sides are subdivided.
     */
    isCuboid(tolerance: number = 0.5): boolean
    {
        // An arc span can never lie on an OBB face, so bail before obbox() — otherwise a
        // circle is tessellated to hundreds of points twice over only to be rejected.
        if (this.inner().hasArcs()) { return false; }

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
     *  exactly one match (checkSingle), and an empty result warns.
     *  Selecting does not add anything to the scene - it hands back a reference to
     *  geometry that is already there. `select(…).copy()` is what puts a new shape in. */
    @sceneCarry
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
    @sceneCarry
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
    @sceneCarry
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
    @sceneCarry
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
    @sceneAdd
    segment(fromIndex: number, toIndex: number = fromIndex): Curve
    {
        // Build the atomic segments as FRESH, plain-meshup Curves (never Smart*, never
        // scene-bound). Do NOT route through the public segments()/copy() — on a Smart
        // subclass those are scene-decorated, which would both pollute the scene and,
        // after Curve.Compound() consumes the pieces' kernel pointers, leave freed shapes
        // in the scene (→ "null pointer passed to rust" on the next kernel call).
        const segs = this._atomicSegments();
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
    private _atomicSegments(): Curve[]
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
    /** Move this Curve so its bbox centre lands on `target`. Takes loose coordinates too
     *  (`moveTo(200, 475, 0)`) - this override used to drop everything but the first
     *  argument, silently moving the Curve to y=0/z=0 while Mesh.moveTo() did the right thing. */
    moveTo(target: PointLike | number, py?: number, pz?: number): this
    {
        const bb = this.bbox();
        if (!bb) return this;
        const c = bb.center();
        const t = Point.from(target as PointLike, py, pz);
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
                this.scale(scaleFactor, q1);
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

    /** Scale Curve with a uniform factor or per-axis [sx, sy, sz] around an origin (default: center of this Curve) */
    override scale(factor: number | PointLike, origin?: PointLike): this
    {
        const [sx, sy, sz] = (typeof factor === 'number') ? [factor, factor, factor] : [Point.from(factor).x, Point.from(factor).y, Point.from(factor).z];
        const o = origin ? Point.from(origin) : this.center();
        const uniform = Math.abs(sx - sy) < 1e-9 && Math.abs(sy - sz) < 1e-9;
        if (uniform)
        {
            // A uniform scale IS a similarity, which hypercurve applies natively.
            this.translate([-o.x, -o.y, -o.z]);
            this.update(this.inner().scale(sx));
            this.translate([o.x, o.y, o.z]);
            return this;
        }

        // A per-axis scale is not a similarity, but the map it induces within the curve's
        // plane is a plain 2D affine — and hypercurve accepts one of those on a region. So
        // a closed curve scales exactly: a scaled circle becomes a real ellipse rather than
        // resampled line work. Open curves have no region to lift to (transform_affine is
        // CurveRegion2-only), so they keep the resampling fallback.
        if (this.isClosed())
        {
            try
            {
                return this.update(Curve.fromCsgrs(
                    this.inner().scaleNonUniform(sx, sy, sz, o.toPoint3Js())));
            }
            catch (e)
            {
                console.warn(`Curve::scale(): exact non-uniform scale unavailable ("${e}"); resampling.`);
            }
        }
        this.translate([-o.x, -o.y, -o.z]);
        const pts = this.tessellate().map(p => [p.x * sx, p.y * sy, p.z * sz] as [number, number, number]);
        this.update(Curve.Polyline(pts));
        this.translate([o.x, o.y, o.z]);
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

        // A reflection is an isometry of the curve's plane, so only the plane moves — the
        // geometry in it is untouched and a mirrored circle stays a circle. This used to
        // reflect the tessellated boundary and rebuild a ~500-segment polyline.
        this.update(Curve.fromCsgrs(this.inner().mirror(n.toVector3Js(), planePos.toPoint3Js())));
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

        // When the curve's own plane is parallel to the target, the projection is a rigid
        // translation along the normal — the in-plane geometry is untouched, so a circle
        // stays a circle. (This includes projecting an XY curve onto XY, which used to
        // resample the whole thing to achieve nothing.)
        const own = this.normal();
        if (own && Math.abs(Math.abs(own.normalize().dot(n)) - 1) < 1e-9)
        {
            const start = this.start();
            const signed = (start.x - origin.x) * n.x + (start.y - origin.y) * n.y + (start.z - origin.z) * n.z;
            this.translate(-signed * n.x, -signed * n.y, -signed * n.z);
            this._holes = this._holes.map(h => h.projectOnto(plane));
            return this;
        }

        // An oblique projection compresses one in-plane direction, so it is not a
        // similarity. hypercurve's only general affine is on CurveRegion2, which needs a
        // closed curve; anything else resamples.
        const pts = this.tessellate().map(p => projectPoint(p));
        this.update(Curve.Polyline(pts.map(p => [p.x, p.y, p.z] as [number, number, number])));
        this._holes = this._holes.map(h => h.projectOnto(plane));
        return this;
    }

    /** Flatten this Curve onto a coordinate plane: project it onto the plane through the
     *  origin perpendicular to `axis` and drop the doubles that creates — segments that
     *  collapse onto each other (the two vertical edges of a wall outline) or onto nothing
     *  (an edge running along the axis). Mirrors Mesh.flatten() / ShapeCollection.flatten().
     *
     *  @param axis  Axis to collapse along ('x' | 'y' | 'z', default 'z' — onto the XY plane).
     */
    flatten(axis: Axis = 'z'): this
    {
        const normal: [number, number, number] = (axis === 'x') ? [1, 0, 0]
                                               : (axis === 'y') ? [0, 1, 0]
                                               :                  [0, 0, 1];
        this.projectOnto({ normal, origin: [0, 0, 0] });

        // Fresh, plain, non-scene-bound pieces: Curve.Compound() consumes them and the
        // dropped ones must never be shapes that live in the scene.
        const segs = this._atomicSegments();
        if (segs.length > 1)
        {
            // Projecting stacks segments that were apart along the axis (the two horizontal
            // edges of a wall outline) and collapses those running along it to nothing.
            const seen = new Set<string>();
            const kept = segs
                .filter(s => s.length() > Curve.ZERO_LENGTH_TOLERANCE)
                .filter(s =>
                {
                    const key = s._flatKey();
                    if (seen.has(key)) { return false; }
                    seen.add(key);
                    return true;
                });

            if (kept.length > 0 && kept.length < segs.length)
            {
                this.update((kept.length === 1) ? kept[0] : Curve.Compound(kept));
            }
        }
        return this;
    }

    /** Order- and direction-independent key for this Curve's geometry, used by flatten()
     *  and ShapeCollection.flatten() to filter out curves that flattened onto each other. */
    _flatKey(tolerance: number = 1e-5): string
    {
        return this.tessellate()
            .map(p => [p.x, p.y, p.z]
                        .map(c => (Math.round(c / tolerance) * tolerance + 0).toFixed(6))
                        .join(','))
            .sort()
            .join('|');
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

    /** Collapse runs of consecutive collinear line segments into single lines: interior
     *  vertices whose incoming and outgoing directions match are redundant, so they are
     *  dropped and the curve is rebuilt through the vertices that remain. This is what keeps
     *  `extend()`/`toDegree1()` from leaving a curve split at a vertex that is not a corner.
     *
     *  Only pure degree-1 curves are rebuilt: on a curve carrying arcs/splines the control
     *  points are NURBS control points rather than on-curve vertices, so a polyline rebuild
     *  through them would corrupt the geometry. Such curves are returned unchanged.
     *
     *  @param colinearTol - |sin(angle)| between adjacent directions below which they count
     *                       as collinear (default 1e-3 ≈ 0.06°).
     */
    mergeColinearLines(colinearTol: number = 1e-3): this
    {
        if (this.spans().toArray().some(s => (s.inner()?.degree() ?? 1) > 1)) { return this; }

        const pts = this.controlPoints();
        if (!pts || pts.length < 3) { return this; }

        /** Unit direction from `from` to `to`, or null when they coincide. */
        const dirOf = (from: Point, to: Point): Vector|null =>
        {
            const v = to.toVector().subtract(from);
            return (v.length() > Curve.ZERO_LENGTH_TOLERANCE) ? v.normalize() : null;
        };

        // First and last vertices are always endpoints, never merge candidates. On a closed
        // curve they are the seam, which is left alone.
        const kept: Array<Point> = [pts[0]];
        for (let i = 1; i < pts.length - 1; i++)
        {
            const inDir = dirOf(kept[kept.length - 1], pts[i]);
            const outDir = dirOf(pts[i], pts[i + 1]);
            if (!inDir || !outDir) { continue; } // duplicate vertex: drop it
            // Parallel AND same-facing: an anti-parallel pair is a spike doubling back on
            // itself, whose vertex is a real corner.
            const parallel = inDir.copy().cross(outDir).length() <= colinearTol;
            if (!(parallel && inDir.dot(outDir) > 0)) { kept.push(pts[i]); }
        }
        kept.push(pts[pts.length - 1]);

        if (kept.length === pts.length) { return this; } // nothing was redundant
        return this.update(Curve.Polyline(kept));
    }

    /** Close this curve by adding a segment from end back to start.
     *  If already closed, returns self unchanged. */
    close(): this
    {
        if (this.isClosed()) return this;
        // Append a closing segment to the exact geometry. Rebuilding from controlPoints()
        // (as this used to) turned a closed arc into a two-chord degenerate ring.
        try
        {
            return this.update(Curve.fromCsgrs(this.inner().closePath()));
        }
        catch (e)
        {
            console.warn(`Curve::close(): native close failed ("${e}"); leaving curve open.`);
            return this;
        }
    }

    /** The corner points of this Curve, indexed exactly as the kernel indexes them:
     *  corner `vi` is the junction of segment `vi-1` and segment `vi`, i.e. the start of
     *  segment `vi`. Closed curves have a corner at every index; on open curves index 0 is
     *  the free start point and is not a corner.
     *
     *  Deliberately does NOT collapse coincident points the way vertices() does — that
     *  would shift the indices out of step with the kernel. */
    private _cornerPoints(): Array<Point>
    {
        return this.segments().toArray().map(seg => new Point(seg.start()));
    }

    /** Resolve a corner selection to kernel corner indices.
     *
     *  Accepts an index (negative counts from the end, as in segment()), a point (the
     *  nearest corner wins), a Vertex, a selector string, a ShapeCollection, or an array
     *  mixing those. Returns undefined for "every corner", which is what the kernel wants
     *  when `at` is omitted. */
    private _resolveCornerIndices(at?: CurveCornerSelection): Uint32Array|undefined
    {
        if (at === undefined || at === null) { return undefined; }
        if (at instanceof Uint32Array) { return at; } // already kernel indices

        const corners = this._cornerPoints();
        if (corners.length === 0) { return new Uint32Array(); }

        // A flat array of numbers is a PointLike ([x,y] / [x,y,z]), never a list of
        // indices — isPointLike([0,2]) is true, so there is no way to tell them apart.
        // Several corners by index therefore go through a Uint32Array (handled above).
        // An empty array means "no corners", which isPointLike would otherwise swallow.
        const items: Array<any> =
            (at instanceof ShapeCollection) ? at.toArray()
            : (Array.isArray(at) && at.length === 0) ? []
            : (Array.isArray(at) && !isPointLike(at)) ? at
            : [at];

        const indices = new Set<number>();

        for (const item of items)
        {
            // selector string: resolve to shapes, then treat those as points
            if (typeof item === 'string')
            {
                const selected = this.select(item);
                const shapes = (selected instanceof ShapeCollection) ? selected.toArray() : [selected];
                shapes.filter(Boolean).forEach(s =>
                {
                    const i = this._nearestCornerIndex(corners, new Point((s as any).center?.() ?? s));
                    if (i !== undefined) { indices.add(i); }
                });
                continue;
            }

            // plain index, negative counts from the end
            if (typeof item === 'number' && Number.isInteger(item))
            {
                const i = item < 0 ? corners.length + item : item;
                if (i >= 0 && i < corners.length) { indices.add(i); }
                else { console.warn(`Curve: corner index ${item} is out of bounds, skipped`); }
                continue;
            }

            const i = this._nearestCornerIndex(corners, new Point(item));
            if (i !== undefined) { indices.add(i); }
        }

        return new Uint32Array([...indices].sort((a, b) => a - b));
    }

    /** Index of the corner nearest `p`. */
    private _nearestCornerIndex(corners: Array<Point>, p: Point): number|undefined
    {
        let best: number|undefined = undefined;
        let bestDist = Infinity;
        corners.forEach((c, i) =>
        {
            const d = c.distance(p);
            if (d < bestDist) { bestDist = d; best = i; }
        });
        return best;
    }

    /** Fillet (round) the sharp corners of a Curve with arcs of `radius`.
     *  Works on both closed curves (every corner) and open curves (interior corners
     *  only — the two free endpoints are not corners). Corners where the radius does
     *  not fit are left sharp.
     *
     *  @param at  Optional corner filter: only these corners are filleted. Accepts a
     *             corner index (negative counts from the end), a point (the nearest
     *             corner wins), a Vertex, a selector string, a ShapeCollection, or an
     *             array mixing those. Omit to fillet every corner.
     *
     *             NOTE: a flat array of numbers is always read as a point — `[0, 2]` is
     *             the point (0,2), not corners 0 and 2, because the two are
     *             indistinguishable. Pass several indices as a Uint32Array.
     *
     *  @example curve.fillet(5)                          // every corner
     *  @example curve.fillet(5, 0)                       // just the first corner
     *  @example curve.fillet(5, -1)                      // just the last corner
     *  @example curve.fillet(5, new Uint32Array([0, 2])) // corners 0 and 2
     *  @example curve.fillet(5, [10, 10, 0])             // the corner nearest that point
     *  @example curve.fillet(5, 'vertex<<->[0,0,0]')     // the corner nearest the origin
     */
    fillet(radius: number, at?: CurveCornerSelection): this|null
    {
        try { return this.update(Curve.fromCsgrs(this.inner().fillet(radius, this._resolveCornerIndices(at)))); }
        catch (e) { console.warn('Curve.fillet():', e); return this; }
    }

    /** Chamfer (bevel) the sharp corners of a Curve, cutting back `setback` along
     *  each edge. Works on both closed and open curves (interior corners only).
     *
     *  @param at  Optional corner filter — see fillet(). Omit to chamfer every corner. */
    chamfer(setback: number, at?: CurveCornerSelection): this
    {
        try { return this.update(Curve.fromCsgrs(this.inner().chamfer(setback, this._resolveCornerIndices(at)))); }
        catch (e) { console.warn('Curve.chamfer():', e); return this; }
    }

    /** Fillet only the corners nearest the given curve parameters. */
    filletAtParams(radius: number, at: Array<number>): this|null
    {
        if (!Array.isArray(at) || at.length === 0) { return this.fillet(radius); }
        // Map each param to the point on the curve there, then let fillet() snap those
        // points to their nearest corners.
        const pts = at.map(t => new Point(this.inner().pointAt(t)));
        return this.fillet(radius, pts);
    }

    /** Extend the curve by `length` at its start / end / both, along the endpoint
     *  tangent(s). Rebuilds as a polyline through the extended vertices. */
    extend(length: number, side: 'start'|'end'|'both' = 'end'): this
    {
        // Append a straight span along the endpoint tangent, keeping the exact geometry.
        // This used to rebuild the whole curve as a polyline through controlPoints(), which
        // collapsed any arc to a chord just to add a straight tail.
        try
        {
            const extended = Curve.fromCsgrs(this.inner().extend(length, side));
            // An extension runs along the endpoint tangent, so on a straight end segment the
            // old endpoint stops being a corner: merge it away rather than leave an extra
            // segment. (Arc-bearing curves are left alone by mergeColinearLines.)
            return this.update(extended.mergeColinearLines());
        }
        catch (e)
        {
            console.warn(`Curve::extend(): native extend failed ("${e}"); curve unchanged.`);
            return this;
        }
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

        ShapeCollection._nameGrid(curves, this.name() as string | undefined, cx, cy, cz);
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

        ShapeCollection._nameRow(curves, this.name() as string | undefined);
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
    @sceneUpdate
    offset(distance: number, cornerType:'sharp'|'round'|'smooth'='sharp'): Curve|null
    {
        if(!this.isPlanar()){ throw new Error(`Curve::offset(): Cannot offset a non-planar curve!`);}
        void cornerType; // hypercurve offset uses miter/arc joins; corner style not selectable

        // NOTE: there used to be a fast path here that rebuilt a circle at radius + distance,
        // because the native offset returned a tessellated ring. The native offset now
        // preserves arcs, so an offset circle comes back as an exact circle on its own.

        // Single straight open line: offsetting is a perpendicular translate within the line's
        // plane, but the native offset picks its side from the curve's internal winding — which
        // flips non-deterministically. Choose the side deterministically instead: the in-plane
        // perpendicular (normal × direction), oriented so its leading component is positive —
        // i.e. toward +X; if the line is parallel to X, toward +Y; otherwise +Z. So a positive
        // `distance` always offsets a line the same way, independent of its start→end direction.
        if(!this.isClosed() && this.isStraight())
        {
            const t = this.direction().normalize();
            const n = this.normal();
            if(n && n.length() > 1e-6)
            {
                const d = n.copy().cross(t); // perpendicular to the line, in its plane
                if(d.length() > 1e-6)
                {
                    d.normalize();
                    const EPS = 1e-9;
                    const lead = Math.abs(d.x) > EPS ? d.x : (Math.abs(d.y) > EPS ? d.y : d.z);
                    if(lead < 0) { d.scale(-1); }
                    const off = d.scale(distance);
                    return this.translate(off.x, off.y, off.z);
                }
            }
            // else: fall through to the native offset below.
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

    /** Sign such that a positive `distance` grows a closed curve and negative shrinks it,
     *  independent of winding.
     *
     *  meshup's convention is grow/shrink; hypercurve offsets a fixed side ("left of travel
     *  direction"), so which side that is depends on the curve's winding. For a closed
     *  curve the winding IS the sign of the enclosed signed area, so one kernel call
     *  answers it — this used to run two extra probe offsets and compare the results,
     *  making every `offset()` cost three offsets.
     *
     *  Open curves have no winding to read, so they keep the bbox probe.
     */
    private _offsetGrowSign(): number
    {
        try
        {
            if(this.isClosed())
            {
                // Traversing a positively-wound (CCW) boundary keeps the interior on the
                // left, so a left offset moves inward — negate to make +distance grow.
                const signedArea = this.inner().area();
                return (signedArea > 0) ? -1 : 1;
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
            // Degenerate sub-range (e.g. zero-length window) — return a copy. `_copy()`, not
            // `copy()`: this is a pure sub-curve accessor, so it must not touch the scene —
            // the success path above returns a fresh, unattached curve too.
            return this._copy();
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
            if (hits && hits.length) { return hits.map(p => Point.from(p).round()); }

            // hypercurve projects `other` into THIS curve's plane, which is ill-defined for a
            // straight line - so a real crossing can be missed one way round but found the other.
            const hitsSwapped = other.inner().intersect(this.inner());
            return (hitsSwapped || []).map(p => Point.from(p).round());
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
    @sceneUpdate
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
                // Preserve this Curve's concrete class (e.g. a scene-bound SmartCurve
                // subclass) rather than minting a plain Curve via fromCsgrs — otherwise a
                // boolean that splits into several regions yields untracked plain Curves
                // that never appear in the scene. `_copy()` clones as the same class
                // without auto-registering (the caller/editor places the results); we
                // then swap in the region's geometry. Mirrors replicate()/array().
                const exterior = this._copy();
                exterior.update(rg.exterior as Curve3DJs);
                exterior._holes = (rg.holes() as Array<Curve3DJs>).map(h => Curve.fromCsgrs(h));
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
    @sceneReplaceOrKeep
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
    @sceneReplaceOrKeep
    difference(other: Curve): Curve|ShapeCollection<Curve>|null
    {
        return this._difference(other);
    }

    /** Pure boolean difference geometry — no scene bookkeeping. Mutates in place and returns
     *  `this` for a single result, returns a new ShapeCollection when it splits into several
     *  pieces, or null on failure. Used internally (cutoffBy) so scene management doesn't fire
     *  mid-operation. */
    private _difference(other: Curve): Curve|ShapeCollection<Curve>|null
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

    // Alias for difference (scene management runs via the decorated difference()).
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
    @sceneReplaceOrKeep
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
        // Use the raw difference so its scene decorator doesn't fire inside cutoffBy.
        return keepSmallest ? this._difference(other) : this._booleanOp(other, 'intersection')?.checkSingle() || null;
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
        if(arcCurves.length === 0) return null;
        // Join the exact spans and close. Building this from controlPoints() replaced each
        // boundary arc with its chord, so cutting a circle in half produced a zero-area
        // "region" — and the caller decides which side to keep by comparing those areas.
        try
        {
            return Curve.Compound(arcCurves).close();
        }
        catch (e)
        {
            console.warn(`Curve::_closedRegionFromArc(): join failed ("${e}").`);
            return null;
        }
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

            // Tessellate here and hand the mesh a plain polyline.
            const pts = mesh.inner()?.intersectPolyline(this.inner().tessellate(tolerance ?? 1e-4));

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
    @sceneReplace
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
            const face = this._toPolygon();
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
    @sceneReplace
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

        // Ruled loft: sample every profile at matching positions and stitch corresponding points
        // between consecutive profiles into quads. hypercurve has no surfaces, so we build the
        // mesh directly.
        const rings = this._loftRings(profiles);
        const steps = rings[0].length - 1;
        const mkVert = (pt: Point) => new VertexJs(new Point3Js(pt.x, pt.y, pt.z), new Vector3Js(0, 0, 0));
        const polygons: PolygonJs[] = [];
        for (let k = 0; k < rings.length - 1; k++)
        {
            const A = rings[k];
            const B = rings[k + 1];
            for (let i = 0; i < steps; i++)
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

            // NOTE: cap from the ring, not from the profile's own tessellation — a cap sampled any
            // other way than the wall it closes leaves gaps along the seam
            const firstCap = this._makeCap(first, firstOut, rings[0]);
            const lastCap  = this._makeCap(last, lastOut, rings[rings.length - 1]);
            if (firstCap) { polygons.push(firstCap); }
            if (lastCap)  { polygons.push(lastCap); }
        }

        if (polygons.length === 0) { return null; }
        return Mesh.from(this._csgrs.MeshJs.fromPolygons(polygons, {}));
    }

    /** Ring sample points for a ruled loft, one array per profile, all of the same length.
     *
     *  Profiles that share a structure — the same number of segments — are matched segment by
     *  segment, so lofting a rectangle onto a rectangle yields four quads instead of a finely
     *  resampled tube. A segment that is straight in every profile needs no subdivision at all;
     *  a curved one is subdivided by how far it turns. Profiles whose segments do not line up
     *  fall back to uniform arc-length sampling.
     */
    private _loftRings(profiles: Curve[]): Point[][]
    {
        const uniform = (): Point[][] => profiles.map( p =>
                Array.from({ length: LOFT_SEGMENTS_PER_TURN + 1 },
                    (_, i) => new Point(p.inner().pointAt(i / LOFT_SEGMENTS_PER_TURN))));

        const segments = profiles.map( p => p._atomicSegments() );
        const count = segments[0].length;
        if(count === 0 || segments.some( s => s.length !== count )){ return uniform(); }

        const steps = Array.from({ length: count }, (_, j) =>
        {
            if(segments.every( s => s[j].degree() === 1 )){ return 1; }
            // the profile that turns the most through this segment sets its resolution
            const turn = Math.max(...segments.map( s => Curve._turnOf(s[j]) ));
            return Math.max(2, Math.ceil(LOFT_SEGMENTS_PER_TURN * turn / 360));
        });

        return segments.map( (segs, i) =>
        {
            const ring = segs.flatMap( (seg, j) =>
                    Array.from({ length: steps[j] }, (_, k) => new Point(seg.inner().pointAt(k / steps[j]))));
            // close the ring: a closed profile returns to its start, an open one stops at its end
            ring.push(new Point(profiles[i].inner().pointAt(1)));
            return ring;
        });
    }

    /** How far a segment turns from end to end, in degrees. Summed over sub-steps so that a
     *  segment turning more than half a turn does not fold back onto a smaller angle. */
    private static _turnOf(segment: Curve): number
    {
        const STEPS = 4;
        return Array.from({ length: STEPS }, (_, k) =>
        {
            const from = Vector.from(segment.inner().tangentAt(k / STEPS));
            const to = Vector.from(segment.inner().tangentAt((k + 1) / STEPS));
            return from.angle(to);
        }).reduce( (total, angle) => total + angle, 0);
    }

    /** Build a single cap face for a closed profile, wound so its normal faces `outward`.
     *  Pass `ring` to cap exactly the points the surrounding wall was built from. */
    private _makeCap(profile: Curve, outward: Vector, ring?: Point[]): PolygonJs | null
    {
        const pts = ring ?? profile.tessellate();
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
    @sceneReplace
    toPolygon(tolerance: number = TESSELATION_TOLERANCE): Polygon | undefined
    {
        return this._toPolygon(tolerance);
    }

    /** Pure tessellation to a Polygon — never touches the scene. Used internally (extrude,
     *  toFace, toMesh) so the decorated public toPolygon() can't corrupt the scene when
     *  called during another op. */
    private _toPolygon(tolerance: number = TESSELATION_TOLERANCE): Polygon | undefined
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
    @sceneReplace
    toFace(tolerance: number = TESSELATION_TOLERANCE): Polygon | undefined
    {
        return this._toPolygon(tolerance);
    }

    @sceneReplace
    toMesh(tolerance: number = TESSELATION_TOLERANCE): Mesh | undefined
    {
        const poly = this._toPolygon(tolerance);
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

    /**
     * Colour this Curve with a gradient along its length.
     *
     * ```js
     * curve.colorGradient('red', 'blue')                        // two colours, end to end
     * curve.colorGradient('red', 'white', 'blue')               // evenly spaced
     * curve.colorGradient([[0,'red'], [0.5,'orange'], [1,'blue']])
     * curve.colorGradient([0,'red'], [0.5,'orange'], [1,'blue']) // the same, as varargs
     * ```
     *
     * Positions run 0 to 1 along the curve's ARC LENGTH, so a stop at 0.5 is halfway along the
     * drawn line whatever the tessellation does.
     *
     * A stop is `[position, colour]` — a two-element array whose second element is not a
     * number. That matters because `[255,0,0]` is a colour, so `colorGradient([255,0,0],
     * [0,0,255])` is two colours while `colorGradient([0,'red'], [1,'blue'])` is two stops.
     *
     * Rendered as per-vertex colour, so it stays ONE curve with one material rather than being
     * chopped into segments. Calling {@link color} afterwards clears the gradient.
     */
    colorGradient(...args: Array<any>): this
    {
        this.style.gradient = Style.normaliseStops(Style.parseGradientArgs(args));
        return this;
    }

    /** Set stroke dash pattern. Defaults to [2, 2] when called with no arguments. */
    //// PROJECTION ////

    /** Isometric projection of this Curve.
     *
     *  A Curve is line work already, so there is nothing to remove hidden lines
     *  *from* — but it is geometry in the drawing, and it projects onto the same
     *  screen plane as everything else. Projecting one on its own gives the
     *  flattened, screen-oriented result you would get from a collection
     *  containing only it.
     *
     *  To have a solid hide part of this curve, put both in a
     *  {@link ShapeCollection} and project that: the collection is what knows
     *  about the occluders. See `ShapeCollection.isometry`.
     *
     *  @param cam Direction from the origin toward the viewer. Default `[-1,-1,1]`.
     *  @param method Which hidden-line algorithm the projection runs. Only
     *    matters when there are solids to hide things; kept for signature
     *    parity with {@link Mesh.isometry}.
     *  @param options Projection settings — see `IsometryOptions`.
     */
    isometry(cam?: PointLike, method?: HlrStrategy, options?: IsometryOptions): ShapeCollection<any>;
    /** @deprecated Positional form. Kept working for saved scripts; prefer
     *  `isometry(cam, method, { ... })`. */
    isometry(cam?: PointLike, hiddenLines?: boolean, includeHiddenShapes?: boolean,
             samples?: number, featureAngle?: number, view?: any): ShapeCollection<any>;
    @sceneLayer('iso')
    isometry(cam: PointLike = DEFAULT_ISOMETRY_CAM, ...args: any[]): ShapeCollection<any>
    {
        // Undecorated `_iso`: this method already carries @sceneLayer, and
        // running both would add the projection to the scene twice.
        const o = resolveIsometryArgs(args);
        return new ShapeCollection<any>(this._copy())._iso(
            cam, o.hiddenLines, o.includeHiddenShapes, o.samples, o.featureAngle,
            { strategy: o.method, fallback: o.fallback });
    }

    /** Shorthand alias for {@link isometry}. */
    iso(cam?: PointLike, method?: HlrStrategy, options?: IsometryOptions): ShapeCollection<any>;
    /** @deprecated Positional form — see {@link isometry}. */
    iso(cam?: PointLike, hiddenLines?: boolean, includeHiddenShapes?: boolean,
        samples?: number, featureAngle?: number, view?: any): ShapeCollection<any>;
    iso(cam: PointLike = DEFAULT_ISOMETRY_CAM, ...args: any[]): ShapeCollection<any>
    {
        return (this.isometry as any)(cam, ...args);
    }

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

    /** Rotate this Curve so that direction `from` ends up pointing along `to`, using the
     *  shortest arc between the two.
     *  @param pivot  point the rotation turns around (default: this Curve's center)
     */
    rotateVecToVec(from: PointLike, to: PointLike, pivot?: PointLike): this
    {
        const f = Vector.from(from as any);
        const t = Vector.from(to as any);
        const { axis, angle } = shortestArcAxisAngle(f, t);
        if (angle === 0) { return this; }
        return this.rotateAround(angle, axis, pivot ?? this.center());
    }

    /** Rotate this Curve so its oriented bounding box lines up with the world axes:
     *  the OBB's thinnest axis onto +Z first, then its longest axis onto +X.
     *  For a planar Curve the thinnest axis is the plane normal, so this lays it flat
     *  on the XY plane (without moving it there — use layflat() for that).
     *  Position of the center is kept.
     */
    rotateToAxesOBbox(): this
    {
        const center = this.center();
        // axes()[2] = least variance (plane normal for a planar curve), axes()[0] = greatest
        this.rotateVecToVec(this.obbox().axes()[2], [0, 0, 1], center);
        // NOTE: the OBB is recomputed — its axes turned with the curve in the step above
        this.rotateVecToVec(this.obbox().axes()[0], [1, 0, 0], center);
        return this;
    }

    /** Rotate this Curve to align it with the world axes as much as possible.
     *
     *  First `rotateToAxesOBbox()` brings the curve flat onto the XY plane, then it is
     *  turned around Z so its dominant segment direction lands on the X or Y axis.
     *  The second step only ever turns around Z (by at most a quarter turn), so it can
     *  never undo the flat alignment of the first.
     *
     *  @param o  'vertical' (default) puts the dominant segment direction on the Y axis,
     *            'horizontal' puts it on the X axis
     */
    rotateToOrtho(o: OrientationXY = 'vertical'): this
    {
        this.rotateToAxesOBbox();

        const edges = this.edges().toArray().map(e =>
        {
            const d = e.direction();
            return { x: d.x, y: d.y, z: d.z, length: e.length() };
        });

        const angle = primaryOrthoXYAngle(edges, o);
        return (angle === 0) ? this : this.rotateZ(angle, this.center());
    }

    /** Rotate this Curve to align as much as possible to the world axes.
     *  Alias for rotateToOrtho() */
    autoRotate(o: OrientationXY = 'vertical'): this
    {
        return this.rotateToOrtho(o);
    }

    //// OUTPUTS ////

    toString()
    {
        return `<Curve (${this.isCompound() ? 'Compound' : 'Single'}): length="${this.length().toFixed(3)}", planar="${this.isPlanar()}", closed="${this.isClosed()}" ${this.nodeString()}>`;
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
     *
     * `styleOpts` is passed straight to {@link Style.toSvgAttrs} — see there for why
     * non-scaling-stroke is opt-in and what omitDefaults is for.
     */
    toSVGElem(cssClass?: string, styleOpts?: { nonScalingStroke?: boolean; omitDefaults?: boolean }): string
    {
        const fmt = (n: number) => +n.toFixed(6);
        // SVG's y axis points down, so every model point is mirrored on the way out. That
        // flip reverses handedness, which is why the arc writers below decide their sweep
        // flag from the projected points rather than from the span's own `ccw`.
        const to2D = (p: SpanPoint): [number, number] => [p[0], -p[1]];
        const classAttr = cssClass ? ` class="${cssClass}"` : '';

        // Half a turn at most per span: an SVG `A` whose endpoints coincide is dropped by
        // renderers, so a full ellipse has to leave as two arcs rather than one.
        const spans = this.exportSpans({ maxSweep: Math.PI });

        // A whole circle is better said as <circle> than as a path of two arcs. Decided
        // from the spans, not from subtype(): that calls any closed arcs-only contour a
        // "Circle", so a two-arc lens would take this path and be drawn as a circle.
        const circle = Curve._asCircle(spans, this.isClosed());
        if (circle)
        {
            const [cx, cy] = to2D(circle.center);
            return `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(circle.radius)}"${classAttr} `
                + `${this.style.toSvgAttrs(true, styleOpts)}/>`;
        }

        const pathParts: string[] = [];
        const L = (p: SpanPoint) => { const [x, y] = to2D(p); pathParts.push(`L${fmt(x)} ${fmt(y)}`); };

        /** `A rx ry rot large-arc sweep x y`, with both flags read off the projection. */
        const arcTo = (rx: number, ry: number, rotDeg: number, from: SpanPoint, mid: SpanPoint,
                       to: SpanPoint, largeArc: boolean): void =>
        {
            const [ax, ay] = to2D(from);
            const [mx, my] = to2D(mid);
            const [bx, by] = to2D(to);
            // Orientation of the projected start->mid->end turn. Robust to a curve plane
            // whose normal points at -Z, which no in-plane flag can tell you about.
            const cross = (mx - ax) * (by - my) - (my - ay) * (bx - mx);
            const sweepFlag = cross > 0 ? 1 : 0;
            pathParts.push(`A${fmt(rx)} ${fmt(ry)} ${fmt(rotDeg)} ${largeArc ? 1 : 0} ${sweepFlag} `
                + `${fmt(bx)} ${fmt(by)}`);
        };

        /** Last resort for a span no path command can express.
         *
         *  Only reachable for geometry the kernel itself flagged as undescribable (a
         *  parabolic or hyperbolic conic, a spline whose knot vector does not match its
         *  control net). A chord is crude, but it is visible and finite — the point is
         *  that a span never contributes *nothing*, which is exactly how a cubic Bézier
         *  used to disappear from an exported path without a word. */
        const chordTo = (span: SpanParams): void =>
        {
            console.warn(`Curve::toSVGElem(): span of kind '${span.kind}' cannot be written `
                + `as a path command; approximating it with a straight chord.`);
            L(span.end);
        };

        spans.forEach((span, si) =>
        {
            if (si === 0)
            {
                const [sx, sy] = to2D(span.start);
                pathParts.push(`M${fmt(sx)} ${fmt(sy)}`);
            }

            switch (span.kind)
            {
                case 'line':
                    L(span.end);
                    break;

                case 'arc':
                {
                    // Exact centre and radius from the kernel — not a circumcircle fitted
                    // to three tessellation samples, which carried the chord error of a
                    // polyline the curve never needed to build.
                    const full = Math.abs(Math.abs(span.sweep) - Math.PI * 2) < 1e-9;
                    if (full)
                    {
                        // No single A command can close a full turn: its endpoints would
                        // coincide and the arc would be dropped. Split at the midpoint.
                        arcTo(span.radius, span.radius, 0, span.start, span.start, span.mid, true);
                        arcTo(span.radius, span.radius, 0, span.mid, span.mid, span.end, true);
                    }
                    else
                    {
                        arcTo(span.radius, span.radius, 0, span.start, span.mid, span.end,
                            Math.abs(span.sweep) > Math.PI);
                    }
                    break;
                }

                case 'conic':
                {
                    const e = span.ellipse;
                    if (!e) { chordTo(span); break; }
                    const rx = Math.hypot(e.majorAxis[0], e.majorAxis[1], e.majorAxis[2]);
                    const ry = rx * e.ratio;
                    // Measured after the y-flip: the flip mirrors the axis direction too,
                    // so a tilted ellipse would otherwise come out reflected.
                    const [mjx, mjy] = to2D(e.majorAxis);
                    const rot = Math.atan2(mjy, mjx) * 180 / Math.PI;

                    let sweep = e.ccw ? e.endParam - e.startParam : e.startParam - e.endParam;
                    sweep = ((sweep % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
                    // maxSweep above caps merged spans at half a turn, so no span can reach
                    // here with coincident endpoints. The tolerance keeps the two halves of
                    // a split ellipse from disagreeing about a flag that, at exactly half a
                    // turn, describes the same arc either way.
                    arcTo(rx, ry, rot, span.start, span.mid, span.end, sweep > Math.PI + 1e-9);
                    break;
                }

                case 'quadratic':
                {
                    const [c1] = [to2D(span.control)];
                    const [ex, ey] = to2D(span.end);
                    pathParts.push(`Q${fmt(c1[0])} ${fmt(c1[1])} ${fmt(ex)} ${fmt(ey)}`);
                    break;
                }

                case 'cubic':
                {
                    // Straight from the span's own control points. This used to route
                    // through the B-spline decomposition, which had no knot vector to work
                    // with and silently emitted nothing at all.
                    const c1 = to2D(span.control1);
                    const c2 = to2D(span.control2);
                    const [ex, ey] = to2D(span.end);
                    pathParts.push(`C${fmt(c1[0])} ${fmt(c1[1])} ${fmt(c2[0])} ${fmt(c2[1])} `
                        + `${fmt(ex)} ${fmt(ey)}`);
                    break;
                }

                case 'spline':
                {
                    const pts = span.controlPoints.map(p => ({ x: p[0], y: p[1], z: p[2] }));
                    const segs = _bsplineToBezierSegments(pts, span.knots, span.weights, span.degree);
                    if (segs.length === 0) { chordTo(span); break; }

                    const at = (p: { x: number; y: number; z: number }): [number, number] =>
                        to2D([p.x, p.y, p.z]);
                    segs.forEach(seg =>
                    {
                        if (span.degree === 2)
                        {
                            const [, cp1, end] = seg.map(at);
                            pathParts.push(`Q${fmt(cp1[0])} ${fmt(cp1[1])} ${fmt(end[0])} ${fmt(end[1])}`);
                        }
                        else
                        {
                            const [, cp1, cp2, end] = seg.map(at);
                            pathParts.push(`C${fmt(cp1[0])} ${fmt(cp1[1])} ${fmt(cp2[0])} ${fmt(cp2[1])} `
                                + `${fmt(end[0])} ${fmt(end[1])}`);
                        }
                    });
                    break;
                }

                default:
                    chordTo(span);
                    break;
            }
        });

        if (this.isClosed()) pathParts.push('Z');

        const d = pathParts.join(' ');
        return `<path d="${d}"${classAttr} ${this.style.toSvgAttrs(this.isClosed(), styleOpts)}/>`;
    }

    /** The circle these spans describe, or null if they describe anything else.
     *
     *  Every span must be an arc on one common centre and radius, and together they must
     *  close a full turn. A two-arc lens fails on the centres; a semicircular cap fails on
     *  the total sweep. */
    private static _asCircle(spans: Array<SpanParams>, closed: boolean)
        : { center: SpanPoint, radius: number } | null
    {
        if (!closed || spans.length === 0) { return null; }
        const first = spans[0];
        if (first.kind !== 'arc') { return null; }

        let total = 0;
        for (const s of spans)
        {
            if (s.kind !== 'arc') { return null; }
            if (Math.abs(s.radius - first.radius) > first.radius * 1e-9) { return null; }
            const d = Math.hypot(s.center[0] - first.center[0], s.center[1] - first.center[1],
                s.center[2] - first.center[2]);
            if (d > first.radius * 1e-9) { return null; }
            total += s.sweep;
        }
        return Math.abs(Math.abs(total) - Math.PI * 2) < 1e-9
            ? { center: first.center, radius: first.radius }
            : null;
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

    // A whole number is not optional here, it is what "decomposed into Bezier segments"
    // means. When it was not one — degree 3 over 2 control points gives 0.333 —
    // Array.from({ length: 0.333 }) quietly produced an empty list, so the span emitted no
    // path commands at all and a cubic Bezier vanished from the exported file. Failing
    // loudly and letting the caller fall back is the only acceptable outcome.
    if (!Number.isInteger(numSegments) || numSegments < 1)
    {
        console.warn(`Curve: cannot decompose a degree-${p} spline over ${pts.length} control `
            + `points into Bezier segments (${numSegments} of them); the knot vector and control `
            + `net disagree. Falling back to an approximation.`);
        return [];
    }

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
