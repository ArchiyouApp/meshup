/**
 *  OBbox.test.ts
 *
 *  OBbox.shape() — the real geometry of an oriented bounding box:
 *  a box Mesh (3D), a rectangle Curve (2D) or a line Curve (1D),
 *  reachable from Mesh.obbox() and Curve.obbox().
 */

import { beforeAll, describe, it, expect } from 'vitest';
import { initAsync } from '../../src/index';
import { Mesh } from '../../src/Mesh';
import { Curve } from '../../src/Curve';
import { OBbox } from '../../src/OBbox';

beforeAll(async () =>
{
    await initAsync();
});

describe('OBbox.shape() from a Mesh (3D)', () =>
{
    it('returns a box Mesh with the same volume as the OBB', () =>
    {
        const m = Mesh.Box(200, 100, 20);
        const shape = m.obbox().shape();

        expect(shape).toBeInstanceOf(Mesh);
        expect((shape as Mesh).volume()).toBeCloseTo(200 * 100 * 20, 0);
    });

    it('follows the shape when it is rotated (a real oriented box, not axis aligned)', () =>
    {
        const m = Mesh.Box(200, 100, 20).rotateZ(30);
        const shape = m.obbox().shape() as Mesh;

        // Volume stays that of the original box — an axis-aligned box would be much bigger
        expect(shape.volume()).toBeCloseTo(200 * 100 * 20, -1);
        // ...while its axis-aligned bbox is the (larger) rotated footprint
        expect(shape.bbox().width()).toBeCloseTo(m.bbox().width(), 0);
        expect(shape.bbox().depth()).toBeCloseTo(m.bbox().depth(), 0);
        expect(shape.bbox().width()).toBeGreaterThan(200);
    });

    it('wraps a tumbled shape tightly', () =>
    {
        const m = Mesh.Box(200, 100, 20).rotateX(25).rotateY(-15).rotateZ(40);
        const shape = m.obbox().shape() as Mesh;
        expect(shape.volume()).toBeCloseTo(200 * 100 * 20, -2);
    });

    it('has outward facing faces (positive volume, right-handed frame)', () =>
    {
        // A mirrored PCA frame would build the box inside-out
        [Mesh.Box(200, 100, 20), Mesh.Box(200, 100, 20).mirrorX(0), Mesh.Sphere(50)]
            .forEach(m =>
            {
                expect((m.obbox().shape() as Mesh).volume()!).toBeGreaterThan(0);
            });
    });

    it('contains all of the original shape', () =>
    {
        const m = Mesh.Box(200, 100, 20).rotateZ(30).rotateX(20);
        const box = m.obbox().shape() as Mesh;
        // Every vertex of the source sits inside (or on) the oriented box
        const bb = box.bbox();
        m.vertices().forEach(v =>
        {
            expect(bb.containsPoint(v)).toBe(true);
        });
    });

    it('box() is the 3D-only accessor and toShape() is an alias', () =>
    {
        const obb = Mesh.Box(200, 100, 20).obbox();
        expect(obb.box()).toBeInstanceOf(Mesh);
        expect(obb.toShape()).toBeInstanceOf(Mesh);
        expect(obb.rect()).toBeNull();  // not 2D
        expect(obb.line()).toBeNull();  // not 1D
    });
});

describe('OBbox.shape() from a Curve (2D)', () =>
{
    it('returns a closed rectangle Curve for a flat curve', () =>
    {
        const c = Curve.Rect(200, 100);
        const shape = c.obbox().shape();

        expect(shape).toBeInstanceOf(Curve);
        expect((shape as Curve).isClosed()).toBe(true);
        expect((shape as Curve).length()).toBeCloseTo(2 * (200 + 100), 0);
    });

    it('follows a rotated curve instead of going axis-aligned', () =>
    {
        const c = Curve.Rect(200, 100).rotateZ(35);
        const shape = c.obbox().shape() as Curve;
        expect(shape.length()).toBeCloseTo(2 * (200 + 100), 0);
    });

    it('stays in the plane of a tilted curve', () =>
    {
        const c = Curve.Rect(200, 100).rotateX(40);
        const shape = c.obbox().shape() as Curve;
        expect(shape.length()).toBeCloseTo(2 * (200 + 100), 0);
        expect(shape.isPlanar()).toBe(true);
        // tilted out of the XY plane, exactly like the source
        expect(shape.bbox()!.height()).toBeCloseTo(c.bbox()!.height(), 0);
    });

    it('rect() is the 2D-only accessor', () =>
    {
        const obb = Curve.Rect(200, 100).obbox();
        expect(obb.rect()).toBeInstanceOf(Curve);
        expect(obb.box()).toBeNull();
        expect(obb.line()).toBeNull();
    });
});

