import { beforeAll, describe, it, expect } from 'vitest';
import { initAsync, getCsgrs } from '../../src/index';

/** Ring area via the shoelace formula on a flat [x,y,x,y,...] point list. */
const ringArea = (flat: Float64Array | number[]): number =>
{
    let a = 0;
    const n = flat.length / 2;
    for (let i = 0; i < n; i++)
    {
        const j = (i + 1) % n;
        a += flat[i * 2] * flat[j * 2 + 1] - flat[j * 2] * flat[i * 2 + 1];
    }
    return Math.abs(a) / 2;
};

const square = (cx: number, cy: number, half: number): number[] => [
    cx - half, cy - half,
    cx + half, cy - half,
    cx + half, cy + half,
    cx - half, cy + half,
];

let wasm: any;

beforeAll(async () =>
{
    await initAsync();
    wasm = getCsgrs();
});

describe('hypercurve engine (hcurve_js bindings)', () =>
{
    it('tessellates an open polyline preserving endpoints', () =>
    {
        const pts = wasm.hcTessellatePolyline(new Float64Array([0, 0, 10, 0, 10, 5]), false, 1e-4);
        expect(pts[0]).toBeCloseTo(0);
        expect(pts[1]).toBeCloseTo(0);
        expect(pts[pts.length - 2]).toBeCloseTo(10);
        expect(pts[pts.length - 1]).toBeCloseTo(5);
    });

    it('computes a circle area = pi r^2 and tessellates a ring', () =>
    {
        const ring = wasm.hcCircle(0, 0, 4, 1e-5);
        expect(ringArea(ring)).toBeCloseTo(Math.PI * 16, 1);
    });

    it('signed area of a 10x10 square is 100', () =>
    {
        expect(Math.abs(wasm.hcSignedArea(new Float64Array(square(0, 0, 5))))).toBeCloseTo(100, 6);
    });

    it('boolean union of two overlapping squares -> 1 ring, area 175', () =>
    {
        const rings = wasm.hcBoolean(
            new Float64Array(square(0, 0, 5)),
            new Float64Array(square(5, 5, 5)),
            'union',
            1e-4,
        ) as Float64Array[];
        expect(rings.length).toBe(1);
        expect(ringArea(rings[0])).toBeCloseTo(175, 4);
    });

    it('boolean intersection -> area 25; difference -> area 75', () =>
    {
        const a = new Float64Array(square(0, 0, 5));
        const b = new Float64Array(square(5, 5, 5));
        const inter = wasm.hcBoolean(a, b, 'intersection', 1e-4) as Float64Array[];
        const diff = wasm.hcBoolean(a, b, 'difference', 1e-4) as Float64Array[];
        expect(ringArea(inter[0])).toBeCloseTo(25, 4);
        expect(ringArea(diff[0])).toBeCloseTo(75, 4);
    });

    it('offsets an open line to the left', () =>
    {
        const off = wasm.hcOffset(new Float64Array([0, 0, 10, 0]), false, 2, 1e-4);
        for (let i = 1; i < off.length; i += 2) { expect(off[i]).toBeCloseTo(2); }
    });

    it('intersects two crossing lines at one point', () =>
    {
        const hits = wasm.hcIntersect(
            new Float64Array([0, 0, 10, 10]),
            new Float64Array([0, 5, 10, 5]),
        );
        expect(hits.length).toBe(2); // one point -> [x, y]
        expect(hits[0]).toBeCloseTo(5);
        expect(hits[1]).toBeCloseTo(5);
    });

    it('tessellates a quadratic NURBS (arch) preserving endpoints and apex', () =>
    {
        const pts = wasm.hcNurbsTessellate(
            2,
            new Float64Array([0, 0, 5, 10, 10, 0]),
            new Float64Array([1, 1, 1]),
            new Float64Array([0, 0, 0, 1, 1, 1]),
            1e-4,
        );
        expect(pts[0]).toBeCloseTo(0);
        expect(pts[pts.length - 2]).toBeCloseTo(10);
        let maxY = -Infinity;
        for (let i = 1; i < pts.length; i += 2) { maxY = Math.max(maxY, pts[i]); }
        expect(maxY).toBeCloseTo(5, 1);
    });
});
