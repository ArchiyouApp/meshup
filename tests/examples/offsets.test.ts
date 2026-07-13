import { beforeAll, describe, it, expect } from 'vitest';
import { ShapeCollection, Vector, initAsync } from '../../src/index';
import { Curve } from '../../src/Curve';
import { save } from '../../src/utils';

const OUTPUT_DIR = './tests/outputs/offsets/';

beforeAll(async () => 
{
    await initAsync();
});

describe('Example: Offsets', async () =>
{
    it('Can do simple offsets', async () =>
    {
        const rect = Curve.Rect(100, 100).color('red');
        const offsets = rect.replicate(5, (c,i) => c.offset(i*10)!.moveZ((i+1)*20).color(255-i*50, 0, 0));
        expect(offsets).toBeTruthy();
        expect(offsets.length).toBe(5);

        // Save as GLTF to view in 3D 
        await save(OUTPUT_DIR + 'test.offsets.basic.gltf', await new ShapeCollection(rect, offsets).toGLTF());
    });

    it('Can do advanced offsets', async () =>
    {
        const c1 = Curve.Circle(100);
        const c2 = c1.copy().move(100*1.5,0);
        const circles = c1.union(c2) as Curve;
        expect(circles.isCompound()).toBe(true);

        const deg1 = circles.copy().toDegree1();
        const circlesOffset = circles.copy().offset(-20);
        const circleOffsetFallback = circles.copy().offsetFallback(20);
    
        await save(OUTPUT_DIR + 'test.offsets.circles.gltf', await new ShapeCollection(circles!, deg1.moveZ(10), circlesOffset!.moveZ(20), circleOffsetFallback!.moveZ(30)
            /* circles!.copy().offset(20)!.color('yellow')*/).toGLTF());
        //await save(OUTPUT_DIR + 'test.curves.ops.svg', new ShapeCollection<circles, rect, cc, /*un!, unOffsets*/).toSVG());
    });

    it('Positive offset always grows and negative always shrinks a closed curve, regardless of winding direction', () =>
    {
        const rect = Curve.Rect(100, 100);
        const rectReversed = rect.copy().reverse();

        expect(rect.copy().offset(10)!.area()!).toBeGreaterThan(rect.area()!);
        expect(rect.copy().offset(-10)!.area()!).toBeLessThan(rect.area()!);

        // Same behaviour must hold for a curve wound the other way around
        expect(rectReversed.copy().offset(10)!.area()!).toBeGreaterThan(rectReversed.area()!);
        expect(rectReversed.copy().offset(-10)!.area()!).toBeLessThan(rectReversed.area()!);

        // ...and for the geo-buf based fallback offset method
        expect(rect.copy().offsetFallback(10)!.area()!).toBeGreaterThan(rect.area()!);
        expect(rect.copy().offsetFallback(-10)!.area()!).toBeLessThan(rect.area()!);
        expect(rectReversed.copy().offsetFallback(10)!.area()!).toBeGreaterThan(rectReversed.area()!);
        expect(rectReversed.copy().offsetFallback(-10)!.area()!).toBeLessThan(rectReversed.area()!);
    });

    it('Positive offset always grows and negative always shrinks an open (peaked) polyline', () =>
    {
        // A shallow "tent" shape lying in the XZ plane, as seen in real world scripts
        const WIDTH = 100;
        const MID = 50;
        const pl1 = Curve.Polyline([0, 0, 0], [WIDTH * MID / 100, 0, 20], [WIDTH, 0, 0]);
        expect(pl1.isClosed()).toBe(false);

        const grown = pl1.copy().offset(1)!;
        const shrunk = pl1.copy().offset(-1)!;

        expect(grown.bbox().width()).toBeGreaterThan(pl1.bbox().width());
        expect(shrunk.bbox().width()).toBeLessThan(pl1.bbox().width());
    });

    it('Can offset a single straight line that lies on a non-XY coordinate plane', () =>
    {
        const DIST = 10;

        // A straight line is planar-ambiguous; when it lies on an axis-aligned
        // coordinate plane (one coordinate constant) we detect that plane and offset in it.
        const cases: Array<{ name: string, line: Curve, constAxis: 'x'|'y'|'z', constVal: number }> = [
            { name: 'XY (z=0)', line: Curve.Line([0,0,0],[100,100,0]), constAxis: 'z', constVal: 0 },
            { name: 'XZ (y=0)', line: Curve.Line([0,0,0],[100,0,100]), constAxis: 'y', constVal: 0 },
            { name: 'YZ (x=0)', line: Curve.Line([0,0,0],[0,100,100]), constAxis: 'x', constVal: 0 },
        ];

        for (const { line, constAxis, constVal } of cases)
        {
            const offsetted = line.copy().offset(DIST);
            expect(offsetted).toBeTruthy();

            // Same length as the original (a parallel line)
            expect(offsetted!.length()).toBeCloseTo(line.length(), 4);

            // Result stays on the same coordinate plane (constant coordinate preserved)
            for (const p of offsetted!.points())
            {
                expect(p[constAxis]).toBeCloseTo(constVal, 4);
            }

            // Perpendicular distance from the original line equals DIST
            const a = line.start().toArray();
            const b = line.end().toArray();
            const dir = Vector.from(b[0]-a[0], b[1]-a[1], b[2]-a[2]).normalize();
            for (const p of offsetted!.points())
            {
                const ap = Vector.from(p.x-a[0], p.y-a[1], p.z-a[2]);
                const perp = dir.copy().cross(ap).length(); // |dir × ap| = perpendicular distance
                expect(perp).toBeCloseTo(DIST, 4);
            }
        }
    });
});
