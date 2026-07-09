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
