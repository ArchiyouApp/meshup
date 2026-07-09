import { beforeAll, describe, it, expect } from 'vitest';
import { ShapeCollection, initAsync } from '../../src/index';
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
});
