/** Planar shape operations added for the legacy-cadscript API surface:
 *   - Polygon planar booleans (intersection/union) via the boundary curves
 *   - Polygon.toCurve() / loft() / layflat()
 *   - Vertex.extrude() — the first link of vertex → line → face → solid
 */
import { beforeAll, describe, it, expect } from 'vitest';
import { initAsync } from '../../src/index';
import { Polygon } from '../../src/Polygon';
import { Mesh } from '../../src/Mesh';
import { Curve } from '../../src/Curve';
import { Vertex } from '../../src/Vertex';

beforeAll(async () =>
{
    await initAsync();
});

/** Unit square on XY at the origin */
const SQUARE: Array<[number, number, number]> = [
    [0, 0, 0],
    [10, 0, 0],
    [10, 10, 0],
    [0, 10, 0],
];

describe('Polygon.toCurve()', () =>
{
    it('returns the boundary as a closed, planar Curve', () =>
    {
        const c = new Polygon(SQUARE).toCurve();
        expect(c).toBeInstanceOf(Curve);
        expect(c.isClosed()).toBe(true);
        expect(c.isPlanar()).toBe(true);
    });

    it('does not leave a zero-length segment when vertices() repeats the first point', () =>
    {
        // a Polygon coming out of a Mesh face repeats its first vertex to close the loop
        const face = Mesh.Cube(10).polygons().first() as Polygon;
        expect(() => face.toCurve()).not.toThrow();
        expect(face.toCurve().isClosed()).toBe(true);
    });
});

describe('Polygon planar booleans', () =>
{
    it('intersection() keeps only the overlapping area', () =>
    {
        const a = new Polygon(SQUARE);                          // 10 x 10 = 100
        const b = new Polygon(SQUARE).translate(5, 0, 0);       // shifted 5 in x

        a.intersection(b);
        expect(a.area()).toBeCloseTo(50, 1);                    // 5 x 10 overlap
        expect(a.bbox().minX()).toBeCloseTo(5, 1);
        expect(a.bbox().maxX()).toBeCloseTo(10, 1);
    });

    it('intersection() with a closed Curve works the same as with a Polygon', () =>
    {
        const a = new Polygon(SQUARE);
        const knife = new Polygon(SQUARE).translate(5, 0, 0).toCurve();

        a.intersection(knife);
        expect(a.area()).toBeCloseTo(50, 1);
    });

    it('union() merges two overlapping polygons into one region', () =>
    {
        const a = new Polygon(SQUARE);
        const b = new Polygon(SQUARE).translate(5, 0, 0);

        a.union(b);
        expect(a.area()).toBeCloseTo(150, 1);                   // 15 x 10
        expect(a.bbox().width()).toBeCloseTo(15, 1);
    });

    it('difference() still behaves as before (no regression from the shared code path)', () =>
    {
        const a = new Polygon(SQUARE);
        const b = new Polygon(SQUARE).translate(5, 0, 0);

        a.difference(b);
        expect(a.area()).toBeCloseTo(50, 1);                    // the non-overlapping half
        expect(a.bbox().minX()).toBeCloseTo(0, 1);
        expect(a.bbox().maxX()).toBeCloseTo(5, 1);
    });

    it('intersection() leaves the polygon unchanged when the shapes do not overlap', () =>
    {
        const a = new Polygon(SQUARE);
        const b = new Polygon(SQUARE).translate(100, 0, 0);

        a.intersection(b);
        expect(a.area()).toBeCloseTo(100, 1);
    });

    it('intersection() works on a plane other than XY', () =>
    {
        // same test as above, rotated into the XZ plane
        const a = new Polygon(SQUARE).rotateX(90);
        const b = new Polygon(SQUARE).rotateX(90).translate(5, 0, 0);

        a.intersection(b);
        expect(a.area()).toBeCloseTo(50, 1);
    });
});

describe('Polygon.loft()', () =>
{
    it('lofts to another Polygon into a closed solid Mesh', () =>
    {
        const bottom = new Polygon(SQUARE);
        const top = new Polygon(SQUARE).translate(0, 0, 10);

        const solid = bottom.loft(top);
        expect(solid).toBeInstanceOf(Mesh);
        // a 10x10x10 box-ish loft — capped, so it has a real volume
        expect((solid as Mesh).volume()).toBeGreaterThan(900);
        expect((solid as Mesh).bbox().height()).toBeCloseTo(10, 1);
    });

    it('lofts to a closed Curve profile', () =>
    {
        const bottom = new Polygon(SQUARE);
        const top = new Polygon(SQUARE).translate(0, 0, 10).toCurve();

        const solid = bottom.loft(top);
        expect(solid).toBeInstanceOf(Mesh);
        expect((solid as Mesh).volume()).toBeGreaterThan(900);
    });

    it('returns null (with a warning) for a non-profile argument', () =>
    {
        const bottom = new Polygon(SQUARE);
        expect(bottom.loft(Mesh.Cube(1) as any)).toBeNull();
    });
});

describe('Polygon.layflat()', () =>
{
    it('rotates a tilted polygon onto the XY plane at z = 0', () =>
    {
        const p = new Polygon(SQUARE).rotateX(37).translate(0, 0, 25);

        p.layflat();

        expect(Math.abs(p.normal().normalize().z)).toBeCloseTo(1, 5);
        expect(p.bbox().minZ()).toBeCloseTo(0, 5);
        expect(p.bbox().height()).toBeCloseTo(0, 5);
        expect(p.area()).toBeCloseTo(100, 1); // area is preserved
    });

    it('only drops an already-flat polygon onto z = 0', () =>
    {
        const p = new Polygon(SQUARE).translate(0, 0, 12);

        p.layflat();

        expect(p.bbox().minZ()).toBeCloseTo(0, 5);
        expect(p.area()).toBeCloseTo(100, 1);
    });

    it('turns an upside-down polygon over', () =>
    {
        const p = new Polygon(SQUARE).rotateX(180);

        p.layflat();

        expect(Math.abs(p.normal().normalize().z)).toBeCloseTo(1, 5);
        expect(p.bbox().minZ()).toBeCloseTo(0, 5);
    });
});

describe('Vertex.extrude()', () =>
{
    it('sweeps a vertex into a straight line Curve', () =>
    {
        const line = new Vertex([1, 2, 3]).extrude(10, [0, 1, 0]);

        expect(line).toBeInstanceOf(Curve);
        expect(line.length()).toBeCloseTo(10, 5);
        expect(line.start().x).toBeCloseTo(1, 5);
        expect(line.end().y).toBeCloseTo(12, 5);
    });

    it('defaults to +Z when the vertex has no normal', () =>
    {
        const line = new Vertex([0, 0, 0]).extrude(5);

        expect(line.end().z).toBeCloseTo(5, 5);
    });

    it('uses the vertex normal when it has one', () =>
    {
        const line = new Vertex([0, 0, 0], [1, 0, 0]).extrude(4);

        expect(line.end().x).toBeCloseTo(4, 5);
    });

    it('completes the vertex → line → face → solid chain', () =>
    {
        const solid = new Vertex([0, 0, 0])
            .extrude(10, [1, 0, 0])   // → Curve (line along x)
            .extrude(10, [0, 1, 0])!  // → Polygon (flat quad on XY)
            .extrude(10, [0, 0, 1]);  // → Mesh (solid box)

        expect(solid).toBeInstanceOf(Mesh);
        expect((solid as Mesh).volume()).toBeCloseTo(1000, 0);
    });
});
