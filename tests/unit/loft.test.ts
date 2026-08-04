import { beforeAll, describe, it, expect } from 'vitest';
import { initAsync } from '../../src/index';
import { Curve } from '../../src/Curve';
import { Polygon } from '../../src/Polygon';
import { Mesh } from '../../src/Mesh';

beforeAll(async () =>
{
    await initAsync();
});

describe('Curve.loft()', () =>
{
    it('two straight open lines -> flat Polygon (quad)', () =>
    {
        const a = Curve.Line([0, 0, 0], [10, 0, 0]);
        const b = Curve.Line([0, 0, 5], [10, 0, 5]);
        const result = a.loft(b);
        expect(result).toBeInstanceOf(Polygon);
        expect((result as Polygon).vertices().length).toBe(4);
    });

    it('two open arcs -> surface Mesh (no caps)', () =>
    {
        const a = Curve.Arc([0, 0, 0], [5, 5, 0], [10, 0, 0]);
        const b = Curve.Arc([0, 0, 5], [5, 5, 5], [10, 0, 5]);
        const result = a.loft(b);
        expect(result).toBeInstanceOf(Mesh);
        expect((result as Mesh).polygons().length).toBeGreaterThan(0);
    });

    it('two closed circles, solid=true -> watertight solid Mesh with positive volume', () =>
    {
        const a = Curve.Circle(10, [0, 0, 0], [0, 0, 1]);
        const b = Curve.Circle(5,  [0, 0, 10], [0, 0, 1]);
        const result = a.loft(b, true);
        expect(result).toBeInstanceOf(Mesh);
        const vol = (result as Mesh).volume();
        expect(vol).toBeGreaterThan(0);
    });

    it('two closed circles, solid=false -> fewer faces than solid (no caps)', () =>
    {
        const a = Curve.Circle(10, [0, 0, 0], [0, 0, 1]);
        const b = Curve.Circle(5,  [0, 0, 10], [0, 0, 1]);
        const solid = a.loft(b, true) as Mesh;
        const open  = a.loft(b, false) as Mesh;
        expect(open.polygons().length).toBeLessThan(solid.polygons().length);
    });

    it('loft through three circles via array', () =>
    {
        const a = Curve.Circle(10, [0, 0, 0],  [0, 0, 1]);
        const b = Curve.Circle(5,  [0, 0, 10], [0, 0, 1]);
        const c = Curve.Circle(8,  [0, 0, 20], [0, 0, 1]);
        const result = a.loft([b, c], true);
        expect(result).toBeInstanceOf(Mesh);
        expect((result as Mesh).volume()).toBeGreaterThan(0);
    });

    it('single profile / no others -> null', () =>
    {
        const a = Curve.Line([0, 0, 0], [10, 0, 0]);
        expect(a.loft([])).toBeNull();
    });
});

describe('Curve.loft() resolution', () =>
{
    it('lofts a rectangle onto a rectangle into 6 faces', () =>
    {
        // a box has four sides and two caps — a loft that resamples the profiles instead of
        // following their segments used to make this 66
        const box = Curve.Rect(100, 50).loft(Curve.Rect(100, 50).move(0, 0, 100)) as Mesh;
        expect(box).toBeInstanceOf(Mesh);
        expect(box.polygons().length).toBe(6);
        expect(box.volume()).toBeCloseTo(100 * 50 * 100, 6); // no faceting, so this is exact
    });

    it('keeps the four side faces when the rectangles differ', () =>
    {
        const frustum = Curve.Rect(100, 50).loft(Curve.Rect(50, 25).move(0, 0, 100)) as Mesh;
        expect(frustum.polygons().length).toBe(6);
        // h/3 * (A1 + A2 + sqrt(A1*A2)) for a tapered prism
        expect(frustum.volume()).toBeCloseTo(100 / 3 * (5000 + 1250 + Math.sqrt(5000 * 1250)), 6);
    });

    it('leaves out the caps when solid is false', () =>
    {
        const tube = Curve.Rect(100, 50).loft(Curve.Rect(100, 50).move(0, 0, 100), false) as Mesh;
        expect(tube.polygons().length).toBe(4);
    });

    it('carries the segments through a loft over three profiles', () =>
    {
        const a = Curve.Rect(100, 50);
        const b = Curve.Rect(50, 25).move(0, 0, 50);
        const c = Curve.Rect(80, 40).move(0, 0, 100);
        const stack = a.loft([b, c]) as Mesh;
        expect(stack.polygons().length).toBe(4 + 4 + 2); // two rings of sides, two caps
    });

    it('still subdivides curved segments', () =>
    {
        // straight segments cost one face each, the fillet arcs are subdivided by how far they turn
        const rounded = Curve.Rect(100, 50).fillet(10)!;
        const lofted = rounded.loft(Curve.Rect(100, 50).fillet(10)!.move(0, 0, 50)) as Mesh;
        expect(lofted.polygons().length).toBeGreaterThan(6);
        // area of the rounded rect: the four corners lose (4 - pi) * r^2 between them
        expect(lofted.volume()).toBeCloseTo((5000 - (4 - Math.PI) * 100) * 50, -2);
    });

    it('resolves a circle the same however it is lofted', () =>
    {
        // a full turn is LOFT_SEGMENTS_PER_TURN steps, so two half-circle spans give 64 sides
        const tube = Curve.Circle(50).loft(Curve.Circle(50).move(0, 0, 100), false) as Mesh;
        expect(tube.polygons().length).toBe(64);
    });

    it('falls back to uniform sampling when the profiles do not line up', () =>
    {
        // a rectangle has four segments and a circle two: there is no correspondence to follow
        const cone = Curve.Rect(100, 50).loft(Curve.Circle(30).move(0, 0, 100)) as Mesh;
        expect(cone).toBeInstanceOf(Mesh);
        expect(cone.volume()).toBeGreaterThan(0);
    });

    it('caps from the same points the sides are built from', () =>
    {
        // a cap sampled differently from the wall it closes leaves gaps along the seam
        const solid = Curve.Circle(50).loft(Curve.Circle(50).move(0, 0, 100)) as Mesh;
        expect(solid.polygons().length).toBe(64 + 2);
        // a 64-gon prism, not the ideal cylinder: area is (n/2) * r^2 * sin(2*pi/n)
        expect(solid.volume()).toBeCloseTo(32 * 2500 * Math.sin(2 * Math.PI / 64) * 100, -2);
    });
});
