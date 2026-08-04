
/**
 * Oriented Bounding Box (OBB).
 *
 * Two ways to orient the box, both ending in the same projection maths
 * ({@link OBbox._onFrame}) — only the choice of axes differs:
 *
 *   - {@link OBbox.fromPlanarPoints} — exact minimum-area frame for a *flat* cloud, via
 *     rotating calipers on the convex hull. This is what curves measure with.
 *   - {@link OBbox.fromPoints} — PCA: the directions of greatest variance (Jacobi
 *     eigendecomposition of the covariance matrix). Used for meshes, and as the fallback
 *     for genuinely 3D clouds, where no cheap exact answer exists.
 *
 * PCA only *approximates* the tightest box: it orients by variance, not by extent, so it
 * is exact only when the cloud is symmetric about its own principal axes. An asymmetric
 * outline — a rectangle with one slanted end — comes out tilted and several percent too
 * big, sticking out past the shape it measures.
 *
 * The half-extents are the projected point-cloud extents along each axis.
 *
 * API mirrors {@link Bbox} as closely as possible so both classes are
 * interchangeable where orientation does not matter.
 *
 * Extra OBB-specific methods:
 *   - `axes()` – the three orthonormal principal axes as Vectors
 *   - `halfExtents()` – half-size along each axis
 *   - `corners()` – all 8 world-space corners of the box
 * 
 *  NOTE: resulting axis are ordered
 *      axes()[0] = direction of greatest variance (maps to width)
 *      axes()[1] = direction of second variance (maps to depth)
 *      axes()[2] = direction of least variance (maps to height)
 * 
 *      Based on common language: 
 *      - length() as alias for axes()[0] since it's the most commonly used as the longest dimension
 *      - thickness as alias 
 * 
 *      
 * 
 */

import { Point3Js } from './wasm/meshup.js';

import { Point } from './Point';
import { Vector } from './Vector';
import { Mesh } from './Mesh';
import { Curve } from './Curve';
import type { PointLike } from './types';
import { addResultToScene } from './sceneDecorators';
import { POINT_TOLERANCE, TESSELATION_TOLERANCE, BBOX_FLAT_EPS, BBOX_FLAT_REL_EPS,
         OBBOX_PLANAR_EPS, OBBOX_PLANAR_REL_EPS } from './constants';

/** An axis as a plain triple — the internal currency of the frame maths, to keep the
 *  per-point projection loops free of Vector allocation. */
type Axis3 = [number, number, number];

export class OBbox
{
    private _center: Point;
    private _axes: [Vector, Vector, Vector];
    private _halfExtents: [number, number, number];
    /** The Shape this box was measured from — lets shape()/box()/rect()/line() land in its scene.
     *  Non-enumerable: an OBbox is compared and serialised by its frame alone. */
    declare _source: any;

    /**
     * @param center       World-space centre of the OBB.
     * @param axes         Three orthonormal principal axes (normalised automatically).
     * @param halfExtents  Half-size along each axis (same ordering as axes).
     */
    constructor(
        center: PointLike,
        axes: [PointLike, PointLike, PointLike],
        halfExtents: [number, number, number],
    )
    {
        this._center = new Point(center);
        this._axes = [
            Vector.from(axes[0]).normalize(),
            Vector.from(axes[1]).normalize(),
            Vector.from(axes[2]).normalize(),
        ];
        this._halfExtents = halfExtents;
        Object.defineProperty(this, '_source', { value: null, writable: true, enumerable: false });
    }

    //// SCENE ////

    /** Tie this box to the Shape it was measured from, so the shapes it makes can join that
     *  shape's scene. Fluent and internal — set by the bbox()/obbox() accessors. */
    _fromShape(shape: any): this
    {
        this._source = shape;
        return this;
    }

    /** Put a shape this box just built into the measured shape's scene (no-op when there is
     *  no source, or the source is standalone / tmp()). */
    _attach<T>(shape: T): T
    {
        addResultToScene(this._source, shape);
        return shape;
    }

    //// FACTORY METHODS ////

