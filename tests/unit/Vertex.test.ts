/** Vertex.moveTo() / moveToX/Y/Z().
 *  A Vertex is dimensionless, so its bbox centre is the vertex itself: where Mesh.moveTo()
 *  and Curve.moveTo() re-centre a bbox on the target, these simply set the position — while
 *  still carrying the vertex normal along untouched. */
import { beforeAll, describe, it, expect } from 'vitest';
import { initAsync } from '../../src/index';
import { Vertex } from '../../src/Vertex';
import { Point } from '../../src/Point';

beforeAll(async () =>
{
    await initAsync();
});

describe('Vertex.moveTo()', () =>
{
    it('moves the vertex onto an absolute target in-place', () =>
    {
        const v = new Vertex([1, 2, 3]);
        const result = v.moveTo([10, 20, 30]);
        expect(v.toArray()).toEqual([10, 20, 30]);
        expect(result).toBe(v); // returns this
    });

    it('takes loose coordinates and does not drop y/z', () =>
    {
        const v = new Vertex([1, 2, 3]);
        v.moveTo(200, 475, 0);
        expect(v.toArray()).toEqual([200, 475, 0]);
    });

    it('accepts a Point as target', () =>
    {
        const v = new Vertex([1, 2, 3]);
        v.moveTo(new Point(-5, -6, -7));
        expect(v.toArray()).toEqual([-5, -6, -7]);
    });

    it('keeps the normal untouched', () =>
    {
        const v = new Vertex([1, 2, 3], [0, 0, 1]);
        v.moveTo([10, 20, 30]);
        expect(v.normal().toArray()).toEqual([0, 0, 1]);
    });

    it('lands the bbox on the target too', () =>
    {
        const v = new Vertex([1, 2, 3]).moveTo([10, 20, 30]);
        expect(v.bbox().center().toArray()).toEqual([10, 20, 30]);
    });
});

describe('Vertex.moveToX/Y/Z()', () =>
{
    it('only touch their own axis and stay chainable', () =>
    {
        const v = new Vertex([1, 2, 3]);

        expect(v.moveToX(10)).toBe(v);
        expect(v.toArray()).toEqual([10, 2, 3]);

        v.moveToY(20);
        expect(v.toArray()).toEqual([10, 20, 3]);

        v.moveToZ(30);
        expect(v.toArray()).toEqual([10, 20, 30]);
    });

    it('keep the normal untouched', () =>
    {
        const v = new Vertex([1, 2, 3], [0, 1, 0]);
        v.moveToX(10).moveToY(20).moveToZ(30);
        expect(v.normal().toArray()).toEqual([0, 1, 0]);
    });
});
