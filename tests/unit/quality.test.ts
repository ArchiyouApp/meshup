/**
 *  The quality profile — one dial for how finely curved geometry is discretised.
 *
 *  The regression that motivated it: `tessellate_open` / `tessellate_closed` in the Rust
 *  kernel read their chord error as an ABSOLUTE distance, so a circle's point count grew
 *  with its radius (r=10 → 226 points, r=1000 → 2224) and with the model's choice of unit.
 *  Every mesh built from a curve — extrude, loft, toPolygon, sweep — inherited it: extruding
 *  a `Curve.Circle(100)` cost 708 polygons and 220 ms where `Mesh.Cylinder(100, 50)` cost 96
 *  and 1 ms. The size-independence tests below are the ones that would catch it coming back.
 */

import { beforeAll, afterEach, describe, it, expect } from 'vitest';
import { initAsync, setQuality, getQuality, resetQuality, QUALITY_PRESETS } from '../../src/index';
import { Curve } from '../../src/Curve';
import { Mesh } from '../../src/Mesh';

beforeAll(async () =>
{
    await initAsync();
});

// Quality is global state: a test that changes it has to hand the next one a clean profile.
afterEach(() =>
{
    resetQuality();
});

describe('quality profile — size and unit independence', () =>
{
    it('a circle costs the same at every radius', () =>
    {
        const counts = [10, 100, 1000, 5000].map( r => Curve.Circle(r).tessellate().length );
        expect(new Set(counts).size).toBe(1);
        // and it is a sane number, not the 226 / 706 / 2224 / 3144 ladder it used to be
        expect(counts[0]).toBeLessThan(100);
    });

    it('the same model in mm and in m tessellates to the same density', () =>
    {
        const inMetres      = Curve.Rect(1, 0.5).fillet(0.05)!.tessellate().length;
        const inMillimetres = Curve.Rect(1000, 500).fillet(50)!.tessellate().length;
        // Within one point, not exactly equal: consecutive samples that coincide are dropped,
        // and whether a line's end and the next arc's start land on the same f64 depends on
        // the scale. What matters is that the count does not SCALE with the unit — it used to
        // be 505 in millimetres against 69 in metres.
        expect(Math.abs(inMillimetres - inMetres)).toBeLessThanOrEqual(1);
    });

    it('extruding a circle is in the same range as the equivalent Mesh.Cylinder', () =>
    {
        const extruded = Curve.Circle(100).extrude(50) as Mesh;
        const cylinder = Mesh.Cylinder(100, 50);
        // Not equal — the two build their walls and caps differently — but the same order,
        // where extrude() used to be ~7x the cylinder and grew from there with the radius.
        expect(extruded.polygons().length).toBeLessThan(cylinder.polygons().length * 2);
    });

    it('a full turn is subdivided by the profile\'s facets-per-turn', () =>
    {
        // Curve.Circle is two 180° arcs, so a full turn's worth of facets, plus the point
        // that closes the ring.
        const pts = Curve.Circle(50).tessellate();
        expect(pts.length).toBe(getQuality().curveSegmentsPerTurn + 1);
    });

    it('a quarter-circle fillet gets a quarter of a turn\'s facets', () =>
    {
        const perTurn = getQuality().curveSegmentsPerTurn;
        // 4 straight sides (1 chord each) + 4 quarter-turn arcs, then the closing point.
        const pts = Curve.Rect(1000, 500).fillet(50)!.tessellate();
        expect(pts.length).toBe(4 + 4 * (perTurn / 4) + 1);
    });
});

describe('quality profile — accuracy', () =>
{
    it('every tessellated point of a large circle sits on the circle', () =>
    {
        const r = 1000;
        // A chord over 1/n of a turn deviates by r*(1 - cos(pi/n)) at its midpoint; the
        // VERTICES stay exactly on the circle. That is what is asserted here — the chord
        // deviation itself is bounded by construction, from the facets-per-turn count.
        Curve.Circle(r).tessellate().forEach( p =>
        {
            expect(Math.hypot(p.x, p.y)).toBeCloseTo(r, 6);
        });
    });

    it('the chord sagitta stays within what the profile promises', () =>
    {
        const r = 1000;
        const perTurn = getQuality().curveSegmentsPerTurn;
        const allowed = r * (1 - Math.cos(Math.PI / perTurn)) * 1.05; // 5% slack for rounding
        const pts = Curve.Circle(r).tessellate();
        pts.slice(0, -1).forEach( (p, i) =>
        {
            const q = pts[i + 1];
            const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
            expect(r - Math.hypot(mid.x, mid.y)).toBeLessThanOrEqual(allowed);
        });
    });
});

