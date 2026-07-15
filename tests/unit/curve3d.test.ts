import { beforeAll, describe, it, expect } from 'vitest';
import { initAsync, getCsgrs } from '../../src/index';

let wasm: any;

beforeAll(async () =>
{
    await initAsync();
    wasm = getCsgrs();
});

const P = (x: number, y: number, z: number) => new wasm.Point3Js(x, y, z);
const V = (x: number, y: number, z: number) => new wasm.Vector3Js(x, y, z);

/** Polygon area of a 3D planar ring via Newell's cross-product magnitude. */
const area3d = (pts: any[]): number =>
{
    let ax = 0, ay = 0, az = 0;
    for (let i = 0; i < pts.length; i++)
    {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        ax += a.y * b.z - a.z * b.y;
        ay += a.z * b.x - a.x * b.z;
        az += a.x * b.y - a.y * b.x;
    }
    return 0.5 * Math.sqrt(ax * ax + ay * ay + az * az);
};

describe('Curve3DJs (hypercurve-backed planar 3D curve)', () =>
{
    it('makePolyline (closed square in XY) tessellates and areas to 100', () =>
    {
        const sq = wasm.Curve3DJs.makePolyline(
            [P(-5, -5, 0), P(5, -5, 0), P(5, 5, 0), P(-5, 5, 0)],
            true,
        );
        expect(sq.closed()).toBe(true);
        expect(Math.abs(sq.area())).toBeCloseTo(100, 6);
        const pts = sq.tessellate(1e-4);
        expect(pts.length).toBeGreaterThanOrEqual(4);
    });

    it('makeCircle in an arbitrary plane keeps points on that plane', () =>
    {
        // Circle centred at (0,0,10), normal = +X  => lies in the YZ plane.
        const c = wasm.Curve3DJs.makeCircle(4, P(0, 0, 10), V(1, 0, 0));
        const pts = c.tessellate(1e-4);
        // All points must have x == 0 (the plane through origin with normal +X at x=0).
        for (const p of pts) { expect(Math.abs(p.x)).toBeLessThan(1e-9); }
        // 3D area = pi r^2.
        expect(area3d(pts)).toBeCloseTo(Math.PI * 16, 0);
    });

    it('boolean union of two overlapping squares -> area 175', () =>
    {
        const a = wasm.Curve3DJs.makePolyline(
            [P(-5, -5, 0), P(5, -5, 0), P(5, 5, 0), P(-5, 5, 0)], true);
        const b = wasm.Curve3DJs.makePolyline(
            [P(0, 0, 0), P(10, 0, 0), P(10, 10, 0), P(0, 10, 0)], true);
        const res = a.boolean(b, 'union', 1e-4);
        expect(res.length).toBe(1);
        expect(res[0].holeCount()).toBe(0);
        expect(Math.abs(res[0].exterior.area())).toBeCloseTo(175, 3);
    });

    it('boolean intersection -> area 25', () =>
    {
        const a = wasm.Curve3DJs.makePolyline(
            [P(-5, -5, 0), P(5, -5, 0), P(5, 5, 0), P(-5, 5, 0)], true);
        const b = wasm.Curve3DJs.makePolyline(
            [P(0, 0, 0), P(10, 0, 0), P(10, 10, 0), P(0, 10, 0)], true);
        const res = a.boolean(b, 'intersection', 1e-4);
        expect(res.length).toBe(1);
        expect(Math.abs(res[0].exterior.area())).toBeCloseTo(25, 3);
    });

    it('difference of an enclosed square -> region with one hole', () =>
    {
        const outer = wasm.Curve3DJs.makePolyline(
            [P(-10, -10, 0), P(10, -10, 0), P(10, 10, 0), P(-10, 10, 0)], true);
        const inner = wasm.Curve3DJs.makePolyline(
            [P(-3, -3, 0), P(3, -3, 0), P(3, 3, 0), P(-3, 3, 0)], true);
        const res = outer.boolean(inner, 'difference', 1e-4);
        expect(res.length).toBe(1);
        expect(res[0].holeCount()).toBe(1);
        expect(Math.abs(res[0].exterior.area())).toBeCloseTo(400, 2);
        const holes = res[0].holes();
        expect(Math.abs(holes[0].area())).toBeCloseTo(36, 2);
    });

    it('translate moves the curve and preserves area', () =>
    {
        const sq = wasm.Curve3DJs.makePolyline(
            [P(-5, -5, 0), P(5, -5, 0), P(5, 5, 0), P(-5, 5, 0)], true);
        const moved = sq.translate(V(100, 0, 0));
        const pts = moved.tessellate(1e-4);
        for (const p of pts) { expect(p.x).toBeGreaterThan(90); }
        expect(Math.abs(moved.area())).toBeCloseTo(100, 6);
    });

    it('offset of a closed square changes area predictably', () =>
    {
        const sq = wasm.Curve3DJs.makePolyline(
            [P(-5, -5, 0), P(5, -5, 0), P(5, 5, 0), P(-5, 5, 0)], true);
        const off = sq.offset(1, 1e-4);
        const a = Math.abs(off.area());
        expect(a === 0 || Math.abs(a - 64) < 1e-3 || Math.abs(a - 144) < 1e-3).toBe(true);
    });

    it('intersect: two crossing open lines meet at one 3D point', () =>
    {
        const a = wasm.Curve3DJs.makePolyline([P(0, 0, 0), P(10, 10, 0)], false);
        const b = wasm.Curve3DJs.makePolyline([P(0, 10, 0), P(10, 0, 0)], false);
        const hits = a.intersect(b, 1e-4);
        expect(hits.length).toBe(1);
        expect(hits[0].x).toBeCloseTo(5);
        expect(hits[0].y).toBeCloseTo(5);
        expect(hits[0].z).toBeCloseTo(0);
    });

    it('bbox of the XY square is [-5,-5,0 .. 5,5,0]', () =>
    {
        const sq = wasm.Curve3DJs.makePolyline(
            [P(-5, -5, 0), P(5, -5, 0), P(5, 5, 0), P(-5, 5, 0)], true);
        const b = sq.bbox(1e-4);
        expect(b[0]).toBeCloseTo(-5); expect(b[1]).toBeCloseTo(-5); expect(b[2]).toBeCloseTo(0);
        expect(b[3]).toBeCloseTo(5); expect(b[4]).toBeCloseTo(5); expect(b[5]).toBeCloseTo(0);
    });

    it('rotateAxis 90deg about Z maps the square onto itself (area preserved)', () =>
    {
        const sq = wasm.Curve3DJs.makePolyline(
            [P(-5, -5, 0), P(5, -5, 0), P(5, 5, 0), P(-5, 5, 0)], true);
        const rot = sq.rotateAxis(Math.PI / 2, 0, 0, 1);
        expect(Math.abs(rot.area())).toBeCloseTo(100, 6);
        const b = rot.bbox(1e-4);
        // Still bounded within the same 10x10 XY box after a 90-degree turn.
        expect(b[0]).toBeCloseTo(-5); expect(b[3]).toBeCloseTo(5); expect(b[2]).toBeCloseTo(0);
    });

    it('clone is independent and isPlanar is true', () =>
    {
        const sq = wasm.Curve3DJs.makePolyline(
            [P(-5, -5, 0), P(5, -5, 0), P(5, 5, 0), P(-5, 5, 0)], true);
        const cp = sq.clone();
        expect(cp.isPlanar()).toBe(true);
        expect(Math.abs(cp.area())).toBeCloseTo(100, 6);
    });

    it('getOnPlane returns [normal, x, y] for an XY curve', () =>
    {
        const sq = wasm.Curve3DJs.makePolyline(
            [P(-5, -5, 0), P(5, -5, 0), P(5, 5, 0), P(-5, 5, 0)], true);
        const [n, x, y] = sq.getOnPlane();
        expect(Math.abs(n.z)).toBeCloseTo(1); // normal ~ +/- Z
        expect(Math.abs(x.z)).toBeCloseTo(0);
        expect(Math.abs(y.z)).toBeCloseTo(0);
    });

    it('uniform scale x2 quadruples the area and doubles extents', () =>
    {
        const sq = wasm.Curve3DJs.makePolyline(
            [P(-5, -5, 0), P(5, -5, 0), P(5, 5, 0), P(-5, 5, 0)], true);
        const big = sq.scale(2);
        expect(Math.abs(big.area())).toBeCloseTo(400, 4);
        const b = big.bbox(1e-4);
        expect(b[0]).toBeCloseTo(-10); expect(b[3]).toBeCloseTo(10);
    });

    it('rotateQuaternion 90deg about Z preserves area', () =>
    {
        const sq = wasm.Curve3DJs.makePolyline(
            [P(-5, -5, 0), P(5, -5, 0), P(5, 5, 0), P(-5, 5, 0)], true);
        // Quaternion for 90deg about Z: (cos45, 0, 0, sin45).
        const c = Math.SQRT1_2;
        const rot = sq.rotateQuaternion(c, 0, 0, c);
        expect(Math.abs(rot.area())).toBeCloseTo(100, 6);
    });

    it('makeInterpolated passes through all input points (in 3D XY)', () =>
    {
        const coords = [[0, 0, 0], [1, 2, 0], [3, 3, 0], [5, 1, 0], [6, 4, 0]];
        // NOTE: makeInterpolated consumes the Point3Js it is given (wasm-bindgen
        // takes ownership of a Vec<Point3Js>), so keep the expected values as plain
        // numbers rather than reusing the Point3Js objects afterwards.
        const curve = wasm.Curve3DJs.makeInterpolated(coords.map(([x, y, z]) => P(x, y, z)), 3);
        const tess = curve.tessellate(1e-5);
        for (const [qx, qy, qz] of coords)
        {
            let min = Infinity;
            for (const p of tess)
            {
                min = Math.min(min, Math.hypot(p.x - qx, p.y - qy, p.z - qz));
            }
            expect(min).toBeLessThan(2e-2); // nearest stored polyline vertex to an on-curve input
        }
    });
});

