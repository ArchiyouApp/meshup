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

import { TESSELATION_TOLERANCE } from './constants';

import { NurbsCurve3DJs, CompoundCurve3DJs, Vector3Js, BooleanRegionJs } from "./wasm/csgrs";

import { MeshCollection, CurveCollection, getCsgrs, Mesh } from './index';
import type { CsgrsModule, PointLike, Axis, GLTFBuffer } from './types';
import { isPointLike } from './types'
import { Point } from './Point';
import { Vector } from './Vector';
import { Bbox } from './Bbox';

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
    static Interpolated(controlPoints: PointLike[], degree: number = 3): Curve
    {
        return Curve.fromCsgrs(
            getCsgrs()
                ?.NurbsCurve3DJs
                    ?.makeInterpolated(
                        controlPoints.map(p => new Point(p).toPoint3Js()),
                        degree,
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

    type(): 'Curve'|'Compound'
    {
        return (this.inner() instanceof NurbsCurve3DJs) ? 'Curve' : 'Compound';
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
        if (this._curve instanceof NurbsCurve3DJs) {
            const result = this._curve.getOnPlane(tolerance);
            if (!result || result.length === 0) return null;
            return {
                normal: new Vector(result[0].x, result[0].y, result[0].z),
                x: new Vector(result[1].x, result[1].y, result[1].z),
                y: new Vector(result[2].x, result[2].y, result[2].z),
            };
        }

        // For compound curves: check each span's plane
        if (this._curve instanceof CompoundCurve3DJs) {
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

    bbox():undefined|Bbox
    {
        const bboxCoords = this.inner()?.bbox();
        return bboxCoords ? new Bbox(bboxCoords) : undefined;
    }

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

    /** rotate the given curve for the specified angles (in degrees) per axis */
    rotate(ax: number, ay?: number, az?: number): this
    {
        return this.update(this.inner().rotate(rad(ax), rad(ay || 0), rad(az || 0)));
    }

    /** Rotate Curve by angleDeg around an axis through a pivot point.
     *  Uses Rodrigues' rotation formula on control points — works for any axis.
     *  @param angleDeg - rotation angle in degrees
     *  @param axis     - 'x' | 'y' | 'z' or an arbitrary direction vector (PointLike)
     *  @param pivot    - point the axis passes through (default: world origin)
     */
    rotateAround(angleDeg: number, axis: Axis | PointLike = 'z', pivot: PointLike = [0, 0, 0]): this
    {
        const axVec = (typeof axis === 'string') ? Vector.from(axis) : Point.from(axis).toVector();
        const u = axVec.normalize();
        const o = Point.from(pivot);
        const theta = rad(angleDeg);
        const cos = Math.cos(theta), sin = Math.sin(theta), t = 1 - cos;
        const { x: ux, y: uy, z: uz } = u;

        // Rodrigues rotation of a single point around axis through pivot
        const rotatePoint = (p: Point): Point =>
        {
            const dx = p.x - o.x, dy = p.y - o.y, dz = p.z - o.z;
            const dot = dx * ux + dy * uy + dz * uz;
            return new Point(
                o.x + (t * ux * ux + cos) * dx + (t * ux * uy - sin * uz) * dy + (t * ux * uz + sin * uy) * dz,
                o.y + (t * ux * uy + sin * uz) * dx + (t * uy * uy + cos) * dy + (t * uy * uz - sin * ux) * dz,
                o.z + (t * ux * uz - sin * uy) * dx + (t * uy * uz + sin * ux) * dy + (t * uz * uz + cos) * dz,
            );
        };

        const rotateSpan = (span: NurbsCurve3DJs): NurbsCurve3DJs =>
        {
            const pts = span.controlPoints().map(p => rotatePoint(Point.from(p)).toPoint3Js());
            return new NurbsCurve3DJs(span.degree(), pts, span.weights(), span.knots());
        };

        if (!this.isCompound())
        {
            this.update(rotateSpan(this.inner() as NurbsCurve3DJs));
        }
        else
        {
            const spans = (this.inner() as CompoundCurve3DJs).spans().map(rotateSpan);
            this.update(new CompoundCurve3DJs(spans));
        }

        this._holes = this._holes.map(h => { h.rotateAround(angleDeg, axis, pivot); return h; });

        return this;
    }

    scale(sx: number, sy: number, sz: number): this
    {
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

    /** Merge seperate line spans into a single polyline Curve 
     *  TODO: more robust
    */
    mergeLines(): this
    {
        // ...existing code...
        
        if (!this.isCompound()) return this;

        const spans = (this.inner() as CompoundCurve3DJs).spans();
        if (spans.some(s => s.degree() !== 1)) return this;

        const points: Point[] = [];
        for (let i = 0; i < spans.length; i++)
        {
            const cps = spans[i].controlPoints().map(p => Point.from(p));
            if (i === 0) points.push(cps[0]);
            points.push(cps[cps.length - 1]);
        }

        return this.update(Curve.Polyline(points));
    }

    /** Reorient this Curve from its current plane onto the plane defined by `normal` and `offset`.
     *  1. Translates so the curve's bbox-min lands on `offset`.
     *  2. Rotates via Euler angles (from `srcNormal.angleEuler(targetNormal)`) to align the planes.
     */
    reorient(normal: PointLike, offset: PointLike = [0,0,0], up: PointLike = [0,0,1]): this
    {
        const srcPlane = this.getOnPlane();
        if (!srcPlane){ console.error(`Curve::reorient(): Curve is not planar.`); return this; }

        const tgtNormal = Vector.from(normal);

        // Canonicalize: ensure source normal is in the same half-space as the target,
        // so opposite-winding copies of the same plane get an identical rotation.
        const srcNormal = srcPlane.normal.dot(tgtNormal) < 0
            ? srcPlane.normal.scale(-1)
            : srcPlane.normal;

        // TODO: make offset useful
        this.translate(offset);

        // Rotation: align normals — angleEuler returns radians, inner().rotate takes radians
        const [roll, pitch, yaw] = srcNormal.angleEuler(tgtNormal);
        this.update(this.inner().rotate(roll, pitch, yaw));

        // Propagate to holes
        this._holes = this._holes.map(h => h.reorient(normal, offset, up));

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
        this._curve = this.inner().extend(length, side);
        return this;
    }

    /** Offset a Curve a given amount (+ or -) and optionally provide corner type (default:sharp) */
    offset(distance: number, cornerType:'sharp'|'round'|'smooth'='sharp'): Curve|null
    {
        if(!this.isPlanar()){ throw new Error(`Curve:offset(): Cannot offset a 3D curve!`);}
        // If compound with all-line spans, combine into a single polyline first
        const curve = this.isCompound() ? this.mergeLines() : this;
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

    /** Internal helper: perform a boolean operation against another Curve.
     *  Dispatches to the correct WASM method based on curve types.
     *  Returns BooleanRegionJs results that include both exterior and interior hole curves.
     *  @returns CurveCollection of result Curves (each with holes attached), or null on error.
     */
    private _booleanOp(other: Curve, operation: string): CurveCollection | null
    {
        try
        {
            const regions: BooleanRegionJs[] = this.isCompound()
                ? (!other.isCompound()
                    ? (this.inner() as CompoundCurve3DJs).booleanCurve(other.inner() as NurbsCurve3DJs, operation)
                    : (this.inner() as CompoundCurve3DJs).booleanCompoundCurve(other.inner() as CompoundCurve3DJs, operation))
                : (!other.isCompound()
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
            return null;
        }
    }

    /** Boolean union of this (closed) Curve with another (closed) Curve.
     *  Both curves must be closed and coplanar.
     *  Returns the exterior outlines of the resulting regions,
     *  or null on error.
     */
    union(other: Curve): CurveCollection|null
    {
        return this._booleanOp(other, 'union');
    }

    /** Boolean subtraction: this Curve minus the other Curve.
     *  Both curves must be closed and coplanar.
     *  Returns the exterior outlines of the resulting regions,
     *  or null on error.
     */
    difference(other: Curve): CurveCollection | null
    {
        return this._booleanOp(other, 'difference');
    }

    // Alias for difference
    subtract(other: Curve): CurveCollection | null
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

  

    //// TRANSFORMATION TO OTHER TYPES ////

    toMesh(tolerance: number = TESSELATION_TOLERANCE): Mesh | undefined
    {
        const points = this.tessellate(tolerance);
        if (points.length < 3)
        {
            console.warn(`Curve::toMesh(): Not enough points (${points.length}) to create a mesh. A minimum of 3 non-collinear points is required.`);
            return undefined;
        }

        // If this curve has holes, tessellate each hole and use fromPointsWithHoles
        if (this.hasHoles())
        {
            const holePointArrays = this._holes.map(hole => hole.tessellate(tolerance));
            return Mesh.fromPointsWithHoles(points, holePointArrays);
        }

        return Mesh.fromPoints(points);
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

}