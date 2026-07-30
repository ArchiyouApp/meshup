import { beforeAll, describe, it, expect } from 'vitest';
import { initAsync } from '../../src/index';
import { Curve } from '../../src/Curve';

beforeAll(async () =>
{
    await initAsync();
});

describe('Curve.Ellipse()', () =>
{
    it('creates a non-null closed curve', () =>
    {
        const e = Curve.Ellipse(3, 1.5);
        expect(e).toBeTruthy();
        expect(e.isClosed()).toBe(true);
    });

    it('classifies as Ellipse', () =>
    {
        expect(Curve.Ellipse(3, 1.5).subtype()).toBe('Ellipse');
    });

    it('bbox spans the semi-axes', () =>
    {
        const bb = Curve.Ellipse(3, 1.5).bbox()!;
        expect(bb.min().x).toBeCloseTo(-3, 2);
        expect(bb.max().x).toBeCloseTo(3, 2);
        expect(bb.min().y).toBeCloseTo(-1.5, 2);
        expect(bb.max().y).toBeCloseTo(1.5, 2);
    });

    it('has area ~ pi*a*b', () =>
    {
        const a = Curve.Ellipse(3, 1.5).area();
        expect(a).toBeDefined();
        expect(Math.abs(a as number)).toBeCloseTo(Math.PI * 3 * 1.5, 1);
    });

    it('a rotated ellipse swaps its extents', () =>
    {
        // 90 degrees: major axis becomes vertical.
        const bb = Curve.Ellipse(3, 1.5, [0, 0, 0], 90).bbox()!;
        expect(bb.max().x).toBeCloseTo(1.5, 2);
        expect(bb.max().y).toBeCloseTo(3, 2);
    });

    it('offsets outward into a larger closed curve', () =>
    {
        const e = Curve.Ellipse(3, 1.5);
        const o = e.offset(0.5);
        expect(o).toBeTruthy();
        expect(o!.isClosed()).toBe(true);
    });

    it('tessellates to a smooth point set that stays on the ellipse', () =>
    {
        const pts = Curve.Ellipse(3, 1.5).tessellate();
        expect(pts.length).toBeGreaterThan(16);
        // Every tessellation point satisfies (x/3)^2 + (y/1.5)^2 ~ 1.
        for (const p of pts)
        {
            const f = (p.x / 3) ** 2 + (p.y / 1.5) ** 2;
            expect(f).toBeCloseTo(1, 2);
        }
    });
});

describe('Curve.EllipticalArc()', () =>
{
    it('a quarter arc is open and spans vertex to vertex', () =>
    {
        const a = Curve.EllipticalArc(3, 1.5, 0, 90);
        expect(a.isClosed()).toBe(false);
        // Start at +x vertex (3,0), end at +y vertex (0,1.5).
        expect(a.start().x).toBeCloseTo(3, 3);
        expect(a.start().y).toBeCloseTo(0, 3);
        expect(a.end().x).toBeCloseTo(0, 3);
        expect(a.end().y).toBeCloseTo(1.5, 3);
    });

    it('a full 360 sweep closes into an ellipse', () =>
    {
        expect(Curve.EllipticalArc(3, 1.5, 0, 360).isClosed()).toBe(true);
    });
});
