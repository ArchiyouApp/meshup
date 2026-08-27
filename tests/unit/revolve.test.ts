import { beforeAll, describe, it, expect } from 'vitest';
import { initAsync } from '../../src/index';
import { Curve } from '../../src/Curve';
import { Mesh } from '../../src/Mesh';
import { Polygon } from '../../src/Polygon';
import { Sketch } from '../../src/Sketch';
import { Vector } from '../../src/Vector';

beforeAll(async () =>
{
    await initAsync();
});

/** Area of a regular n-gon of circumradius r, or of the n-facet fan that a partial sweep
 *  leaves behind. A revolve facets its sweep, so these — not the circle formulas — are the
 *  exact answers to compare a revolved volume against. */
const fanArea = (n: number, r: number, sweep: number = 2 * Math.PI) => (n / 2) * r * r * Math.sin(sweep / n);

/** A 20 x 10 rectangle standing in the XZ plane, 40 to 60 out from the Z axis. Revolved, it
 *  is a ring of rectangular section — a hollow cylinder. */
const ringProfile = () => Curve.Rect(20, 10, [50, 0, 5], 'xz');

/** The polygon of `mesh` whose centre stands furthest off the world Z axis. */
const outermostFace = (mesh: Mesh) =>
{
    const off = (p: { center(): { x: number, y: number } }) => Math.hypot(p.center().x, p.center().y);
    return mesh.polygons().toArray().reduce( (best, poly) => (off(poly) > off(best)) ? poly : best);
};