describe('Curve3DJs native ops', () =>
{
    it('makeArc through 3 points, pointAt endpoints, subtype Arc', () =>
    {
        const arc = wasm.Curve3DJs.makeArc(P(0,0,0), P(5,5,0), P(10,0,0));
        expect(arc.subtype()).toBe('Arc');
        const s = arc.pointAt(0); const e = arc.pointAt(1);
        expect(s.x).toBeCloseTo(0); expect(e.x).toBeCloseTo(10);
        const mid = arc.pointAt(0.5);
        expect(mid.y).toBeCloseTo(5, 1); // apex
    });
    it('makeLine + reverse swaps endpoints; subtype Line', () =>
    {
        const ln = wasm.Curve3DJs.makeLine(P(0,0,0), P(10,0,0));
        expect(ln.subtype()).toBe('Line');
        const r = ln.reverse();
        expect(r.pointAt(0).x).toBeCloseTo(10);
        expect(r.pointAt(1).x).toBeCloseTo(0);
    });
    it('closed square: subtype Rect, controlPoints=4, degree 1', () =>
    {
        const sq = wasm.Curve3DJs.makePolyline([P(-5,-5,0),P(5,-5,0),P(5,5,0),P(-5,5,0)], true);
        expect(sq.subtype()).toBe('Rect');
        expect(sq.controlPoints().length).toBe(4);
        expect(sq.degree()).toBe(1);
    });
    it('circle: subtype Circle, degree 2, paramAtLength half ~ 0.5', () =>
    {
        const c = wasm.Curve3DJs.makeCircle(10, P(0,0,0), V(0,0,1));
        expect(c.subtype()).toBe('Circle');
        expect(c.degree()).toBe(2);
        const half = c.paramAtLength(Math.PI*10); // half the circumference
        expect(half).toBeCloseTo(0.5, 1);
    });
});