describe('OBbox.shape() from a straight Curve (1D)', () =>
{
    it('returns a line Curve of the same length', () =>
    {
        const c = Curve.Line([0, 0, 0], [100, 50, 25]);
        const shape = c.obbox().shape();

        expect(shape).toBeInstanceOf(Curve);
        expect((shape as Curve).length()).toBeCloseTo(c.length(), 3);
    });

    it('line() is the 1D-only accessor', () =>
    {
        const obb = Curve.Line([0, 0, 0], [100, 0, 0]).obbox();
        expect(obb.is1D()).toBe(true);
        expect(obb.line()).toBeInstanceOf(Curve);
        expect(obb.rect()).toBeNull();
        expect(obb.box()).toBeNull();
    });
});

describe('OBbox.shape() degenerate cases', () =>
{
    it('returns null for a zero-size box', () =>
    {
        expect(OBbox.empty().isPoint()).toBe(true);
        expect(OBbox.empty().shape()).toBeNull();
    });

    it('treats a near-zero extent as flat (rotated flat shapes stay 2D)', () =>
    {
        // A rotated flat curve has a thickness of ~1e-15, not exactly 0
        const obb = Curve.Rect(200, 100).rotateX(30).rotateZ(20).obbox();
        expect(obb.is2D()).toBe(true);
        expect(obb.is3D()).toBe(false);
        expect(obb.shape()).toBeInstanceOf(Curve);
    });
});

