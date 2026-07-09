import { beforeAll, describe, it, expect } from 'vitest';
import { initAsync } from '../../src/index';
import { Mesh } from '../../src/Mesh';
import { Curve } from '../../src/Curve';
import { Polygon } from '../../src/Polygon';
import { Point } from '../../src/Point';
import { Vertex } from '../../src/Vertex';

beforeAll(async () =>
{
    await initAsync();
});

describe('distance() across shape types', () =>
{
    // Reproduces the reported example:
    //   pl = polyline([-100,0,0],[100,0,0],[0,100,0]).close()   → a closed Curve at z=0
    //   p  = plane(10,10)                                       → a 10×10 Mesh at z=0 (x,y ∈ [-5,5])
    // The polyline's first edge runs along y=0,z=0 through x∈[-100,100], crossing the plane.
    const makePlane = () => Curve.Rect(10, 10, [0, 0, 0]).toMesh() as Mesh;
    const makePolyline = () => Curve.Polyline([[-100, 0, 0], [100, 0, 0], [0, 100, 0]]).close();

    it('Mesh.distance(Curve) is ~0 when they overlap (was 95)', () =>
    {
        const p = makePlane();
        const pl = makePolyline();
        expect(p.distance(pl)).toBeCloseTo(0, 5);
    });

    it('Curve.distance(Mesh) is defined and ~0 (was undefined)', () =>
    {
        const p = makePlane();
        const pl = makePolyline();
        expect(pl.distance(p)).toBeCloseTo(0, 5);
    });

    it('Mesh.distance(Curve) returns the true gap when apart', () =>
    {
        const p = makePlane();               // x,y ∈ [-5,5], z=0
        const line = Curve.Polyline([[20, 0, 0], [20, 100, 0]]); // nearest point x=20 → gap 15
        expect(p.distance(line)).toBeCloseTo(15, 4);
        expect(line.distance(p)).toBeCloseTo(15, 4);
    });

    it('symmetric across Point / Vertex / Polygon / Mesh / Curve', () =>
    {
        const mesh = Mesh.Cube(10);                    // centered cube, x,y,z ∈ [-5,5]
        const pt = new Point([15, 0, 0]);              // 10 from the +X face
        const vx = new Vertex(15, 0, 0);
        const poly = Polygon.from([[20, -5, 0], [20, 5, 0], [20, 5, 10], [20, -5, 10]]);
        const curve = Curve.Polyline([[15, 0, 0], [15, 0, 20]]);

        expect(mesh.distance(pt)).toBeCloseTo(10, 4);
        expect(pt.distance(mesh)).toBeCloseTo(10, 4);
        expect(mesh.distance(vx)).toBeCloseTo(10, 4);
        expect(vx.distance(mesh)).toBeCloseTo(10, 4);
        expect(mesh.distance(poly)).toBeCloseTo(15, 4);
        expect(poly.distance(mesh)).toBeCloseTo(15, 4);
        expect(mesh.distance(curve)).toBeCloseTo(10, 4);
        expect(curve.distance(mesh)).toBeCloseTo(10, 4);

        // point-like ↔ curve / polygon
        expect(pt.distance(curve)).toBeCloseTo(0, 4);   // point lies on the curve start
        expect(curve.distance(pt)).toBeCloseTo(0, 4);
        expect(vx.distance(poly)).toBeCloseTo(5, 4);    // vx x=15, poly at x=20
        expect(poly.distance(vx)).toBeCloseTo(5, 4);
    });
});
