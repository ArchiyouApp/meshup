/**
 *  Curve.ts
 *
 *  Wrapper around the csgrs NurbsCurve3DJs or CompoundCurve3DJs (see meshup.rs)
 *
 *  A BSpline consists of:
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

import { NurbsCurve3DJs, CompoundCurve3DJs, Vector3Js, BooleanRegionJs } from "./wasm/csgrs";

import { MeshCollection, CurveCollection, getCsgrs, Mesh } from './index';
import type { CsgrsModule, PointLike, Axis, GLTFBuffer, BasePlane } from './types';
import { isPointLike, isBasePlane } from './types'
import { Point } from './Point';
import { Vector } from './Vector';
import { Bbox } from './Bbox';
import { OBbox } from './OBbox';
import { Polygon } from './Polygon';

import { toBase64, rad } from "./utils";


export class Curve
{
    _curve: NurbsCurve3DJs|CompoundCurve3DJs|undefined = undefined;

    /** Interior hole curves (e.g. from boolean difference where one curve contains the other) */
    private _holes: Array<Curve> = [];

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
    inner(): NurbsCurve3DJs|CompoundCurve3DJs
    {
        if (!this._curve)
        {
            throw new Error('Curve::inner(): Curve not initialized');
        }
        
        return this._curve;
    }

    /** Update internal curve */
    update(c:NurbsCurve3DJs|CompoundCurve3DJs|Curve): this
    {
        if(c instanceof Curve)
        {
            this._curve = c._curve;
            this._holes = c._holes.map(h => h.copy());
        }
        else
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

    copy(): Curve
    {
        const newCurve = new Curve();
        newCurve._curve = this._curve?.clone();
        newCurve._holes = this._holes.map(h => h.copy());
        return newCurve;
    }

    /** Replicate this Curve a given number of times and return in a CurveCollection */
    replicate(num: number, transform: (curve: Curve, index: number, prev:Curve|undefined) => Curve): CurveCollection
    {
        const newCurves = new Array(num).fill(0).map((_, i, arr) => 
        {
            const newCurve = transform(this.copy(), i, i > 0 ? arr[i - 1] : undefined);
            return newCurve;
        });

        return new CurveCollection(...newCurves);
    }   

    //// CREATION ////
    /*
        We use factory methods for it's clean syntax
    */

    static fromCsgrs(curve: NurbsCurve3DJs|CompoundCurve3DJs): Curve
    {
        if(!curve) { throw new Error('Curve::fromCsgrs(): Invalid curve'); }
        const newCurve = new Curve();
        newCurve._curve = curve;
        return newCurve;
    }

    static Line(start: PointLike, end: PointLike): Curve
    {
        if(!isPointLike(start) || !isPointLike(end)){ throw new Error('Curve.Line(): Invalid start or end point. Please supply a PointLike: [x,y], [x,y,z], Point, Vector etc'); }
        return this.Polyline([Point.from(start), Point.from(end)]); // We can use polyline here
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
        else {
            controlPoints = controlPoints as Array<PointLike>; // already in correct format
        }

        return Curve.fromCsgrs(
            getCsgrs()?.NurbsCurve3DJs?.makePolyline(
                controlPoints.map(p => Point.from(p).toPoint3Js()),
                true,
            )
        );
    }

    /** Make a NURBS curve by interpolating through given points */
    static Interpolated(...args: Array<PointLike|Array<PointLike>>): Curve
    {
        // arguments can be flat [p1, p2, p3] or all in first args [[p1, p2, p3]]
        const controlPoints = (args[0] instanceof Array && args[0].every(isPointLike))
                                ? args[0].filter(isPointLike).map(p => Point.from(p)) 
                                : args.filter(isPointLike).map(p => Point.from(p));

        if(controlPoints.length < 3)
        {
            throw new Error('Curve.Interpolated(): At least 3 control points are required. Please supply PointLikes (p1,p2,p3) or [p1,p2,p3].');
        }

        return Curve.fromCsgrs(
            getCsgrs()
                ?.NurbsCurve3DJs
                    ?.makeInterpolated(
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
                    ?.NurbsCurve3DJs
                    ?.makeCircle(
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
        const ab = new Vector(B.x - A.x, B.y - A.y, B.z - A.z);
        const ac = new Vector(C.x - A.x, C.y - A.y, C.z - A.z);

        // Plane normal (cross product of two edges)
        const rawNormal = ab.cross(ac);
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
        const chord = new Vector(C.x - A.x, C.y - A.y, C.z - A.z);

        if (chord.length() < 1e-10)
        {
            throw new Error('Curve.Arc(): start and end are the same point.');
        }

        // The plane normal is the cross product of the tangent and the chord
        const rawNormal = tanUnit.cross(chord);
        if (rawNormal.length() < 1e-10)
        {
            throw new Error('Curve.Arc(): tangent is parallel to start→end — no arc can be defined.');
        }
        const normalUnit = rawNormal.normalize();

        // The center lies on the line through A perpendicular to the tangent in the plane.
        // perpAtA = normal × tangent — points from A towards center
        const perpAtA = normalUnit.cross(tanUnit).normalize();

        // Also the center must be equidistant from A and C → lies on perpendicular bisector of AC.
        const midAC = new Vector((A.x + C.x) / 2, (A.y + C.y) / 2, (A.z + C.z) / 2);
        const chordDir = chord.normalize();
        const perpBisector = normalUnit.cross(chordDir).normalize();

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
        const centerToMid = new Vector(midChord.x - center.x, midChord.y - center.y, midChord.z - center.z);
        const midOnArc = new Point(
            center.x + centerToMid.normalize().scale(radius).x,
            center.y + centerToMid.normalize().scale(radius).y,
            center.z + centerToMid.normalize().scale(radius).z,
        );

        // Use the tangent cross chord to pick the arc side consistent with the tangent direction.
        // If perpAtA (which points from A towards center) has a positive dot with center−A,
        // the arc should go the "short way" through midOnArc. Otherwise flip.
        const centerFromA = new Vector(center.x - A.x, center.y - A.y, center.z - A.z);
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
        const ab = new Vector(B.x - A.x, B.y - A.y, B.z - A.z);
        const ac = new Vector(C.x - A.x, C.y - A.y, C.z - A.z);

        const mAB = new Vector((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
        const mAC = new Vector((A.x + C.x) / 2, (A.y + C.y) / 2, (A.z + C.z) / 2);

        const dAB = normalUnit.cross(ab).normalize();
        const dAC = normalUnit.cross(ac).normalize();

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
    private static _trimArcFromCircle(A: Point, B: Point, C: Point, center: Point, radius: number, normalUnit: Vector): Curve
    {
        const csgrs = getCsgrs();
        const makeFullCircle = (n: Vector): Curve =>
            Curve.fromCsgrs(csgrs?.NurbsCurve3DJs?.makeCircle(radius, center.toPoint3Js(), n.toVector3Js()));

        let circ = makeFullCircle(normalUnit);
        let tA = circ.paramClosestToPoint(A);
        let tB = circ.paramClosestToPoint(B);
        let tC = circ.paramClosestToPoint(C);

        if (tA === null || tB === null || tC === null)
        {
            throw new Error('Curve.Arc(): Could not resolve arc parameters on the circumscribed circle.');
        }

        let kd = (circ.inner() as NurbsCurve3DJs).knotsDomain();
        let period = kd[1] - kd[0];

        // Ensure A→B→C is the forward direction of the parameterisation.
        const relB = ((tB - tA) % period + period) % period;
        const relC = ((tC - tA) % period + period) % period;

        if (relB > relC)
        {
            circ = makeFullCircle(normalUnit.scale(-1));
            tA = circ.paramClosestToPoint(A);
            tB = circ.paramClosestToPoint(B);
            tC = circ.paramClosestToPoint(C);

            if (tA === null || tB === null || tC === null)
            {
                throw new Error('Curve.Arc(): Could not resolve arc parameters after direction adjustment.');
            }

            kd     = (circ.inner() as NurbsCurve3DJs).knotsDomain();
            period = kd[1] - kd[0];
        }

        const relCfinal = ((tC - tA) % period + period) % period;
        const innerCircle = circ.inner() as NurbsCurve3DJs;
        const t1raw = tA + relCfinal;

        let segments: NurbsCurve3DJs[];
        if (t1raw <= kd[1] + 1e-10)
        {
            segments = innerCircle.trimRange(tA, Math.min(t1raw, kd[1]));
        }
        else
        {
            const seg1 = innerCircle.trimRange(tA, kd[1]);
            const seg2 = innerCircle.trimRange(kd[0], kd[0] + (t1raw - kd[1]));
            segments = [...seg1, ...seg2];
        }

        if (!segments || segments.length === 0)
        {
            throw new Error('Curve.Arc(): Failed to trim the arc from the circumscribed circle.');
        }

        return segments.length === 1
            ? Curve.fromCsgrs(segments[0])
            : Curve.fromCsgrs(new CompoundCurve3DJs(segments));
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
     *  The rectangle lies on the given base plane; each corner is projected onto it.
     *  @param from  - first corner
     *  @param to    - opposite corner
     *  @param plane - base plane (default: 'xy')
     */
    static RectBetween(from: PointLike, to: PointLike, plane: BasePlane = 'xy'): Curve
    {
        if (!isPointLike(from) || !isPointLike(to))
        {
            throw new Error('Curve.RectBetween(): from and to must be PointLike values.');
        }

        const a = Point.from(from);
        const b = Point.from(to);
        const def = BASE_PLANE_NAME_TO_PLANE[plane];
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
     *  The underlying Curvo `try_new` validates connectivity and auto-inverts spans if needed.
     */
    static Compound(curves: Array<Curve>): Curve
    {
        if(!Array.isArray(curves) || curves.length === 0)
        {
            throw new Error('Curve.Compound(): Supply a non-empty array of Curves.');
        }

        // Flatten: if a Curve is already compound, unwrap its spans
        const spans: NurbsCurve3DJs[] = [];
        for(const c of curves)
        {
            const inner = c.inner();
            if(inner instanceof CompoundCurve3DJs)
            {
                spans.push(...inner.spans());
            }
            else
            {
                spans.push(inner as NurbsCurve3DJs);
            }
        }

        // CompoundCurve3DJs constructor uses try_new: validates connectivity, auto-inverts
        const compound = new CompoundCurve3DJs(spans);
        return Curve.fromCsgrs(compound);
    }
    //// PROPERTIES ////

    /** Classify this curve as 'line', 'arc', 'circle', 'rect', 'polyline', 'spline', or 'compound'. */
    type(): 'line'|'arc'|'circle'|'rect'|'polyline'|'spline'|'compound'
    {
        const inner = this.inner();

        if (inner instanceof NurbsCurve3DJs)
        {
            return this._classifyNurbs(inner);
        }

        // CompoundCurve3DJs: inspect spans
        const compound = inner as CompoundCurve3DJs;
        const spans = compound.spans();

        if (spans.length === 0) return 'compound';

        const allDeg1 = spans.every(s => s.degree() === 1);
        if (allDeg1)
        {
            // Rebuild control points from spans to check rect/polyline
            if (this.isClosed() && this._isRect()) return 'rect';
            return 'polyline';
        }

        const allRationalDeg2 = spans.every(s =>
            s.degree() === 2 && Array.from(s.weights()).some(w => Math.abs(w - 1.0) > 1e-8)
        );
        if (allRationalDeg2)
        {
            return this.isClosed() ? 'circle' : 'arc';
        }

        return 'compound';
    }

    /** Classify a single NurbsCurve3DJs span. */
    private _classifyNurbs(c: NurbsCurve3DJs): 'line'|'arc'|'circle'|'rect'|'polyline'|'spline'
    {
        const deg = c.degree();
        const weights = Array.from(c.weights());
        const isRational = weights.some(w => Math.abs(w - 1.0) > 1e-8);

        if (deg === 1)
        {
            const nCps = c.controlPoints().length;
            if (nCps <= 2) return 'line';
            if (this.isClosed() && this._isRect()) return 'rect';
            return 'polyline';
        }

        if (deg === 2 && isRational)
        {
            return this.isClosed() ? 'circle' : 'arc';
        }

        return 'spline';
    }

    /** Check if a closed degree-1 curve forms a rectangle (4 right-angle corners). */
    private _isRect(): boolean
    {
        const pts = this.controlPoints();
        // A closed rect polyline has 5 control points (last == first) giving 4 corners
        const n = pts.length;
        if (n < 4 || n > 5) return false;

        const corners = (n === 5) ? pts.slice(0, 4) : pts;
        if (corners.length !== 4) return false;

        for (let i = 0; i < 4; i++)
        {
            const a = corners[i];
            const b = corners[(i + 1) % 4];
            const c = corners[(i + 2) % 4];
            const ab = new Vector(b.x - a.x, b.y - a.y, b.z - a.z);
            const bc = new Vector(c.x - b.x, c.y - b.y, c.z - b.z);
            if (Math.abs(ab.dot(bc)) > ANGLE_COMPARE_TOLERANCE) return false;
        }

        return true;
    }

    isCompound():boolean
    {
        return this.inner() instanceof CompoundCurve3DJs;
    }

    /** Get control points of Curve */
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

    /** Get knots of Curve */
    knots()
    {
        if(!this.isCompound())
        {
            return (this.inner() as NurbsCurve3DJs).knots();
        }
        else {
            console.warn(`Curve::knots(): Curve is compound. Use specific span to get knots`);
        }
    }

    knotsDomain():Array<number|number>|undefined
    {
        if(!this.isCompound())
        {
            return Array.from(this.inner()?.knotsDomain());
        }
        else {
            console.warn(`Curve::knots(): Curve is compound. Use specific span to get knots`);
        }
    }

    weights()
    {
        if(!this.isCompound())
        {
            return Array.from((this.inner() as NurbsCurve3DJs)?.weights());
        }
        else {
            console.warn(`Curve::weights(): Curve is compound. Use specific span to get weights`);
        }
    }
    
    spans(): Array<Curve>
    {
        if(!this.isCompound())
        {
            // If not compound, return self as single span for consistent API
            return [this];
        }
        else {
            return (this.inner() as CompoundCurve3DJs).spans().map(span => Curve.fromCsgrs(span));
        }
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
        if (this._curve instanceof NurbsCurve3DJs) {
            return this._curve.isPlanar();
        }
        // For compound curves, check via getOnPlane
        return this.getOnPlane() !== null;
    }

    /** Get the plane of the Curve as { normal, x, y }.
     *  The local axes are aligned to the closest global axes.
     *  Returns null if the curve is not planar.
     */
    getOnPlane(tolerance: number = 1e-6): { normal: Vector, x: Vector, y: Vector } | null
    {
        if (this._curve instanceof NurbsCurve3DJs)
        {
            const result = this._curve.getOnPlane(tolerance);
            if (!result || result.length === 0) return null;
            return {
                normal: new Vector(result[0].x, result[0].y, result[0].z),
                x: new Vector(result[1].x, result[1].y, result[1].z),
                y: new Vector(result[2].x, result[2].y, result[2].z),
            };
        }

        // For compound curves: check each span's plane
        if (this._curve instanceof CompoundCurve3DJs) 
        {
            const spans = this._curve.spans();
            if (!spans || spans.length === 0) return null;
            const firstResult = spans[0].getOnPlane(tolerance);
            if (!firstResult || firstResult.length === 0) return null;
            // Verify all spans share the same plane
            for (let i = 1; i < spans.length; i++) {
                const r = spans[i].getOnPlane(tolerance);
                if (!r || r.length === 0) return null;
            }
            return {
                normal: new Vector(firstResult[0].x, firstResult[0].y, firstResult[0].z),
                x: new Vector(firstResult[1].x, firstResult[1].y, firstResult[1].z),
                y: new Vector(firstResult[2].x, firstResult[2].y, firstResult[2].z),
            };
        }

        return null;
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
        // A little old fashioned, but should work
        const pnts = this.points();
        if(pnts.length < 3){ console.warn(`Curve::normalOrientation(): Curve has less than 3 control points, normal orientation may be unreliable.`); }
        const v1 = pnts[1].toVector().subtract(pnts[0].toVector());
        const v2 = pnts[2].toVector().subtract(pnts[1].toVector());
        return v1.cross(v2).normalize();
    }

    length(): number
    {
        return this.inner().length(); 
    }

    /** Start point of the curve (at the start of the knot domain) */
    start(): Point
    {
        const domain = this.inner().knotsDomain();
        return new Point(this.inner().pointAtParam(domain[0]));
    }

    /** End point of the curve (at the end of the knot domain) */
    end(): Point
    {
        const domain = this.inner().knotsDomain();
        return new Point(this.inner().pointAtParam(domain[1]));
    }
    
    degree(): number|null
    {
        if(!this.isCompound())
        {
            return (this.inner() as NurbsCurve3DJs)?.degree();
        }
        else {
            console.warn(`Curve::degree(): Curve is compound. Use specific span to get degree`);
            return null;
        }
    }

    paramAtLength(length: number): number|null
    {
        if(!this.isCompound())
        {
            return (this.inner() as NurbsCurve3DJs)?.paramAtLength(length);
        }
        else {
            console.warn(`Curve::paramAtLength(): Curve is compound. Use specific span to get parameter at length`);
            return null;
        }
            
    }

    paramClosestToPoint(point: PointLike): number|null
    {
        try
        {
            return this.inner()?.paramClosestToPoint(new Point(point).toPoint3Js());
        }
        catch (e)
        {
            console.error('Curve::paramClosestToPoint(): Error:', e);
            return null;
        }
    }

    pointAtParam(p: number): Point
    {
        return new Point(
            this.inner().pointAtParam(p));
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
    distance(to: PointLike|Curve): number|null
    {
        if(isPointLike(to))
        {
            return this._distanceToPoint(Point.from(to));
        }
        else if(to instanceof Curve)
        {
            return this._distanceToCurve(to);
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

        for (let i = 0; i <= NUM_SAMPLES; i++)
        {
            const tA = domainA[0] + (domainA[1] - domainA[0]) * i / NUM_SAMPLES;
            const tB = domainB[0] + (domainB[1] - domainB[0]) * i / NUM_SAMPLES;
            samplesA.push({ param: tA, pt: this.pointAtParam(tA) });
            samplesB.push({ param: tB, pt: other.pointAtParam(tB) });
        }

        // 2. Find top-k closest pairs as seeds
        const seeds: Array<{ distSq: number, paramA: number, paramB: number }> = [];
        for (const a of samplesA)
        {
            for (const b of samplesB)
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
            }
        }

        if (seeds.length === 0) return null;

        // 3. Refine each seed with alternating closest-point iteration
        let bestDist = Infinity;
        let bestPair: [Point, Point]|null = null;

        for (const seed of seeds)
        {
            let ptA = this.pointAtParam(seed.paramA);
            let ptB = other.pointAtParam(seed.paramB);
            let prevDist = Infinity;

            for (let i = 0; i < MAX_ACI_ITER; i++)
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
        }

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
        const bboxCoords = this.inner()?.bbox();
        return bboxCoords ? new Bbox(bboxCoords) : undefined;
    }

    /** Get oriented bounding box of this Curve using PCA */
    obbox(): OBbox
    {
        return OBbox.fromCurve(this);
    }

    /** Center point of this curve's bounding box */
    center(): Point
    {
        const bb = this.bbox();
        if (bb) return bb.center();
        // Fallback: midpoint along the curve
        return this.pointAtPerc(0.5) ?? this.start();
    }

    /** Tessellate the curve into a series of points.
     *  @param tol - tessellation normal tolerance
     *  @returns array of points representing the tessellated curve
     * 
     *  NOTE: Currently only uses normal tolerance in Curvo AdaptiveTessellationOptions
     *      see https://docs.rs/curvo/0.1.81/curvo/prelude/struct.AdaptiveTessellationOptions.html
     *      More control can be added in the future
     */
    tessellate(tol: number = TESSELATION_TOLERANCE): Array<Point>
    {
        return this.inner().tessellate(tol)
            .map(p => Point.from(p));
    }


    //// OPERATIONS ////

    translate(vecOrX: PointLike | number, dy?: number, dz?: number): this
    {
        const vec = (isPointLike(vecOrX)) 
                        ? Point.from(vecOrX) 
                        : Point.from(vecOrX, dy || 0, dz || 0);

        if(!vec){ throw new Error('Curve.translate(): Invalid translation input. Please use PointLike or valid offset coordinates.'); }
        this.update(this.inner().translate(vec.toVector3Js()));
        return this;
    }

    /** Alias for translate */
    move(vecOrX: PointLike | number, dy?: number, dz?: number): this
    {
        return this.translate(vecOrX, dy, dz);
    }

    moveX(dx: number): this { return this.translate(dx, 0, 0); }
    moveY(dy: number): this { return this.translate(0, dy, 0); }
    moveZ(dz: number): this { return this.translate(0, 0, dz); }

    /** Rotate the given curve a specified angle (in degrees) around an axis through the world origin */
    rotate(angle: number, axis: Axis | PointLike = 'z', pivot: PointLike = [0, 0, 0]): this
    {
        return this.update(this.rotateAround(angle, axis, pivot));
    }

    /** Rotate Curve by angleDeg around an axis through a pivot point.
     *  Uses Rodrigues' rotation formula on control points — works for any axis.
     *  @param angleDeg - rotation angle in degrees
     *  @param axis     - 'x' | 'y' | 'z' or an arbitrary direction vector (PointLike)
     *  @param pivot    - point the axis passes through (default: world origin)
     */
    rotateAround(angleDeg: number, axis: Axis | PointLike = 'z', pivot: PointLike = [0, 0, 0]): this
    {
        const p = Point.from(pivot);
        this.translate([-p.x, -p.y, -p.z]);

        if (typeof axis === 'string')
        {
            const a = rad(angleDeg);
            this.update(this.inner().rotate(
                axis === 'x' ? a : 0,
                axis === 'y' ? a : 0,
                axis === 'z' ? a : 0,
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

    rotateX(angle: number, pivot: PointLike = [0, 0, 0]): this 
    { 
        return this.rotateAround(angle, 'x', pivot); 
    }

    rotateY(angle: number, pivot: PointLike = [0, 0, 0]): this 
    { 
        return this.rotateAround(angle, 'y', pivot); 
    }
    
    rotateZ(angle: number, pivot: PointLike = [0, 0, 0]): this 
    { 
        return this.rotateAround(angle, 'z', pivot); 
    }

    /** Rotate Curve by a quaternion given as components `(w, x, y, z)`.
     *  The quaternion is normalized internally, so non-unit input is safe.
     */
    rotateQuaternion(wOrObj: number | {w: number, x: number, y: number, z: number}, x?: number, y?: number, z?: number): this
    {
        if (typeof wOrObj === 'object' && wOrObj !== null && 'w' in wOrObj && 'x' in wOrObj && 'y' in wOrObj && 'z' in wOrObj) {
            return this.update(this.inner().rotateQuaternion(wOrObj.w, wOrObj.x, wOrObj.y, wOrObj.z));
        } else {
            return this.update(this.inner().rotateQuaternion(wOrObj, x!, y!, z!));
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
        const srcEdge = new Vector(p2.x - p1.x, p2.y - p1.y, p2.z - p1.z);
        const tgtEdge = new Vector(q2.x - q1.x, q2.y - q1.y, q2.z - q1.z);

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
            const rel = new Vector(p3.x - p1.x, p3.y - p1.y, p3.z - p1.z)
                            .scale(scaleFactor)
                            .rotateQuaternion(R1.w, R1.x, R1.y, R1.z);

            // Where q3 sits relative to q1:
            const goal = new Vector(q3.x - q1.x, q3.y - q1.y, q3.z - q1.z);

            // Twist axis = the aligned first edge (unit)
            const axLen = tgtEdge.length();
            if (axLen > 1e-10)
            {
                const axis = tgtEdge.scale(1 / axLen);

                // Project both vectors onto the plane perpendicular to axis
                const u1 = rel.subtract(axis.scale(rel.dot(axis)));
                const u2 = goal.subtract(axis.scale(goal.dot(axis)));

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

    scale(factor: number | PointLike, origin?: PointLike): this
    {
        const [sx, sy, sz] = (typeof factor === 'number') ? [factor, factor, factor] : [Point.from(factor).x, Point.from(factor).y, Point.from(factor).z];
        if (origin)
        {
            const o = Point.from(origin);
            this.translate([-o.x, -o.y, -o.z]);
            this.update(this.inner().scale(sx, sy, sz));
            this.translate([o.x, o.y, o.z]);
            return this;
        }
        return this.update(this.inner().scale(sx, sy, sz));
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
    mirror(dir: Axis | PointLike, pos?: PointLike): this
    {
        const planeNormal = isPointLike(dir)
                                ? Point.from(dir).toVector()
                                : Vector.from(dir); // converts axis to Vector
        const n = planeNormal.normalize();
        const planePos = pos
                            ? Point.from(pos)
                            : this.bbox()?.center() ?? new Point([0, 0, 0]);

        // Reflect a single point: P' = P - 2·dot(P−Q, n)·n
        const mirrorPoint = (p: Point): Point => {
            const dot2 = 2 * ((p.x - planePos.x) * n.x + (p.y - planePos.y) * n.y + (p.z - planePos.z) * n.z);
            return new Point([p.x - dot2 * n.x, p.y - dot2 * n.y, p.z - dot2 * n.z]);
        };

        // Reflect a single NURBS span and return a new NurbsCurve3DJs
        const mirrorSpan = (span: NurbsCurve3DJs): NurbsCurve3DJs => {
            const mirroredPoints = span.controlPoints().map(p => mirrorPoint(Point.from(p)).toPoint3Js());
            return new NurbsCurve3DJs(span.degree(), mirroredPoints, span.weights(), span.knots());
        };

        if (!this.isCompound())
        {
            this.update(mirrorSpan(this.inner() as NurbsCurve3DJs));
        }
        else
        {
            const mirroredSpans = (this.inner() as CompoundCurve3DJs).spans().map(mirrorSpan);
            this.update(new CompoundCurve3DJs(mirroredSpans));
        }

        return this;
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
        const projectPoint = (p: Point): Point => {
            const dot = (p.x - origin.x) * n.x + (p.y - origin.y) * n.y + (p.z - origin.z) * n.z;
            return new Point(p.x - dot * n.x, p.y - dot * n.y, p.z - dot * n.z);
        };

        const projectSpan = (span: NurbsCurve3DJs): NurbsCurve3DJs => {
            const projectedPoints = span.controlPoints().map(p => projectPoint(Point.from(p)).toPoint3Js());
            return new NurbsCurve3DJs(span.degree(), projectedPoints, span.weights(), span.knots());
        };

        if (!this.isCompound())
        {
            this.update(projectSpan(this.inner() as NurbsCurve3DJs));
        }
        else
        {
            const projectedSpans = (this.inner() as CompoundCurve3DJs).spans().map(projectSpan);
            this.update(new CompoundCurve3DJs(projectedSpans));
        }

        return this;
    }

    /** Merge consecutive collinear line spans into single segments.
     *  If only one span remains, unwraps to a single NurbsCurve. */
    mergeColinearLines(colinearTol: number = 1e-3): this
    {
        if (!this.isCompound()) return this;

        const merged = (this.inner() as CompoundCurve3DJs).mergeColinearLines(colinearTol);
        this.update(merged);

        // If compound has a single span left, unwrap to a plain NurbsCurve
        if (this.isCompound())
        {
            const spans = (this.inner() as CompoundCurve3DJs).spans();
            if (spans.length === 1)
            {
                this._curve = spans[0];
            }
        }

        return this;
    }


     /** Close this curve by adding a line segment from end back to start.
     *  If already closed, returns self unchanged.
     *  The (inner) result is always a CompoundCurve.
     */
    close(): this
    {
        if (this.isClosed()) return this;

        const startPt = this.start();
        const endPt = this.end();
        const closingLine = Curve.Line(endPt, startPt);

        // Build spans array: existing span(s) + closing line
        const spans: NurbsCurve3DJs[] = [];
        const inner = this.inner();
        if (inner instanceof CompoundCurve3DJs)
        {
            spans.push(...inner.spans());
        }
        else
        {
            spans.push(inner as NurbsCurve3DJs);
        }
        spans.push(closingLine.inner() as NurbsCurve3DJs);

        this._curve = new CompoundCurve3DJs(spans);
        return this;
    }

    /** Fillet sharp corner(s) of Curve. Optionally only at given point(s) */
    fillet(radius: number, at?: PointLike|Array<PointLike>): this|null
    {
        const atPoints = (isPointLike(at)) 
                        ? [new Point(at).toPoint3Js()] 
                        : (Array.isArray(at)) 
                            ? at.map(p => new Point(p).toPoint3Js()).filter(p => p) 
                            : null;
        if(!this.isCompound())
        {
            // Any fillet operation results in compound curve
            const compoundCurve = (this.inner() as NurbsCurve3DJs).fillet(radius, atPoints);
            this._curve = compoundCurve; // override inner curve
            return this;
        }
        return null;
    }

    filletAtParams(radius: number, at: Array<number>): this|null
    {
        if(!this.isCompound())
        {
            // Any fillet operation results in compound curve
            const compoundCurve = (this.inner() as NurbsCurve3DJs).filletAtParams(radius, new Float64Array(at));
            this._curve = compoundCurve; // override inner curve
            return this;
        }
        return null;
    }
    

    extend(length: number, side: 'start'|'end'|'both' = 'end'): this
    {
        // Both NurbsCurve3DJs and CompoundCurve3DJs now return CompoundCurve3DJs
        this.update(this.inner().extend(length, side));
        return this;
    }

    /** Offset a Curve a given amount (+ or -) and optionally provide corner type (default:sharp) */
    offset(distance: number, cornerType:'sharp'|'round'|'smooth'='sharp'): Curve|null
    {
        if(!this.isPlanar()){ throw new Error(`Curve:offset(): Cannot offset a 3D curve!`);}
        // If compound with all-line spans, combine into a single polyline first
        const curve = this.isCompound() ? this.mergeColinearLines() : this;
        return this.update(Curve.fromCsgrs(curve.inner()?.offset(distance, cornerType)));
    }

    /** Trim the curve to a sub-curve between parameters t0 and t1.
     *  Returns an array of Curves (typically one for inside trim).
     *  Parameters are in the curve's knot domain (see knotsDomain()).
     */
    trim(t0: number, t1: number): Array<Curve>
    {
        try
        {
            const spans: Array<NurbsCurve3DJs> = this.inner()?.trimRange(t0, t1);
            return (spans || []).map(s => Curve.fromCsgrs(s));
        }
        catch (e)
        {
            console.error('Curve::trim(): Error:', e);
            return [];
        }
    }

    /** Split the curve at parameter t, returning [left, right]. 
     *  Parameter t must be within the curve's knot domain.
     */
    split(t: number): [Curve, Curve] | null
    {
        try 
        {
            const parts = this.inner()?.split(t);
            if(!parts || parts.length < 2) return null;
            return [Curve.fromCsgrs(parts[0]), Curve.fromCsgrs(parts[1])];
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
            return ((this.isCompound())
                ? (!other.isCompound())
                    ? this.inner()?.intersect(other.inner() as NurbsCurve3DJs)
                    : this.inner()?.intersectCompound(other.inner() as CompoundCurve3DJs)
                : (!other.isCompound())
                    ? this.inner()?.intersect(other.inner() as NurbsCurve3DJs)
                    : this.inner()?.intersectCompound(other.inner() as CompoundCurve3DJs)
            || [])
            .map(p => Point.from(p).round()); // round to default Point tolerance to avoid most rounding errors
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
    connectTo(other:Curve, maxGap?: number):this 
    {
        if(!(other instanceof Curve)){ throw new Error(`Curve::connectTo(): Expected a Curve. Got: ${other}`); }

        const curEndpoints = [{ point: this.start(), used: false }, { point: this.end(), used: false }];
        const otherEndpoints = [{ point: other.start(), used: false }, { point: other.end(), used: false }];
        
        // Find closest pair of endpoints and create extra lines
        const addedLines: Array<Curve> = [];

        curEndpoints.forEach(curEndpoint => 
        {
            otherEndpoints.forEach(otherEndpoint => 
            {
                // skip if either endpoint already used
                if(curEndpoint.used || otherEndpoint.used){ return; }

                const dist = curEndpoint.point.distance(otherEndpoint.point);
                if (maxGap === undefined || dist <= maxGap)
                {
                    curEndpoint.used = true;
                    otherEndpoint.used = true;
                    const line = Curve.Line(curEndpoint.point, otherEndpoint.point); 
                    addedLines.push(line);
                }
            });
        });

        // Combine original spans with added lines and create a new CompoundCurve
        const combinedCurves = CurveCollection.from(
                                    this.spans().concat(addedLines)
                                ).combine();
        // The combined collection should always be a Curve or CompoundCurve
        // But just to make sure:
        if(combinedCurves.count() > 1)
        {
            console.warn(`Curve::connectTo(): Unexpected result: more than one combined curve. Check connectivity and maxGap.`, combinedCurves);
        }

        this._curve = combinedCurves.first()?.inner();
        
        return this;
    }

    //// BOOLEAN OPERATIONS ////
    /*
        NOTES:
            - If boolean operation succeeds:
                    - Result is single Curve: current Curve is replaced by the result
                    - Result are multiple Curves: a new CurveCollection is returned, current Curve is unchanged (also give warning)
            - If it fails: return original curve with warning
            - the operant (other) is not modified/removed in either case
    */

    /** Perform a boolean operation against another Curve
     *  Dispatches to the correct WASM method based on curve types.
     *  @returns CurveCollection of result Curves (each with holes attached), or null on error.
     */
    private _booleanOp(other: Curve, operation: 'union'|'difference'|'intersection'): CurveCollection | null
    {
        try
        {
            const regions: BooleanRegionJs[] = (this.isCompound())
                ? (!other.isCompound()
                    ? (this.inner() as CompoundCurve3DJs).booleanCurve(other.inner() as NurbsCurve3DJs, operation)
                    : (this.inner() as CompoundCurve3DJs).booleanCompoundCurve(other.inner() as CompoundCurve3DJs, operation))
                : (!other.isCompound() // single Curve
                    ? (this.inner() as NurbsCurve3DJs).booleanCurve(other.inner() as NurbsCurve3DJs, operation)
                    : (this.inner() as NurbsCurve3DJs).booleanCompoundCurve(other.inner() as CompoundCurve3DJs, operation));

            const curves: Array<Curve> = [];
            for (const region of (regions || []))
            {
                const exterior = Curve.fromCsgrs(region.exterior);
                // Attach hole curves to the exterior curve
                const holeCurves = region.holes || [];
                for (const hole of holeCurves)
                {
                    exterior.addHole(Curve.fromCsgrs(hole));
                }
                curves.push(exterior);
            }
            return new CurveCollection(...curves);
        }
        catch (e)
        {
            console.error(`Curve::${operation}(): Error:`, e);
            // TODO: add some analysis of why it failed 
            // for example: don't touch, not closed etc

            return null;
        }
    }

    /** Boolean union of this (closed) Curve with another (closed) Curve.
     *  Both curves must be closed and coplanar.
     *  Returns the exterior outlines of the resulting regions,
     *  or null on error.
     */
    union(other: Curve): Curve|CurveCollection|null
    {
        const bool = this._booleanOp(other, 'union')?.checkSingle() || null;
        if(bool instanceof Curve){ return this.update(bool);}
        else if (bool instanceof CurveCollection)
        {
            console.warn('Curve::union(): Result are multiple curves. Returning a CurveCollection');
            return bool;
        }
        else { console.warn('Curve::union(): Boolean operation failed. Returning null.'); return null; }
    }

    /** Boolean subtraction: this Curve minus the other Curve.
     *  Both curves must be closed and coplanar.
     *  Returns the exterior outlines of the resulting regions,
     *  or null on error.
     */
    difference(other: Curve): Curve|CurveCollection|null
    {
        const bool = this._booleanOp(other, 'difference')?.checkSingle() || null;
        if(bool instanceof Curve){ return this.update(bool);}
        else if (bool instanceof CurveCollection)
        {
            console.warn('Curve::difference(): Result are multiple curves. Returning a CurveCollection');
            return bool;
        }
        else { console.warn('Curve::difference(): Boolean operation failed. Returning null.'); return null; }
    }

    // Alias for difference
    subtract(other: Curve): Curve|CurveCollection|null
    {
        return this.difference(other);
    }

    /** Get intersecting Curves with either closed Curves or Mesh */
    intersections(other: Curve|Mesh): CurveCollection|null
    {
        return (other instanceof Mesh) 
                    ? this._intersectionMesh(other) 
                    : this._intersectionCurve(other);
    }

    /** Get single intersection of Curve with another Curve or Mesh */
    intersection(other: Curve|Mesh): Curve|CurveCollection|null
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
    private _intersectionCurve(other: Curve): CurveCollection | null
    {
        if(!this.isClosed){ throw new Error('Curve::intersection(): Intersection requires closed curves for now!'); }
        
        return this._booleanOp(other, 'intersection');
    }

    /** Intersect this Curve with a Mesh and return the trimmed sub-curve(s) as CurveCollection.
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
    private _intersectionMesh(mesh: Mesh, tolerance?: number): CurveCollection|null
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

        return (results.length > 0) ? new CurveCollection(results) : null;
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

            const pts = (this.isCompound())
                ? mesh.inner()?.intersectCompoundCurve(this.inner() as CompoundCurve3DJs, tolerance)
                : mesh.inner()?.intersectCurve(this.inner() as NurbsCurve3DJs, tolerance);

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
     *  @param direction - The extrusion direction vector (default planar normal or [0,0,1])
     *  @param length - The extrusion length (default: 1)
     *  @returns A new Mesh representing the extruded geometry
     */
    extrude(length: number, direction: PointLike): Mesh|null
    {
        console.error(`Curve::extrude(): Not implemented yet!`);
        return null;
    }

    

    //// TRANSFORMATION TO OTHER TYPES ////

    /** Convert this curve to a Polygon via tessellation (including hole rings if present). */
    toPolygon(tolerance: number = TESSELATION_TOLERANCE): Polygon | undefined
    {
        const points = this.tessellate(tolerance);

        if (points.length < 3)
        {
            console.warn(`Curve::toPolygon(): Not enough points (${points.length}) to create a polygon. A minimum of 3 non-collinear points is required.`);
            return undefined;
        }

        const poly = new Polygon(points);

        if (this.hasHoles())
        {
            for (const hole of this._holes)
            {
                const holePoints = hole.tessellate(tolerance);
                if (holePoints.length >= 3)
                {
                    poly.addHole(holePoints);
                }
            }
        }
        return poly;
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
        return ((this.isPlanar() && this.normalOrientation()!.dot(new Vector(0, 1, 0)) < 0))
                ? m.inverse()
                : m;
    }
    

    //// OUTPUTS ////

    toString()
    {
        return `<Curve(${this.isCompound() ? 'Compound' : 'Single'}): length="${this.length().toFixed(3)}", planar="${this.isPlanar()}", closed="${this.isClosed()}">`;
    }

    /**
     * Build the raw geometry buffer for this curve, ready to be embedded in a GLTF document.
     * Returns all pieces needed to assemble one GLTF primitive so that multiple curves can be
     * combined into a single GLTF later.
     */
    toGLTFBuffer(up: Axis = 'z'): GLTFBuffer
    {
        const points = this.tessellate();
        const pointsFlat = new Float32Array(
            points
                .map(p => {
                    const arr = p.toArray();
                    if (up === 'z')
                    {
                        return [arr[0], arr[2], -arr[1]];
                    }
                    else if (up === 'x')
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

        if (pointsFlat.length < 3)
        {
            throw new Error(`Curve::toGLTFBuffer(): Not enough vertices to export!`);
        }

        // Compute min/max from the already-remapped positions in the buffer
        const minArr = [Infinity, Infinity, Infinity];
        const maxArr = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < pointsFlat.length; i += 3)
        {
            for (let c = 0; c < 3; c++)
            {
                if (pointsFlat[i + c] < minArr[c]) minArr[c] = pointsFlat[i + c];
                if (pointsFlat[i + c] > maxArr[c]) maxArr[c] = pointsFlat[i + c];
            }
        }

        return {
            data: toBase64(pointsFlat),
            byteLength: pointsFlat.byteLength,
            count: points.length,
            min: new Point(minArr[0], minArr[1], minArr[2]),
            max: new Point(maxArr[0], maxArr[1], maxArr[2]),
        };
    }

    /** Serialize this curve as a self-contained GLTF JSON string (LINE_STRIP). */
    toGLTF(up: Axis = 'z'): string
    {
        const buf = this.toGLTFBuffer(up);

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
                count: buf.count,
                type: "VEC3",
                max: buf.max,
                min: buf.min,
            }],
            bufferViews: [{
                buffer: 0,
                byteOffset: 0,
                byteLength: buf.byteLength,
                target: 34962 // ARRAY_BUFFER
            }],
            buffers: [{
                byteLength: buf.byteLength,
                uri: `data:application/octet-stream;base64,${buf.data}`
            }]
        };

        return JSON.stringify(gltf);
    }

    /** Export this curve as an SVG string, projecting onto the given named plane.
     *  Preserves arc geometry: degree-2 rational NURBS → SVG `A`, quadratic → `Q`, cubic → `C`, line → `L`.
     *  @param plane - named base plane to project onto (default: 'xy')
     */
    toSVG(plane: BasePlane = 'xy'): string
    {
        // Project onto the target plane, then read XY as the 2D SVG coordinates
        const projected = this.copy().projectOnto(plane);

        const fmt = (n: number) => +n.toFixed(6);
        // SVG Y-axis points down, so negate y
        const to2D = (p: { x: number; y: number; z: number }): [number, number] => [p.x, -p.y];

        // Full circle → emit a <circle> element directly instead of two arcs
        if (this.type() === 'circle')
        {
            const bb = projected.bbox();
            if (bb)
            {
                const cx = fmt((bb.min().x + bb.max().x) / 2);
                const cy = fmt(-((bb.min().y + bb.max().y) / 2)); // SVG Y flip
                const r  = fmt((bb.max().x - bb.min().x) / 2);
                const pad = +r * 0.05 || 1;
                const vbX = fmt(cx - r - pad);
                const vbY = fmt(cy - r - pad);
                const vbW = fmt(2 * r + 2 * pad);
                const vbH = fmt(2 * r + 2 * pad);
                return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}"><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="black" stroke-width="1"/></svg>`;
            }
        }

        const pathParts: string[] = [];
        const spans = projected._getSvgSpans();

        for (let si = 0; si < spans.length; si++)
        {
            const spanCurve = Curve.fromCsgrs(spans[si]);
            const cps = spanCurve.controlPoints();
            const curveType = spanCurve.type();

            // Move-to for the first span's start
            if (si === 0)
            {
                const [sx, sy] = to2D(cps[0]);
                pathParts.push(`M${fmt(sx)} ${fmt(sy)}`);
            }

            switch (curveType)
            {
                case 'line':
                case 'polyline':
                case 'rect':
                {
                    for (let i = 1; i < cps.length; i++)
                    {
                        const [x, y] = to2D(cps[i]);
                        pathParts.push(`L${fmt(x)} ${fmt(y)}`);
                    }
                    break;
                }
                case 'arc':
                case 'circle':
                {
                    _appendArcSvg(spans[si], to2D, fmt, pathParts);
                    break;
                }
                case 'spline':
                {
                    const span = spans[si];
                    const deg = span.degree();
                    const weights = Array.from(span.weights());
                    const bezierSegs = _bsplineToBezierSegments(
                        span.controlPoints(), Array.from(span.knots()), weights, deg);

                    if (deg === 2)
                    {
                        for (const seg of bezierSegs)
                        {
                            const [, cp1, end] = seg.map(to2D);
                            pathParts.push(`Q${fmt(cp1[0])} ${fmt(cp1[1])} ${fmt(end[0])} ${fmt(end[1])}`);
                        }
                    }
                    else
                    {
                        // degree 3 (cubic) is the common case
                        for (const seg of bezierSegs)
                        {
                            const [, cp1, cp2, end] = seg.map(to2D);
                            pathParts.push(`C${fmt(cp1[0])} ${fmt(cp1[1])} ${fmt(cp2[0])} ${fmt(cp2[1])} ${fmt(end[0])} ${fmt(end[1])}`);
                        }
                    }
                    break;
                }
                default:
                {
                    // compound or unsupported: tessellate fallback
                    const pts = spanCurve.tessellate();
                    for (let i = 1; i < pts.length; i++)
                    {
                        const [x, y] = to2D(pts[i]);
                        pathParts.push(`L${fmt(x)} ${fmt(y)}`);
                    }
                    break;
                }
            }
        }

        // Close path if the curve is closed
        if (this.isClosed())
        {
            pathParts.push('Z');
        }

        // Compute viewBox from bbox of the projected curve (in SVG-flipped Y)
        const bb = projected.bbox();
        let vbX: number, vbY: number, vbW: number, vbH: number;
        if (bb)
        {
            const minPt = bb.min();
            const maxPt = bb.max();
            // SVG y is flipped: world minY → SVG maxY, world maxY → SVG minY
            const svgMinX = minPt.x;
            const svgMinY = -maxPt.y;
            const svgW = maxPt.x - minPt.x;
            const svgH = maxPt.y - minPt.y;
            const pad = Math.max(svgW, svgH) * 0.05 || 1;
            vbX = fmt(svgMinX - pad);
            vbY = fmt(svgMinY - pad);
            vbW = fmt(svgW + 2 * pad);
            vbH = fmt(svgH + 2 * pad);
        }
        else
        {
            vbX = 0; vbY = 0; vbW = 1; vbH = 1;
        }

        const d = pathParts.join(' ');
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}"><path d="${d}" fill="none" stroke="black" stroke-width="1"/></svg>`;
    }

    /** Collect all individual NurbsCurve3DJs spans from this curve (compound or single).
     *  Closed degree-2 rational curves (full circles) are split at the midpoint
     *  so that each resulting arc is open and can map to an SVG `A` command. */
    private _getSvgSpans(): NurbsCurve3DJs[]
    {
        const inner = this.inner();
        let rawSpans: NurbsCurve3DJs[];
        if (inner instanceof CompoundCurve3DJs)
        {
            rawSpans = inner.spans();
        }
        else
        {
            rawSpans = [inner as NurbsCurve3DJs];
        }

        // Split any geometrically-closed rational degree-2 span (full circle) into two open arcs
        const result: NurbsCurve3DJs[] = [];
        for (const span of rawSpans)
        {
            if (span.degree() === 2
                && Array.from(span.weights()).some(w => Math.abs(w - 1.0) > 1e-8))
            {
                // Check geometric closure: start ≈ end
                const cps = span.controlPoints();
                const first = cps[0];
                const last = cps[cps.length - 1];
                const dist = Math.sqrt(
                    (first.x - last.x) ** 2 + (first.y - last.y) ** 2 + (first.z - last.z) ** 2
                );

                if (dist < 1e-6)
                {
                    // Closed circle/arc: split at midpoint so each half is an open arc
                    const [lo, hi] = Array.from(span.knotsDomain());
                    const mid = (lo + hi) / 2;
                    const halves = span.split(mid);
                    result.push(...halves);
                    continue;
                }
            }
            result.push(span);
        }
        return result;
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

    for (const { value, multiplicity } of interiorKnots)
    {
        const timesToInsert = p - multiplicity;
        for (let t = 0; t < timesToInsert; t++)
        {
            const result = _boehmInsert(pts, U, p, value);
            pts = result.points;
            U = result.knots;
        }
    }

    // After full knot insertion, each Bezier segment spans (p+1) control points
    // with overlap at boundary points.
    const numSegments = (pts.length - 1) / p;
    const segments: Array<Array<{ x: number; y: number; z: number }>> = [];

    for (let i = 0; i < numSegments; i++)
    {
        const seg: Array<{ x: number; y: number; z: number }> = [];
        for (let j = 0; j <= p; j++)
        {
            const h = pts[i * p + j];
            const invW = h.w !== 0 ? 1 / h.w : 1;
            seg.push({ x: h.x * invW, y: h.y * invW, z: h.z * invW });
        }
        segments.push(seg);
    }

    return segments;
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
    while (i < n - degree - 1)
    {
        const val = knots[i];
        if (val > lo && val < hi)
        {
            let mult = 0;
            let j = i;
            while (j < n - degree - 1 && Math.abs(knots[j] - val) < 1e-12)
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
    let k = -1;
    for (let i = p; i < knots.length - 1; i++)
    {
        if (knots[i] <= u + 1e-12 && u < knots[i + 1] - 1e-12)
        {
            k = i;
            break;
        }
    }
    if (k === -1) k = knots.length - p - 2; // fallback for end

    // Compute new control points
    const newPts: Array<{ x: number; y: number; z: number; w: number }> = [];
    for (let i = 0; i <= n; i++)
    {
        if (i <= k - p)
        {
            newPts.push({ ...pts[i] });
        }
        else if (i >= k + 1)
        {
            newPts.push({ ...pts[i - 1] });
        }
        else
        {
            // k-p+1 <= i <= k
            const denom = knots[i + p] - knots[i];
            const alpha = denom > 1e-14 ? (u - knots[i]) / denom : 0;
            newPts.push({
                x: (1 - alpha) * pts[i - 1].x + alpha * pts[i].x,
                y: (1 - alpha) * pts[i - 1].y + alpha * pts[i].y,
                z: (1 - alpha) * pts[i - 1].z + alpha * pts[i].z,
                w: (1 - alpha) * pts[i - 1].w + alpha * pts[i].w,
            });
        }
    }

    // Insert knot value into knot vector
    const newKnots = [...knots.slice(0, k + 1), u, ...knots.slice(k + 1)];

    return { points: newPts, knots: newKnots };
}

/** Append SVG arc (A) commands for a rational degree-2 NURBS span (circle/arc).
 *  Expects the span to already be projected onto XY. Uses (x, -y) for SVG coordinates.
 *  Uses the circumcircle of three sampled points to determine the radius,
 *  and the cross product to determine the sweep direction. */
function _appendArcSvg(
    span: NurbsCurve3DJs,
    to2D: (p: { x: number; y: number; z: number }) => [number, number],
    fmt: (n: number) => number,
    pathParts: string[]
): void
{
    const cps = span.controlPoints();
    const [domain0, domain1] = Array.from(span.knotsDomain());
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