describe('setQuality()', () =>
{
    it('a preset name switches the whole profile', () =>
    {
        setQuality('draft');
        expect(getQuality()).toEqual(QUALITY_PRESETS.draft);
        setQuality('fine');
        expect(getQuality()).toEqual(QUALITY_PRESETS.fine);
    });

    it('coarser presets give strictly fewer points, finer ones strictly more', () =>
    {
        const count = () => Curve.Circle(100).tessellate().length;
        setQuality('draft');   const draft = count();
        setQuality('preview'); const preview = count();
        setQuality('normal');  const normal = count();
        setQuality('fine');    const fine = count();
        expect(draft).toBeLessThan(preview);
        expect(preview).toBeLessThan(normal);
        expect(normal).toBeLessThan(fine);
    });

    it('reaches loft, revolve and the mesh primitives too', () =>
    {
        const sphere = () => Mesh.Sphere(10).polygons().length;
        const cylinder = () => Mesh.Cylinder(10, 20).polygons().length;
        const revolved = () => (Curve.Line([10, 0, 0], [10, 0, 50]).revolve() as Mesh).polygons().length;
        const lofted = () => (Curve.Circle(10).loft(Curve.Circle(5).moveZ(10)) as Mesh).polygons().length;

        setQuality('draft');
        const coarse = [sphere(), cylinder(), revolved(), lofted()];
        setQuality('fine');
        const dense = [sphere(), cylinder(), revolved(), lofted()];

        coarse.forEach( (n, i) => expect(n).toBeLessThan(dense[i]) );
    });

    it('a partial override changes one dial and leaves the rest', () =>
    {
        const before = getQuality();
        setQuality({ curveSegmentsPerTurn: 24 });
        expect(getQuality().curveSegmentsPerTurn).toBe(24);
        expect(getQuality().sphereSegmentsWidth).toBe(before.sphereSegmentsWidth);
        expect(Curve.Circle(100).tessellate().length).toBe(25);
    });

    it('rejects a nonsense dial rather than installing it', () =>
    {
        const before = { ...getQuality() };
        setQuality({ curveSegmentsPerTurn: 0 });
        setQuality({ curveChordTolerance: Number.NaN });
        setQuality({ curveMaxSegments: -5 });
        expect(getQuality()).toEqual(before);
        // and the geometry still works
        expect(Curve.Circle(10).tessellate().length).toBeGreaterThan(3);
    });

    it('resetQuality() goes back to normal', () =>
    {
        setQuality('draft');
        resetQuality();
        expect(getQuality()).toEqual(QUALITY_PRESETS.normal);
    });
});

describe('per-call override', () =>
{
    it('an explicit tolerance beats the profile, in both directions', () =>
    {
        const c = Curve.Circle(100);
        const fromProfile = c.tessellate().length;
        expect(c.tessellate(1e-5).length).toBeGreaterThan(fromProfile);
        expect(c.tessellate(1e-2).length).toBeLessThan(fromProfile);
    });

    it('an explicit tolerance is relative too — same count at any radius', () =>
    {
        const counts = [10, 1000].map( r => Curve.Circle(r).tessellate(1e-4).length );
        expect(counts[0]).toBe(counts[1]);
    });

    it('an explicit tolerance still applies under a coarse profile', () =>
    {
        setQuality('draft');
        const c = Curve.Circle(100);
        expect(c.tessellate(1e-4).length).toBeGreaterThan(c.tessellate().length);
    });

    it('an explicit revolve segment count still wins', () =>
    {
        setQuality('draft');
        const wall = Curve.Line([10, 0, 0], [10, 0, 50]).revolve(360, undefined, undefined, 40) as Mesh;
        expect(wall.polygons().length).toBe(40);
    });
});
