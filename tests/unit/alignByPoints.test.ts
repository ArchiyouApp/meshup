/**
 * tests/unit/alignByPoints.test.ts
 *
 * alignByPoints() must actually land the source points on the target points.
 * The reference points are deliberately NOT at the world origin: the transform used to be
 * built from Vectors that mutate in place, which only worked when p1 === [0,0,0].
 */
import { beforeAll, describe, it, expect } from 'vitest';
import { initAsync } from '../../src/index';
import { Mesh } from '../../src/Mesh';
import { Curve } from '../../src/Curve';
import { Point } from '../../src/Point';

beforeAll(async () =>
{
    await initAsync();
});

/** Closest point of the mesh geometry to `p` — used to check a reference point really landed there */
const distToMesh = (m: Mesh, p: [number, number, number]): number =>
{
    let best = Infinity;
    m.vertices().forEach(v =>
    {
        const d = Math.hypot(v.x - p[0], v.y - p[1], v.z - p[2]);
        if (d < best) { best = d; }
    });
    return best;
};

describe('Mesh.alignByPoints()', () =>
{
    it('maps 3 source points onto 3 target points (p1 off the origin)', () =>
    {
        // Box from [10,10,10] to [60,30,25]: source points are box corners, none at the origin
        const box = Mesh.BoxBetween([10, 10, 10], [60, 30, 25]);

        const src: [number, number, number][] = [[10, 10, 10], [60, 10, 10], [10, 30, 10]];
        const tgt: [number, number, number][] = [[100, 5, -20], [150, 5, -20], [100, 25, -20]];

        box.alignByPoints(src as any, tgt as any);

        tgt.forEach((t, i) =>
        {
            expect(distToMesh(box, t), `target point ${i} at ${t}`).toBeLessThan(1e-6);
        });
    });

    it('maps 3 points with withScale=true (edge lengths differ)', () =>
    {
        const box = Mesh.BoxBetween([10, 10, 10], [60, 30, 25]);

        // First target edge is twice the source edge → uniform scale of 2
        const src: [number, number, number][] = [[10, 10, 10], [60, 10, 10], [10, 30, 10]];
        const tgt: [number, number, number][] = [[100, 5, -20], [200, 5, -20], [100, 45, -20]];

        box.alignByPoints(src as any, tgt as any, true);

        expect(distToMesh(box, tgt[0])).toBeLessThan(1e-6);
        expect(distToMesh(box, tgt[1])).toBeLessThan(1e-6);
        expect(distToMesh(box, tgt[2])).toBeLessThan(1e-6);

        // the box itself is scaled ×2
        const bb = box.bbox()!;
        expect(bb.width()).toBeCloseTo(100, 4);
        expect(bb.depth()).toBeCloseTo(40, 4);
        expect(bb.height()).toBeCloseTo(30, 4);
    });

    it('maps 2 source points onto 2 target points with scale', () =>
    {
        const box = Mesh.BoxBetween([10, 10, 10], [60, 30, 25]);
        const src: [number, number, number][] = [[10, 10, 10], [60, 10, 10]];
        const tgt: [number, number, number][] = [[100, 5, -20], [200, 5, -20]];

        box.alignByPoints(src as any, tgt as any, true);

        // p1 → q1, and the box grew ×2 along the aligned edge
        expect(distToMesh(box, tgt[0])).toBeLessThan(1e-6);
        expect(box.bbox()!.width()).toBeCloseTo(100, 4);
    });
});

describe('Curve.alignByPoints()', () =>
{
    it('maps 3 source points onto 3 target points (p1 off the origin)', () =>
    {
        const c = Curve.Polyline([[10, 10, 10], [60, 10, 10], [10, 30, 10]]);

        const src: [number, number, number][] = [[10, 10, 10], [60, 10, 10], [10, 30, 10]];
        const tgt: [number, number, number][] = [[100, 5, -20], [150, 5, -20], [100, 25, -20]];

        (c as any).alignByPoints(src, tgt);

        const pts = c.tessellate().map((p: Point) => [p.x, p.y, p.z] as [number, number, number]);
        tgt.forEach((t, i) =>
        {
            const best = Math.min(...pts.map(p => Math.hypot(p[0] - t[0], p[1] - t[1], p[2] - t[2])));
            expect(best, `target point ${i} at ${t}`).toBeLessThan(1e-6);
        });
    });
});
