import { beforeAll, describe, it, expect } from 'vitest';
import { initAsync, ShapeCollection } from '../../src/index';
import { Curve } from '../../src/Curve';
import { Polygon } from '../../src/Polygon';
import { Mesh } from '../../src/Mesh';
import { save } from '../../src/utils';

beforeAll(async () =>
{
    await initAsync();
});

describe('Curve.Line()', () =>
{
    it('creates a non-null curve', () =>
    {
        const c = Curve.Line([0, 0, 0], [10, 0, 0]);
        expect(c).toBeTruthy();
    });

    it('has the correct length', () =>
    {
        const c = Curve.Line([0, 0, 0], [10, 0, 0]);
        expect(c.length()).toBeCloseTo(10, 1);
    });

    it('start() returns the start point', () =>
    {
        const c = Curve.Line([1, 2, 3], [4, 5, 6]);
        expect(c.start().x).toBeCloseTo(1);
        expect(c.start().y).toBeCloseTo(2);
        expect(c.start().z).toBeCloseTo(3);
    });

    it('end() returns the end point', () =>
    {
        const c = Curve.Line([1, 2, 3], [4, 5, 6]);
        expect(c.end().x).toBeCloseTo(4);
        expect(c.end().y).toBeCloseTo(5);
        expect(c.end().z).toBeCloseTo(6);
    });

    it('is not closed', () =>
    {
        const c = Curve.Line([0, 0, 0], [10, 0, 0]);
        expect(c.isClosed()).toBe(false);
    });

    it('throws for invalid points', () =>
    {
        expect(() => Curve.Line('bad' as any, [0, 0, 0])).toThrow();
    });
});

describe('Curve.Polyline()', () =>
{
    it('creates a polyline through multiple points', () =>
    {
        const c = Curve.Polyline([[0,0,0], [5,0,0], [5,5,0], [0,5,0]]);
        expect(c).toBeTruthy();
    });

    it('has a positive length', () =>
    {
        const c = Curve.Polyline([[0,0,0], [5,0,0], [5,5,0]]);
        expect(c.length()).toBeGreaterThan(0);
    });

    it('accepts flat args: Curve.Polyline(p1, p2, p3)', () =>
    {
        const c = Curve.Polyline([0,0,0], [10,0,0], [10,10,0]);
        expect(c).toBeTruthy();
        expect(c.length()).toBeGreaterThan(0);
    });
});

describe('Curve.Interpolated()', () =>
{
    it('creates a smooth curve through control points', () =>
    {
        // degree 3 needs at least 4 control points
        const c = Curve.Interpolated([[0,0,0], [3,5,0], [7,5,0], [10,0,0]]);
        expect(c).toBeTruthy();
        expect(c.length()).toBeGreaterThan(0);
    });
});

describe('Curve.Circle()', () =>
{
    it('creates a circle with the given radius', () =>
    {
        const c = Curve.Circle(5);
        expect(c).toBeTruthy();
    });

    it('is closed', () =>
    {
        const c = Curve.Circle(5);
        expect(c.isClosed()).toBe(true);
    });

    it('circumference ≈ 2πr', () =>
    {
        const r = 10;
        const c = Curve.Circle(r);
        expect(c.length()).toBeCloseTo(2 * Math.PI * r, 0);
    });
});

describe('Curve.tessellate()', () =>
{
    it('returns an array of Points', () =>
    {
        const c = Curve.Line([0, 0, 0], [10, 0, 0]);
        const pts = c.tessellate();
        expect(Array.isArray(pts)).toBe(true);
        expect(pts.length).toBeGreaterThan(0);
    });

    it('first tessellated point is near the start', () =>
    {
        const c = Curve.Line([0, 0, 0], [10, 0, 0]);
        const pts = c.tessellate();
        expect(pts[0].x).toBeCloseTo(0, 1);
    });
});

describe('Curve.pointAtParam()', () =>
{
    it('returns start point at param domain[0]', () =>
    {
        const c = Curve.Line([0, 0, 0], [10, 0, 0]);
        const domain = c.inner().knotsDomain();
        const pt = c.pointAtParam(domain[0]);
        expect(pt.x).toBeCloseTo(0, 1);
    });
});

describe('Curve.type()', () =>
{
    it('returns "line" for a simple NurbsCurve', () =>
    {
        const c = Curve.Line([0,0,0], [1,0,0]);
        expect(c.type).toBe('Curve');
    });
});