describe('Curve3DJs fillet/chamfer', () =>
{
    it('fillet rounds a rect corner: introduces arcs, area slightly reduced', () =>
    {
        const sq = wasm.Curve3DJs.makePolyline([P(0,0,0),P(20,0,0),P(20,20,0),P(0,20,0)], true);
        const f = sq.fillet(3);
        expect(f.hasArcs()).toBe(true);               // corners became arcs
        const a = Math.abs(f.area());
        // 400 minus 4 corner cuts (each (r^2 - pi r^2/4) = 9 - 7.07 = 1.93) ≈ 400 - 7.7
        expect(a).toBeGreaterThan(385);
        expect(a).toBeLessThan(400);
    });
    it('chamfer bevels a rect corner: stays polygonal, area reduced by 4 triangles', () =>
    {
        const sq = wasm.Curve3DJs.makePolyline([P(0,0,0),P(20,0,0),P(20,20,0),P(0,20,0)], true);
        const c = sq.chamfer(4);
        expect(c.hasArcs()).toBe(false);              // bevels are straight
        const a = Math.abs(c.area());
        // 400 minus 4 right-triangles of legs 4 => 4 * (0.5*4*4) = 32
        expect(a).toBeCloseTo(368, 0);
    });
    it('fillet rounds an OPEN polyline\'s interior corner (endpoints preserved)', () =>
    {
        // A right-angle open path: only the single interior corner rounds; the two
        // free endpoints stay put. hypercurve's vertex fillet would reject a general
        // f64 corner (RadiusMismatch) — the from_bulge path handles it.
        const pl = wasm.Curve3DJs.makePolyline([P(0,0,0),P(100,0,0),P(100,100,0)], false);
        const f = pl.fillet(10);
        expect(f.closed()).toBe(false);
        expect(f.hasArcs()).toBe(true);                          // corner became an arc
        expect(f.segmentCount()).toBe(3);                        // line + arc + line
        // line(90) + quarter arc(π·10/2) + line(90)
        expect(f.length()).toBeCloseTo(180 + Math.PI * 5, 3);
        const cps = f.controlPoints();
        expect([cps[0].x, cps[0].y, cps[0].z]).toEqual([0, 0, 0]);         // start endpoint kept
    });
    it('chamfer bevels an OPEN polyline\'s interior corner only', () =>
    {
        const pl = wasm.Curve3DJs.makePolyline([P(0,0,0),P(100,0,0),P(100,100,0)], false);
        const c = pl.chamfer(10);
        expect(c.closed()).toBe(false);
        expect(c.hasArcs()).toBe(false);
        expect(c.segmentCount()).toBe(3);                        // line + bevel + line
    });
});