describe('Curve.revolve()', () =>
{
    it('sweeps a closed profile a full turn into a solid', () =>
    {
        const ring = ringProfile().revolve() as Mesh;
        expect(ring).toBeInstanceOf(Mesh);
        // four profile edges, REVOLVE_SEGMENTS_PER_TURN facets each, and no caps on a full turn
        expect(ring.polygons().length).toBe(4 * 64);
        // a 64-gon prism with a 64-gon hole in it, not the ideal tube: this is exact
        expect(ring.volume()).toBeCloseTo(10 * (fanArea(64, 60) - fanArea(64, 40)), 6);
    });

    it('caps a partial sweep at both ends', () =>
    {
        const quarter = ringProfile().revolve(90) as Mesh;
        expect(quarter.polygons().length).toBe(4 * 16 + 2); // a quarter turn is a quarter of the facets
        expect(quarter.volume()).toBeCloseTo(10 * (fanArea(16, 60, Math.PI / 2) - fanArea(16, 40, Math.PI / 2)), 6);
    });

    it('sweeps the other way round on a negative angle', () =>
    {
        const back = ringProfile().revolve(-90) as Mesh;
        expect(back.volume()).toBeCloseTo((ringProfile().revolve(90) as Mesh).volume()!, 6);
        // +90 turns from +x towards +y, -90 the other way
        expect(back.bbox().min().y).toBeCloseTo(-60, 6);
        expect(back.bbox().max().y).toBeCloseTo(0, 6);
    });

    it('leaves an open profile an open surface', () =>
    {
        const wall = Curve.Line([10, 0, 0], [10, 0, 50]).revolve() as Mesh;
        expect(wall.polygons().length).toBe(64); // one edge swept, nothing to cap
        expect(wall.area()).toBeCloseTo(2 * Math.PI * 10 * 50, -1);
    });

    it('closes an open profile that begins and ends on the axis', () =>
    {
        // a half circle revolves into a sphere: the quads at either pole fall back to triangles
        const sphere = Curve.Arc([0, 0, -10], [10, 0, 0], [0, 0, 10], 'threepoint').revolve() as Mesh;
        expect(sphere.volume()).toBeCloseTo(4 / 3 * Math.PI * 1000, -2);
        expect(sphere.bbox().min().z).toBeCloseTo(-10, 6);
        expect(sphere.bbox().max().z).toBeCloseTo(10, 6);
    });

    it('drops the edges of a profile that lie along the axis', () =>
    {
        // the rectangle's inner edge sits ON the Z axis, so only three of its four edges sweep
        const cylinder = Curve.Rect(20, 10, [10, 0, 5], 'xz').revolve() as Mesh;
        expect(cylinder.polygons().length).toBe(3 * 64);
        expect(cylinder.volume()).toBeCloseTo(10 * fanArea(64, 20), 6);
    });

    it('revolves interior holes into a cavity', () =>
    {
        const profile = ringProfile();
        profile.addHole(Curve.Rect(4, 4, [50, 0, 5], 'xz'));
        const hollow = profile.revolve(90) as Mesh;

        const solid  = 10 * (fanArea(16, 60, Math.PI / 2) - fanArea(16, 40, Math.PI / 2));
        const cavity =  4 * (fanArea(16, 52, Math.PI / 2) - fanArea(16, 48, Math.PI / 2));
        expect(hollow.volume()).toBeCloseTo(solid - cavity, 6);
        // walls for both rings, and caps triangulated around the hole
        expect(hollow.polygons().length).toBe(4 * 16 + 4 * 16 + 2 * 8);
    });

    it('takes an explicit axis as a direction or as two points', () =>
    {
        const byName   = ringProfile().revolve(360, 'z') as Mesh;
        const byVector = ringProfile().revolve(360, [0, 0, 1]) as Mesh;
        const byPoints = ringProfile().revolve(360, [0, 0, 0], [0, 0, 1]) as Mesh;

        expect(byName.volume()).toBeCloseTo(byPoints.volume()!, 6);
        expect(byVector.volume()).toBeCloseTo(byPoints.volume()!, 6);
    });

    it('takes an explicit number of facets', () =>
    {
        const coarse = ringProfile().revolve(360, undefined, undefined, 8) as Mesh;
        expect(coarse.polygons().length).toBe(4 * 8);
        expect(coarse.volume()).toBeCloseTo(10 * (fanArea(8, 60) - fanArea(8, 40)), 6);
    });

    it('rejects a sweep that cannot mean anything', () =>
    {
        expect(ringProfile().revolve(0)).toBeNull();                          // no sweep
        expect(ringProfile().revolve(360, [0, 0, 0], [0, 0, 0])).toBeNull();  // no axis direction
        expect(Curve.Line([0, 0, 0], [0, 0, 10]).revolve()).toBeNull();       // profile IS the axis
    });

    it('clamps a sweep beyond a full turn', () =>
    {
        const over = ringProfile().revolve(400) as Mesh;
        expect(over.volume()).toBeCloseTo((ringProfile().revolve(360) as Mesh).volume()!, 6);
    });
});

describe('Curve.revolve() orientation', () =>
{
    it('faces the outer wall away from the axis and the inner wall into the hole', () =>
    {
        const ring = ringProfile().revolve() as Mesh;
        const faces = ring.polygons().toArray();
        const off = (p: typeof faces[0]) => Math.hypot(p.center().x, p.center().y);
        const outer = faces.reduce( (best, p) => (off(p) > off(best)) ? p : best);
        const inner = faces.reduce( (best, p) => (off(p) < off(best)) ? p : best);

        const radial = (p: typeof faces[0]) => Vector.from(p.center().x, p.center().y, 0).normalize();
        expect(outer.normal().dot(radial(outer))).toBeCloseTo(1, 6);
        expect(inner.normal().dot(radial(inner))).toBeCloseTo(-1, 6);
    });

    it('gives a solid that works as a boolean cutter', () =>
    {
        // an inside-out solid still measures a positive volume but leaves a difference() alone,
        // so this is the test that really pins the winding down
        const ring = ringProfile().revolve() as Mesh;
        const slab = Mesh.BoxBetween([-100, -100, 0], [100, 100, 10]);
        const cut = slab.difference(ring) as Mesh;
        expect(cut.volume()).toBeCloseTo(400000 - ring.volume()!, 6);
    });

    it('faces the sphere shell outward', () =>
    {
        const sphere = Curve.Arc([0, 0, -10], [10, 0, 0], [0, 0, 10], 'threepoint').revolve() as Mesh;
        const face = sphere.polygons().toArray()[10];
        const outward = Vector.from(face.center().x, face.center().y, face.center().z).normalize();
        expect(face.normal().dot(outward)).toBeGreaterThan(0.99);
    });
});

