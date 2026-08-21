/** flatten() across Mesh / Curve / ShapeCollection.
 *  Flattening collapses geometry onto a coordinate plane (default 'z' → the XY plane) and
 *  filters out the doubles that creates — the brep kernel's Solid.flatten() equivalent. */
import { beforeAll, describe, it, expect } from 'vitest';
import { initAsync } from '../../src/index';
import { Mesh } from '../../src/Mesh';
import { Curve } from '../../src/Curve';
import { ShapeCollection } from '../../src/ShapeCollection';

beforeAll(async () =>
{
    await initAsync();
});

describe('Mesh.flatten()', () =>
{
    it('defaults to axis z and keeps a single face for a box', () =>
    {
        const flat = Mesh.Box(100, 50, 20).moveZ(30).flatten();

        expect(flat.polygons().length).toEqual(1);
        expect(flat.polygons().toArray()[0].vertices().length).toEqual(4);
        expect(flat.bbox().min().z).toBeCloseTo(0);
        expect(flat.bbox().max().z).toBeCloseTo(0);
        expect(flat.bbox().width()).toBeCloseTo(100);
        expect(flat.bbox().depth()).toBeCloseTo(50);
    });

    it("collapses along the given axis, not always z", () =>
    {
        const flat = Mesh.Box(100, 50, 20).flatten('x');

        expect(flat.polygons().length).toEqual(1);
        expect(flat.bbox().min().x).toBeCloseTo(0);
        expect(flat.bbox().max().x).toBeCloseTo(0);
        // the YZ face survives with its real size
        expect(flat.bbox().depth()).toBeCloseTo(50);
        expect(flat.bbox().height()).toBeCloseTo(20);
    });
});

describe('Curve.flatten()', () =>
{
    it('projects onto the XY plane and drops doubled/collapsed segments', () =>
    {
        // A vertical rectangle in the XZ plane: flattened along z its two horizontal edges
        // land on the same line and its two vertical edges collapse to nothing.
        const rect = Curve.Polyline([[0,0,0],[100,0,0],[100,0,40],[0,0,40],[0,0,0]]);
        const flat = rect.flatten();

        expect(flat.segments().length).toEqual(1);
        expect(flat.length()).toBeCloseTo(100);
        expect(flat.bbox().min().z).toBeCloseTo(0);
        expect(flat.bbox().max().z).toBeCloseTo(0);
    });

    it('leaves a curve already in the plane intact', () =>
    {
        const rect = Curve.Rect(100, 50);
        const segsBefore = rect.segments().length;
        const flat = rect.flatten();

        expect(flat.segments().length).toEqual(segsBefore);
        expect(flat.length()).toBeCloseTo(2 * (100 + 50));
    });
});

describe('ShapeCollection.flatten()', () =>
{
    it('flattens every shape and removes shapes that become identical', () =>
    {
        const a = Mesh.Box(100, 50, 20);
        const b = Mesh.Box(100, 50, 20).moveZ(200); // same footprint, different height
        const c = Mesh.Box(60, 60, 20).moveX(500);

        const col = new ShapeCollection<Mesh>(a, b, c).flatten();

        expect(col.length).toEqual(2);
        expect(col.toArray().every(m => m.bbox().max().z === 0)).toEqual(true);
    });
});