describe('OBbox from a planar Curve is the minimum-area box, not the PCA one', () =>
{
    /** Tightest enclosing rectangle by brute-force rotation, as an independent oracle.
     *  Sampling orientations can only ever *miss* the optimum, so this is an upper bound on
     *  the true minimum — never a lower one. */
    const sweepArea = (pts: Array<[number, number]>, steps = 36000): number =>
    {
        let best = Infinity;
        for (let d = 0; d < steps; d++)
        {
            const a = d * Math.PI / steps;
            const cos = Math.cos(a), sin = Math.sin(a);
            let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
            pts.forEach(([x, y]) =>
            {
                const u = x * cos + y * sin, v = -x * sin + y * cos;
                if (u < minU) minU = u;
                if (u > maxU) maxU = u;
                if (v < minV) minV = v;
                if (v > maxV) maxV = v;
            });
            best = Math.min(best, (maxU - minU) * (maxV - minV));
        }
        return best;
    };

    it('hugs a rectangle with one slanted end (PCA tilted it by ~1 degree)', () =>
    {
        // 50 x 400 upright, with the top edge sloping from y=400 down to y=300. PCA orients
        // by variance, so the slanted end tipped the frame over and gave a 400.9 x 56.0 box.
        const c = Curve.Polyline([[0, 0, 0], [50, 0, 0], [50, 400, 0], [0, 300, 0]]).close().move(100);
        const obb = c.obbox();

        expect(obb.width()).toBeCloseTo(400, 6);
        expect(obb.depth()).toBeCloseTo(50, 6);
        expect(obb.height()).toBeCloseTo(0, 9);
        // ...which for this shape is the axis-aligned box: each axis is a world axis
        obb.axes().forEach(a =>
        {
            expect(Math.max(Math.abs(a.x), Math.abs(a.y), Math.abs(a.z))).toBeCloseTo(1, 9);
        });

        // The rectangle it builds sits exactly on the shape, not around it
        const rect = obb.shape() as Curve;
        expect(rect.bbox()!.width()).toBeCloseTo(c.bbox()!.width(), 6);
        expect(rect.bbox()!.depth()).toBeCloseTo(c.bbox()!.depth(), 6);
    });

    it('matches a brute-force rotation sweep on awkward outlines', () =>
    {
        const OUTLINES: Array<Array<[number, number]>> = [
            [[0, 0], [50, 0], [50, 400], [0, 300]],            // the slanted-end case
            [[0, 0], [120, 20], [90, 130], [-30, 60]],         // a tilted parallelogram
            [[0, 0], [200, 0], [200, 30], [80, 30], [80, 160], [0, 160]], // L-shape (concave)
            [[0, 0], [10, 300], [-10, 300]],                   // a thin triangle
        ];

        OUTLINES.forEach(outline =>
        {
            const obb = Curve.Polyline(outline.map(([x, y]) => [x, y, 0] as [number, number, number])).close().obbox();
            const area = obb.width() * obb.depth();
            const sweep = sweepArea(outline);

            expect(area).toBeLessThanOrEqual(sweep * (1 + 1e-9));  // never worse than the sweep...
            expect(area).toBeGreaterThan(sweep * (1 - 1e-4));      // ...and no more than a sample step better
            expect(obb.width()).toBeGreaterThanOrEqual(obb.depth()); // longest side first, as PCA ordered them
        });
    });

    it('the O(h) calipers agree with a full rescan on every hull edge', () =>
    {
        // The calipers carry their three supporting points from edge to edge instead of
        // re-finding them; this pins that walk against the rescan it replaces, on the shapes
        // that stress it — regular polygons (every point on the hull), slivers, duplicates.
        const rescanArea = (cloud: Array<[number, number]>): number =>
        {
            const hull: Array<[number, number]> = (OBbox as any)._convexHull2(cloud);
            if (hull.length < 3) { return 0; }

            let best = Infinity;
            hull.forEach((a, i) =>
            {
                const b = hull[(i + 1) % hull.length];
                const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
                if (len === 0) { return; }
                const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
                let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
                hull.forEach(p =>
                {
                    const u = p[0] * ux + p[1] * uy, v = -p[0] * uy + p[1] * ux;
                    minU = Math.min(minU, u); maxU = Math.max(maxU, u);
                    minV = Math.min(minV, v); maxV = Math.max(maxV, v);
                });
                best = Math.min(best, (maxU - minU) * (maxV - minV));
            });
            return best;
        };

        const ring = (n: number, a: number, b: number): Array<[number, number]> =>
            Array.from({ length: n }, (_, i) => [Math.cos(i / n * 2 * Math.PI) * a, Math.sin(i / n * 2 * Math.PI) * b]);

        const CLOUDS: Array<Array<[number, number]>> = [
            ...[3, 4, 5, 7, 12, 50, 361, 1000].map(k => ring(k, 100, 100)),   // regular polygons
            ring(200, 100, 1), ring(200, 100, 0.001), ring(200, 3, 500),      // slivers
            [[0, 0], [0, 0], [10, 0], [10, 0], [5, 0], [10, 10], [0, 10], [5, 10]], // duplicates + collinear
            [[0, 0], [50, 0], [50, 400], [0, 300]],
        ];

        CLOUDS.forEach(cloud =>
        {
            const obb = OBbox.fromPlanarPoints(cloud.map(([x, y]) => [x, y, 0] as [number, number, number]));
            expect(obb.width() * obb.depth()).toBeCloseTo(rescanArea(cloud), 6);
        });
    });

    it('encloses every point of the curve it measured', () =>
    {
        const c = Curve.Polyline([[0, 0, 0], [50, 0, 0], [50, 400, 0], [0, 300, 0]]).close().rotateZ(23).rotateX(17);
        const obb = c.obbox();
        const centre = obb.center(), axes = obb.axes(), half = obb.halfExtents();

        c.tessellate().forEach(p =>
        {
            axes.forEach((a, i) =>
            {
                const proj = (p.x - centre.x) * a.x + (p.y - centre.y) * a.y + (p.z - centre.z) * a.z;
                expect(Math.abs(proj)).toBeLessThanOrEqual(half[i] + 1e-6);
            });
        });
    });

    it('works in the curve own plane, not just in XY', () =>
    {
        const flat = Curve.Polyline([[0, 0, 0], [50, 0, 0], [50, 400, 0], [0, 300, 0]]).close();
        const tilted = flat.copy().rotateX(37).rotateZ(-64).move(1000, -500, 250);
        const obb = tilted.obbox();

        expect(obb.width()).toBeCloseTo(400, 4);
        expect(obb.depth()).toBeCloseTo(50, 4);
        expect(obb.is2D()).toBe(true);
    });

    it('returns a right-handed frame', () =>
    {
        [Curve.Rect(200, 100).rotateZ(35), Curve.Circle(50), Curve.Ellipse(80, 30).rotateX(20)]
            .forEach(c =>
            {
                const [a0, a1, a2] = c.obbox().axes();
                expect(a0.copy().cross(a1).dot(a2)).toBeCloseTo(1, 6);
            });
    });

    it('falls back to the PCA frame for a curve that runs through 3D', () =>
    {
        const pts: Array<[number, number, number]> = Array.from({ length: 60 }, (_, i) =>
        {
            const a = i / 60 * Math.PI * 4;
            return [Math.cos(a) * 50, Math.sin(a) * 50, i * 2];
        });
        const planar = OBbox.fromPlanarPoints(pts);
        const pca    = OBbox.fromPoints(pts);

        expect(planar.width()).toBeCloseTo(pca.width(), 9);
        expect(planar.depth()).toBeCloseTo(pca.depth(), 9);
        expect(planar.height()).toBeCloseTo(pca.height(), 9);
    });

    it('survives degenerate clouds', () =>
    {
        // collinear: a 1D box along the line
        const line = OBbox.fromPlanarPoints([[0, 0, 0], [10, 10, 0], [5, 5, 0]]);
        expect(line.is1D()).toBe(true);
        expect(line.width()).toBeCloseTo(Math.hypot(10, 10), 6);

        // coincident / single / empty: a point box, no orientation to find
        expect(OBbox.fromPlanarPoints([[3, 3, 3], [3, 3, 3]]).isPoint()).toBe(true);
        expect(OBbox.fromPlanarPoints([[5, 5, 5]]).isPoint()).toBe(true);
        expect(OBbox.fromPlanarPoints([]).isPoint()).toBe(true);
    });
});