    /** A zero-size OBbox at the origin — what an empty shape measures. */
    static empty(): OBbox
    {
        return new OBbox([0, 0, 0], [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [0, 0, 0]);
    }

    /**
     * Build an OBbox from a cloud of points using PCA.
     * The returned box is aligned to the principal axes of the point distribution — the
     * tightest box *on that frame*, but not necessarily the tightest box there is. For a
     * flat cloud prefer {@link fromPlanarPoints}, which computes the exact minimum-area frame.
     */
    static fromPoints(points: Array<PointLike>): OBbox
    {
        if (points.length < 1)
        {
            // An empty shape is a legitimate boolean result (two solids that turn out not to
            // overlap). Hand back a zero-size box at the origin rather than throwing, so
            // measuring one reads 0 instead of taking the whole script down.
            return OBbox.empty();
        }

        const pts = points.map(p => new Point(p));

        return OBbox._onFrame(pts, OBbox._pcaAxes(pts));
    }

    /**
     * Build the tightest OBbox around a *planar* point cloud.
     *
     * For a flat cloud the exact answer is cheap: by the rotating-calipers theorem the
     * minimum-area enclosing rectangle always has one side flush with an edge of the convex
     * hull, so trying every hull-edge direction and keeping the smallest is optimal. That is
     * what a user means by "the oriented bounding box" — a box that hugs the shape — where
     * PCA merely approximates it (see the class doc).
     *
     * A cloud that is not flat has no such closed form; those fall back to {@link fromPoints}'
     * PCA frame. So does a degenerate cloud (all points equal), where there is no direction
     * to find.
     *
     * The frame is right-handed and ordered like the PCA one: axes[0] is the longest side,
     * axes[2] the plane normal (the flat axis).
     */
    static fromPlanarPoints(points: Array<PointLike>): OBbox
    {
        if (points.length < 1) { return OBbox.empty(); }

        const pts = points.map(p => new Point(p));
        const pca = OBbox._onFrame(pts, OBbox._pcaAxes(pts));

        // The least-variance axis is the best-fit plane normal — and the extent along it is
        // how far the cloud strays from that plane. Only a flat one gets the exact treatment.
        if (pca.height() > Math.max(OBBOX_PLANAR_EPS, pca.maxSize() * OBBOX_PLANAR_REL_EPS))
        {
            return pca;
        }

        // In-plane basis: PCA's first axis (already perpendicular to the normal) and its
        // in-plane perpendicular. Any pair spanning the plane does — the calipers pick the
        // orientation from here, so the starting twist has no say in the result.
        const [u, , n] = pca._axes;
        const v = n.copy().cross(u).normalize();
        const c = pca.center();

        const flat = pts.map(p =>
        {
            const dx = p.x - c.x, dy = p.y - c.y, dz = p.z - c.z;
            return [dx * u.x + dy * u.y + dz * u.z, dx * v.x + dy * v.y + dz * v.z] as [number, number];
        });

        const dir = OBbox._minAreaRectDir(OBbox._convexHull2(flat));
        if (!dir) { return pca; } // all points coincide: nothing to orient

        const [dx, dy] = dir;
        const a0: Axis3 = [u.x * dx + v.x * dy, u.y * dx + v.y * dy, u.z * dx + v.z * dy];
        const a1: Axis3 = [v.x * dx - u.x * dy, v.y * dx - u.y * dy, v.z * dx - u.z * dy];

        return OBbox._onFrame(pts, [a0, a1, OBbox._cross(a0, a1)]);
    }

    /** Build an OBbox from all vertices of a Mesh. */
    static fromMesh(m: Mesh): OBbox
    {
        const unique = new Map<string, Point>();

        m.vertices().forEach(vertex =>
        {
            const rounded = new Point(vertex).round(POINT_TOLERANCE);
            unique.set(`${rounded.x},${rounded.y},${rounded.z}`, rounded);
        });

        return OBbox.fromPoints(Array.from(unique.values()))._fromShape(m);
    }

    /** Build an OBbox from a tessellated Curve.
     *
     *  A curve is planar far more often than not, so this takes the exact minimum-area route
     *  ({@link fromPlanarPoints}) and only falls back to PCA for a genuinely 3D curve.
     *
     *  Coincident points are dropped first: a closed curve tessellates with its start point
     *  repeated at the end, and a compound curve repeats every shared segment endpoint.
     *  Duplicates no longer sway the orientation on the planar path (the hull ignores them),
     *  but they still skew the covariance of the PCA fallback — a plain 200x100 rect came out
     *  as a 210x121 box rotated by 6 degrees.
     */
    static fromCurve(c: Curve, tessellationTol: number = TESSELATION_TOLERANCE): OBbox
    {
        const unique = new Map<string, Point>();

        c.tessellate(tessellationTol).forEach(p =>
        {
            const rounded = new Point(p).round(POINT_TOLERANCE);
            const key = `${rounded.x},${rounded.y},${rounded.z}`;
            if (!unique.has(key)) { unique.set(key, new Point(p)); }
        });

        return OBbox.fromPlanarPoints(Array.from(unique.values()))._fromShape(c);
    }

    //// CALCULATED PROPERTIES ////

    /**
     * The three orthonormal principal axes.
     * axes()[0] = direction of greatest variance (maps to width)
     * axes()[1] = direction of second variance (maps to depth)
     * axes()[2] = direction of least variance (maps to height)
     */
    axes(): [Vector, Vector, Vector]
    {
        return this._axes;
    }

    /** Half-sizes along each principal axis (same order as axes()). */
    halfExtents(): [number, number, number]
    {
        return this._halfExtents;
    }

    /** World-space centre of the OBB. */
    center(): Point
    {
        return this._center;
    }

    /**
     * One "min" corner of the OBB in world space.
     * Specifically: center − axes[0]·he[0] − axes[1]·he[1] − axes[2]·he[2].
     */
    min(): Point
    {
        const c = this._center;
        const [a0, a1, a2] = this._axes;
        const [h0, h1, h2] = this._halfExtents;
        return new Point(
            c.x - a0.x * h0 - a1.x * h1 - a2.x * h2,
            c.y - a0.y * h0 - a1.y * h1 - a2.y * h2,
            c.z - a0.z * h0 - a1.z * h1 - a2.z * h2,
        );
    }

    /**
     * The "max" corner diagonally opposite to min().
     * center + axes[0]·he[0] + axes[1]·he[1] + axes[2]·he[2].
     */
    max(): Point
    {
        const c = this._center;
        const [a0, a1, a2] = this._axes;
        const [h0, h1, h2] = this._halfExtents;
        return new Point(
            c.x + a0.x * h0 + a1.x * h1 + a2.x * h2,
            c.y + a0.y * h0 + a1.y * h1 + a2.y * h2,
            c.z + a0.z * h0 + a1.z * h1 + a2.z * h2,
        );
    }

    /**
     * Full dimensions of the OBB as a Point3Js
     * (x = width along axis[0], y = depth along axis[1], z = height along axis[2]).
     */
    size(): Point3Js
    {
        return new Point3Js(
            this._halfExtents[0] * 2,
            this._halfExtents[1] * 2,
            this._halfExtents[2] * 2,
        );
    }

    /** Full size along principal axis[0] (greatest-variance direction). */
    width(): number
    {
        return this._halfExtents[0] * 2;
    }

    /** Length is commonly used as longest side  */
    length(): number
    {
        return this.width();
    }

    /** Full size along principal axis[1] (second-variance direction). */
    depth(): number
    {
        return this._halfExtents[1] * 2;
    }

    /** Full size along principal axis[2] (least-variance direction). */
    height(): number
    {
        return this._halfExtents[2] * 2;
    }

    /** Biggest of the three principal sizes. Axes are sorted by variance, so this is width().
     *  Named to match Bbox.maxSize(). */
    maxSize(): number
    {
        return this.width();
    }

    /** Smallest of the three principal sizes — the thickness. Named to match Bbox.minSize(). */
    minSize(): number
    {
        return this.height();
    }

    /** Thickness is commonly used for the smallest side */
    thickness(): number
    {
        return this.height();
    }

    /** Is the box flat (zero-size within tolerance) along a given full extent?
     *  Same absolute + relative convention as Bbox, so a box measured from a rotated
     *  shape — where the flat axis comes out at ~1e-15 instead of exactly 0 — still
     *  counts as flat. */
    private _isFlatAlong(extent: number): boolean
    {
        return extent <= Math.max(BBOX_FLAT_EPS, this.maxSize() * BBOX_FLAT_REL_EPS);
    }

    /** A zero-size box: every extent collapsed (what an empty or single-point shape measures) */
    isPoint(): boolean
    {
        return [this.width(), this.depth(), this.height()].every(d => this._isFlatAlong(d));
    }

    is1D(): boolean
    {
        const dims = [this.width(), this.depth(), this.height()].filter(d => !this._isFlatAlong(d));
        return dims.length === 1;
    }

    is2D(): boolean
    {
        return !this.isPoint()
            && [this.width(), this.depth(), this.height()].filter(d => !this._isFlatAlong(d)).length === 2;
    }

    is3D(): boolean
    {
        return [this.width(), this.depth(), this.height()].every(d => !this._isFlatAlong(d));
    }

    /**
     * All 8 corners of the OBB in world space.
     * The order iterates over (±1) combinations along axes[0], axes[1], axes[2].
     */
    corners(): Array<Point>
    {
        const c = this._center;
        const [a0, a1, a2] = this._axes;
        const [h0, h1, h2] = this._halfExtents;
        return [-1, 1].flatMap(s0 =>
            [-1, 1].flatMap(s1 =>
                [-1, 1].map(s2 =>
                    new Point(
                        c.x + s0 * a0.x * h0 + s1 * a1.x * h1 + s2 * a2.x * h2,
                        c.y + s0 * a0.y * h0 + s1 * a1.y * h1 + s2 * a2.y * h2,
                        c.z + s0 * a0.z * h0 + s1 * a1.z * h1 + s2 * a2.z * h2,
                    )
                )
            )
        );
    }

    //// SHAPE REPRESENTATIONS ////

    /** The principal frame made right-handed (a0 × a1 = a2).
     *  PCA eigenvectors carry no handedness guarantee — the Jacobi solver can hand back a
     *  mirrored frame. Geometry built on a mirrored frame comes out inside-out (inverted
     *  face normals, negative volume), so flip the last axis when needed. The box itself is
     *  unaffected: flipping an axis only relabels which corner is which. */
    private _rightHandedAxes(): [Vector, Vector, Vector]
    {
        const [a0, a1, a2] = this._axes;
        return (a0.copy().cross(a1).dot(a2) < 0) ? [a0, a1, a2.copy().reverse()] : [a0, a1, a2];
    }

    /** The 8 corners on the right-handed frame, indexed by sign bits (s0 s1 s2),
     *  s = -1 → bit 0, s = +1 → bit 1: index = 4·b0 + 2·b1 + b2. */
    private _framedCorners(): Array<Point>
    {
        const c = this._center;
        const [a0, a1, a2] = this._rightHandedAxes();
        const [h0, h1, h2] = this._halfExtents;
        return [-1, 1].flatMap(s0 =>
            [-1, 1].flatMap(s1 =>
                [-1, 1].map(s2 =>
                    new Point(
                        c.x + s0 * a0.x * h0 + s1 * a1.x * h1 + s2 * a2.x * h2,
                        c.y + s0 * a0.y * h0 + s1 * a1.y * h1 + s2 * a2.y * h2,
                        c.z + s0 * a0.z * h0 + s1 * a1.z * h1 + s2 * a2.z * h2,
                    )
                )
            )
        );
    }

    /** Index of the single axis this box is flat along, or -1 when it is not flat */
    private _flatAxisIndex(): number
    {
        return [this.width(), this.depth(), this.height()].findIndex(d => this._isFlatAlong(d));
    }

    /**
     * The real geometry of this oriented bounding box, matching its dimensionality:
     *   - 3D → a box `Mesh`
     *   - 2D → a closed rectangle `Curve` in the box's own plane
     *   - 1D → a straight line `Curve` along the box's one axis
     *   - a zero-size (point) box has no geometry → `null`
     *
     * Unlike `Bbox`'s equivalents the result follows the box's own principal axes, so it
     * is a real oriented box rather than an axis-aligned one.
     *
     * The result is added to the scene the measured shape lives in (same layer an
     * `@sceneAdd` result would land on). Measured off a standalone or `tmp()` shape it stays
     * out of the scene, as does a box built straight from points.
     */
    shape(): Mesh | Curve | null
    {
        if (this.isPoint())
        {
            console.warn('OBbox::shape(): OBbox has no size, so there is no shape to make. Returned null');
            return null;
        }
        // line()/rect()/box() attach the result themselves
        return this.is1D() ? this.line() : this.is2D() ? this.rect() : this.box();
    }

    /** Alias for shape() */
    toShape(): Mesh | Curve | null
    {
        return this.shape();
    }

    /** A straight line Curve along this box's one non-flat axis. Null when not 1D. */
    line(): Curve | null
    {
        if (!this.is1D())
        {
            console.warn(`OBbox::line(): OBbox is not 1D, so can't turn it into a single line. Returned null`);
            return null;
        }

        const axes  = this._rightHandedAxes();
        const sizes = [this.width(), this.depth(), this.height()];
        const i     = sizes.findIndex(d => !this._isFlatAlong(d));
        const half  = axes[i].copy().scale(this._halfExtents[i]);
        const c     = this._center;

        return this._attach(Curve.Line(
            [c.x - half.x, c.y - half.y, c.z - half.z],
            [c.x + half.x, c.y + half.y, c.z + half.z],
        ));
    }

    /** A closed rectangle Curve in this box's own plane. Null when not 2D. */
    rect(): Curve | null
    {
        if (!this.is2D())
        {
            console.warn(`OBbox::rect(): OBbox is not 2D, so can't turn it into a rectangle. Returned null`);
            return null;
        }

        const axes = this._rightHandedAxes();
        const flat = this._flatAxisIndex();
        const [i, j] = [0, 1, 2].filter(k => k !== flat);
        const u = axes[i].copy().scale(this._halfExtents[i]);
        const v = axes[j].copy().scale(this._halfExtents[j]);
        const c = this._center;

        const corner = (su: number, sv: number): [number, number, number] =>
            [c.x + su * u.x + sv * v.x, c.y + su * u.y + sv * v.y, c.z + su * u.z + sv * v.z];

        const ring = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
        return this._attach(Curve.Polyline([...ring, ring[0]])); // repeating the first point closes it
    }

    /** A box Mesh following this box's own axes. Null when not 3D.
     *  Built straight from the 8 corners as 6 outward-facing quads. */
    box(): Mesh | null
    {
        if (!this.is3D())
        {
            console.warn(`OBbox::box(): OBbox is not 3D, so can't turn it into a box Mesh. Returned null`);
            return null;
        }

        const c = this._framedCorners();
        // Rings wound counter-clockwise seen from outside (frame is right-handed)
        const FACES = [
            [0, 1, 3, 2], [4, 6, 7, 5],   // -axis0, +axis0
            [0, 4, 5, 1], [2, 3, 7, 6],   // -axis1, +axis1
            [0, 2, 6, 4], [1, 5, 7, 3],   // -axis2, +axis2
        ];

        return this._attach(Mesh.fromPolygons(FACES.map(ring => ring.map(i => c[i]))));
    }

    /**
     * Quaternion that aligns this OBB's full principal frame to world XYZ.
     *
     * Unlike a shortest-arc "lay flat" rotation, this also resolves the in-plane
     * twist so axis[0] aligns to +X, axis[1] to +Y, and axis[2] to +Z.
     *
     * Note: if two extents are equal (for example a square plate or a cube), the
     * PCA frame inside that degenerate subspace is not unique, so the twist angle
     * is inherently underdetermined.
     */
    toOrthoQuaternion(): { x: number; y: number; z: number; w: number }
    {
        let xAxis = this._axes[0].copy().normalize();
        let yAxis = this._axes[1].copy().normalize();
        let zAxis = this._axes[2].copy().normalize();

        if (xAxis.copy().cross(yAxis).dot(zAxis) < 0)
        {
            yAxis.reverse();
        }

        if (zAxis.dot(Vector.from(0, 0, 1)) < 0)
        {
            xAxis.reverse();
            zAxis.reverse();
        }

        if (xAxis.dot(Vector.from(1, 0, 0)) < 0)
        {
            xAxis.reverse();
            yAxis.reverse();
        }

        return OBbox.quaternionFromRotationMatrix(
            xAxis.x, xAxis.y, xAxis.z,
            yAxis.x, yAxis.y, yAxis.z,
            zAxis.x, zAxis.y, zAxis.z,
        );
    }

    //// FRAME MATHS ////

    /** The principal axes of a point cloud: eigenvectors of its covariance matrix, ordered
     *  by decreasing variance. */
    private static _pcaAxes(pts: Array<Point>): [Axis3, Axis3, Axis3]
    {
        const n = pts.length;
        const cx = pts.reduce((s, p) => s + p.x, 0) / n;
        const cy = pts.reduce((s, p) => s + p.y, 0) / n;
        const cz = pts.reduce((s, p) => s + p.z, 0) / n;

        // Covariance matrix (symmetric, upper-triangle)
        let c00 = 0, c01 = 0, c02 = 0, c11 = 0, c12 = 0, c22 = 0;
        pts.forEach(p =>
        {
            const dx = p.x - cx, dy = p.y - cy, dz = p.z - cz;
            c00 += dx * dx; c01 += dx * dy; c02 += dx * dz;
            c11 += dy * dy; c12 += dy * dz;
            c22 += dz * dz;
        });
        c00 /= n; c01 /= n; c02 /= n; c11 /= n; c12 /= n; c22 /= n;

        return OBbox.jacobi3(c00, c01, c02, c11, c12, c22).axes;
    }

    /** The tightest box around a cloud *on a given orthonormal frame*: project every point
     *  onto each axis and take the extents. Both construction paths end here — choosing the
     *  axes is the only thing they do differently. */
    private static _onFrame(pts: Array<Point>, axes: [Axis3, Axis3, Axis3]): OBbox
    {
        const n = pts.length;
        const cx = pts.reduce((s, p) => s + p.x, 0) / n;
        const cy = pts.reduce((s, p) => s + p.y, 0) / n;
        const cz = pts.reduce((s, p) => s + p.z, 0) / n;

        const [a0, a1, a2] = axes;

        // Projections are taken relative to the centroid: for a cloud sitting far from the
        // origin that keeps the subtraction out of the accumulated dot products.
        let min0 = Infinity, max0 = -Infinity;
        let min1 = Infinity, max1 = -Infinity;
        let min2 = Infinity, max2 = -Infinity;

        pts.forEach(p =>
        {
            const dx = p.x - cx, dy = p.y - cy, dz = p.z - cz;
            const proj0 = dx * a0[0] + dy * a0[1] + dz * a0[2];
            const proj1 = dx * a1[0] + dy * a1[1] + dz * a1[2];
            const proj2 = dx * a2[0] + dy * a2[1] + dz * a2[2];
            if (proj0 < min0) min0 = proj0;
            if (proj0 > max0) max0 = proj0;
            if (proj1 < min1) min1 = proj1;
            if (proj1 > max1) max1 = proj1;
            if (proj2 < min2) min2 = proj2;
            if (proj2 > max2) max2 = proj2;
        });

        // OBB centre shifted from point-cloud centroid by the mid-projections
        const mid0 = (min0 + max0) / 2;
        const mid1 = (min1 + max1) / 2;
        const mid2 = (min2 + max2) / 2;

        const obbCenter = new Point(
            cx + mid0 * a0[0] + mid1 * a1[0] + mid2 * a2[0],
            cy + mid0 * a0[1] + mid1 * a1[1] + mid2 * a2[1],
            cz + mid0 * a0[2] + mid1 * a1[2] + mid2 * a2[2],
        );

        const halfExtents: [number, number, number] = [
            (max0 - min0) / 2,
            (max1 - min1) / 2,
            (max2 - min2) / 2,
        ];

        return new OBbox(obbCenter, [a0, a1, a2], halfExtents);
    }

    private static _cross(a: Axis3, b: Axis3): Axis3
    {
        return [
            a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0],
        ];
    }

