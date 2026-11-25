/**
 * rowFill(): fill a span with a row of copies at a centre-to-centre spacing, like studs in a wall
 * or joists in a floor. The span is a length or runs up to another shape; members sit on a grid
 * from the start ('grid') or in equal bays ('even'), with or without a closing member at the end.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Curve, Mesh, Vector, initAsync, rowFillOffsets } from '../../src/index';

beforeAll(async () =>
{
    await initAsync();
});

/** A stud 38 x 140 x 2400 with its back face on x = 0 */
const stud = () => Mesh.BoxBetween([0, 0, 0], [38, 140, 2400]).name('stud');
const minX = (col: { toArray(): Array<any> }) => col.toArray().map(s => +s.bbox()!.min().x.toFixed(6));

describe('rowFill()', () =>
{
    it('puts studs on the grid from the start and closes flush with the end', () =>
    {
        const s = stud();
        const studs = s.rowFill(3000, 600);
        expect(minX(studs)).toEqual([0, 600, 1200, 1800, 2400, 2962]);
        expect(studs.first()).toBe(s);
        expect(studs.toArray().map(m => m.name())).toEqual(['stud1', 'stud2', 'stud3', 'stud4', 'stud5', 'stud6']);
    });

    it('lets a grid member give way to the closing member it would overlap', () =>
    {
        expect(minX(stud().rowFill(2440, 600))).toEqual([0, 600, 1200, 1800, 2402]);
    });

    it('leaves the closing member out with close = false', () =>
    {
        expect(minX(stud().rowFill(3000, 600, 'x', 'grid', false))).toEqual([0, 600, 1200, 1800, 2400]);
    });

    it('splits the span in equal bays of at most the spacing with even', () =>
    {
        const xs = minX(stud().rowFill(3000, 600, 'x', 'even'));   // 2962 over 5 bays
        expect(xs.length).toBe(6);
        xs.forEach((x, i) => expect(x).toBeCloseTo(i * 2962 / 5, 6));
        expect(minX(stud().rowFill(3000, 600, 'x', 'even', false)).length).toBe(5);
    });

    it('fills up to the near face of another shape', () =>
    {
        const wallB = Mesh.BoxBetween([0, 2000, 0], [3000, 2140, 300]);
        const joist = Mesh.BoxBetween([0, 0, 0], [3000, 50, 200]);
        const ys = joist.rowFill(wallB, 400, 'y').toArray().map(j => +j.bbox()!.min().y.toFixed(6));
        expect(ys).toEqual([0, 400, 800, 1200, 1600, 1950]);
    });

    it('runs along a minus axis or a vector', () =>
    {
        const xs = minX(Mesh.BoxBetween([-38, 0, 0], [0, 140, 2400]).rowFill(1000, 400, '-x'));
        expect(xs).toEqual([-38, -438, -838, -1000]);
        const zs = stud().rowFill(5000, 2500, new Vector(0, 0, 1), 'grid', false).toArray().map(m => +m.bbox()!.min().z.toFixed(6));
        expect(zs).toEqual([0, 2500]);
    });

    it('fills with curves too', () =>
    {
        const line = Curve.Line([0, 0, 0], [0, 1000, 0]);
        const xs = line.rowFill(1000, 300).toArray().map(c => +c.bbox()!.min().x.toFixed(6));
        expect(xs).toEqual([0, 300, 600, 900, 1000]);
    });

    it('warns and keeps only the first member when the other shape is behind or the span too short', () =>
    {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const s = stud();
        expect(s.rowFill(Mesh.BoxBetween([-500, 0, 0], [-400, 100, 100]), 600).toArray()).toEqual([s]);
        expect(warn).toHaveBeenLastCalledWith(expect.stringMatching(/behind/));
        const t = stud();
        expect(t.rowFill(30, 600).toArray()).toEqual([t]);
        expect(warn).toHaveBeenLastCalledWith(expect.stringMatching(/shorter than one member/));
        warn.mockRestore();
    });

    it('throws when members overlap or the arguments are wrong', () =>
    {
        expect(() => stud().rowFill(3000, 20)).toThrow(/overlap/);
        expect(() => stud().rowFill(3000, 0)).toThrow(/spacing/);
        expect(() => stud().rowFill(3000, 600, 'x', 'random' as any)).toThrow(/distribute/);
    });
});

describe('rowFillOffsets()', () =>
{
    const box = { min: () => ({ x: 0, y: 0, z: 0 }), max: () => ({ x: 50, y: 10, z: 10 }) };

    it('gives a single member when the span is one member', () =>
    {
        expect(rowFillOffsets(box, 50, 400, [1, 0, 0], 'grid', true, 'test')).toEqual([0]);
        expect(rowFillOffsets(box, 50, 400, [1, 0, 0], 'even', true, 'test')).toEqual([0]);
    });

    it('lands the last grid member on the closing one when the span is a multiple', () =>
    {
        expect(rowFillOffsets(box, 850, 400, [1, 0, 0], 'grid', true, 'test')).toEqual([0, 400, 800]);
    });
});
