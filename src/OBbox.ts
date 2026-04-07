import { Point3Js } from './wasm/csgrs.js';

import { Point } from './Point';
import { Vector } from './Vector';
import { Mesh } from './Mesh';
import { Curve } from './Curve';
import type { PointLike } from './types';
import { TESSELATION_TOLERANCE } from './constants';

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
function jacobi3(
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

/**
 * PCA-based Oriented Bounding Box (OBB).
 *
 * The three principal axes are the directions of greatest variance in the
 * supplied point cloud (via PCA / Jacobi eigendecomposition of the covariance
 * matrix).  The half-extents are the projected point-cloud extents along each
 * axis.
 *
 * API mirrors {@link Bbox} as closely as possible so both classes are
 * interchangeable where orientation does not matter.
 *
 * Extra OBB-specific methods:
 *   - `axes()` – the three orthonormal principal axes as Vectors
 *   - `halfExtents()` – half-size along each axis
 *   - `corners()` – all 8 world-space corners of the box
 */
export class OBbox
{
    private _center: Point;
    private _axes: [Vector, Vector, Vector];
    private _halfExtents: [number, number, number];

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
    }

    //// FACTORY METHODS ////

    /**
     * Build an OBbox from a cloud of points using PCA.
     * The returned box is the tightest oriented box aligned to the
     * principal axes of the point distribution.
     */
    static fromPoints(points: Array<PointLike>): OBbox
    {
        if (points.length < 1)
        {
            throw new Error('OBbox::fromPoints(): Need at least one point.');
        }

        const pts = points.map(p => new Point(p));
        const n = pts.length;

        // Centroid
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

        // PCA via Jacobi
        const { axes } = jacobi3(c00, c01, c02, c11, c12, c22);
        const [a0, a1, a2] = axes;

        // Project all points onto each principal axis to determine extents
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

    /** Build an OBbox from all vertices of a Mesh. */
    static fromMesh(m: Mesh): OBbox
    {
        return OBbox.fromPoints(m.vertices());
    }

    /** Build an OBbox from a tessellated Curve. */
    static fromCurve(c: Curve, tessellationTol: number = TESSELATION_TOLERANCE): OBbox
    {
        return OBbox.fromPoints(c.tessellate(tessellationTol));
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

    is1D(): boolean
    {
        const dims = [this.width(), this.depth(), this.height()].filter(d => d > 0);
        return dims.length === 1;
    }

    is2D(): boolean
    {
        return this.height() === 0 || this.depth() === 0 || this.width() === 0;
    }

    is3D(): boolean
    {
        return this.height() > 0 && this.depth() > 0 && this.width() > 0;
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
}
