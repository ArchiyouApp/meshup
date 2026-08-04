import { beforeAll, describe, it, expect } from 'vitest';
import { initAsync, getCsgrs } from '../../src/index';

/** The hypercurve engine, exercised through the native `Curve3DJs` surface.
 *
 *  This file used to drive the flat-`Float64Array` `hc*` free functions
 *  (`hcTessellatePolyline`, `hcCircle`, `hcBoolean`, `hcOffset`, `hcIntersect`,
 *  `hcNurbsTessellate`, …). Those took polylines in and returned polylines out, so they
 *  could only ever assert tessellated answers — and nothing in `src/` called them. They
 *  were removed; the same behaviour is asserted here against `Curve3DJs`, which is what
 *  the TypeScript layer actually uses, and against NATIVE quantities where hypercurve has
 *  them (a circle's area is exactly pi*r^2, not a shoelace over a ring).
 */

let wasm: any;

beforeAll(async () =>
{
    await initAsync();
    wasm = getCsgrs();
});

const P = (x: number, y: number, z: number) => new wasm.Point3Js(x, y, z);
const V = (x: number, y: number, z: number) => new wasm.Vector3Js(x, y, z);

/** Closed square of side 2*half centred at (cx, cy) in the XY plane. */
const square = (cx: number, cy: number, half: number) => wasm.Curve3DJs.makePolyline([
    P(cx - half, cy - half, 0),
    P(cx + half, cy - half, 0),
    P(cx + half, cy + half, 0),
    P(cx - half, cy + half, 0),
], true);

describe('hypercurve engine (native Curve3DJs bindings)', () =>
{
    it('tessellates an open polyline preserving its endpoints', () =>
    {
        const c = wasm.Curve3DJs.makePolyline([P(0, 0, 0), P(10, 0, 0), P(10, 5, 0)], false);
        const pts = c.tessellate(1e-4);
        expect(pts[0].x).toBeCloseTo(0);
        expect(pts[0].y).toBeCloseTo(0);
        expect(pts[pts.length - 1].x).toBeCloseTo(10);
        expect(pts[pts.length - 1].y).toBeCloseTo(5);
    });

    it('a circle has exact area pi*r^2 and perimeter 2*pi*r', () =>
    {
        const c = wasm.Curve3DJs.makeCircle(4, P(0, 0, 0), V(0, 0, 1));
        // Native: arcs are exact, so these hold to full precision — not to 1 decimal
        // as the old shoelace-over-a-tessellated-ring assertion did.
        expect(Math.abs(c.area())).toBeCloseTo(Math.PI * 16, 9);
        expect(c.length()).toBeCloseTo(2 * Math.PI * 4, 9);
    });

    it('signed area of a 10x10 square is 100', () =>
    {
        expect(Math.abs(square(0, 0, 5).area())).toBeCloseTo(100, 9);
    });

    it('boolean union of two overlapping squares -> 1 region, area 175', () =>
    {
        const regions = square(0, 0, 5).boolean(square(5, 5, 5), 'union');
        expect(regions.length).toBe(1);
        expect(Math.abs(regions[0].exterior.area())).toBeCloseTo(175, 9);
        expect(regions[0].holeCount()).toBe(0);
    });

    it('boolean intersection -> area 25; difference -> area 75', () =>
    {
        const inter = square(0, 0, 5).boolean(square(5, 5, 5), 'intersection');
        const diff = square(0, 0, 5).boolean(square(5, 5, 5), 'difference');
        expect(Math.abs(inter[0].exterior.area())).toBeCloseTo(25, 9);
        expect(Math.abs(diff[0].exterior.area())).toBeCloseTo(75, 9);
    });

    it('a fully enclosed subtrahend becomes a hole, not a second region', () =>
    {
        const regions = square(0, 0, 10).boolean(square(0, 0, 3), 'difference');
        expect(regions.length).toBe(1);
        expect(regions[0].holeCount()).toBe(1);
        expect(Math.abs(regions[0].exterior.area())).toBeCloseTo(400, 9);
        expect(Math.abs(regions[0].holes()[0].area())).toBeCloseTo(36, 9);
    });

    it('offsets an open line sideways by the given distance', () =>
    {
        const line = wasm.Curve3DJs.makePolyline([P(0, 0, 0), P(10, 0, 0)], false);
        const off = line.offset(2, 1e-4);
        expect(off.length()).toBeCloseTo(10, 6);
        for (const p of off.tessellate(1e-4)) { expect(Math.abs(p.y)).toBeCloseTo(2, 6); }
    });

    it('intersects two crossing lines at one point', () =>
    {
        const a = wasm.Curve3DJs.makePolyline([P(0, 0, 0), P(10, 10, 0)], false);
        const b = wasm.Curve3DJs.makePolyline([P(0, 5, 0), P(10, 5, 0)], false);
        const hits = a.intersect(b, 1e-4);
        expect(hits.length).toBe(1);
        expect(hits[0].x).toBeCloseTo(5);
        expect(hits[0].y).toBeCloseTo(5);
    });

    it('an interpolated curve passes through its input points', () =>
    {
        const input = [P(0, 0, 0), P(5, 10, 0), P(10, 0, 0)];
        const c = wasm.Curve3DJs.makeInterpolated(input, 2);
        const pts = c.tessellate(1e-4);
        // Endpoints are interpolated exactly.
        expect(pts[0].x).toBeCloseTo(0, 6);
        expect(pts[pts.length - 1].x).toBeCloseTo(10, 6);
        // The apex is reached: an interpolating spline passes through (5, 10).
        let maxY = -Infinity;
        for (const p of pts) { maxY = Math.max(maxY, p.y); }
        expect(maxY).toBeCloseTo(10, 3);
    });

    it('an ellipse is built from exact conic spans, not sampled points', () =>
    {
        const e = wasm.Curve3DJs.makeEllipse(3, 1.5, 0, P(0, 0, 0), V(0, 0, 1));
        expect(e.closed()).toBe(true);
        // Every tessellation point satisfies the implicit ellipse equation.
        for (const p of e.tessellate(1e-5))
        {
            expect((p.x / 3) ** 2 + (p.y / 1.5) ** 2).toBeCloseTo(1, 6);
        }
    });
});