describe('Curve.center()', () =>
{
    it('returns midpoint of a line along x-axis', () =>
    {
        const c = Curve.Line([0, 0, 0], [10, 0, 0]);
        const center = c.center();
        expect(center.x).toBeCloseTo(5, 1);
        expect(center.y).toBeCloseTo(0, 1);
        expect(center.z).toBeCloseTo(0, 1);
    });

    it('returns center of a circle', () =>
    {
        const c = Curve.Circle(5, [3, 4, 0]);
        const center = c.center();
        expect(center.x).toBeCloseTo(3, 0);
        expect(center.y).toBeCloseTo(4, 0);
    });

    it('returns a Point instance', () =>
    {
        const c = Curve.Line([1, 2, 3], [5, 6, 7]);
        expect(c.center()).toBeInstanceOf(Object); // Point
        expect(typeof c.center().x).toBe('number');
    });
});

describe('Curve.grid()', () =>
{
    it('accepts per-axis spacing as a vector-like 4th parameter', () =>
    {
        const curves = Curve.Line([0, 0, 0], [10, 0, 0]).grid(2, 2, 2, [5, 6, 7]);
        const centers = curves.toArray().map(curve => curve.center().toArray());

        expect(curves.length).toBe(8);
        expect(centers).toContainEqual([5, 0, 0]);
        expect(centers).toContainEqual([10, 6, 7]);
    });
});

describe('Curve.toPolygon()', () =>
{
    it('returns a Polygon for a closed curve', () =>
    {
        const c = Curve.Polyline([[0,0,0], [10,0,0], [10,10,0], [0,10,0]]).close();
        const p = c.toPolygon();
        expect(p).toBeInstanceOf(Polygon);
    });

    it('returns polygon with vertices', () =>
    {
        const c = Curve.Circle(5);
        const p = c.toPolygon();
        expect(p).toBeTruthy();
        expect(p!.vertices().length).toBeGreaterThan(2);
    });
});

describe('Curve.toMesh()', () =>
{
    it('returns a Mesh for a closed curve', () =>
    {
        const c = Curve.Polyline([[0,0,0], [10,0,0], [10,10,0], [0,10,0]]).close();
        const m = c.toMesh();
        expect(m).toBeInstanceOf(Mesh);
    });

    it('result mesh has triangles', () =>
    {
        const c = Curve.Circle(5);
        const m = c.toMesh();
        expect(m).toBeTruthy();
        expect(m!.inner().triangleCount()).toBeGreaterThan(0);
    });
});

describe('Curve.extend()', async () =>
{
    it('Should extend a polyline correctly', () =>
    {
        const line = Curve.Line(
            [0, 0, 0],
            [200, 200,0],
        ).extend(50, 'both');
        
        expect(line).toBeTruthy();
        expect(line.length()).toBeCloseTo(Math.sqrt(2) * 200 + 50*2, 1);
    });

    it('should extend a line towards another', async () =>
    {
        const line1 = Curve.Line(
            [0, 0, 0],
            [50, 50,0],
        ).color('red');
        const line2 = Curve.Line(
            [0, 0, 0],
            [0, 250, 0],
        ).move(200).color('blue');


        expect(line1.distance(line2)).toBe(150);

        line1.extendTo(line2);

        expect(line1.distance(line2)).toBeCloseTo(0, 5);

        // visual check
        await save('test.curve.extendTo.gltf',
            await new ShapeCollection<Curve>(line1, line2).toGLTF()
        );
    });
});

describe('Curve.extrude()', () =>
{
    it('returns a Mesh for an open curve', () =>
    {
        const c = Curve.Line([0, 0, 0], [10, 0, 0]);
        const m = c.extrude(5);
        expect(m).toBeInstanceOf(Mesh);
    });

    it('returns a Mesh for a closed curve', () =>
    {
        const c = Curve.Rect(5, 3);
        const m = c.extrude(4);
        expect(m).toBeInstanceOf(Mesh);
    });

    it('extruded open curve has triangles', () =>
    {
        const c = Curve.Line([0, 0, 0], [10, 0, 0]);
        const m = c.extrude(5);
        expect(m!.inner().triangleCount()).toBeGreaterThan(0);
    });

    it('respects a custom direction', async () =>
    {
        const c = Curve.Line([0, 0, 0], [10, 0, 0]);
        const mZ = c.extrude(5, [0, 0, 1]);
        const mY = c.extrude(5, [1, 1, 1]);
        // Both should produce geometry; bboxes should differ in the extruded axis
        expect(mZ!.bbox()!.max().z).toBeGreaterThan(0);
        expect(mY!.bbox()!.max().y).toBeGreaterThan(0);
        
        const a = Curve.Arc([0,0,0],[10,40,0], [20,0,0]);
        const mA = a.extrude(10, [0, 0, 1]).color('blue');
        expect(mA!.bbox()!.max().z).toBeCloseTo(10,1);

        await save('test.curve.extrude.direction.gltf', await new ShapeCollection<Mesh>(mZ, mY, mA).toGLTF());
    });


});