describe('Curve.revolve() axis detection', () =>
{
    it('lathes a profile in the XZ plane about world Z', () =>
    {
        const ring = ringProfile().revolve() as Mesh;
        expect(ring.bbox().min().toArray()).toEqual([-60, -60, 0].map( v => expect.closeTo(v, 6)));
        expect(ring.bbox().max().z).toBeCloseTo(10, 6);
    });

    it('falls back to world Y for a profile lying in the XY plane', () =>
    {
        // Z is perpendicular to the profile's plane and cannot be a lathe axis there
        const ring = Curve.Rect(20, 10, [50, 5, 0], 'xy').revolve() as Mesh;
        expect(ring.bbox().min().y).toBeCloseTo(0, 6);
        expect(ring.bbox().max().y).toBeCloseTo(10, 6);
        expect(ring.bbox().max().x).toBeCloseTo(60, 6);
        expect(ring.bbox().max().z).toBeCloseTo(60, 6);
    });

    it('keeps the axis in the profile’s own plane when that plane is offset', () =>
    {
        // drawn on y = 10, so the axis is the vertical line through (0, 10) — not through the
        // world origin, which the profile's plane never even meets
        const ring = Curve.Rect(20, 10, [50, 10, 5], 'xz').revolve() as Mesh;
        expect(ring.volume()).toBeCloseTo(10 * (fanArea(64, 60) - fanArea(64, 40)), 6);
        expect(ring.bbox().min().y).toBeCloseTo(-50, 6);
        expect(ring.bbox().max().y).toBeCloseTo(70, 6);
    });

    it('skips an axis the profile straddles', () =>
    {
        // spanning x = -20..20 the profile straddles world Y, so world X is taken instead
        const ring = Curve.Rect(40, 10, [0, 30, 0], 'xy').revolve() as Mesh;
        expect(ring.bbox().min().x).toBeCloseTo(-20, 6);
        expect(ring.bbox().max().x).toBeCloseTo(20, 6);
        expect(ring.bbox().max().z).toBeCloseTo(35, 6);
    });

    it('still returns something when every axis is straddled', () =>
    {
        // a circle around the origin has no clean axis in its plane — warned about, not refused
        expect(Curve.Circle(10).revolve()).toBeInstanceOf(Mesh);
    });
});

describe('Polygon.revolve()', () =>
{
    /** The same 20 x 10 profile as ringProfile(), as a face rather than a curve. */
    const ringFace = () => new Polygon([[40, 0, 0], [60, 0, 0], [60, 0, 10], [40, 0, 10]]);

    it('lathes the face into a solid', () =>
    {
        const ring = ringFace().revolve() as Mesh;
        expect(ring.polygons().length).toBe(4 * 64);
        expect(ring.volume()).toBeCloseTo(10 * (fanArea(64, 60) - fanArea(64, 40)), 6);
        expect(outermostFace(ring).normal().dot(
            Vector.from(outermostFace(ring).center().x, outermostFace(ring).center().y, 0).normalize())).toBeCloseTo(1, 6);
    });

    it('takes the same angle and axis as the curve does', () =>
    {
        const quarter = ringFace().revolve(90, 'z') as Mesh;
        expect(quarter.polygons().length).toBe(4 * 16 + 2);
        expect(quarter.volume()).toBeCloseTo(10 * (fanArea(16, 60, Math.PI / 2) - fanArea(16, 40, Math.PI / 2)), 6);
    });

    it('carries the face’s holes into a cavity', () =>
    {
        // extrude() drops a polygon's holes; a revolve sweeps them along into a cavity
        const face = ringFace();
        face.addHole([[48, 0, 3], [52, 0, 3], [52, 0, 7], [48, 0, 7]]);
        const ring = face.revolve(90) as Mesh;

        const solid  = 10 * (fanArea(16, 60, Math.PI / 2) - fanArea(16, 40, Math.PI / 2));
        const cavity =  4 * (fanArea(16, 52, Math.PI / 2) - fanArea(16, 48, Math.PI / 2));
        expect(ring.volume()).toBeCloseTo(solid - cavity, 6);
        expect(ring.polygons().length).toBe(4 * 16 + 4 * 16 + 2 * 8);
    });
});

