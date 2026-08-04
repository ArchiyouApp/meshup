/**
 *  rotateToOrtho.test.ts
 *
 *  Mesh.rotateToOrtho() / Curve.rotateToOrtho() — align a shape with the world axes
 *  (brep Shape.rotateToOrtho() parity), plus the helpers they build on:
 *  rotateVecToVec(), rotateToAxesOBbox(), rotateToAlignLargestFaceToZ()
 *  and the pure utils primaryOrthoXYAngle() / shortestArcAxisAngle().
 */

import { beforeAll, describe, it, expect } from 'vitest';
import { initAsync } from '../../src/index';
import { Mesh } from '../../src/Mesh';
import { Curve } from '../../src/Curve';
import { Polygon } from '../../src/Polygon';
import { Vector } from '../../src/Vector';
import { primaryOrthoXYAngle, shortestArcAxisAngle } from '../../src/utils';

beforeAll(async () =>
{
    await initAsync();
});

describe('utils.shortestArcAxisAngle()', () =>
{
    it('returns no rotation for parallel directions', () =>
    {
        expect(shortestArcAxisAngle({ x: 0, y: 0, z: 2 }, { x: 0, y: 0, z: 5 }).angle).toBe(0);
    });

    it('returns 180 degrees around a perpendicular axis for anti-parallel directions', () =>
    {
        const r = shortestArcAxisAngle({ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 });
        expect(r.angle).toBeCloseTo(180, 6);
        // axis must be unit and perpendicular to the input
        expect(Math.hypot(...r.axis)).toBeCloseTo(1, 6);
        expect(r.axis[2]).toBeCloseTo(0, 6);
    });

    it('returns 90 degrees around Z for X -> Y', () =>
    {
        const r = shortestArcAxisAngle({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
        expect(r.angle).toBeCloseTo(90, 6);
        expect(r.axis).toEqual([0, 0, 1]);
    });

    it('never produces NaN for zero-length input', () =>
    {
        expect(shortestArcAxisAngle({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }).angle).toBe(0);
    });
});

describe('utils.primaryOrthoXYAngle()', () =>
{
    const edgesAt = (deg: number, count: number, length: number) =>
        Array.from({ length: count }, () => (
        {
            x: Math.cos(deg * Math.PI / 180) * length,
            y: Math.sin(deg * Math.PI / 180) * length,
            z: 0,
            length,
        }));

    it('returns 0 for an already aligned set of edges', () =>
    {
        expect(primaryOrthoXYAngle([...edgesAt(0, 4, 10), ...edgesAt(90, 4, 10)], 'horizontal')).toBeCloseTo(0, 6);
    });

    it('turns the dominant direction onto the Y axis (vertical)', () =>
    {
        // 6 long edges at 20 degrees dominate 2 short ones at 70
        const angle = primaryOrthoXYAngle([...edgesAt(20, 6, 100), ...edgesAt(70, 2, 5)], 'vertical');
        expect(angle).toBeCloseTo(70, 4); // 20 -> 90
    });

    it('turns the dominant direction onto the X axis (horizontal)', () =>
    {
        const angle = primaryOrthoXYAngle([...edgesAt(20, 6, 100), ...edgesAt(70, 2, 5)], 'horizontal');
        expect(angle).toBeCloseTo(-20, 4); // 20 -> 0
    });

    it('treats an edge and its reverse as the same line', () =>
    {
        const angle = primaryOrthoXYAngle([...edgesAt(30, 3, 10), ...edgesAt(210, 3, 10)], 'horizontal');
        expect(angle).toBeCloseTo(-30, 4);
    });

    it('never turns more than a quarter turn', () =>
    {
        [0, 15, 44, 46, 89, 91, 134, 179].forEach(a =>
        {
            const r = primaryOrthoXYAngle(edgesAt(a, 4, 10), 'horizontal');
            expect(Math.abs(r)).toBeLessThanOrEqual(90);
        });
    });

    it('ignores near-vertical edges that have no meaningful XY direction', () =>
    {
        const vertical = Array.from({ length: 20 }, () => ({ x: 0, y: 0, z: 100, length: 100 }));
        const angle = primaryOrthoXYAngle([...vertical, ...edgesAt(30, 2, 10)], 'horizontal');
        expect(angle).toBeCloseTo(-30, 4);
    });

    it('returns 0 when there is nothing to align', () =>
    {
        expect(primaryOrthoXYAngle([], 'horizontal')).toBe(0);
    });
});

describe('Mesh.rotateVecToVec()', () =>
{
    it('rotates a box so its long axis follows the target direction', () =>
    {
        const m = Mesh.Box(100, 10, 10);   // long along X
        m.rotateVecToVec([1, 0, 0], [0, 1, 0]);
        const bb = m.bbox();
        expect(bb.width()).toBeCloseTo(10, 3);   // X span
        expect(bb.depth()).toBeCloseTo(100, 3);  // Y span
    });

    it('keeps the pivot point fixed', () =>
    {
        const m = Mesh.Box(100, 10, 10).moveTo(50, 0, 0);
        m.rotateVecToVec([1, 0, 0], [0, 1, 0], [0, 0, 0]);
        const bb = m.bbox();
        // rotated around the origin: the box now spans Y from ~0 to ~100
        expect(bb.minY()).toBeCloseTo(0, 3);
        expect(bb.maxY()).toBeCloseTo(100, 3);
    });

    it('is a no-op for directions that already match', () =>
    {
        const m = Mesh.Box(100, 10, 10);
        const before = m.bbox();
        m.rotateVecToVec([0, 0, 1], [0, 0, 2]);
        expect(m.bbox().width()).toBeCloseTo(before.width(), 6);
        expect(m.bbox().depth()).toBeCloseTo(before.depth(), 6);
    });
});

describe('Mesh.rotateToAlignLargestFaceToZ()', () =>
{
    it('brings the dominant face of a tilted plate parallel to XY', () =>
    {
        const m = Mesh.Box(200, 100, 10).rotateX(35);
        m.rotateToAlignLargestFaceToZ();
        const bb = m.bbox();
        expect(bb.height()).toBeCloseTo(10, 1); // thinnest again along Z
    });
});

describe('Mesh.rotateToOrtho()', () =>
{
    it('aligns a plate rotated around Z back to the axes (vertical: long side on Y)', () =>
    {
        const m = Mesh.Box(200, 100, 10).rotateZ(37);
        m.rotateToOrtho('vertical');
        const bb = m.bbox();
        expect(bb.height()).toBeCloseTo(10, 1);
        expect(bb.width()).toBeCloseTo(100, 1);
        expect(bb.depth()).toBeCloseTo(200, 1);
    });

    it('aligns the same plate with the long side on X (horizontal)', () =>
    {
        const m = Mesh.Box(200, 100, 10).rotateZ(37);
        m.rotateToOrtho('horizontal');
        const bb = m.bbox();
        expect(bb.height()).toBeCloseTo(10, 1);
        expect(bb.width()).toBeCloseTo(200, 1);
        expect(bb.depth()).toBeCloseTo(100, 1);
    });

    it('aligns a plate tumbled around all three axes', () =>
    {
        const m = Mesh.Box(200, 100, 10).rotateX(20).rotateY(-15).rotateZ(40);
        m.rotateToOrtho('horizontal');
        const bb = m.bbox();
        expect(bb.height()).toBeCloseTo(10, 0);
        expect(bb.width()).toBeCloseTo(200, 0);
        expect(bb.depth()).toBeCloseTo(100, 0);
    });

    it('leaves an already aligned box alone', () =>
    {
        const m = Mesh.Box(200, 100, 10);
        const before = m.bbox();
        m.rotateToOrtho('horizontal');
        const bb = m.bbox();
        expect(bb.width()).toBeCloseTo(before.width(), 1);
        expect(bb.depth()).toBeCloseTo(before.depth(), 1);
        expect(bb.height()).toBeCloseTo(before.height(), 1);
        expect(bb.center().x).toBeCloseTo(before.center().x, 1);
        expect(bb.center().y).toBeCloseTo(before.center().y, 1);
    });

    it('autoRotate() is an alias', () =>
    {
        const m = Mesh.Box(200, 100, 10).rotateZ(37);
        m.autoRotate('horizontal');
        const bb = m.bbox();
        expect(bb.width()).toBeCloseTo(200, 1);
        expect(bb.depth()).toBeCloseTo(100, 1);
    });
});

describe('Polygon.rotateToOrtho()', () =>
{
    const rect = () => Polygon.from([[0, 0, 0], [200, 0, 0], [200, 100, 0], [0, 100, 0]]);

    it('aligns a rectangle rotated around Z back to the axes', () =>
    {
        const p = rect().rotateZ(37);
        p.rotateToOrtho('horizontal');
        const bb = p.bbox()!;
        expect(bb.width()).toBeCloseTo(200, 1);
        expect(bb.depth()).toBeCloseTo(100, 1);
        expect(bb.height()).toBeCloseTo(0, 3);
    });

    it('puts the dominant direction on Y when vertical', () =>
    {
        const p = rect().rotateZ(37);
        p.rotateToOrtho('vertical');
        const bb = p.bbox()!;
        expect(bb.width()).toBeCloseTo(100, 1);
        expect(bb.depth()).toBeCloseTo(200, 1);
    });

    it('lays a tilted rectangle flat and aligns it', () =>
    {
        const p = rect().rotateX(30).rotateZ(25);
        p.rotateToOrtho('horizontal');
        const bb = p.bbox()!;
        expect(bb.height()).toBeCloseTo(0, 2);
        expect(bb.width()).toBeCloseTo(200, 0);
        expect(bb.depth()).toBeCloseTo(100, 0);
    });
});

describe('Curve.rotateToOrtho()', () =>
{
    it('aligns a rectangle rotated around Z back to the axes', () =>
    {
        const c = Curve.Rect(200, 100).rotateZ(37);
        c.rotateToOrtho('horizontal');
        const bb = c.bbox()!;
        expect(bb.width()).toBeCloseTo(200, 1);
        expect(bb.depth()).toBeCloseTo(100, 1);
        expect(bb.height()).toBeCloseTo(0, 3);
    });

    it('puts the dominant direction on Y when vertical', () =>
    {
        const c = Curve.Rect(200, 100).rotateZ(37);
        c.rotateToOrtho('vertical');
        const bb = c.bbox()!;
        expect(bb.width()).toBeCloseTo(100, 1);
        expect(bb.depth()).toBeCloseTo(200, 1);
    });

    it('lays a tilted rectangle flat and aligns it', () =>
    {
        const c = Curve.Rect(200, 100).rotateX(30).rotateZ(25);
        c.rotateToOrtho('horizontal');
        const bb = c.bbox()!;
        expect(bb.height()).toBeCloseTo(0, 2);
        expect(bb.width()).toBeCloseTo(200, 0);
        expect(bb.depth()).toBeCloseTo(100, 0);
    });

    it('keeps an already aligned rectangle in place', () =>
    {
        const c = Curve.Rect(200, 100);
        const before = c.bbox()!;
        c.rotateToOrtho('horizontal');
        const bb = c.bbox()!;
        expect(bb.width()).toBeCloseTo(before.width(), 1);
        expect(bb.depth()).toBeCloseTo(before.depth(), 1);
        expect(bb.center().x).toBeCloseTo(before.center().x, 1);
        expect(bb.center().y).toBeCloseTo(before.center().y, 1);
    });

    it('rotateVecToVec() turns a line onto a target direction', () =>
    {
        const c = Curve.Line([0, 0, 0], [100, 0, 0]);
        c.rotateVecToVec([1, 0, 0], [0, 1, 0], [0, 0, 0]);
        const end = Vector.from(c.end());
        expect(end.x).toBeCloseTo(0, 3);
        expect(end.y).toBeCloseTo(100, 3);
    });
});