    /** Convex hull of a 2D cloud (Andrew's monotone chain), counter-clockwise, with
     *  collinear points dropped. Returns 1 point for a coincident cloud and 2 for a
     *  collinear one — both are legitimate degenerate hulls, not failures. */
    private static _convexHull2(points: Array<[number, number]>): Array<[number, number]>
    {
        const pts = [...points].sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
        // Drop exact duplicates: repeated points make the turn test degenerate
        const uniq = pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]);
        if (uniq.length < 3) { return uniq; }

        // Right turn or straight → the middle point is not a hull corner
        const turn = (o: [number, number], a: [number, number], b: [number, number]) =>
            (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

        const half = (ordered: Array<[number, number]>): Array<[number, number]> =>
        {
            const chain: Array<[number, number]> = [];
            ordered.forEach(p =>
            {
                while (chain.length >= 2 && turn(chain[chain.length - 2], chain[chain.length - 1], p) <= 0)
                {
                    chain.pop();
                }
                chain.push(p);
            });
            chain.pop(); // last point is the first of the other half
            return chain;
        };

        // A collinear cloud collapses both halves to their end point, leaving the 2-point
        // hull of the extremes — degenerate but still the right direction to measure along.
        return [...half(uniq), ...half([...uniq].reverse())];
    }

    /**
     * Direction of the minimum-area rectangle enclosing a convex hull, as a unit vector in
     * the hull's own 2D coordinates, pointing along the rectangle's *longest* side (so the
     * caller can order the axes by extent, matching the PCA convention).
     *
     * Rotating calipers: the optimal rectangle always has a side flush with a hull edge, so
     * every hull-edge direction is tried and the smallest-area one wins. The three supporting
     * points (farthest from the edge, and the two extremes along it) only ever move *forward*
     * around the hull as the edge rotates, so they are carried between edges instead of being
     * re-found — O(h) in total rather than O(h²), which matters: a finely tessellated circle
     * hits thousands of hull points, where rescanning cost ~100ms per obbox().
     *
     * Null when the hull has no direction at all (a single point).
     */
    private static _minAreaRectDir(hull: Array<[number, number]>): [number, number] | null
    {
        const n = hull.length;
        if (n < 2) { return null; }

        const px = hull.map(p => p[0]);
        const py = hull.map(p => p[1]);

        if (n === 2)
        {
            // Collinear cloud: one direction, zero area, nothing to choose
            const dx = px[1] - px[0], dy = py[1] - py[0];
            const len = Math.hypot(dx, dy);
            return (len === 0) ? null : [dx / len, dy / len];
        }

        /** Distance from hull point `p` to the line through `o` along (ux, uy). The hull runs
         *  counter-clockwise, so for a hull edge starting at `o` this is never negative. */
        const height = (ux: number, uy: number, o: number, p: number) =>
            ux * (py[p] - py[o]) - uy * (px[p] - px[o]);
        const along = (ux: number, uy: number, p: number) => px[p] * ux + py[p] * uy;

        // Supports for the first edge, found by a full scan; every later edge advances them
        let ux = px[1] - px[0], uy = py[1] - py[0];
        const len0 = Math.hypot(ux, uy);
        ux /= len0; uy /= len0;
        let far = 0, ahead = 0, behind = 0;
        for (let p = 1; p < n; p++) // perf: keep as loop
        {
            if (height(ux, uy, 0, p) > height(ux, uy, 0, far)) { far = p; }
            if (along(ux, uy, p) > along(ux, uy, ahead)) { ahead = p; }
            if (along(ux, uy, p) < along(ux, uy, behind)) { behind = p; }
        }

        let best: { area: number, dir: [number, number], w: number, h: number } | null = null;

        for (let i = 0; i < n; i++) // perf: keep as loop
        {
            const next = (i + 1) % n;
            const ex = px[next] - px[i], ey = py[next] - py[i];
            const len = Math.hypot(ex, ey);
            if (len === 0) { continue; } // duplicate hull point: no direction to test
            ux = ex / len; uy = ey / len;

            // Each caliper walks forward while the next point is more extreme. The step cap is
            // a float-noise backstop only — the walks are monotone, so they cannot lap the hull.
            for (let s = 0; s < n && height(ux, uy, i, (far + 1) % n)    > height(ux, uy, i, far);    s++) { far    = (far + 1) % n; }
            for (let s = 0; s < n && along(ux, uy, (ahead + 1) % n)      > along(ux, uy, ahead);      s++) { ahead  = (ahead + 1) % n; }
            for (let s = 0; s < n && along(ux, uy, (behind + 1) % n)     < along(ux, uy, behind);     s++) { behind = (behind + 1) % n; }

            const w = along(ux, uy, ahead) - along(ux, uy, behind);
            const h = height(ux, uy, i, far);
            const area = w * h;
            if (!best || area < best.area) { best = { area, dir: [ux, uy], w, h }; }
        }

        if (!best) { return null; }
        // Longest side first
        return (best.h > best.w) ? [-best.dir[1], best.dir[0]] : best.dir;
    }

    /**
     * Jacobi eigendecomposition for a symmetric 3×3 covariance matrix.
     * Returns eigenvalues and eigenvectors sorted by *decreasing* eigenvalue
     * (i.e. the axis of greatest variance comes first).
     *
     * Matrix entries (upper-triangle only, rest is mirrored):
     *   | a00  a01  a02 |
     *   | a01  a11  a12 |
     *   | a02  a12  a22 |
     */
    private static jacobi3(
        a00: number, a01: number, a02: number,
        a11: number, a12: number, a22: number,
    ): { eigenvalues: [number, number, number]; axes: [[number, number, number], [number, number, number], [number, number, number]] }
    {
        // Working copy of the full symmetric matrix
        const A: number[][] = [
            [a00, a01, a02],
            [a01, a11, a12],
            [a02, a12, a22],
        ];

        // Eigenvector accumulator – columns of V are unit eigenvectors
        const V: number[][] = [
            [1, 0, 0],
            [0, 1, 0],
            [0, 0, 1],
        ];

        for (let iter = 0; iter < 50; iter++) // perf: keep as loop
        {
            // Find the off-diagonal element with largest absolute value
            let p = 0, q = 1;
            let maxVal = Math.abs(A[0][1]);
            if (Math.abs(A[0][2]) > maxVal) { maxVal = Math.abs(A[0][2]); p = 0; q = 2; }
            if (Math.abs(A[1][2]) > maxVal) { maxVal = Math.abs(A[1][2]); p = 1; q = 2; }

            if (maxVal < 1e-12) break; // Converged

            // Rotation angle that zeros out A[p][q]
            const theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
            const t = theta >= 0
                ? 1 / (theta + Math.sqrt(1 + theta * theta))
                : 1 / (theta - Math.sqrt(1 + theta * theta));
            const c = 1 / Math.sqrt(1 + t * t);
            const s = t * c;

            // Update diagonal elements
            const newApp = A[p][p] - t * A[p][q];
            const newAqq = A[q][q] + t * A[p][q];
            A[p][p] = newApp;
            A[q][q] = newAqq;
            A[p][q] = 0;
            A[q][p] = 0;

            // Update the remaining rows/columns (r ≠ p, r ≠ q)
            for (let r = 0; r < 3; r++) // perf: keep as loop
            {
                if (r !== p && r !== q)
                {
                    const Apr = A[p][r];
                    const Aqr = A[q][r];
                    A[p][r] = c * Apr - s * Aqr;
                    A[r][p] = A[p][r];
                    A[q][r] = s * Apr + c * Aqr;
                    A[r][q] = A[q][r];
                }
            }

            // Accumulate eigenvectors (update columns p and q of V)
            for (let r = 0; r < 3; r++) // perf: keep as loop
            {
                const Vrp = V[r][p];
                const Vrq = V[r][q];
                V[r][p] = c * Vrp - s * Vrq;
                V[r][q] = s * Vrp + c * Vrq;
            }
        }

        // Pack results and sort by decreasing eigenvalue
        const eigs = [
            { val: A[0][0], vec: [V[0][0], V[1][0], V[2][0]] as [number, number, number] },
            { val: A[1][1], vec: [V[0][1], V[1][1], V[2][1]] as [number, number, number] },
            { val: A[2][2], vec: [V[0][2], V[1][2], V[2][2]] as [number, number, number] },
        ];
        eigs.sort((a, b) => b.val - a.val);

        return {
            eigenvalues: [eigs[0].val, eigs[1].val, eigs[2].val],
            axes: [eigs[0].vec, eigs[1].vec, eigs[2].vec],
        };
    }

    private static quaternionFromRotationMatrix(
        m00: number, m01: number, m02: number,
        m10: number, m11: number, m12: number,
        m20: number, m21: number, m22: number,
    ): { x: number; y: number; z: number; w: number }
    {
        const trace = m00 + m11 + m22;
        let x: number;
        let y: number;
        let z: number;
        let w: number;

        if (trace > 0)
        {
            const s = Math.sqrt(trace + 1) * 2;
            w = 0.25 * s;
            x = (m21 - m12) / s;
            y = (m02 - m20) / s;
            z = (m10 - m01) / s;
        }
        else if (m00 > m11 && m00 > m22)
        {
            const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
            w = (m21 - m12) / s;
            x = 0.25 * s;
            y = (m01 + m10) / s;
            z = (m02 + m20) / s;
        }
        else if (m11 > m22)
        {
            const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
            w = (m02 - m20) / s;
            x = (m01 + m10) / s;
            y = 0.25 * s;
            z = (m12 + m21) / s;
        }
        else
        {
            const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
            w = (m10 - m01) / s;
            x = (m02 + m20) / s;
            y = (m12 + m21) / s;
            z = 0.25 * s;
        }

        const length = Math.hypot(w, x, y, z) || 1;
        return { x: x / length, y: y / length, z: z / length, w: w / length };
    }
}