describe('Sketch.revolve()', () =>
{
    /** 20 x 10 rectangle in sketch coordinates, 40 to 60 out from the sketch's Y axis. */
    const ringSketch = (plane: 'xy'|'front' = 'xy') => new Sketch(plane)
        .moveTo(40, 0).lineTo(60, 0).lineTo(60, 10).lineTo(40, 10).close();

    it('lathes the sketch about its own vertical centre line', () =>
    {
        const ring = ringSketch().revolve() as Mesh;
        expect(ring.volume()).toBeCloseTo(10 * (fanArea(64, 60) - fanArea(64, 40)), 6);
        // the sketch's Y axis is world Y on the XY plane, so the ring turns around that
        expect(ring.bbox().min().toArray()).toEqual([-60, 0, -60].map( v => expect.closeTo(v, 6)));
        expect(ring.bbox().max().toArray()).toEqual([60, 10, 60].map( v => expect.closeTo(v, 6)));
    });

    it('places the result on the sketch workplane', () =>
    {
        // on the front plane the sketch's Y axis is world Z, so the same profile stands up
        const ring = ringSketch('front').revolve() as Mesh;
        expect(ring.volume()).toBeCloseTo(10 * (fanArea(64, 60) - fanArea(64, 40)), 6);
        expect(ring.bbox().min().toArray()).toEqual([-60, -60, 0].map( v => expect.closeTo(v, 6)));
        expect(ring.bbox().max().toArray()).toEqual([60, 60, 10].map( v => expect.closeTo(v, 6)));
    });

    it('takes an axis in sketch coordinates', () =>
    {
        const explicit = ringSketch().revolve(360, [0, 0], [0, 1]) as Mesh;
        expect(explicit.volume()).toBeCloseTo((ringSketch().revolve() as Mesh).volume()!, 6);
    });

    it('sweeps a partial turn with caps', () =>
    {
        const quarter = ringSketch().revolve(90) as Mesh;
        expect(quarter.polygons().length).toBe(4 * 16 + 2);
        expect(quarter.volume()).toBeCloseTo(10 * (fanArea(16, 60, Math.PI / 2) - fanArea(16, 40, Math.PI / 2)), 6);
    });

    it('carries the contour’s own holes into a cavity', () =>
    {
        // a sketch contour that already holds a hole (from a boolean, or drawn elsewhere)
        // revolves into a solid with a matching cavity — same convention as extrude()
        const sketch = new Sketch()
            .moveTo(40, 0).lineTo(60, 0).lineTo(60, 10).lineTo(40, 10).close();
        sketch._curves.first()!.addHole(Curve.Rect(4, 4, [50, 5, 0]));
        const ring = sketch.revolve(90) as Mesh;

        const solid  = 10 * (fanArea(16, 60, Math.PI / 2) - fanArea(16, 40, Math.PI / 2));
        const cavity =  4 * (fanArea(16, 52, Math.PI / 2) - fanArea(16, 48, Math.PI / 2));
        expect(ring.volume()).toBeCloseTo(solid - cavity, 6);
    });

    it('returns null when there is nothing closed to revolve', () =>
    {
        expect(new Sketch().moveTo(0, 0).lineTo(10, 0).revolve()).toBeNull();
    });
});
